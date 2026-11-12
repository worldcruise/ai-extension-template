import { createDocumentFileStore } from './document-file-store.mjs';

const q = selector => document.querySelector(selector);
const status = q('#document-preview-status'), open = q('#document-preview-open');
let file, objectUrl, disposed = false;

// The download API requires a user gesture. Keep this invocation directly in
// the click handler; loading the local browser preview never opens an OS app.
open.addEventListener('click', () => {
  if (!file || file.state !== 'complete' || !Number.isInteger(file.downloadId)) return;
  open.disabled = true;
  try {
    chrome.downloads.open(file.downloadId, () => {
      const error = chrome.runtime.lastError;
      if (disposed) return;
      open.disabled = false;
      status.textContent = error ? 'Chrome could not open the downloaded file. Check that it is still available in Downloads.' : 'Opened the downloaded file.';
    });
  } catch {
    open.disabled = false;
    status.textContent = 'Chrome could not open the downloaded file. Check that it is still available in Downloads.';
  }
});
window.addEventListener('pagehide', () => {
  disposed = true;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
}, { once: true });

async function load() {
  try {
    const key = new URL(location.href).searchParams.get('file');
    if (!key) throw new Error('This preview has no downloaded document.');
    const stored = await createDocumentFileStore().get(key);
    if (disposed) return;
    if (!stored || stored.state !== 'complete' || !Number.isInteger(stored.downloadId) || stored.downloadId < 0) {
      throw new Error('This document has not finished downloading or is no longer available.');
    }
    if (!(stored.bytes instanceof Uint8Array) || !stored.bytes.byteLength || !['pdf','docx','json'].includes(stored.format)) {
      throw new Error('The saved document cannot be previewed.');
    }
    const filename = typeof stored.filename === 'string' ? stored.filename : 'Downloaded document';
    q('#document-preview-filename').textContent = filename;
    document.title = filename + ' · Preview';
    q('#document-preview-kind').textContent = stored.format === 'docx' ? 'Word document' : stored.format.toUpperCase() + ' document';
    if (stored.format === 'pdf') {
      objectUrl = URL.createObjectURL(new Blob([stored.bytes], { type:'application/pdf' }));
      const frame = q('#document-preview-pdf'); frame.src = objectUrl; frame.hidden = false;
      status.textContent = 'Preview of the downloaded PDF.';
    } else {
      const content = q('#document-preview-text');
      content.textContent = stored.format === 'json' ? new TextDecoder('utf-8', { fatal:true, ignoreBOM:true }).decode(stored.bytes)
        : typeof stored.previewText === 'string' ? stored.previewText : 'Use Open downloaded file to view this Word document.';
      content.hidden = false;
      status.textContent = stored.format === 'docx' ? 'Text preview. Open the downloaded file to view its Word formatting.' : 'Contents of the downloaded JSON file.';
    }
    file = {state:stored.state,downloadId:stored.downloadId}; open.disabled = false;
    document.documentElement.dataset.previewState = 'ready';
  } catch (error) {
    if (disposed) return;
    document.documentElement.dataset.previewState = 'error';
    status.textContent = error.message || 'Could not load this downloaded document.';
  }
}
void load();
