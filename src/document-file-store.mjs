export const DOCUMENT_FILES_DATABASE = 'ai-agent-document-files';

export function createDocumentFileStore({ indexedDB = globalThis.indexedDB } = {}) {
  function database() {
    return new Promise((resolve, reject) => {
      let failed = false;
      const request = indexedDB.open(DOCUMENT_FILES_DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'key' });
      request.onerror = () => { failed = true; reject(request.error || new Error('Could not open downloaded document storage.')); };
      request.onblocked = () => { failed = true; reject(new Error('Close older document previews and try again.')); };
      request.onsuccess = () => {
        const db = request.result;
        if (failed) { db.close(); return; }
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  }
  function key(value) {
    if (typeof value !== 'string' || !value || value.length > 500) throw new Error('The downloaded document key is invalid.');
    return value;
  }
  async function access(mode, operation) {
    const db = await database();
    return new Promise((resolve, reject) => {
      let tx, value, failure;
      try {
        tx = db.transaction('files', mode);
        const request = operation(tx.objectStore('files'));
        request.onsuccess = () => { value = request.result; };
      } catch (error) { db.close(); reject(error); return; }
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onerror = () => { failure = tx.error; };
      tx.onabort = () => { db.close(); reject(failure || tx.error || new Error('Could not save the downloaded document.')); };
    });
  }
  return {
    async put(record) {
      key(record?.key);
      if (!(record.bytes instanceof Uint8Array) || !record.bytes.byteLength) throw new Error('The downloaded document must contain file bytes.');
      return access('readwrite', files => files.put(record));
    },
    async get(value) { return access('readonly', files => files.get(key(value))); }
  };
}
