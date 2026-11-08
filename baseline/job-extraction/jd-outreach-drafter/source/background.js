// Service worker: owns the Claude API call so drafting keeps running if the popup closes.
importScripts("defaults.js");

const API_URL = "https://api.anthropic.com/v1/messages";

const DRAFT_TOOL = {
  name: "save_outreach_draft",
  description: "Save the finished cold email and LinkedIn connection note.",
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "Email subject line." },
      email_body: {
        type: "string",
        description: "Plain-text email body, from greeting through the closing line. No signature.",
      },
      linkedin_note: {
        type: "string",
        description: "LinkedIn connection request, plain text, under 300 characters total including its subject line.",
      },
      resume_variant_used: { type: "string", description: "Name of the resume variant the draft is based on." },
      recipient_first_name: { type: "string", description: "First name used in the greeting, or empty." },
      fit_notes: {
        type: "string",
        description: "One or two sentences for the sender: strongest match, and any JD requirement the resume doesn't cover.",
      },
    },
    required: ["subject", "email_body", "linkedin_note", "resume_variant_used", "fit_notes"],
  },
};

function buildSystemPrompt(settings) {
  return `You write cold outreach for a job seeker to a hiring manager or recruiter, based on a job description and the sender's resume.

Sender: ${settings.senderName || "the candidate"}

Outreach rules (follow exactly):
${settings.rules}

Additional context about the sender (facts you may use):
${settings.profileNotes || "(none)"}

Hard constraints:
- Use only experience, numbers, and projects that appear in the resume or the context above. Never invent or inflate.
- Map proof bullets to the JD's most important requirements, using the JD's own vocabulary where it's honest to do so.
- For a hiring manager: lead with technical proof tied to the team's problems. For a recruiter: lead with role match, level, and the keywords they screen for.
- Plain text only: no markdown, no bold, bullets written as "• ".
- If the recipient's name is unknown, greet with "Hi there,".
- Call the save_outreach_draft tool with the result.`;
}

function resumeBlocks(resumes, choice) {
  const chosen = choice === "auto" ? resumes : resumes.filter((r) => r.name === choice);
  const blocks = [];
  for (const r of chosen) {
    if (r.pdf) {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: r.pdf },
        title: `Resume variant: ${r.name}`,
      });
    }
    if (r.text && r.text.trim()) {
      blocks.push({ type: "text", text: `Resume variant: ${r.name}\n\n${r.text.trim()}` });
    }
  }
  return blocks;
}

async function generate({ key, job, recipient, resumeChoice, instructions, previous }) {
  const settings = { ...DEFAULTS, ...(await chrome.storage.local.get(null)) };
  await chrome.storage.session.set({ [key]: { status: "loading", job, recipient, resumeChoice } });

  try {
    if (!settings.apiKey) throw new Error("Add your Anthropic API key in Settings.");
    const resumes = (settings.resumes || []).filter((r) => r.name && (r.pdf || (r.text && r.text.trim())));
    if (!resumes.length) throw new Error("Add at least one resume in Settings.");

    const content = resumeBlocks(resumes, resumeChoice);
    if (!content.length) throw new Error(`Resume "${resumeChoice}" is empty. Pick another in the dropdown.`);

    const pickLine =
      resumeChoice === "auto" && resumes.length > 1
        ? "Pick the single resume variant that best fits this JD and base the draft on it only."
        : "";

    content.push({
      type: "text",
      text: `<job>
Title: ${job.title || "(unknown)"}
Company: ${job.company || "(unknown)"}
Location: ${job.location || "(unknown)"}
URL: ${job.url || ""}

${job.description}
</job>

<recipient>
Type: ${recipient.type === "recruiter" ? "Recruiter" : "Hiring manager"}
Name: ${recipient.name || "(unknown)"}
${recipient.headline ? `Headline: ${recipient.headline}` : ""}
</recipient>

${pickLine}
${instructions ? `Extra instructions from the sender: ${instructions}` : ""}`.trim(),
    });

    if (previous) {
      content.push({
        type: "text",
        text: `Revise this previous draft according to the extra instructions, keeping everything else that works:
Subject: ${previous.subject}

${previous.email_body}

LinkedIn note: ${previous.linkedin_note}`,
      });
    }

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 2000,
        system: buildSystemPrompt(settings),
        messages: [{ role: "user", content }],
        tools: [DRAFT_TOOL],
        tool_choice: { type: "tool", name: DRAFT_TOOL.name },
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data.error && data.error.message) || `Request failed (${res.status})`;
      throw new Error(res.status === 401 ? "API key was rejected. Check it in Settings." : msg);
    }
    const call = (data.content || []).find((b) => b.type === "tool_use");
    if (!call) throw new Error("Claude didn't return a draft. Try again.");

    const draft = { ...call.input };
    if (settings.signature && settings.signature.trim()) {
      draft.email_body = `${draft.email_body.trim()}\n\n${settings.signature.trim()}`;
    }
    const result = { status: "done", job, recipient, resumeChoice, draft, usage: data.usage, at: Date.now() };
    await chrome.storage.session.set({ [key]: result });
    return result;
  } catch (err) {
    const result = { status: "error", job, recipient, resumeChoice, error: err.message, draft: previous || null };
    await chrome.storage.session.set({ [key]: result });
    return result;
  }
}

async function testKey({ apiKey, model }) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: "user", content: "Say ok" }] }),
  });
  if (res.ok) return { ok: true };
  const data = await res.json().catch(() => ({}));
  return { ok: false, error: (data.error && data.error.message) || `Request failed (${res.status})` };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "generate") {
    generate(msg).then(sendResponse);
    return true;
  }
  if (msg.type === "testKey") {
    testKey(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

// Right-click fallback for pages the extractor can't read (iframes, odd layouts).
chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({
    id: "draft-from-selection",
    title: "Draft outreach from selected job description",
    contexts: ["selection"],
  });
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "draft-from-selection") return;
  await chrome.storage.session.set({
    pendingSelection: { tabId: tab.id, url: tab.url, title: tab.title, text: info.selectionText },
  });
  try {
    await chrome.action.openPopup();
  } catch (_) {
    chrome.action.setBadgeText({ tabId: tab.id, text: "JD" });
    chrome.action.setBadgeBackgroundColor({ color: "#C8372D" });
  }
});
