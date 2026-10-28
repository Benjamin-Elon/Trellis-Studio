/** Runs in the isolated production-strength renderer; all addresses are fixture-owned loopback URLs. */ // NEW
(async function () { // NEW
    window.executed = false; // NEW
    const remote = window.probeURL, label = '<img src="' + remote + '" onerror="window.executed=true"><b>Garden 🌱</b>'; // NEW
    const text = getCellDisplayText({ value: label }), safe = Graph.sanitizeHtml(label); // NEW
    const image = document.createElement('img'); image.src = remote; document.body.appendChild(image); // NEW
    document.body.insertAdjacentHTML('beforeend', '<img src="' + remote + '?raw"><div style="background-image:url(' + remote + '?css)">Style</div>'); // NEW
    const style = document.createElement('style'); style.textContent = '@font-face{font-family:probe;src:url(' + remote + '?font)}body{font-family:probe}'; document.head.appendChild(style); // NEW
    try { await fetch(remote + '?fetch'); } catch (_) {} // NEW
    const unsafeSvg = 'data:image/svg+xml;utf8,' + encodeURIComponent(Graph.svgDoctype + '<svg xmlns="http://www.w3.org/2000/svg"><image href="' + remote + '?svg-dependency"/></svg>'); // CHANGE: newly accepted encoding must retain dependency rejection.
    const svgRejected = TrellisContentPolicy.imageSource(unsafeSvg) === null, svgImage = new Image(); svgImage.src = unsafeSvg; document.body.appendChild(svgImage); // NEW: known-declaration normalization must not authorize SVG dependencies.
    const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" parent="1" vertex="1"><include name="' + remote + '?include"/></mxCell></root></mxGraphModel>'; // NEW
    let rejected = false; try { const doc = mxUtils.parseXml(xml); new mxCodec(doc).decode(doc.documentElement); } catch (_) { rejected = true; } // NEW
    const display = Graph.sanitizeHtml('<img src="' + remote + '?export">'); // NEW
    const graph = new Graph(document.getElementById('graph')); graph.setHtmlLabels(true); // NEW
    const model = graph.getModel(), history = new mxUndoManager(); model.addListener(mxEvent.UNDO, (_sender, event) => history.undoableEditHappened(event.getProperty('edit'))); // NEW
    const cell = graph.insertVertex(graph.getDefaultParent(), 'garden', label, 10, 10, 180, 80, 'html=1;'); // NEW
    graph.insertVertex(graph.getDefaultParent(), 'remote-image', '', 10, 100, 60, 60, 'shape=image;image=' + remote + '?style;'); // NEW
    const original = mxUtils.getXml(new mxCodec().encode(model)); // NEW
    model.setValue(cell, label.replace('Garden', 'Refresh')); history.undo(); history.redo(); // NEW: live refresh and undo/redo use the actual compiled label renderer.
    const restore = mxUtils.parseXml(original); new mxCodec(restore).decode(restore.documentElement, model); graph.refresh(); // NEW: history/recovery reconstruction uses the same native decode boundary.
    const exported = mxUtils.getXml(graph.getSvg(null, 1, 0)); // NEW
    if (exported.includes(remote) || exported.includes('onerror=')) throw new Error('Visual export retained an automatic remote dependency.'); // NEW
    TrellisContentPolicy.setAssetBase(new URL('.', window.assetURL).href.replace(/assets\/$/, '')); // NEW
    const reference = 'assets/' + window.assetURL.split('/').pop(), holder = document.createElement('div'); // NEW
    holder.innerHTML = Graph.sanitizeHtml('<b>Local 🌱</b><img src="' + reference + '">'); // NEW: the compiled sanitizer must retain approved capability URLs.
    const loaded = await new Promise(resolve => { const asset = holder.querySelector('img'); if (!asset || asset.getAttribute('src') !== window.assetURL) return resolve(false); asset.onload = () => { try { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; canvas.getContext('2d').drawImage(asset, 0, 0); resolve(canvas.toDataURL().startsWith('data:image/png')); } catch (_) { resolve(false); } }; asset.onerror = () => resolve(false); document.body.appendChild(holder); setTimeout(() => resolve(false), 4000); }); // NEW
    await new Promise(resolve => setTimeout(resolve, 200)); graph.destroy(); return { text, safe, display, rejected, svgRejected, executed: window.executed, loaded, hasRequire: typeof require, nativeHistoryAndExport: true }; // NEW
})(); // NEW
