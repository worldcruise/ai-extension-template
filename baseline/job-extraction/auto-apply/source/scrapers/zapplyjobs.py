"""Scraper for Zapply's New-Grad-Jobs-2027 GitHub repo
(https://github.com/zapplyjobs/New-Grad-Jobs-2027), refreshed roughly every
10 minutes.

Like speedyapply, listings are Markdown tables rather than a JSON feed, but
a different shape: `| Company | Role | Location | Posted | Visa | Apply |`
with the company name as plain **bold** text (no separate company link),
a relative-age "Posted" column ("13m", "14m", ...), a "Visa" column
("✅ Sponsor" or blank), and the Apply link as a Markdown image-link rather
than raw HTML - see scrapers/markdown_table.py for the shared parsing
helpers.

Zapply's stated terms (README "Data & Reuse" section / repo LICENSE, as of
2026-10-06): free use including commercial, with link-back + credit, and no
resubmitting these listings to a third-party aggregator or feed. Personal
use inside this app doesn't republish anything - job_url already points
back to Zapply's own apply link, which covers the link-back; "Zapply" is
credited in this docstring and the job board badge below covers the rest.

This repo covers every early-career field, not just tech (retail,
warehouse, hospitality roles alongside SWE/data ones), so each row's title
is checked against common.title_is_relevant before it's stored, rather
than importing everything the table publishes.

Zapply's own Apply link is a `zapply.jobs/l/d/...` redirect, not the real
employer page - stored job_url is resolved to the real destination (see
automation.tsenta.resolve_apply_link) before being saved, same resolver
auto-apply already used at apply time, just run earlier here. Fixes two
things that followed from storing the raw redirect: the job board badge
(job_boards.job_board_name is domain-based, so a zapply.jobs URL always
read as "Unknown") and the "Application Link" shown to a person browsing
the tab, which used to go through Zapply's own redirector instead of
straight to the posting. external_id stays the original, unresolved
zapply.jobs link - that's the row's stable dedup identity; job_url is what
gets shown and applied through, so it's the one that should change if a
re-sync resolves somewhere new.
"""

import json
import urllib.request

import config as cfg
from db import db
from scrapers import common, markdown_table as mt
from automation.tsenta import resolve_apply_link

REQUEST_TIMEOUT_S = 30


def sync_jobs(app):
    """Fetches the README and upserts rows under 3 days old. Returns a
    summary dict. Must be called inside an app context.
    """
    req = urllib.request.Request(cfg.ZAPPLYJOBS_README_URL, headers={"User-Agent": "auto-apply"})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
        text = resp.read().decode("utf-8")

    created, updated, skipped, too_old = 0, 0, 0, 0
    for line in text.splitlines():
        cells = mt.split_table_row(line)
        if cells is None or len(cells) != 6 or mt.is_header_or_separator(cells):
            continue

        data = _parse_row(cells)
        if not data or not common.title_is_relevant(data["title"]):
            skipped += 1
            continue

        if not common.is_recent(data.pop("_seconds_old")):
            too_old += 1
            continue

        # Only resolve rows that actually clear every other filter - a
        # resolve is a real HTTP round-trip, and most of what the table
        # publishes each sync is irrelevant or already seen (upsert_job
        # below still only writes a status="new" row's fields, same as
        # before - this just changes what job_url holds when it does).
        data["job_url"] = resolve_apply_link(data["job_url"])

        is_new = common.upsert_job("zapplyjobs", data)
        if is_new:
            created += 1
        else:
            updated += 1

    db.session.commit()
    return {"created": created, "updated": updated, "skipped": skipped, "too_old": too_old}


def _parse_row(cells):
    company_cell, role_cell, location_cell, posted_cell, visa_cell, apply_cell = cells

    company = mt.strip_markup(company_cell)
    position = mt.strip_markup(role_cell)
    location = mt.strip_markup(location_cell)
    job_url = mt.extract_link_url(apply_cell)
    seconds_old = mt.parse_age_seconds(posted_cell)
    if not company or not position or not job_url or seconds_old is None:
        return None

    tags = []
    if "sponsor" in visa_cell.lower():
        tags.append("Sponsorship")

    return {
        "external_id": job_url,
        "title": position,
        "company": company,
        "location": location or None,
        "work_mode": None,
        "posted_label": common.relative_time_label(seconds_old),
        "tags": ", ".join(tags),
        "job_url": job_url,
        "description": None,
        "raw_json": json.dumps({"cells": cells}),
        "_seconds_old": seconds_old,
    }
