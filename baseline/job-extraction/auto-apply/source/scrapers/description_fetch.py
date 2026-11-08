"""Best-effort job-description scraping for Simplify listings.

`listings.json` has no JD field - only the real employer application URL
(Workday, Greenhouse, Lever, ...). This loads that URL in a throwaway
headless browser and pulls out the description text. These are public
postings behind no login, so unlike automation/browser.py this never needs
the headed-login fallback - just one shared browser for the whole sync.

Purely best-effort: any failure (timeout, unrecognized layout, Chrome not
installed) returns None so the caller falls back to whatever it already had.
"""

import contextlib

from playwright.sync_api import sync_playwright

PAGE_LOAD_TIMEOUT_MS = 15_000
RENDER_SETTLE_MS = 1500  # client-rendered ATS pages (Workday, Greenhouse) need a beat to paint
MIN_DESCRIPTION_CHARS = 200

_STEALTH_ARGS = ["--disable-blink-features=AutomationControlled"]
_STEALTH_INIT_SCRIPT = "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"

# Tried in order against known ATS layouts before falling back to a generic
# "biggest obvious content region" guess. (domain substring, CSS selector)
KNOWN_SELECTORS = [
    ("myworkdayjobs.com", '[data-automation-id="jobPostingDescription"]'),
    ("greenhouse.io", "#content"),
    ("lever.co", ".section-wrapper .content"),
    ("ashbyhq.com", '[class*="_descriptionText"]'),
    ("icims.com", "#iCIMS_JobContent"),
    ("smartrecruiters.com", "#st-jobDescription"),
    ("workable.com", '[data-ui="job-description"]'),
    ("bamboohr.com", "#jobDescriptionText"),
    ("applytojob.com", "#job-description"),  # JazzHR
]


@contextlib.contextmanager
def browser_session():
    """Yields a `fetch(url) -> str | None` callable backed by one shared
    headless browser for the duration of the `with` block - much cheaper
    than launching a browser per job. If Playwright/Chrome isn't available
    at all, yields a no-op fetcher instead of raising, so a sync always
    falls back to the existing "no description" behavior rather than
    failing outright.
    """
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, channel="chrome", args=_STEALTH_ARGS)
            context = browser.new_context()
            context.add_init_script(_STEALTH_INIT_SCRIPT)
            try:
                yield lambda url: _fetch_one(context, url)
            finally:
                context.close()
                browser.close()
    except Exception:
        yield lambda url: None


def _fetch_one(context, url):
    if not url:
        return None
    try:
        page = context.new_page()
        try:
            page.goto(url, timeout=PAGE_LOAD_TIMEOUT_MS, wait_until="domcontentloaded")
            page.wait_for_timeout(RENDER_SETTLE_MS)
            return _extract(page, url)
        finally:
            page.close()
    except Exception:
        return None


def _extract(page, url):
    host = url.lower()
    for domain, selector in KNOWN_SELECTORS:
        if domain in host:
            text = _text_of(page, selector)
            if text:
                return text

    # Unrecognized ATS - guess at the main content region.
    for selector in ("main", "article", "body"):
        text = _text_of(page, selector)
        if text:
            return text
    return None


def _text_of(page, selector):
    try:
        locator = page.locator(selector).first
        if locator.count() == 0:
            return None
        text = (locator.inner_text() or "").strip()
    except Exception:
        return None
    return text if len(text) >= MIN_DESCRIPTION_CHARS else None
