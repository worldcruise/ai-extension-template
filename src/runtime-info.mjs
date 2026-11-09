export const BUILD = globalThis.AiAgentBuild || { id: 'source-unbuilt', version: '0.5.0' };
export function connectionReport(report, confirmed, scope) {
  return { ...report, sessionConfirmed: confirmed === true, confirmationScope: scope,
    hostBuild: BUILD.id, adapterBuild: typeof report.buildId === 'string' ? report.buildId : 'unknown',
    revisionMatches: BUILD.id !== 'source-unbuilt' && report.buildId === BUILD.id };
}
export function requireMatchingRevision(report) {
  if (BUILD.id === 'source-unbuilt' || report.buildId !== BUILD.id) throw Object.assign(new Error('Host and ChatGPT adapter revisions differ or cannot be verified. Build the extension and compare fingerprints in Settings before continuing.'), { code: 'revision-mismatch' });
}
