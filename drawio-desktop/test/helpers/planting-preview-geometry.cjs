const assert = require('node:assert/strict'); // CHANGE

/** Compare all four CSS frame corners with usable local bounds rotated around the full group pivot. */ // CHANGE
function assertFootprintFrame(frame, rect, bounds, angle, scale, translate) { // CHANGE
    assert.ok(frame, 'expected a usable planting frame'); // CHANGE
    const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians); // CHANGE
    const width = parseFloat(frame.style.width), height = parseFloat(frame.style.height); // CHANGE
    const frameCenter = { x: parseFloat(frame.style.left) + width / 2, y: parseFloat(frame.style.top) + height / 2 }; // CHANGE
    const groupCenter = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; // CHANGE
    assert.equal(width, Math.round((bounds.maxX - bounds.minX) * scale)); // CHANGE
    assert.equal(height, Math.round((bounds.maxY - bounds.minY) * scale)); // CHANGE
    assert.equal(frame.style.transform, angle ? `rotate(${angle}deg)` : ''); // CHANGE
    for (const [right, bottom] of [[false, false], [true, false], [true, true], [false, true]]) { // CHANGE
        const localX = (right ? bounds.maxX : bounds.minX) - rect.width / 2; // CHANGE
        const localY = (bottom ? bounds.maxY : bounds.minY) - rect.height / 2; // CHANGE
        const expectedX = (groupCenter.x + localX * cos - localY * sin + translate.x) * scale; // CHANGE
        const expectedY = (groupCenter.y + localX * sin + localY * cos + translate.y) * scale; // CHANGE
        const frameX = (right ? 1 : -1) * width / 2, frameY = (bottom ? 1 : -1) * height / 2; // CHANGE
        const actualX = frameCenter.x + frameX * cos - frameY * sin; // CHANGE
        const actualY = frameCenter.y + frameX * sin + frameY * cos; // CHANGE
        assert.ok(Math.abs(actualX - expectedX) <= 1.5, `footprint corner x: ${actualX} vs ${expectedX}`); // CHANGE: account for existing CSS pixel rounding.
        assert.ok(Math.abs(actualY - expectedY) <= 1.5, `footprint corner y: ${actualY} vs ${expectedY}`); // CHANGE
    } // CHANGE
} // CHANGE

/** Browser-portable measurements of painted footprint bounds and circles through view displacement and scrolling. */ // CHANGE
function measurePreviewGeometry(graph, host, rows) { // CHANGE
    const view = graph.view, scale = view.scale, tr = view.translate, hostBounds = host.getBoundingClientRect(); // CHANGE
    const dots = [...host.querySelectorAll('.manual-link-spacing-preview-plant')]; // CHANGE
    let maxFrameDelta = 0, maxCircleDelta = 0, index = 0; // CHANGE
    for (const row of rows) { // CHANGE
        let dx = 0, dy = 0; // CHANGE
        const cell = row.cellId && graph.model.getCell(row.cellId), state = cell && view.getState(cell); // CHANGE
        if (state) { // CHANGE: saved plantings follow their current view projection; Allocate supplies already-projected rectangles.
            let savedX = 0, savedY = 0; // CHANGE
            for (let current = cell; current; current = graph.model.getParent(current)) { const geo = current.getGeometry(); if (geo) { savedX += geo.x; savedY += geo.y; } } // CHANGE
            dx = state.x / scale - tr.x - savedX; dy = state.y / scale - tr.y - savedY; // CHANGE
        } // CHANGE
        const rect = row.rect, bounds = row.contentBounds, radians = (row.rotationDeg || 0) * Math.PI / 180; // CHANGE
        const cos = Math.cos(radians), sin = Math.sin(radians); // CHANGE
        const corners = [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]].map(([x, y]) => ({ // CHANGE
            x: hostBounds.x + (rect.x + rect.width / 2 + (x - rect.width / 2) * cos - (y - rect.height / 2) * sin + dx + tr.x) * scale, // CHANGE
            y: hostBounds.y + (rect.y + rect.height / 2 + (x - rect.width / 2) * sin + (y - rect.height / 2) * cos + dy + tr.y) * scale // CHANGE
        })); // CHANGE
        const frame = row.cellId ? host.querySelector('[data-spacing-preview-cell="' + row.cellId + '"]') : host.querySelector('.manual-link-spacing-preview-group-frame'); // CHANGE
        const actual = frame.getBoundingClientRect(); // CHANGE
        maxFrameDelta = Math.max(maxFrameDelta, Math.abs(actual.left - Math.min(...corners.map(p => p.x))), Math.abs(actual.right - Math.max(...corners.map(p => p.x))), Math.abs(actual.top - Math.min(...corners.map(p => p.y))), Math.abs(actual.bottom - Math.max(...corners.map(p => p.y)))); // CHANGE
        for (const dot of row.summaryText ? [] : row.circles || []) { // CHANGE
            const actual = dots[index++]?.getBoundingClientRect(); // CHANGE
            if (!actual) { maxCircleDelta = Infinity; continue; } // CHANGE
            maxCircleDelta = Math.max(maxCircleDelta, Math.abs(actual.x + actual.width / 2 - hostBounds.x - (dot.x + dx + tr.x) * scale), Math.abs(actual.y + actual.height / 2 - hostBounds.y - (dot.y + dy + tr.y) * scale)); // CHANGE
        } // CHANGE
    } // CHANGE
    return { maxFrameDelta, maxCircleDelta, circleCount: dots.length, expectedCount: index }; // CHANGE
} // CHANGE

module.exports = { assertFootprintFrame, measurePreviewGeometry }; // CHANGE
