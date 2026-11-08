"""Small regex helpers for pulling job rows out of the GitHub-flavored
Markdown tables that zapplyjobs/speedyapply publish listings in - there's
no JSON feed for these (unlike SimplifyJobs), and the two repos don't even
agree on column layout, so each scraper's own row-parsing function uses
these shared primitives rather than one forced-common table parser.
"""

import re

_MD_IMAGE_LINK_RE = re.compile(r"\[<img[^>]*>\]\((?P<url>[^)]+)\)")
_HTML_A_RE = re.compile(r'<a href="(?P<url>[^"]+)">(?P<inner>.*?)</a>', re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")
_MD_BOLD_RE = re.compile(r"\*\*(.*?)\*\*")
_AGE_RE = re.compile(r"(\d+)\s*(mo|[ymdh])\b", re.IGNORECASE)
_AGE_UNIT_SECONDS = {"m": 60, "h": 3600, "d": 86400, "mo": 30 * 86400, "y": 365 * 86400}


def strip_markup(text):
    """Removes HTML tags and **bold** markdown, leaving plain text."""
    text = _TAG_RE.sub("", text)
    text = _MD_BOLD_RE.sub(r"\1", text)
    return text.strip()


def extract_link_url(cell):
    """Pulls the URL out of either a `[<img ...>](url)` Markdown image-link
    or an `<a href="url">...</a>` HTML link - the two "Apply"/"Posting"
    cell formats seen across these repos. Returns None if neither matches.
    """
    m = _MD_IMAGE_LINK_RE.search(cell) or _HTML_A_RE.search(cell)
    return m.group("url") if m else None


def split_table_row(line):
    """Splits a `| a | b | c |` Markdown table row into its stripped cells,
    or None if `line` isn't a pipe-delimited row at all (section headers,
    blank lines, HTML comments)."""
    line = line.strip()
    if not line.startswith("|") or not line.endswith("|"):
        return None
    return [c.strip() for c in line.strip("|").split("|")]


def is_header_or_separator(cells):
    """True for a table's header row (`| Company | ... |`) or its
    `|---|---|` separator row - neither is a data row."""
    first = cells[0]
    return first in ("Company", "") or set(first) <= {"-", ":"}


def parse_age_seconds(text):
    """Parses a short relative-age label like "7d", "13m", "2h", "3mo" (the
    "Posted"/"Age" column format these repos use) into elapsed seconds.
    Returns None if it doesn't look like one of these labels."""
    text = strip_markup(text)
    m = _AGE_RE.match(text)
    if not m:
        return None
    value, unit = m.groups()
    return int(value) * _AGE_UNIT_SECONDS[unit.lower()]
