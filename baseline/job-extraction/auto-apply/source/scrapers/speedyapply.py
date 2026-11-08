"""Scraper for speedyapply's 2027-AI-College-Jobs GitHub repo
(https://github.com/speedyapply/2027-AI-College-Jobs), updated daily.

Unlike SimplifyJobs, there's no JSON feed here - listings are published as
GitHub-flavored Markdown tables (NEW_GRAD_USA.md) with an HTML `<a>` link
per Company/Posting cell and a "7d"-style Age column, parsed with
scrapers/markdown_table.py's helpers rather than json.loads. Two table
shapes share the file (FAANG+/Quant include a Salary column, Other doesn't)
so each row's cell count decides how to read it.

No explicit LICENSE file is published for this repo - same situation as
SimplifyJobs (already used by this app without one either): public data a
public repo exists specifically to be read by tools like this one, but
worth knowing there's no stated reuse grant beyond that.
"""

import json
import urllib.request

import config as cfg
from db import db
from scrapers import common, markdown_table as mt

REQUEST_TIMEOUT_S = 30


def sync_jobs(app):
    """Fetches NEW_GRAD_USA.md and upserts rows under 3 days old. Returns a
    summary dict. Must be called inside an app context.
    """
    req = urllib.request.Request(cfg.SPEEDYAPPLY_USA_URL, headers={"User-Agent": "auto-apply"})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
        text = resp.read().decode("utf-8")

    created, updated, skipped, too_old = 0, 0, 0, 0
    for line in text.splitlines():
        cells = mt.split_table_row(line)
        if cells is None or len(cells) not in (5, 6) or mt.is_header_or_separator(cells):
            continue

        data = _parse_row(cells)
        if not data:
            skipped += 1
            continue

        if not common.is_recent(data.pop("_seconds_old")):
            too_old += 1
            continue

        is_new = common.upsert_job("speedyapply", data)
        if is_new:
            created += 1
        else:
            updated += 1

    db.session.commit()
    return {"created": created, "updated": updated, "skipped": skipped, "too_old": too_old}


def _parse_row(cells):
    company_cell = cells[0]
    position = mt.strip_markup(cells[1])
    location = mt.strip_markup(cells[2])
    if len(cells) == 6:
        posting_cell, age_cell = cells[4], cells[5]
    else:
        posting_cell, age_cell = cells[3], cells[4]

    company = mt.strip_markup(company_cell)
    job_url = mt.extract_link_url(posting_cell)
    seconds_old = mt.parse_age_seconds(age_cell)
    if not company or not position or not job_url or seconds_old is None:
        return None

    # The job's own URL is unique and stable enough to key on - this repo
    # doesn't publish a separate per-posting id the way an ATS/API would.
    external_id = job_url

    return {
        "external_id": external_id,
        "title": position,
        "company": company,
        "location": location or None,
        "work_mode": None,
        "posted_label": common.relative_time_label(seconds_old),
        "tags": "",
        "job_url": job_url,
        "description": None,
        "raw_json": json.dumps({"cells": cells}),
        "_seconds_old": seconds_old,
    }
