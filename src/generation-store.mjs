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
  async function access(id, edit) {
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('runs',edit?'readwrite':'readonly'),table=tx.objectStore('runs');let value,failure;
      const request=table.get(id);
      request.onsuccess=()=>{try{const previous=request.result;value=edit?edit(previous):previous;if(value?.then)throw new Error('Run storage edits must be synchronous.');if(edit&&value&&value!==previous)table.put(value);}catch(error){failure=error;tx.abort();}};
      tx.oncomplete=()=>resolve({value});tx.onerror=tx.onabort=()=>reject(failure||tx.error||new Error('Could not access generation progress.'));
    });
  }
  async function summaries() {
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('runs'),values=[];
      const request=tx.objectStore('runs').openCursor();
      request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const {job,prompt,raw,result,...summary}=cursor.value;values.push(summary);cursor.continue();};
      tx.oncomplete=()=>resolve(values);tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Could not list generation progress.'));
    });
  }
  return { read: async () => (await change()).state, change, get:async id=>(await access(id)).value, update:access, summaries };
}
