"""Scraper for SimplifyJobs' New-Grad-Positions GitHub repo
(https://github.com/SimplifyJobs/New-Grad-Positions).

Unlike jobright.ai, this needs no browser automation at all: the repo's bot
publishes a structured `listings.json` on the `dev` branch that already has
everything we need, including the real employer application URL directly in
`url` - no login, no scraping, no click-through required.

Only pulls postings 0-2 days old (`common.is_recent`, using the exact
`date_posted` unix timestamp) - the full active set is ~3,100 listings across
every category, most of which are stale for a "what's new today" tab.
"""

import json
import urllib.request
from datetime import datetime, timezone

import config as cfg
from db import db
from models import Job
from scrapers import common, description_fetch

REQUEST_TIMEOUT_S = 30


def sync_jobs(app):
    """Fetches listings.json and upserts active/visible jobs into the DB.
    Returns a summary dict. Must be called inside an app context.
    """
    with urllib.request.urlopen(cfg.SIMPLIFY_LISTINGS_URL, timeout=REQUEST_TIMEOUT_S) as resp:
        entries = json.loads(resp.read())

    now_ts = datetime.now(timezone.utc).timestamp()
    created, updated, skipped, too_old = 0, 0, 0, 0
    with description_fetch.browser_session() as fetch_description:
        for entry in entries:
            if not entry.get("active") or not entry.get("is_visible"):
                continue

            date_posted = entry.get("date_posted")
            if not common.is_recent(None if date_posted is None else now_ts - date_posted):
                too_old += 1
                continue

            data = _parse_entry(entry)
            if not data:
                skipped += 1
                continue

            existing = Job.query.filter_by(source="simplify", external_id=data["external_id"]).first()
            if existing and existing.status != "new":
                skipped += 1
                continue

            # listings.json never has a JD (see _parse_entry). Fetch it from
            # the application link itself - but only once per job: if we
            # already captured one, keep it rather than let a transient
            # fetch failure on resync wipe it back out.
            if existing and existing.description:
                data["description"] = existing.description
            else:
                data["description"] = fetch_description(data["job_url"])

            is_new = common.upsert_job("simplify", data)
            if is_new:
                created += 1
            else:
                updated += 1

            # Commit per job instead of once at the end: fetch_description
            # above opens the real posting in a browser tab, so one
            # transaction around the whole run would hold SQLite's write lock
            # for the entire sync (~12 min on a cold backfill) and lock out
            # the apply worker.
            db.session.commit()
    return {"created": created, "updated": updated, "skipped": skipped, "too_old": too_old}


def _parse_entry(entry):
    job_id = entry.get("id")
    title = entry.get("title")
    url = entry.get("url")
    if not job_id or not title or not url:
        return None

    locations = entry.get("locations") or []

    tags = []
    if entry.get("category"):
        tags.append(entry["category"])
    tags.extend(entry.get("degrees") or [])
    if entry.get("sponsorship") and entry["sponsorship"] != "Other":
        tags.append(entry["sponsorship"])

    return {
        "external_id": job_id,
        "title": title,
        "company": entry.get("company_name"),
        "location": ", ".join(locations) if locations else None,
        "work_mode": None,
        "posted_label": _relative_time(entry.get("date_posted")),
        "tags": ", ".join(dict.fromkeys(tags)),
        "job_url": url,
        "description": None,  # listings.json has no JD field - sync_jobs fetches it from job_url
        "raw_json": json.dumps(entry),
    }


def _relative_time(unix_ts):
    if not unix_ts:
        return None
    try:
        posted = datetime.fromtimestamp(unix_ts, tz=timezone.utc)
    except (ValueError, OSError, OverflowError):
        return None

    seconds = max(0, (datetime.now(timezone.utc) - posted).total_seconds())
    if seconds < 3600:
        return f"{max(1, int(seconds // 60))} minutes ago"
    if seconds < 86400:
        return f"{int(seconds // 3600)} hours ago"
    return f"{int(seconds // 86400)} days ago"
