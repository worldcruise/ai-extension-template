export const duplicateCheckStorageKey = 'checkExistingJobs';

const trustedCompany = ['user', 'structured', 'page'];
function companyKey(job) {
  const kind = job?.provenance?.company?.kind;
  if (['missing', 'profile-fallback'].includes(kind) || typeof job?.company !== 'string') return '';
  const key = job.company.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
  if (!trustedCompany.includes(kind) && /^(untitled company|company not provided|base resume)$/u.test(key)) return '';
  return key;
}

export function duplicateJobUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|trk|trackingId|refId|referral|source)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    // Keep job identifiers in queries and hash routes, plus case-sensitive paths.
    url.pathname = url.pathname.replace(/\/+$/u, '') || '/';
    return url.href;
  } catch { return ''; }
}

// Match the visible candidate list, including examples and failed jobs. Filters
// and the optional company duplicate check do not change whether a URL is saved.
export function jobUrlInList(value, candidateId, requests = []) {
  const url = duplicateJobUrl(value);
  return Boolean(url && candidateId && requests.some(request => request.state !== 'cancelled' &&
    request.input?.candidateId === candidateId && [request.input.job?.url,
      request.capturePending || !/^https?:\/\/(?:[^/]+\.)?(?:hiring\.cafe|hiringcafe\.com)(?:\/|$)/i.test(request.captureSourceUrl || '') ? request.captureSourceUrl : null
    ].some(value=>duplicateJobUrl(value) === url)));
}

export function findExistingJob(input, requests = []) {
  if (!input?.candidateId || !input.tailor) return null;
  const company = companyKey(input.job), url = duplicateJobUrl(input.job?.url);
  if (!company && !url) return null;
  for (const request of requests) {
    if (request.isExample || request.input?.candidateId !== input.candidateId || !request.input?.tailor ||
        request.state === 'cancelled') continue;
    const matchedBy = [];
    if (company && company === companyKey(request.input.job)) matchedBy.push('company');
    if (url && url === duplicateJobUrl(request.input.job?.url)) matchedBy.push('url');
    if (matchedBy.length) return { requestId: request.id, matchedBy,
      location: request.state === 'ready' ? 'saved results' : 'queue' };
  }
  return null;
}
