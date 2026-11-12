// URL-only eligibility: deciding whether to offer capture never reads a chat or inbox.
const aiHosts = new Set([
  'chatgpt.com', 'chat.openai.com', 'chat.deepseek.com', 'claude.ai',
  'gemini.google.com', 'aistudio.google.com', 'copilot.microsoft.com',
  'grok.com', 'perplexity.ai', 'poe.com', 'chat.mistral.ai'
]);
const mailHosts = new Set([
  'gmail.com', 'inbox.google.com', 'outlook.live.com', 'outlook.office.com',
  'outlook.office365.com', 'outlook.cloud.microsoft', 'app.fastmail.com',
  'app.tuta.com', 'mailbox.org'
]);

export function canCaptureJobUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    if (aiHosts.has(host) || mailHosts.has(host)) return false;
    // Includes Gmail, Yahoo, AOL, Proton, Zoho and company-hosted webmail.
    if (/^(?:mail|webmail)\./.test(host) || /^\/(?:webmail|owa)(?:\/|$)/i.test(url.pathname)) return false;
    if ((host === 'icloud.com' || host === 'beta.icloud.com') &&
        (/^\/mail(?:\/|$)/i.test(url.pathname) || /^#\/?mail(?:[/?]|$)/i.test(url.hash))) return false;
    return true;
  } catch { return false; }
}
