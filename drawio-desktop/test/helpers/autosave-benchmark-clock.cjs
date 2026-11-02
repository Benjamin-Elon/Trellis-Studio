/** Install only in the isolated benchmark renderer; production timers and performance clocks remain real. */ // NEW
function installAutosaveClock(root, mode) { // NEW
    if (!['real', 'split'].includes(mode)) throw Error('Unknown autosave timing mode.'); // NEW
    const production = root.TrellisBackgroundSaving, performanceNow = root.performance.now, realNow = performanceNow.bind(root.performance); // NEW
    const sleep = delay => new Promise(resolve => root.setTimeout(resolve, delay)); // NEW
    let offset = 0, controller, executing = false, executionOffset, record; // NEW
    root.TrellisBackgroundSaving = Object.freeze({ ...production, create(options) { // NEW
        controller = production.create({ ...options, now: () => realNow() + offset }); return controller; // NEW: reuse the controller's existing clock dependency; retain every real scheduler.
    } }); // NEW
    return { // NEW
        async prepare(sampleIndex, edit) { // NEW
            if (executing || !controller) throw Error('Quiet clock preparation requires an idle managed controller.'); // NEW
            edit(); const remainingBeforeMs = controller.getSaveStatus().remainingMs; // NEW
            if (!(remainingBeforeMs > 0 && remainingBeforeMs <= production.QUIET_PERIOD_MS)) throw Error('Edit did not reset the quiet countdown.'); // NEW
            const controlled = mode === 'split' && sampleIndex > 0, started = realNow(), quietAdvanceMs = controlled ? production.QUIET_PERIOD_MS : 0; // NEW
            if (controlled) offset += quietAdvanceMs; // NEW
            else { const due = started + production.QUIET_PERIOD_MS; while (realNow() < due) await sleep(Math.max(1, due - realNow())); } // NEW
            const wallWaitMs = realNow() - started, remainingAfterMs = controller.getSaveStatus().remainingMs; // NEW
            if (remainingAfterMs !== 0) throw Error('Quiet countdown has not expired.'); // NEW
            record = { sampleIndex, mode: controlled ? 'controlled' : 'real', wallWaitMs, quietAdvanceMs, remainingBeforeMs, remainingAfterMs }; // NEW
            return record; // NEW
        }, // NEW
        beginExecution() { // NEW
            if (executing || root.performance.now !== performanceNow) throw Error('Execution requires the unmodified real performance clock.'); // NEW
            executionOffset = offset; executing = true; // NEW
        }, // NEW
        endExecution() { // NEW
            if (!executing || offset !== executionOffset || root.performance.now !== performanceNow) throw Error('Quiet clock changed during real-time execution.'); // NEW
            executing = false; const advance = offset - executionOffset; if (record) { record.executionAdvanceMs = advance; record = null; } return advance; // NEW
        } // NEW
    }; // NEW
} // NEW
module.exports = { installAutosaveClock }; // NEW
