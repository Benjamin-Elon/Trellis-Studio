/** Activity and private recovery scheduling are independent of the native content-save timer. */ // NEW
(function (root) { // NEW
    'use strict'; // NEW
    function create(options) { // NEW
        const every = options.setInterval || root.setInterval.bind(root), cancel = options.clearInterval || root.clearInterval.bind(root); // NEW
        const now = options.now || (() => root.performance?.now?.() || Date.now()), schedule = options.setTimeout || root.setTimeout?.bind(root), cancelTimeout = options.clearTimeout || root.clearTimeout?.bind(root), quietWaiters = new Map(); // NEW
        let lastEdit = now(); // NEW
        let disposed = false, publishing = null, publishAgain = false, checkpointTask = null, checkpointAgain = false, saveState = 'saved'; // NEW
        async function publish() { // NEW
            if (disposed) return; // NEW
            publishAgain = true; if (publishing) return publishing; // NEW
            publishing = Promise.resolve().then(async () => { // NEW
                try { while (publishAgain && !disposed) { // CHANGE
                    publishAgain = false; const pending = options.pending(); // NEW
                    await options.publish({ kind: 'publish', pending, objects: options.viewing(), revision: options.revision(), saveState: pending.length ? saveState === 'saved' ? 'pending' : saveState : 'saved' }); // NEW
                } } catch (error) { options.report('Status update failed: ' + error.message); } finally { publishing = null; } // CHANGE: release the slot synchronously with drain completion so a trailing request cannot attach to an already-finished drain.
            }); // CHANGE
            return publishing; // NEW
        } // NEW
        async function checkpoint(force = false) { // NEW
            if (disposed || !force && !options.dirty()) return; // NEW
            checkpointAgain = true; if (checkpointTask) return checkpointTask; // NEW
            checkpointTask = Promise.resolve().then(async () => { // NEW
                try { while (checkpointAgain && !disposed) { checkpointAgain = false; const captured = options.capture(); await options.checkpoint(captured); } } finally { checkpointTask = null; } // CHANGE: close requests arriving at drain completion must receive their own completed capture.
            }); // CHANGE
            return checkpointTask; // NEW
        } // NEW
        const heartbeat = every(() => { void publish(); }, 5000); // NEW
        const recovery = every(() => { checkpoint().catch(error => options.report('Recovery checkpoint failed: ' + error.message)); }, 10000); // NEW
        function flushQuiet() { for (const [timer, resolve] of quietWaiters) { cancelTimeout(timer); resolve(); } quietWaiters.clear(); } // NEW
        return { // NEW
            changed() { lastEdit = now(); if (saveState !== 'conflict') saveState = 'pending'; void publish(); }, // CHANGE
            state(value) { saveState = value; void publish(); }, // NEW
            publish, checkpoint, // NEW
            async waitForQuiet(required = () => true) { while (!disposed && required()) { const delay = 5000 - (now() - lastEdit); if (delay <= 0) return; await new Promise(resolve => { const timer = schedule(() => { quietWaiters.delete(timer); resolve(); }, delay); quietWaiters.set(timer, resolve); }); } }, // NEW
            flushQuiet, // NEW
            dispose() { disposed = true; cancel(heartbeat); cancel(recovery); flushQuiet(); }, // CHANGE
        }; // NEW
    } // NEW
    root.TrellisBackgroundSaving = Object.freeze({ create }); // NEW
})(typeof window !== 'undefined' ? window : globalThis); // NEW
