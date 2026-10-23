/** Private, unsent editor work. This store is never a source of accepted defaults. */ // NEW
(function (root) {
    'use strict';
    let opening;
    function database() {
        if (!opening) opening = new Promise((resolve, reject) => {
            const request = root.indexedDB.open('trellis-reference-drafts', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('drafts');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => { opening = null; reject(request.error); };
        });
        return opening;
    }
    async function operation(mode, key, value, remove = false) {
        const db = await database();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('drafts', mode), store = transaction.objectStore('drafts');
            const request = mode === 'readonly' ? store.get(key) : remove ? store.delete(key) : store.put(value, key);
            transaction.oncomplete = () => resolve(request.result);
            transaction.onabort = transaction.onerror = () => reject(transaction.error || request.error || new Error('Local draft storage failed.'));
        });
    }
    root.TrellisReferenceDrafts = Object.freeze({ read: key => operation('readonly', key), write: (key, value) => operation('readwrite', key, value), remove: key => operation('readwrite', key, undefined, true) });
})(globalThis); // NEW
