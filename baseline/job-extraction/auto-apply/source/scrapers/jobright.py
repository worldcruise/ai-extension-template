"""Scraper for the jobright.ai recommendations feed.

Selectors below were reverse-engineered from a real logged-in DOM dump
(debug/jobright_headed.html, captured via the app's own debug hook) - not
guessed. jobright is a Next.js/antd app using CSS Modules, so class names
look like `index_job-title__Riiip`: a stable semantic prefix + a hash suffix
that can change on redeploy. Every selector here matches on the stable
prefix (`[class*="index_job-title__"]`) rather than the full hashed class,
so a redeploy that only changes hashes won't break this - only a real
markup/naming change would, at which point re-run Sync, look at the fresh
debug/jobright_*.html dump, and adjust the selector constants below.

Key structural facts this scraper relies on:
- Each job card is a `div[class*="index_job-card__"]` whose `id` attribute
  IS jobright's own job id (e.g. "6a60248db0f20036bc634e4d") - used directly
  as our external_id, no need to parse it out of a URL.
- The card wraps an `<a href="/jobs/info/<id>">` - that's the canonical job
  URL used both as our job_url and what gets handed to tsenta on Apply.
  (jobright itself also has "APPLY NOW"/"Apply with Autofill" buttons and an
  icon-only "not interested" button, but our own Pass/Apply live entirely in
  our UI/DB - we don't click jobright's own action buttons.)
- Metadata (location/type/salary/work-mode/seniority/experience) each live
  in a `div[class*="index_job-metadata-item__"]` containing an
  `svg[aria-label=...]` icon followed by a `span` with the value text.
- The feed card's own link only points back to jobright's *own* detail page,
  not the employer's real application page - tsenta needs the latter. Each
  job's detail page (`/jobs/info/<id>`) embeds a
  `<script id="jobright-helper-job-detail-info" type="application/json">`
  blob whose `jobResult.applyLink` (same as `jobResult.originalUrl` in both
  samples checked) IS the real employer application URL - present in the
  page's initial HTML for both "APPLY NOW" and "Apply with Autofill" cards,
  with no need to ever click jobright's own Apply button (which we
  deliberately never do - "Apply with Autofill" reads as something that
  could submit a real application on click, and clicking through to find
  out isn't a safe way to test that). So: for every job that's still
  undecided (`status == "new"`), we do one extra read-only navigation to its
  detail page purely to read this JSON.
- Only jobs 0-2 days old are pulled (`common.is_recent`, parsed from the
  card's own "X hours/days ago" text via `_posted_label_to_seconds`) - the
  feed is ranked by match score, not recency, so every card still has to be
  scrolled past and checked rather than stopping at the first old one.
"""

import json
import os
import re

from playwright.sync_api import sync_playwright

import config as cfg
from automation.browser import get_logged_in_page, dump_debug_snapshot
from db import db
from models import Job
from scrapers import common

CARD_SELECTOR = '[class*="index_job-card__"]'
TITLE_SELECTOR = '[class*="index_job-title__"]'
COMPANY_SELECTOR = '[class*="index_company-name__"]'
LOCATION_SELECTOR = '[class*="index_primary-location__"]'
POSTED_SELECTOR = '[class*="index_publish-time__"]'
METADATA_ITEM_SELECTOR = '[class*="index_job-metadata-item__"]'
TAG_SELECTORS = [
    '[class*="index_company-highlight-tag__"]',
    '[class*="index_social-connection-school-tag__"]',
    '[class*="index_jobTag__"]',
]
DETAIL_LINK_SELECTOR = 'a[href^="/jobs/info/"]'
APPLY_INFO_SCRIPT_SELECTOR = "#jobright-helper-job-detail-info"

POSTED_AGE_RE = re.compile(r"(\d+)\s+(minute|hour|day|week|month)s?\s+ago", re.I)
AGE_UNIT_SECONDS = {"minute": 60, "hour": 3600, "day": 86400, "week": 604800, "month": 2_592_000}

DEBUG_DIR = os.path.join(cfg.BASE_DIR, "debug")


def _looks_like_feed_page(page):
    return page.locator(CARD_SELECTOR).count() > 0


def sync_jobs(app):
    """Scrapes the jobright.ai feed and upserts new jobs into the DB.
    Returns a summary dict. Must be called inside an app context.
    """
    with sync_playwright() as p:
        context, page = get_logged_in_page(
            p,
            cfg.JOBRIGHT_PROFILE_DIR,
            cfg.JOBRIGHT_FEED_URL,
            is_logged_in=_looks_like_feed_page,
            debug_label="jobright",
        )
        try:
            basics, too_old = _collect_all_cards(page)
            dump_debug_snapshot(page, "jobright_after_scroll")

            created, updated, skipped = 0, 0, 0
            for basic in basics:
                existing = Job.query.filter_by(
                    source="jobright", external_id=basic["external_id"]
                ).first()
                if existing and existing.status != "new":
                    skipped += 1
                    continue

                detail = _fetch_detail_info(page, basic["external_id"])
                data = dict(basic)
                if detail["apply_url"]:
                    data["job_url"] = detail["apply_url"]
                data["description"] = detail["description"]

                is_new = _upsert_job(data)
                if is_new:
                    created += 1
                else:
                    updated += 1

                # Commit per job instead of once at the end. _fetch_detail_info
                # above drives the browser, so batching the whole feed into one
                # transaction keeps SQLite's single write lock held for minutes
                # and starves every other writer - the apply worker included.
                db.session.commit()
            return {
                "found": len(basics),
                "created": created,
                "updated": updated,
                "skipped": skipped,
                "too_old": too_old,
            }
        finally:
            context.close()


def _collect_all_cards(page, max_rounds=40):
    """jobright's feed is a virtualized infinite-scroll list: cards that
    scroll out of view get unmounted, so the DOM never holds the full set at
    once and we can't just "scroll until stable then read". Instead, harvest
    whatever cards are currently mounted after every scroll step (deduping by
    job id) before they get unmounted, and stop once a few consecutive
    scrolls produce no new ids.

    The feed isn't sorted by recency (it's ranked by match), so we can't stop
    early once we hit an old one - every card gets scrolled past and checked,
    only 0-2-day-old ones make it into the returned list. Returns
    (basics, too_old_count).
    """
    seen_ids = set()
    basics = []
    too_old = 0
    stable_rounds = 0
    for _ in range(max_rounds):
        new_this_round = 0
        for card in page.locator(CARD_SELECTOR).all():
            job_id = card.get_attribute("id")
            if not job_id or job_id in seen_ids:
                continue
            seen_ids.add(job_id)
            new_this_round += 1

            basic = _extract_card_basic(card)
            if not basic:
                continue
            if not common.is_recent(_posted_label_to_seconds(basic["posted_label"])):
                too_old += 1
                continue
            basics.append(basic)

        if new_this_round == 0:
            stable_rounds += 1
            if stable_rounds >= 3:
                break
        else:
            stable_rounds = 0

        page.mouse.wheel(0, 3000)
        page.wait_for_timeout(1200)
    return basics, too_old


def _posted_label_to_seconds(label):
    if not label:
        return None
    m = POSTED_AGE_RE.search(label)
    if not m:
        return None
    return int(m.group(1)) * AGE_UNIT_SECONDS[m.group(2).lower()]


def _text_or_none(locator):
    try:
        if locator.count() == 0:
            return None
        t = locator.first.inner_text().strip()
        return t or None
    except Exception:
        return None


def _metadata_value(card, aria_label):
    item = card.locator(f'{METADATA_ITEM_SELECTOR}:has(svg[aria-label="{aria_label}"])')
    if item.count() == 0:
        return None
    return _text_or_none(item.first.locator("span"))


def _extract_card_basic(card):
    """Everything readable straight off the feed card. `job_url` here is
    jobright's own detail page - `sync_jobs` overwrites it with the real
    employer application link fetched via `_fetch_detail_info` before saving,
    falling back to this if that fetch fails.
    """
    job_id = card.get_attribute("id")
    if not job_id:
        return None

    title = _text_or_none(card.locator(TITLE_SELECTOR))
    if not title:
        return None
    company = _text_or_none(card.locator(COMPANY_SELECTOR))
    location = _text_or_none(card.locator(LOCATION_SELECTOR))
    posted_label = _text_or_none(card.locator(POSTED_SELECTOR))
    work_mode = _metadata_value(card, "remote")

    tags = []
    for sel in TAG_SELECTORS:
        loc = card.locator(sel)
        for i in range(loc.count()):
            t = loc.nth(i).inner_text().strip()
            if t:
                tags.append(t)

    href = None
    link = card.locator(DETAIL_LINK_SELECTOR)
    if link.count() > 0:
        href = link.first.get_attribute("href")
    jobright_url = f"https://jobright.ai{href}" if href else f"https://jobright.ai/jobs/info/{job_id}"

    return {
        "external_id": job_id,
        "title": title,
        "company": company,
        "location": location,
        "work_mode": work_mode.title() if work_mode else None,
        "posted_label": posted_label,
        "tags": ", ".join(dict.fromkeys(tags)),
        "job_url": jobright_url,
        "raw_json": json.dumps({
            "jobright_url": jobright_url,
            "job_type": _metadata_value(card, "time"),
            "salary": _metadata_value(card, "money"),
            "seniority": _metadata_value(card, "seniority"),
            "years_exp": _metadata_value(card, "date"),
        }),
    }


def _fetch_detail_info(page, job_id):
    """Reads the real employer application URL and a composed job
    description off the job's detail page. Read-only - navigates and parses
    embedded JSON, never clicks jobright's own Apply button. Returns
    {"apply_url": ..., "description": ...} - either may be None on failure.
    """
    try:
        page.goto(f"https://jobright.ai/jobs/info/{job_id}", wait_until="domcontentloaded", timeout=20_000)
        page.wait_for_selector(APPLY_INFO_SCRIPT_SELECTOR, state="attached", timeout=15_000)
        raw = page.locator(APPLY_INFO_SCRIPT_SELECTOR).text_content()
        job_result = json.loads(raw).get("jobResult", {})
        return {
            "apply_url": job_result.get("applyLink") or job_result.get("originalUrl") or None,
            "description": _build_description(job_result),
        }
    except Exception:
        return {"apply_url": None, "description": None}


def _build_description(job_result):
    """jobright doesn't expose one big JD blob - it's already parsed into a
    summary + separate responsibility/requirement/benefit lists. Compose
    those into one readable block for our detail page.
    """
    sections = []

    summary = job_result.get("jobSummary") or job_result.get("jdResponsibilitySummary")
    if summary:
        sections.append(summary.strip())

    responsibilities = job_result.get("coreResponsibilities") or []
    if responsibilities:
        sections.append("Responsibilities:\n" + "\n".join(f"- {r}" for r in responsibilities))

    requirements = job_result.get("skillSummaries") or (job_result.get("qualifications") or {}).get("mustHave") or []
    if requirements:
        sections.append("Requirements:\n" + "\n".join(f"- {r}" for r in requirements))

    benefits = job_result.get("benefitsSummaries") or []
    if benefits:
        sections.append("Benefits:\n" + "\n".join(f"- {b}" for b in benefits))

    return "\n\n".join(sections) or None


def _upsert_job(data):
    return common.upsert_job("jobright", data)
