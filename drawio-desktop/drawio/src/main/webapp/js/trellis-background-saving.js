/** Activity and private recovery scheduling are independent of the native content-save timer. */ // NEW
(function (root) { // NEW
    'use strict'; // NEW
    const QUIET_PERIOD_MS = 20000; // CHANGE: managed-garden scheduling and queued saves share one editing-pause policy.
    function create(options) { // NEW
        const every = options.setInterval || root.setInterval.bind(root), cancel = options.clearInterval || root.clearInterval.bind(root); // NEW
        const now = options.now || (() => root.performance?.now?.() || Date.now()), schedule = options.setTimeout || root.setTimeout?.bind(root), cancelTimeout = options.clearTimeout || root.clearTimeout?.bind(root), quietWaiters = new Map(); // NEW
        let lastEdit = now(); // NEW
        let disposed = false, publishing = null, publishAgain = false, checkpointTask = null, checkpointAgain = false, saveState = 'saved'; // NEW
        /** A detached local snapshot shares waitForQuiet's clock; reading it never schedules or publishes work. */ // NEW
        function getSaveStatus() { return { remainingMs: Math.max(0, QUIET_PERIOD_MS - (now() - lastEdit)), busy: !!options.busy?.(), state: saveState }; } // NEW
        function notifyStatus() { if (!disposed) { try { options.onStatusChange?.(getSaveStatus()); } catch (_) {} } } // NEW: presentation observers cannot interrupt saving or recovery.
        async function publish() { // NEW
            if (disposed) return; // NEW
            publishAgain = true; if (publishing) return publishing; // NEW
            publishing = Promise.resolve().then(async () => { // NEW
                try { while (publishAgain && !disposed) { // CHANGE
                    publishAgain = false; const pending = options.pending(); // NEW
                    notifyStatus(); // NEW: pending reconciliation may clear dirty state after undo.
                    await options.publish({ kind: 'publish', pending, objects: options.viewing(), revision: options.revision(), saveState: pending.length ? saveState === 'saved' ? 'pending' : saveState : 'saved' }); // NEW
                } } catch (error) { options.report('Status update failed: ' + error.message); } finally { publishing = null; } // CHANGE: release the slot synchronously with drain completion so a trailing request cannot attach to an already-finished drain.
            }); // CHANGE
            return publishing; // NEW
        } // NEW
        async function checkpoint(force = false) { // NEW
            if (disposed || !force && !options.dirty()) return; // NEW
            checkpointAgain = true; if (checkpointTask) return checkpointTask; // NEW
            checkpointTask = Promise.resolve().then(async () => { // NEW
                try { while (checkpointAgain && !disposed) { checkpointAgain = false; if (options.whenCapturable) await options.whenCapturable(); if (disposed) return; const captured = options.capture(); await options.checkpoint(captured); } } finally { checkpointTask = null; } // CHANGE: recovery cannot serialize an editor's provisional application or failed compensation.
            }); // CHANGE
            return checkpointTask; // NEW
        } // NEW
        const heartbeat = every(() => { notifyStatus(); void publish(); }, 5000); // CHANGE: refresh locally even while the activity IPC lane is stalled.
        const recovery = every(() => { checkpoint().catch(error => options.report('Recovery checkpoint failed: ' + error.message)); }, 10000); // NEW
        function flushQuiet() { for (const [timer, resolve] of quietWaiters) { cancelTimeout(timer); resolve(); } quietWaiters.clear(); } // NEW
        return { // NEW
            activity() { lastEdit = now(); notifyStatus(); }, // CHANGE: typing defers an existing graph save without creating dirty state or IPC work.
            changed() { lastEdit = now(); if (saveState !== 'conflict') saveState = 'pending'; notifyStatus(); void publish(); }, // CHANGE
            state(value) { saveState = value; notifyStatus(); void publish(); }, // CHANGE
            publish, checkpoint, getSaveStatus, // CHANGE
            async waitForQuiet(required = () => true) { while (!disposed && required()) { const delay = QUIET_PERIOD_MS - (now() - lastEdit); if (delay <= 0 && !options.busy?.()) return; await new Promise(resolve => { const timer = schedule(() => { quietWaiters.delete(timer); resolve(); }, delay > 0 ? delay : 250); quietWaiters.set(timer, resolve); }); } }, // CHANGE
            flushQuiet, // NEW
            dispose() { disposed = true; cancel(heartbeat); cancel(recovery); flushQuiet(); }, // CHANGE
        }; // NEW
    } // NEW
    root.TrellisBackgroundSaving = Object.freeze({ create, QUIET_PERIOD_MS }); // CHANGE
})(typeof window !== 'undefined' ? window : globalThis); // NEW
