const kinds = ['user', 'structured', 'page', 'ai', 'profile-fallback', 'missing', 'legacy-unknown'];
export function metadataProvenance(job) {
  return Object.fromEntries(['company', 'role'].map(key => {
    const value = job?.provenance?.[key];
    const kind = kinds.includes(value?.kind) ? value.kind : job?.[key]?.trim() ? 'legacy-unknown' : 'missing';
    return [key, { kind, ...(typeof value?.source === 'string' ? { source: value.source.slice(0, 120) } : {}) }];
  }));
}
export function provenanceLabel(value) {
  return ({ user: 'User input', structured: 'Structured page data', page: 'Page extraction', ai:'AI-cleaned listing',
    'profile-fallback': 'Profile role fallback', missing: 'Not provided', 'legacy-unknown': 'Historical source unknown' })[value?.kind] || 'Historical source unknown';
}
