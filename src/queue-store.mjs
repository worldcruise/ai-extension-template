export const QUEUE_DATABASE = 'ai-agent-resume-studio';
export const defaultControl = () => ({ selectedCandidateId: null });

export function createQueueStore({ indexedDB = globalThis.indexedDB, name = QUEUE_DATABASE } = {}) {
  let opening;
  function database() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        for (const key of ['requests', 'profiles', 'meta']) request.result.createObjectStore(key, { keyPath: key === 'meta' ? 'key' : 'id' });
      };
      request.onerror = () => { opening = null; reject(request.error); };
      request.onblocked = () => { reject(new Error('Local storage is waiting for another extension window to close.')); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
    });
    return opening;
  }
  async function transaction(edit) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['requests', 'profiles', 'meta'], edit ? 'readwrite' : 'readonly');
      const state = {}; let left = 3, value, failure;
      const read = (store, key, done) => {
        const request = key ? tx.objectStore(store).get(key) : tx.objectStore(store).getAll();
        request.onsuccess = () => { done(request.result); if (--left === 0 && edit) apply(); };
      };
      const apply = () => {
        const previous = { requests: new Map(state.requests.map(item => [item.id, item])), profiles: new Map(state.profiles.map(item => [item.id, item])) };
        const control = state.control;
        try {
          value = edit(state);
          if (value?.then) throw new Error('Storage edits must be synchronous.');
          for (const key of ['requests', 'profiles']) {
            const ids = new Set(state[key].map(item => item.id));
            for (const item of state[key]) if (previous[key].get(item.id) !== item) tx.objectStore(key).put(item);
            for (const id of previous[key].keys()) if (!ids.has(id)) tx.objectStore(key).delete(id);
          }
          if (state.control !== control) tx.objectStore('meta').put({ key: 'control', value: state.control });
        } catch (error) { failure = error; tx.abort(); }
      };
      read('requests', null, result => { state.requests = result.sort((a, b) => (a.sequence || 0) - (b.sequence || 0) || a.createdAt - b.createdAt); });
      read('profiles', null, result => { state.profiles = result; });
      read('meta', 'control', result => { state.control = result?.value || defaultControl(); });
      tx.oncomplete = () => resolve({ state, value });
      tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error('Could not save locally. Keep the panel open and retry saving.'));
    });
  }
  return { read: async () => (await transaction()).state, change: transaction };
}
