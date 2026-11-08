// Injected into the active tab via chrome.scripting.executeScript.
// The value of the final expression is returned to the popup.
(() => {
  const MAX_CHARS = 15000;

  const clean = (s) =>
    (s || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const textOf = (el) => {
    if (!el) return "";
    const t = el.innerText || "";
    // innerText skips CSS-hidden text (e.g. LinkedIn "see more"); fall back to textContent.
    return clean(t.trim().length > 200 ? t : el.textContent);
  };

  const firstLine = (el) => (el ? textOf(el).split("\n")[0].trim() : "");

  const htmlToText = (html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
    doc.querySelectorAll("li").forEach((li) => li.prepend("• "));
    doc.querySelectorAll("p,li,div,h1,h2,h3,h4,h5,ul,ol").forEach((e) => e.append("\n"));
    return clean(doc.body.textContent);
  };

  const pick = (selectors) => {
    for (const s of selectors || []) {
      try {
        const el = document.querySelector(s);
        if (el && textOf(el)) return el;
      } catch (_) {}
    }
    return null;
  };

  // 1. Schema.org JobPosting (most ATS pages and public LinkedIn/Indeed pages ship this)
  function fromJsonLd() {
    const nodes = [];
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      nodes.push(n);
      if (n["@graph"]) walk(n["@graph"]);
    };
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try { walk(JSON.parse(s.textContent)); } catch (_) {}
    });
    const jp = nodes.find((n) => [].concat(n["@type"] || []).includes("JobPosting"));
    if (!jp || !jp.description) return null;
    const org = jp.hiringOrganization;
    const location = []
      .concat(jp.jobLocation || [])
      .map((l) => {
        const a = (l && l.address) || {};
        const country = a.addressCountry && (a.addressCountry.name || a.addressCountry);
        return [a.addressLocality, a.addressRegion, country].filter((x) => typeof x === "string").join(", ");
      })
      .filter(Boolean)
      .join(" | ");
    return {
      source: "Structured data",
      title: jp.title || "",
      company: (typeof org === "string" ? org : org && org.name) || "",
      location: location || (jp.jobLocationType === "TELECOMMUTE" ? "Remote" : ""),
      description: htmlToText(jp.description),
    };
  }

  // 2. Known job boards / ATS
  const SITES = [
    { name: "LinkedIn", match: /linkedin\.com\/jobs/,
      desc: [".jobs-description__content", ".jobs-description-content__text", "#job-details", ".jobs-box__html-content", ".show-more-less-html__markup"],
      title: [".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title", ".top-card-layout__title", "h1"],
      company: [".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name", ".topcard__org-name-link"] },
    { name: "Greenhouse", match: /greenhouse\.io/,
      desc: [".job__description", "#content", ".job-post"], title: [".job__title h1", "h1.app-title", "h1"], company: [".company-name"] },
    { name: "Lever", match: /lever\.co/,
      desc: ['[data-qa="job-description"]', ".posting-page .section-wrapper.page-full-width", ".posting-page"], title: [".posting-headline h2", "h2"] },
    { name: "Ashby", match: /ashbyhq\.com/,
      desc: ['[class*="_descriptionText"]', ".ashby-job-posting-right-pane"], title: ["h1"] },
    { name: "Workday", match: /myworkdayjobs\.com|workday/,
      desc: ['[data-automation-id="jobPostingDescription"]'], title: ['[data-automation-id="jobPostingHeader"]', "h2"] },
    { name: "Indeed", match: /indeed\.com/,
      desc: ["#jobDescriptionText"], title: ['[data-testid="jobsearch-JobInfoHeader-title"]', "h1"],
      company: ['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]'] },
    { name: "Glassdoor", match: /glassdoor\./,
      desc: ['[class*="JobDetails_jobDescription"]', ".jobDescriptionContent"], title: ['[class*="heading_Level1"]', "h1"],
      company: ['[class*="EmployerProfile_employerName"]'] },
    { name: "Wellfound", match: /wellfound\.com/,
      desc: ['[class*="description"]'], title: ["h1"] },
    { name: "Workable", match: /workable\.com/,
      desc: ['[data-ui="job-description"]', '[data-ui="job-requirements"]'], title: ['[data-ui="job-title"]', "h1"] },
    { name: "SmartRecruiters", match: /smartrecruiters\.com/,
      desc: [".job-sections", '[itemprop="description"]'], title: [".job-title", "h1"] },
    { name: "Handshake", match: /joinhandshake\.com/, custom: fromHandshake,
      desc: ['[class*="job-description"]', '[class*="JobDescription"]', '[data-hook*="description"]'] },
  ];

  const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

  // First heading that isn't the company name or a section label.
  const SECTION_LABEL = /^(about|at a glance|job description|what (they|we)('|’)re looking for|what you('|’)ll do|similar jobs|more jobs|details|requirements|qualifications|benefits|apply)\b/i;
  function headingOtherThan(company, root) {
    return [...(root || document).querySelectorAll("h1, h2, h3")]
      .map(firstLine)
      .find((t) => t && t.length < 150 && norm(t) !== norm(company) && !SECTION_LABEL.test(t)) || "";
  }

  // Handshake: hashed class names, company shown above the job title.
  function fromHandshake() {
    const root = document.querySelector("main") || document.body;
    const employerLink = [...root.querySelectorAll("a[href]")].find((a) => {
      const path = a.getAttribute("href") || "";
      const t = firstLine(a);
      return /\/(employers|e)\/\d+/.test(path) && t && t.length < 80;
    });
    let company = employerLink ? firstLine(employerLink) : "";
    let title = headingOtherThan(company, root);

    // Tab title is usually "Job title - Company | Handshake"; use it to fill gaps.
    const parts = document.title.replace(/\s*[|–-]\s*Handshake\s*$/i, "").split(/\s+[|–-]\s+/);
    if (!title && parts.length) title = parts[0];
    if (!company && parts.length > 1) company = parts[parts.length - 1];
    return { title, company };
  }

  function fromSite() {
    const site = SITES.find((s) => s.match.test(location.href));
    if (!site) return null;
    const custom = site.custom ? site.custom() : {};
    const descEl = pick(site.desc);
    return {
      source: site.name,
      title: custom.title || firstLine(pick(site.title)),
      company: custom.company || firstLine(pick(site.company)),
      location: "",
      description: descEl ? textOf(descEl) : "",
    };
  }

  // 3. Generic heuristic: densest block of JD-ish vocabulary
  const KW = /\b(responsibilit|qualification|requirement|what you('|’)ll do|about the role|about you|about the team|years of experience|experience with|nice to have|preferred|bonus points|benefits|we('|’)re looking for|you will|must have|equal opportunity|compensation|salary range)/gi;

  function fromHeuristic() {
    let best = null, bestScore = 0;
    for (const el of document.querySelectorAll("main, article, section, div")) {
      const rough = (el.textContent || "").length;
      if (rough < 400 || rough > 60000) continue;
      const t = el.innerText || "";
      const len = t.length;
      if (len < 400 || len > 30000) continue;
      const hits = (t.match(KW) || []).length;
      if (hits < 2) continue;
      let linkLen = 0;
      el.querySelectorAll("a").forEach((a) => (linkLen += (a.innerText || "").length));
      const density = linkLen / len;
      if (density > 0.3) continue;
      // Rewards many keyword hits in a tight block (i.e. the innermost JD container).
      const score = ((hits * 10) / Math.log(len)) * (1 - density);
      if (score > bestScore) { best = el; bestScore = score; }
    }
    if (!best) return null;
    return { source: "Page scan", title: "", company: "", location: "", description: textOf(best), weak: bestScore < 8 };
  }

  // Hiring team / recruiter hints
  function findContacts() {
    const people = [];
    const heading = [...document.querySelectorAll("h2, h3")].find((h) =>
      /meet the hiring team|people you can reach out to|hiring team/i.test(h.innerText || "")
    );
    if (heading) {
      const section = heading.closest("section, .artdeco-card") || (heading.parentElement && heading.parentElement.parentElement);
      section && section.querySelectorAll('a[href*="/in/"]').forEach((a) => {
        const name = clean(a.innerText).split("\n")[0];
        if (!name || name.length > 60 || people.some((p) => p.name === name)) return;
        const card = a.closest("li, div");
        const headline = card ? clean(card.innerText).split("\n").slice(1, 3).join(" ").slice(0, 140) : "";
        people.push({ name, headline, profile: a.href.split("?")[0] });
      });
    }
    return people.slice(0, 5);
  }

  const meta = (p) => {
    const m = document.querySelector(`meta[property="${p}"], meta[name="${p}"]`);
    return m ? m.content : "";
  };

  // Assemble
  const selection = clean(String(window.getSelection() || ""));
  const structured = fromJsonLd();
  const site = fromSite();
  let primary = null;

  if (selection.length > 200) {
    primary = { source: "Your selection", title: "", company: "", location: "", description: selection };
  } else if (structured && structured.description.length > 300) {
    primary = structured;
  } else if (site && site.description.length > 300) {
    primary = site;
  } else {
    primary = fromHeuristic();
    if (primary && site) primary.source = `${site.source} page scan`;
  }

  if (!primary) {
    return { ok: false, frameUrl: location.href, reason: "No job description found on this page." };
  }

  const company = primary.company || (structured && structured.company) || (site && site.company) || meta("og:site_name");
  let title = primary.title || (structured && structured.title) || (site && site.title) || "";
  if (!title || norm(title) === norm(company)) {
    title = headingOtherThan(company) || meta("og:title") || document.title;
  }
  const description = primary.description.slice(0, MAX_CHARS);
  const emails = [...new Set(description.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])]
    .filter((e) => !/^(no-?reply|privacy|accommodation|accessibility)/i.test(e));

  return {
    ok: true,
    frameUrl: location.href,
    isTop: window === window.top,
    source: primary.source,
    weak: !!primary.weak,
    title: clean(title).slice(0, 200),
    company: clean(company).slice(0, 120),
    location: primary.location || (structured && structured.location) || "",
    description,
    truncated: primary.description.length > MAX_CHARS,
    contacts: findContacts(),
    emails,
  };
})();
