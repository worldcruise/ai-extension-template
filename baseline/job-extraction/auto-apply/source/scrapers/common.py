"""Shared upsert logic and freshness filtering used by every job-board scraper."""

from datetime import datetime

import config as cfg
from db import db
from models import Job

# Narrowed from 3 days to 1 (2026-10-19) - keep anything under 24 elapsed
# hours. Applies site-wide, across all 5 sources' sync/browse tabs; the
# auto-apply scheduler's own 48h window (automation/auto_apply_schedule.py)
# no longer needs to be stricter than this to stay meaningfully tighter.
MAX_JOB_AGE_SECONDS = 1 * 86400


def is_recent(seconds_old):
    return seconds_old is not None and 0 <= seconds_old < MAX_JOB_AGE_SECONDS


def title_is_relevant(title):
    """True if `title` matches one of our target roles (config.
    RELEVANT_TITLE_KEYWORDS - the same list automation/auto_apply_schedule.py
    filters on for auto-apply). Sources whose own feed isn't title-scoped -
    zapplyjobs covers every early-career field, not just tech - use this at
    discovery time so the swipe/browse tabs don't fill up with irrelevant
    jobs either, not just auto-apply.
    """
    if not title:
        return False
    lowered = title.lower()
    return any(keyword.lower() in lowered for keyword in cfg.RELEVANT_TITLE_KEYWORDS)


def relative_time_label(seconds_old):
    """"N minutes/hours/days ago" from an elapsed-seconds value - the same
    phrasing every scraper's posted_label has used so far, factored out here
    since more than one of them now computes it from a different starting
    format (unix timestamp, ISO 8601 string, a "Nd" column)."""
    if seconds_old is None:
        return None
    seconds_old = max(0, seconds_old)
    if seconds_old < 3600:
        return f"{max(1, int(seconds_old // 60))} minutes ago"
    if seconds_old < 86400:
        return f"{int(seconds_old // 3600)} hours ago"
    return f"{int(seconds_old // 86400)} days ago"


def upsert_job(source, data):
    """Insert if new; update fields if it already exists and is still
    undecided (status == "new"), so a re-sync never resurrects a job the
    user already passed/applied on. Returns True if a new row was created.

    `data` must have: external_id, title, company, location, work_mode,
    posted_label, tags, job_url, raw_json. `description` is optional (not
    every source has one) and defaults to None.
    """
    existing = Job.query.filter_by(source=source, external_id=data["external_id"]).first()
    if existing:
        if existing.status == "new":
            existing.title = data["title"]
            existing.company = data["company"]
            existing.location = data["location"]
            existing.work_mode = data["work_mode"]
            existing.posted_label = data["posted_label"]
            existing.tags = data["tags"]
            existing.job_url = data["job_url"]
            existing.description = data.get("description")
            existing.raw_json = data["raw_json"]
        return False

    job = Job(
        source=source,
        external_id=data["external_id"],
        title=data["title"],
        company=data["company"],
        location=data["location"],
        work_mode=data["work_mode"],
        posted_label=data["posted_label"],
        tags=data["tags"],
        job_url=data["job_url"],
        description=data.get("description"),
        raw_json=data["raw_json"],
        status="new",
        created_at=datetime.utcnow(),
    )
    db.session.add(job)
    return True
