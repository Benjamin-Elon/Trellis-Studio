/** Transactional offline store: an operation and its counter commit together. // NEW */
export async function openStore() {
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('trellis-field-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('records');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    function transaction(mode, operation) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction('records', mode), records = tx.objectStore('records'); let result;
            tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error || new Error('Offline write interrupted.'));
            operation(records, value => { result = value; });
        });
    }
    return {
        get(key) { return transaction('readonly', (records, done) => { const request = records.get(key); request.onsuccess = () => done(request.result); }); },
        put(key, value) { return transaction('readwrite', (records, done) => { records.put(value, key); done(value); }); },
        update(key, transform) { return transaction('readwrite', (records, done) => { const request = records.get(key); request.onsuccess = () => { try { const value = transform(request.result); records.put(value, key); done(value); } catch (_) { records.transaction.abort(); } }; }); },
        /** Commit counter allocation and its operation atomically, including rapid taps. */ // NEW
        recordOperation(counterKey, workKey, createOperation, overlay) { // NEW
            return transaction('readwrite', (records, done) => {
                const counter = records.get(counterKey), work = records.get(workKey);
                let received = 0;
                function apply() {
                    if (++received !== 2) return;
                    try {
                        const next = (counter.result?.counter || 0) + 1, operation = createOperation(next), value = work.result;
                        const pending = { ...value.pending, operations: [...value.pending.operations, operation] };
                        const updated = { ...value, pending, display: overlay(value.work, pending), lastSaved: Date.now() };
                        records.put({ counter: next }, counterKey); records.put(updated, workKey); done(updated);
                    } catch (_) { records.transaction.abort(); }
                }
                counter.onsuccess = apply; work.onsuccess = apply;
            });
        }
    };
}
