/** A clean compiled garden must show real handles and the host spinner before malicious probes run. */ // NEW
(async function () { // NEW
    const policy = TrellisContentPolicy, container = document.getElementById('graph'); // NEW
    policy.resetDocument(); container.style.cssText = 'position:relative;width:600px;height:400px;overflow:hidden'; // NEW
    window.iconGraph = new Graph(container); iconGraph.gridEnabled = false; iconGraph.setPanning(false); // NEW
    const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="garden" value="Garden 🌱" vertex="1" parent="1"><mxGeometry x="60" y="70" width="200" height="140" as="geometry"/></mxCell></root></mxGraphModel>'; // NEW
    const doc = mxUtils.parseXml(xml); new mxCodec(doc).decode(doc.documentElement, iconGraph.model); // NEW
    window.iconCell = iconGraph.model.getCell('garden'); iconGraph.setSelectionCell(iconCell); // NEW
    const handler = iconGraph.selectionCellsHandler.getHandler(iconCell), shapes = [...handler.sizers.filter(Boolean), handler.rotationShape]; // NEW
    if (!handler.rotationShape || shapes.length < 9) throw Error('Selection handles were not created.'); // NEW
    const sources = shapes.map(shape => { const node = shape.node.matches('img,image') ? shape.node : shape.node.querySelector('img,image'); const src = node?.getAttribute('src') || node?.getAttribute('href') || node?.getAttribute('xlink:href'); if (!src || src === policy.placeholder || shape.node.style.display === 'none') throw Error('Selection handle was replaced or hidden.'); return src; }); // NEW
    async function load(src) { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(Error('Bundled icon failed to decode.')); image.src = src; }); } // NEW
    const sizes = await Promise.all(sources.map(load)); if (sizes.some(size => size.width > 22 || size.height > 22)) throw Error('Selection handle used placeholder dimensions.'); // NEW
    const spinner = document.createElement('img'); spinner.src = Editor.tailSpin; document.body.appendChild(spinner); await load(spinner.src); // NEW
    if (getComputedStyle(spinner).animationName !== 'trellis-status-spin') throw Error('Host spinner CSS animation is missing.'); // NEW
    await new Promise(resolve => setTimeout(resolve, 100)); // NEW
    if (document.querySelector('[data-trellis-content-notice]') || policy.diagnostics().length) throw Error('Clean garden or bundled icons raised a content warning.'); // NEW
    const bounds = handler.sizers[7].bounds, rect = container.getBoundingClientRect(); spinner.remove(); // NEW
    return { handles: shapes.length, cleanNotice: false, spinner: true, x: Math.round(rect.left + bounds.getCenterX()), y: Math.round(rect.top + bounds.getCenterY()) }; // NEW
})(); // NEW
