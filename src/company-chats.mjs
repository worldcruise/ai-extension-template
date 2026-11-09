import { linkedConversationUrl } from './sidebar-protocol.mjs';

// Source links belong to saved Studio requests, scoped to the selected candidate.
export function savedCompanyChats(requests, candidateId) {
  return requests.flatMap(request => {
    const { input } = request;
    const registered = !request.isExample && request.attempts?.some(attempt => attempt.submitted);
    if (request.state === 'cancelled' || (!(request.state === 'ready' && request.resume) && !registered) || !input.tailor || input.candidateId !== candidateId) return [];
    const url = linkedConversationUrl(request.sourceChatUrl);
    const company = typeof input.job.company === 'string' ? input.job.company.trim() : '';
    if (!url || !company) return [];
    return [{ id: String(request.id), title: company, role: input.job.role, url }];
  });
}
