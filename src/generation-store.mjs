export function createGenerationStore({ indexedDB = globalThis.indexedDB } = {}) {
  let opening;
  function database() {
    return opening ||= new Promise((resolve, reject) => {
      const request = indexedDB.open('ai-agent-document-runs', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('runs', { keyPath: 'id' });
      request.onerror = () => { opening = null; reject(request.error); };
      request.onblocked = () => { opening = null; reject(new Error('Close older extension windows to unlock run storage.')); };
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
    });
  }
  async function change(mutator) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('runs', mutator ? 'readwrite' : 'readonly'), table = tx.objectStore('runs');
      let value, state, failure;
      const request = table.getAll();
      request.onsuccess = () => {
        state = { runs: request.result };
        try {
          const previous = new Map(state.runs.map(run => [run.id, run]));
          value = mutator?.(state);
          if (value?.then) throw new Error('Run storage edits must be synchronous.');
          if (mutator) for (const run of state.runs) if (previous.get(run.id) !== run) table.put(run);
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve({ state, value });
      tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('Could not save generation progress.'));
    });
  }
  return { read: async () => (await change()).state, change };
}
