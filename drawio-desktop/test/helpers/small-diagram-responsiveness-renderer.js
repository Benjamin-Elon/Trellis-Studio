/** Production renderer timings; instrumentation is installed only by the isolated benchmark. */ // CHANGE
window.benchmarkTimings = {}; // CHANGE
window.benchmarkStages = []; // CHANGE
window.__trellisBenchmarkStage = (stage, elapsedMs) => { benchmarkStages.push({ stage, at: performance.now(), elapsedMs }); if (benchmarkStages.length > 200) benchmarkStages.shift(); }; // CHANGE
window.benchmarkRemoteLabel = null; window.benchmarkReceivedAt = null; window.benchmarkVisibleAt = null; // CHANGE
window.__trellisBenchmarkReceived = (_input, result) => { // CHANGE
    if (!benchmarkRemoteLabel || benchmarkReceivedAt !== null || !result?.xml?.includes(benchmarkRemoteLabel)) return; // CHANGE
    benchmarkReceivedAt = performance.now(); const label = benchmarkRemoteLabel; // CHANGE
    const painted = () => { if (label !== benchmarkRemoteLabel) return; if (graph.model.getCell('benchmark-incoming')?.getAttribute('label') === label) requestAnimationFrame(() => { if (label === benchmarkRemoteLabel) benchmarkVisibleAt = performance.now(); }); else requestAnimationFrame(painted); }; requestAnimationFrame(painted); // CHANGE: later IPC replies must not move the receipt timestamp or inflate completion with backend work.
}; // CHANGE
function benchmarkWrap(owner, name, phase) { // CHANGE
    const original = owner?.[name]; if (!original) return; // CHANGE
    owner[name] = function (...args) { const start = performance.now(); try { return original.apply(this, args); } finally { const stat = benchmarkTimings[phase] ||= { count: 0, totalMs: 0, maxMs: 0 }; const elapsed = performance.now() - start; stat.count++; stat.totalMs += elapsed; stat.maxMs = Math.max(stat.maxMs, elapsed); if (phase === 'fullRefresh' && window.benchmarkProfiling) (stat.stacks ||= []).push(new Error().stack); } }; // CHANGE
} // CHANGE
benchmarkWrap(smokeUi, 'getFileData', 'serialize'); benchmarkWrap(smokeUi, 'getPagesForXml', 'parse'); benchmarkWrap(smokeUi, 'diffPages', 'diff'); // CHANGE
benchmarkWrap(smokeUi.getCurrentFile(), 'patch', 'patch'); benchmarkWrap(graph, 'refresh', 'fullRefresh'); benchmarkWrap(graph.view, 'validate', 'validate'); // CHANGE
benchmarkWrap(graph.model, 'fireEvent', 'modelNotifications'); // CHANGE
window.benchmarkSave = () => new Promise((resolve, reject) => { // CHANGE
    const file = smokeUi.getCurrentFile(), timer = setTimeout(() => reject(Error('Save did not complete within 30 seconds: ' + JSON.stringify({ saving: !!file.savingFile, naming: !!file.__trellisNamingMove, modified: file.isModified(), stages: benchmarkStages }))), 30000); // CHANGE
    file.save(false, () => { clearTimeout(timer); resolve(); }, error => { clearTimeout(timer); reject(error); }); // CHANGE
}); // CHANGE
window.benchmarkInteractions = async samples => { // CHANGE
    const selections = [], typing = [], movement = [], saves = []; // CHANGE
    window.benchmarkPartialInteractions = { selections, typing, movement, saves }; // CHANGE: preserve completed samples if a later operation fails.
    for (let i = 0; i < samples; i++) { // CHANGE
        const cell = graph.model.getCell('benchmark-edit'); // CHANGE: exercise the native label editor amid all fifty production garden clusters.
        let start = performance.now(); graph.setSelectionCell(cell); await frames(); selections.push(performance.now() - start); // CHANGE
        start = performance.now(); graph.startEditingAtCell(cell); // CHANGE
        if (!graph.cellEditor.textarea) throw Error('Native label editor did not open: ' + JSON.stringify({ rendered: !!graph.view.getState(cell), editable: graph.isCellEditable(cell), enabled: graph.isEnabled(), user: Trellis.users.getCurrentUser()?.id, owner: cell.getAttribute('trellis_owner_user_id') })); // CHANGE
        graph.cellEditor.textarea.textContent = 'Typing benchmark ' + i; graph.cellEditor.textarea.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(i) })); await frames(); typing.push(performance.now() - start); // CHANGE
        graph.stopEditing(false); console.log('CLUSTER_STAGE: responsiveness label save ' + i); start = performance.now(); await benchmarkSave(); saves.push(performance.now() - start); // CHANGE
        start = performance.now(); graph.moveCells([cell], 1, 0); await frames(); movement.push(performance.now() - start); // CHANGE
        console.log('CLUSTER_STAGE: responsiveness movement save ' + i); start = performance.now(); await benchmarkSave(); saves.push(performance.now() - start); // CHANGE
        if (i % 5 === 0) console.log('CLUSTER_STAGE: responsiveness interactions ' + i); // CHANGE
    } // CHANGE
    return { selectionP95: percentile(selections), typingP95: percentile(typing), movementP95: percentile(movement), saveP95: percentile(saves), selections, typing, movement, saves }; // CHANGE
}; // CHANGE
window.benchmarkIncoming = async label => { // CHANGE
    const file = smokeUi.getCurrentFile(), deadline = performance.now() + 30000; // CHANGE
    if (!graph.isEditing()) graph.startEditingAtCell(graph.model.getCell('benchmark-edit')); // CHANGE
    const undo = smokeUi.editor.undoManager, history = undo.history.slice(), index = undo.indexOfNextAdd, selected = graph.getSelectionCells().map(cell => cell.id).join(','); // CHANGE
    const textarea = graph.cellEditor.textarea; if (textarea) textarea.textContent = 'Uncommitted native draft'; // CHANGE
    smokeUi.handleFileChange({ mtimeMs: Date.now() }, { mtimeMs: 1 }, file); // CHANGE
    while (graph.model.getCell('benchmark-incoming')?.getAttribute('label') !== label || benchmarkVisibleAt === null) { if (performance.now() > deadline) throw Error('Incoming content did not appear.'); await frames(); } // CHANGE
    await frames(); if (benchmarkReceivedAt == null) throw Error('Incoming receipt timing was not observed.'); // CHANGE
    if (undo.indexOfNextAdd !== index || undo.history.length !== history.length || undo.history.some((edit, i) => edit !== history[i])) throw Error('Incoming patch changed native undo history.'); // CHANGE
    if (graph.getSelectionCells().map(cell => cell.id).join(',') !== selected || textarea && (graph.cellEditor.textarea !== textarea || textarea.textContent !== 'Uncommitted native draft')) throw Error('Incoming patch discarded selection or active typing.'); // CHANGE
    return benchmarkVisibleAt - benchmarkReceivedAt; // CHANGE
}; // CHANGE
window.benchmarkIdle = async duration => { // CHANGE
    graph.stopEditing(false); graph.clearSelection(); await benchmarkSave(); await frames(); // CHANGE
    const before = structuredClone(benchmarkTimings), start = performance.now(); // CHANGE
    await new Promise(resolve => setTimeout(resolve, duration)); // CHANGE
    const work = {}; for (const [phase, stat] of Object.entries(benchmarkTimings)) work[phase] = { count: stat.count - (before[phase]?.count || 0), totalMs: stat.totalMs - (before[phase]?.totalMs || 0) }; // CHANGE
    return { elapsedMs: performance.now() - start, work }; // CHANGE
}; // CHANGE
