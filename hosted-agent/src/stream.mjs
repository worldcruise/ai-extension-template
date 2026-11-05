const CODES = new Set(['agent_connection_error','agent_authentication_required','hosted_deployment_not_configured','hosted_plan_registration_required','invalid_agent_response','request_in_progress','invalid_json','extension_connection_unavailable', 'extension_context_required', 'authorization_cancelled', 'authorization_timeout',
  'authorization_failed', 'callback_invalid', 'callback_setup_failed', 'state_mismatch', 'duplicate_callback_parameter',
  'missing_authorization_code', 'missing_issued_client_id', 'client_id_mismatch', 'invalid_client', 'unauthorized_client',
  'invalid_grant', 'invalid_scope', 'invalid_request', 'access_denied', 'chatgpt_plan_scope_not_granted',
  'id_token_verification_failed', 'unexpected_provider_configuration', 'selected_account_mismatch', 'session_expired',
  'engine_unavailable', 'not_connected', 'invalid_session', 'no_available_models',
  'unexpected_catalog_shape', 'request_failed', 'connection_error', 'invalid_stream_json', 'stream_too_large',
  'stream_ended_without_completion', 'invalid_completion_event', 'response_incomplete', 'empty_output',
  'model_refusal', 'fixture_validation_failed', 'output_validation_failed', 'cancelled', 'request_timeout',
  'subscription_sharing_usage_limit_exceeded', 'subscription_sharing_usage_unavailable', 'rate_limit_exceeded',
  'model_not_found', 'permission_denied', 'authentication_error', 'insufficient_scope', 'invalid_api_key',
  'invalid_request_error', 'server_error', 'insufficient_quota', 'invalid_input', 'provider_error']);
const count = text => [...text].length;
const safeCode = code => code === 'SESSION_EXPIRED' ? 'authentication_error' : CODES.has(code) ? code : 'provider_error';
export class AgentError extends Error {
  constructor(code, stage = 'inference') { super(safeCode(code)); this.code = safeCode(code); this.stage = stage; }
}
export function outputDiagnostics() {
  return { text_source: 'none', text_delta_event_count: 0, streamed_text_char_count: 0,
    final_output_array_present: false, final_output_item_count: 0, final_text_char_count: 0,
    selected_text_char_count: 0, selected_text_empty_or_whitespace: true,
    begins_with_markdown_code_fence: false, refusal_detected: false };
}
function parts(output) {
  return (Array.isArray(output) ? output : []).flatMap(item => item?.type === 'message' && Array.isArray(item.content) ? item.content.filter(part => part && typeof part === 'object') : []);
}
export async function consumeResponse(response, report) {
  const diagnostics = report.response_diagnostics;
  const output = report.output_diagnostics;
  diagnostics.http_status = response.status;
  const type = (response.headers.get('Content-Type') || '').split(';')[0].toLowerCase().trim();
  diagnostics.content_type = ['text/event-stream', 'application/json', 'text/plain', 'text/html'].includes(type) ? type : type ? 'other' : 'missing';
  diagnostics.content_type_mismatch = type !== 'text/event-stream';
  if (!response.ok) {
    // Bound diagnostics in memory; no HTTP body, header value, or free-text error enters the report.
    let code = 'request_failed';
    const reader = response.body?.getReader();
    if (reader) {
      try { let body = '', length = 0; const decoder = new TextDecoder();
        while (length <= 65536) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length <= 65536) body += decoder.decode(next.value, { stream: true }); }
        if (length <= 65536) { const data = JSON.parse(body + decoder.decode()); code = safeCode(data?.error?.code); }
      } catch {} finally { await reader.cancel().catch(() => {}); }
    }
    throw new AgentError(code);
  }
  if (!response.body) throw new AgentError('stream_ended_without_completion');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', eventData = [], deltas = '', bytes = 0, first = true, selected = null;
  const event = data => {
    if (data === '[DONE]') throw new AgentError('stream_ended_without_completion');
    let value;
    try { value = JSON.parse(data); } catch { throw new AgentError('invalid_stream_json'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentError('invalid_stream_json');
    diagnostics.event_count = (diagnostics.event_count || 0) + 1;
    diagnostics.body_kind = 'sse';
    if (value.type === 'response.output_text.delta') {
      output.text_delta_event_count++;
      if (typeof value.delta === 'string') { deltas += value.delta; output.streamed_text_char_count += count(value.delta); }
    } else if (['response.refusal.delta', 'response.refusal.done'].includes(value.type) || value.part?.type === 'refusal' || parts([value.item]).some(part => part.type === 'refusal')) {
      output.refusal_detected = true;
    } else if (['response.failed', 'error'].includes(value.type)) {
      diagnostics.terminal_event = value.type;
      const code = safeCode(value.response?.error?.code ?? value.code);
      diagnostics.provider_error_code = code;
      throw new AgentError(code);
    } else if (value.type === 'response.incomplete') {
      diagnostics.terminal_event = value.type;
      throw new AgentError('response_incomplete');
    } else if (value.type === 'response.completed') {
      if (value.response?.status !== 'completed' || value.response.error != null) throw new AgentError('invalid_completion_event');
      diagnostics.terminal_event = value.type;
      report.account_inference_confirmed = true;
      report.checks.response_completed = true;
      const final = value.response.output;
      output.final_output_array_present = Array.isArray(final);
      output.final_output_item_count = Array.isArray(final) ? final.length : 0;
      const content = parts(final);
      const finalText = content.filter(part => part.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('');
      output.final_text_char_count = count(finalText);
      output.refusal_detected ||= content.some(part => part.type === 'refusal');
      if (output.refusal_detected) throw new AgentError('model_refusal', 'output');
      if (finalText.trim()) { selected = finalText; output.text_source = 'final_output'; }
      else if (deltas.trim()) { selected = deltas; output.text_source = 'stream_deltas'; }
      else throw new AgentError('empty_output', 'output');
      output.selected_text_char_count = count(selected);
      output.selected_text_empty_or_whitespace = !selected.trim();
      output.begins_with_markdown_code_fence = selected.trimStart().startsWith('```');
    }
  };
  try {
    while (selected === null) {
      const next = await reader.read();
      if (next.done) { buffer += decoder.decode(); break; }
      bytes += next.value.length;
      if (bytes > 8 * 1024 * 1024) throw new AgentError('stream_too_large');
      buffer += decoder.decode(next.value, { stream: true });
      let newline;
      while (selected === null && (newline = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
        if (line.length > 1024 * 1024) throw new AgentError('stream_too_large');
        if (first) { line = line.replace(/^\uFEFF/, ''); first = false; }
        if (!line) { if (eventData.length) { const data = eventData.join('\n'); eventData = []; event(data); } }
        else if (line.startsWith('data:')) eventData.push(line.slice(5).replace(/^ /, ''));
      }
      if (buffer.length > 1024 * 1024) throw new AgentError('stream_too_large');
    }
    if (selected === null) throw new AgentError('stream_ended_without_completion');
    return selected;
  } finally { await reader.cancel().catch(() => {}); }
}
