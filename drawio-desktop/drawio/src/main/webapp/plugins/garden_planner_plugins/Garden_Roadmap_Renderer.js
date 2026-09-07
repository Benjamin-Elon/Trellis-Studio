/** Shared native shapes and isolated export projection; never installs editor UI. */ // NEW
(function (root) { // NEW
    'use strict'; // NEW
    const core = root.TrellisRoadmapCore, HEADER = 64; // NEW
    if (!core || root.TrellisRoadmapRenderer) return; // NEW
    function tickLabel(day) { try { return core.formatDay(day); } catch (_) { return ''; } } // NEW: outer ticks can precede year 0000.
    /** Native timeframe shape keeps ticks inside SVG/image exports, not only DOM overlays. // NEW */
    if (typeof mxRectangleShape !== 'undefined' && typeof mxCellRenderer !== 'undefined') {
        function TimeframeShape() { mxRectangleShape.apply(this, arguments); }
        TimeframeShape.prototype = Object.create(mxRectangleShape.prototype);
        TimeframeShape.prototype.constructor = TimeframeShape;
        TimeframeShape.prototype.paintVertexShape = function (canvas, x, y, width, height) {
            const style = this.style || {}, start = Number(style.roadmapFrameStart), end = Number(style.roadmapFrameEnd), anchor = Number(style.roadmapFrameAnchor), scale = Number(style.roadmapFrameScale), step = Number(style.roadmapFrameStep);
            canvas.setStrokeColor('#cbd5e1'); canvas.begin(); canvas.moveTo(x, y + 22); canvas.lineTo(x, y + height); canvas.stroke();
            if (!scale || !step || !Number.isFinite(start) || !Number.isFinite(end)) return;
            const first = anchor + Math.ceil((start - anchor) / step) * step;
            const density = Math.max(1, Math.ceil(3 / (step * scale)));
            const labelStride = Math.max(density, Math.ceil(66 / (step * scale)));
            canvas.setFontSize(8); canvas.setFontColor('#64748b');
            let count = 0;
            for (let day = first; day < end && count < 10000; day += step * density, count++) {
                const px = x + (day - start) * scale;
                canvas.begin(); canvas.moveTo(px, y + HEADER - 8); canvas.lineTo(px, y + HEADER); canvas.stroke();
                if (Math.round((day - first) / step) % labelStride === 0 && px + 62 < x + width) canvas.text(px + 2, y + HEADER - 22, 62, 12, tickLabel(day), 'left', 'top', false, '', null, false, 0);
            }
        };
        mxCellRenderer.registerShape('trellisRoadmapTimeframe', TimeframeShape);
    }

    /** Apply display data only to the export renderer's decoded model. Original XML stays canonical. */ // NEW
    function applyProjection(graph, pages, pageId) { // NEW
        const records = pages && pages[String(pageId || '')]; // NEW
        if (!records) return; // NEW
        const model = graph.getModel(); model.beginUpdate(); // NEW
        try { records.forEach(record => { // NEW
            const cell = model.getCell(record.id); if (!cell) return; // NEW
            if (record.geometry) { const geometry = model.getGeometry(cell).clone(); Object.assign(geometry, record.geometry); model.setGeometry(cell, geometry); } // NEW
            if (!record.visible) model.setVisible(cell, false); // NEW
            if (record.label != null && cell.value && cell.value.cloneNode) { const value = cell.value.cloneNode(true); value.setAttribute('label', record.label); model.setValue(cell, value); } // NEW
            if (record.frameStyle) model.setStyle(cell, cell.style + ';' + Object.entries(record.frameStyle).map(([key, value]) => key + '=' + value).join(';') + ';'); // NEW
        }); } finally { model.endUpdate(); } // NEW
    } // NEW
    root.TrellisRoadmapRenderer = Object.freeze({ applyProjection }); // NEW
})(globalThis); // NEW
