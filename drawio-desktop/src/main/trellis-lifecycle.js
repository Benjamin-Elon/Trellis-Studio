/** Coordinate document approval and owned-resource shutdown without Electron dependencies. */ // NEW
export function createLifecycleCoordinator(options) { // NEW
    let state = 'running'; // NEW
    let pendingQuit = null; // NEW
    const closing = new Map(); // NEW
    const live = window => !window.isDestroyed(); // NEW
    const report = error => options.onError?.(error); // NEW

    /** Revalidate all approvals before any destructive document operation. */ // NEW
    async function approve(windows) { // NEW
        const approvals = new Map(); // NEW
        for (const window of windows) { // NEW
            if (!live(window)) continue; // NEW
            const approval = await options.prepare(window); // NEW
            if (!approval) return null; // NEW
            approvals.set(window, approval); // NEW
        } // NEW
        for (;;) { // NEW
            let changed = false; // NEW
            for (const [window, approval] of approvals) { // NEW
                if (!live(window)) { approvals.delete(window); continue; } // NEW
                if (await options.validate(window, approval)) continue; // NEW
                await options.release(window); // NEW
                const next = await options.prepare(window); // NEW
                if (!next) return null; // NEW
                approvals.set(window, next); changed = true; // NEW
            } // NEW
            if (!changed) return approvals; // NEW
        } // NEW
    } // NEW

    /** Cancel releases only preparation state; transports and drafts have not changed. */ // NEW
    async function release(windows) { // NEW
        await Promise.allSettled(windows.filter(live).map(window => Promise.resolve().then(() => options.release(window)))); // NEW
    } // NEW

    /** Repeated close clicks share one approval and cleanup operation. */ // NEW
    function requestClose(window) { // NEW
        if (closing.has(window)) return closing.get(window); // NEW
        if (state !== 'running' || !live(window)) return Promise.resolve(false); // NEW
        const operation = Promise.resolve().then(async () => { // NEW
            try { // NEW
                const approvals = await approve([window]); // NEW
                if (!approvals) return false; // NEW
                if (live(window)) await options.commit(window, approvals.get(window)); // NEW
                return true; // NEW
            } catch (error) { report(error); return false; } // NEW
            finally { await release([window]); closing.delete(window); } // NEW
        }); // NEW
        closing.set(window, operation); // NEW
        return operation; // NEW
    } // NEW

    /** One quit transaction owns confirmations, transport stop, and the final exit callback. */ // NEW
    function requestQuit(reason = 'quit', exit = options.exit) { // NEW
        if (pendingQuit) return pendingQuit; // NEW
        if (state === 'ready to exit') return Promise.resolve(true); // NEW
        state = 'checking documents'; options.onState?.(state, reason); // NEW
        const windows = []; // NEW
        pendingQuit = Promise.resolve().then(async () => { // NEW
            try { // NEW
                await Promise.allSettled([...closing.values()]); // NEW
                windows.push(...options.getWindows().filter(live)); // NEW
                const approvals = await approve(windows); // NEW
                if (!approvals) return false; // NEW
                // Discard failures still leave services running and are reported to the user. // NEW
                for (const [window, approval] of approvals) if (live(window)) await options.discard(window, approval); // NEW
                state = 'stopping services'; options.onState?.(state, reason); // NEW
                await options.stop({ deadline: Date.now() + 10000 }); // NEW
                for (const window of windows) if (live(window)) await options.destroy(window); // NEW
                state = 'ready to exit'; options.onState?.(state, reason); // NEW
                await exit(); return true; // NEW
            } catch (error) { // NEW
                report(error); // NEW
                if (state === 'stopping services' || state === 'ready to exit') { // CHANGE
                    // An owned-child failure is logged, never disguised as a successful stop. // NEW
                    for (const window of windows) if (live(window)) await options.destroy(window); // NEW
                    state = 'ready to exit'; options.onState?.(state, reason); // CHANGE
                    try { await options.exit(); } catch (fallbackError) { report(fallbackError); } // NEW: a failed installer must not strand an application with no windows or tray.
                } // NEW
                return false; // NEW
            } finally { // NEW
                if (state === 'checking documents') { // NEW
                    await release(windows); state = 'running'; options.onState?.(state, 'canceled'); // NEW
                } // NEW
                pendingQuit = null; // NEW
            } // NEW
        }); // NEW
        return pendingQuit; // NEW
    } // NEW
    return { requestClose, requestQuit, get state() { return state; }, get acceptsWork() { return state === 'running' || state === 'checking documents'; }, get acceptsWindows() { return state === 'running'; } }; // NEW
} // NEW

/** Await one sender/request-correlated reply; window destruction removes listeners immediately. */ // NEW
export function requestWindowReply({ ipcMain, window, channel, replyChannel, payload, validateSender, timeoutMs = 1000 }) { // NEW
    if (window.isDestroyed()) return Promise.reject(new Error('The editor window has closed.')); // NEW
    const contents = window.webContents, senderId = contents.id; // NEW
    try { // NEW: a window can survive its failed/crashed renderer process.
        if (contents.isDestroyed?.() || contents.isCrashed?.() || contents.mainFrame?.isDestroyed()) return Promise.reject(new Error('The editor renderer is unavailable.')); // NEW
    } catch (_) { return Promise.reject(new Error('The editor renderer is unavailable.')); } // NEW
    return new Promise((resolve, reject) => { // NEW
        let timer; // NEW
        const cleanup = () => { clearTimeout(timer); ipcMain.removeListener(replyChannel, receive); window.removeListener('closed', closed); }; // NEW
        const finish = (error, value) => { cleanup(); error ? reject(error) : resolve(value); }; // NEW
        const closed = () => finish(new Error('The editor window has closed.')); // NEW
        const receive = (event, data) => { // NEW
            if (event.sender.id !== senderId || data?.uniqueId !== payload.uniqueId || !validateSender(event.senderFrame)) return; // NEW
            finish(null, data); // NEW
        }; // NEW
        ipcMain.on(replyChannel, receive); window.once('closed', closed); // NEW
        timer = setTimeout(() => finish(new Error('The editor did not answer the close check.')), timeoutMs); // NEW
        try { contents.send(channel, payload); } catch (error) { finish(error); } // NEW
    }); // NEW
} // NEW

/** Decide last-window behavior independently of native platform implementations. */ // NEW
export function lastWindowPolicy({ platform, configuredSync, trayAvailable }) { // NEW
    if (configuredSync) return trayAvailable ? 'background' : 'explain and quit'; // NEW
    return platform === 'darwin' ? 'stay open' : 'quit'; // NEW
} // NEW

/** Complete independent cleanup steps even if one subsystem has already been disposed. */ // NEW
export function cleanupClosedWindow({ window, contentsId, windows, watches, paths, services, disposers = [], onError }) { // NEW
    const steps = [() => watches.unwatchWindow(window), () => paths.delete(contentsId), ...services.map(service => () => service.forgetContext(contentsId)), ...disposers]; // NEW
    for (const step of steps) { try { step(); } catch (error) { onError?.(error); } } // NEW
    const index = windows.indexOf(window); // NEW
    if (index >= 0) windows.splice(index, 1); // NEW
} // NEW
