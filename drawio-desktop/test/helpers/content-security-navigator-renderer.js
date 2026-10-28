/** Actual navigator consumers run under the production image hooks and compiled graph. */ // NEW
(async function () { // NEW
    const graph = window.navigatorGraph, policy = TrellisContentPolicy; policy.resetDocument(); // NEW
    function value(attributes) { const node = mxUtils.createXmlDocument().createElement('object'); for (const [key, text] of Object.entries(attributes)) node.setAttribute(key, text); return node; } // NEW
    const garden = graph.insertVertex(null, 'nav-garden', value({ garden_module: '1', label: 'Garden' }), 10, 10, 560, 390), bed = graph.insertVertex(garden, 'nav-bed', value({ garden_bed: '1', label: 'Bed' }), 70, 150, 300, 170); // NEW
    const first = graph.insertVertex(garden, 'nav-first', value({ tiler_group: '1', label: 'First 🌱', sow_date: '2026-03-01', harvest_end: '2026-04-01' }), 100, 190, 90, 60), second = graph.insertVertex(garden, 'nav-second', value({ tiler_group: '1', label: 'Second', sow_date: '2026-05-01', harvest_end: '2026-06-01' }), 105, 195, 90, 60); // NEW
    const assembly = graph.insertVertex(garden, 'nav-assembly', value({ irrigation_assembly: '1', irrigation_assembly_type: 'bed', label: 'Irrigation' }), 270, 240, 40, 25); // NEW
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100)))); // NEW
    const selected = () => graph.getSelectionCells().map(cell => cell.id).sort().join(','); // NEW
    function control(alt) { const node = [...graph.container.querySelectorAll('img')].find(image => image.alt === alt && getComputedStyle(image).display !== 'none'); if (!node) throw Error('Navigator control missing: ' + alt); return node; } // NEW
    async function check(alt) { const image = control(alt); await new Promise((resolve, reject) => { if (image.complete && image.naturalWidth) return resolve(); image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', () => reject(Error('Navigator image failed: ' + alt)), { once: true }); }); if (image.src === policy.placeholder || image.naturalWidth !== 22 || image.naturalHeight !== 22) throw Error('Navigator icon was replaced: ' + alt); return image; } // NEW
    graph.setSelectionCell(first); await settle(); // NEW
    const checked = []; for (const alt of ['Select bed', 'Select plantings', 'Select irrigation assembly', 'Previous planting', 'Next planting']) { await check(alt); checked.push(alt); } // NEW
    (await check('Next planting')).click(); await settle(); if (selected() !== second.id) throw Error('Next planting did not select its target.'); // NEW
    (await check('Previous planting')).click(); await settle(); if (selected() !== first.id) throw Error('Previous planting did not select its target.'); // NEW
    (await check('Select plantings')).click(); await settle(); if (selected() !== [first.id, second.id].sort().join(',')) throw Error('Planting selector did not select both groups.'); // NEW
    graph.setSelectionCell(first); await settle(); (await check('Select irrigation assembly')).click(); await settle(); if (selected() !== assembly.id) throw Error('Assembly selector did not select irrigation.'); // NEW
    (await check('Select bed')).click(); await settle(); if (selected() !== bed.id) throw Error('Bed selector did not select the bed.'); // NEW
    if (document.querySelector('[data-trellis-content-notice]') || policy.diagnostics().length) throw Error('Safe navigator icons raised a content warning.'); // NEW
    return { controls: checked, selection: selected(), cleanNotice: true }; // NEW
})(); // NEW
