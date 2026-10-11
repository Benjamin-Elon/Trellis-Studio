/** Browser-portable fixture using real scheduler rows, the regular overlay, and Roadmap projection. */ // CHANGE
async function createRegularSpacingFixture(w, graph) { // CHANGE
    const model = graph.getModel(), roadmap = graph.__trellisRoadmapManager; // CHANGE
    const value = attrs => { const node = w.mxUtils.createXmlDocument().createElement('object'); Object.entries(attrs).forEach(([key, item]) => node.setAttribute(key, String(item))); return node; }; // CHANGE
    const insert = (parent, id, attrs, x, y, width, height, style = '') => graph.insertVertex(parent, id, value(attrs), x, y, width, height, style); // CHANGE
    const roadmapModule = insert(null, 'spacing-roadmap', { roadmap_type: 'module', roadmap_module: '1', label: 'Roadmap' }, 20, 20, 300, 200, 'module=1;container=1;'); // CHANGE
    const board = roadmap.ensureMainRoadmapInRoadmapModule(roadmapModule); // CHANGE
    const outer = insert(null, 'spacing-outer', { label: 'Host' }, roadmapModule.getGeometry().x + roadmapModule.getGeometry().width + 40, 20, 900, 700, 'module=1;container=1;'); // CHANGE
    const garden = insert(outer, 'spacing-garden', { garden_module: '1', label: 'Garden' }, 70, 60, 700, 600, 'module=1;container=1;'); // CHANGE
    const bed = insert(garden, 'spacing-bed', { garden_bed: '1', label: 'Bed' }, 100, 100, 420, 300, 'rotation=37;fillColor=#afb576;'); // CHANGE
    const groups = [0, 1].map(index => insert(garden, 'spacing-group-' + index, { tiler_group: '1', label: 'Radish', plant_name: 'Radish', plant_abbr: 'RAD', // CHANGE
        spacing_x_cm: '30', spacing_y_cm: '30', veg_diameter_cm: '10', plant_yield: '1' }, 120 + index * 170, 120, 140, 170)); // CHANGE
    groups.forEach(group => w.USL.tiler.retileGroup(graph, group)); // CHANGE
    const overlay = graph.__trellisPlantingGroup.overlay, tools = w.USL.scheduler.layoutTools; // CHANGE
    const settle = () => new Promise(resolve => w.requestAnimationFrame(() => w.requestAnimationFrame(resolve))); // CHANGE
    const serialize = () => w.mxUtils.getXml(new w.mxCodec().encode(model)); // CHANGE
    async function open() { // CHANGE
        graph.setSelectionCell(groups[0]); overlay.setMode('spacing'); // CHANGE
        for (let attempt = 0; attempt < 100; attempt++) { // CHANGE
            const entry = overlay.registry.get(groups[0].id); // CHANGE
            if (entry?.panel?.querySelector('input[type=number]')) return entry; // CHANGE
            await settle(); // CHANGE
        } // CHANGE
        throw new Error('Regular spacing editor did not mount'); // CHANGE
    } // CHANGE
    function edit(entry, inputIndex = 0, text = '33') { // CHANGE
        const row = entry.panel.querySelector('[data-spacing-row-cell="' + groups[0].id + '"]'); // CHANGE: navigator context can place neighboring plantings before the selected row.
        const field = row.querySelectorAll('input[type=number]')[inputIndex]; // CHANGE
        field.focus(); field.value = text; field.dispatchEvent(new w.Event('input')); return field; // CHANGE
    } // CHANGE
    await settle(); roadmap.setViewState(board, { today: { multiplier: 2 } }); await settle(); // CHANGE: force a personal displacement after fixture model commands settle.
    return { roadmap, roadmapModule, board, outer, garden, bed, groups, tools, overlay, settle, serialize, open, edit }; // CHANGE
} // CHANGE

module.exports = { createRegularSpacingFixture }; // CHANGE
