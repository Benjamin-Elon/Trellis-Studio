const assert = require('node:assert/strict'); // CHANGE
const test = require('node:test'); // CHANGE
const { loadFittedPlantingGeometry } = require('./helpers/fitted-planting-harness.cjs'); // CHANGE

function bed(width = 100, height = 500, rotation = 0) { // CHANGE
    return { id: 'bed', rotation, getGeometry: () => ({ x: 40, y: 60, width, height }) }; // CHANGE
} // CHANGE
function input(overrides = {}) { // CHANGE
    return { bedCell: bed(), spacingXCm: 20, spacingYCm: 30, plantCount: 7, fillCompleteRows: true, overlapPolicy: 'warn', entryISO: '2027-04-01', harvestEndISO: '2027-07-01', ...overrides }; // CHANGE
} // CHANGE
function occupancy(rect, overrides = {}) { // CHANGE
    return { groupId: 'existing', plantName: 'Carrot', bedId: 'bed', rect, plantingRect: rect, bedEntryISO: '2027-05-01', harvestEndISO: '2027-06-01', ...overrides }; // CHANGE
} // CHANGE
function close(actual, expected, tolerance = 1e-6) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`); } // CHANGE

test('zero-offset planting circles balance opposite bed edges independently of spacing and rotation', () => { // CHANGE
    const api = loadFittedPlantingGeometry(); // CHANGE
    for (const rotation of [0, 30, 45, 90, -30]) for (const percentage of [0, 30, 50, 12.5]) { // CHANGE
        for (const [sx, sy, diameter, width, height] of [[85, 120, 110, 300, 180], [85, 120, 110, 1600, 950], [15, 20, 10, 500, 130], [120, 85, 110, 950, 1600]]) { // CHANGE
            const targetBed = bed(width, height, rotation); // CHANGE
            const p = api.proposePlantingGeometry(input({ bedCell: targetBed, spacingXCm: sx, spacingYCm: sy, vegDiameterCm: diameter, allowedOverhangPct: percentage, offsetXCm: 0, offsetYCm: 0, fillAvailableBed: true })); // CHANGE
            assert.equal(p.ok, true); // CHANGE
            close(p.plantingRect.x + p.plantingRect.width / 2, 40 + width / 2); // CHANGE
            close(p.plantingRect.y + p.plantingRect.height / 2, 60 + height / 2); // CHANGE
            close(p.layoutOffsetXCm, 0); close(p.layoutOffsetYCm, 0); // CHANGE
            const group = api.createPlantingFromProposal({ moduleCell: { getAttribute: () => null }, proposal: p }); // CHANGE
            assert.equal(group.attrs.layout_alignment, 'centered'); // CHANGE
            close(Number(group.attrs.layout_base_offset_x_cm), p.layoutBaseOffsetXCm); // CHANGE
            close(Number(group.attrs.layout_base_offset_y_cm), p.layoutBaseOffsetYCm); // CHANGE
            const stats = api.classifyPlantingSlots(group, api.toPx(sx), api.toPx(sy), api.groupLabelMetrics(group).bandPx, api.readDisabledSet(group)); // CHANGE
            assert.equal(stats.actual, p.plantCount); // CHANGE
        } // CHANGE
    } // CHANGE
}); // CHANGE

test('percentage overhang is precise, diameter-relative, validated, and persisted including zero', () => { // CHANGE
    const api = loadFittedPlantingGeometry(); // CHANGE
    for (const percentage of [0, 30, 50, 12.5]) for (const diameter of [10, 20]) { // CHANGE
        const p = api.proposePlantingGeometry(input({ bedCell: bed(100, 250, 45), spacingXCm: 15, spacingYCm: 15, vegDiameterCm: diameter, allowedOverhangPct: percentage, fillAvailableBed: true })); // CHANGE
        assert.equal(p.allowedOverhangPct, percentage); // CHANGE
        close(p.geometry.width, 100 + 2 * api.toPx(diameter) * percentage / 100 + 8); // CHANGE
        const group = api.createPlantingFromProposal({ moduleCell: { getAttribute: () => null }, proposal: p }); // CHANGE
        assert.equal(Number(group.attrs.allowed_overhang_pct), percentage); // CHANGE
    } // CHANGE
    assert.equal(api.proposePlantingGeometry(input()).allowedOverhangPct, 30); // CHANGE
    for (const percentage of ['', 'invalid', -1, 51, Infinity]) assert.throws(() => api.proposePlantingGeometry(input({ allowedOverhangPct: percentage })), /overhang/); // CHANGE
}); // CHANGE

test('offset-aware demand fitting agrees with committed circles on both axes and rotated beds', () => { // CHANGE
    const api = loadFittedPlantingGeometry(); // CHANGE
    for (const axis of ['width', 'height']) for (const rotation of [0, 37, 90]) for (const [x, y] of [[0, 0], [-25, 12], [35, -40], [2.5, 7.25]]) { // CHANGE
        const proposal = api.proposePlantingGeometry(input({ bedCell: bed(300, 300, rotation), plantCount: 17, fitAxisOverride: axis, offsetXCm: x, offsetYCm: y })); // CHANGE
        assert.equal(proposal.ok, true, JSON.stringify({ axis, rotation, x, y })); // CHANGE
        assert.ok(proposal.plantCount >= 17); assert.equal(proposal.slots.length, proposal.plantCount); // CHANGE
        close(proposal.layoutOffsetXCm, x); close(proposal.layoutOffsetYCm, y); // CHANGE
        const group = api.createPlantingFromProposal({ moduleCell: { getAttribute: () => null }, proposal }); // CHANGE
        const stats = api.classifyPlantingSlots(group, api.toPx(20), api.toPx(30), api.groupLabelMetrics(group).bandPx, api.readDisabledSet(group)); // CHANGE
        assert.equal(stats.actual, proposal.plantCount); assert.equal(Number(group.attrs.plant_count), proposal.plantCount); // CHANGE
        for (const slot of proposal.slots) { // CHANGE
            assert.ok(stats.renderedKeys.has(`${slot.row},${slot.col}`)); // CHANGE
            const center = api.shiftedSlotCenterLocal(group, slot.row, slot.col, api.toPx(20), api.toPx(30), api.groupLabelMetrics(group).bandPx); // CHANGE
            close(center.x, slot.x); close(center.y, slot.y); // CHANGE
        } // CHANGE
    } // CHANGE
}); // CHANGE

test('offset-aware fitting reports reduced capacity, grows to demand, and recovers from extreme offsets', () => { // CHANGE
    const api = loadFittedPlantingGeometry(); // CHANGE
    const request = input({ bedCell: bed(300, 300), fitAxisOverride: 'width', offsetXCm: -25, offsetYCm: 12 }); // CHANGE
    const small = api.proposePlantingGeometry({ ...request, plantCount: 7 }); // CHANGE
    const larger = api.proposePlantingGeometry({ ...request, plantCount: 27 }); // CHANGE
    assert.ok(larger.geometry.height > small.geometry.height); // CHANGE
    const tooMany = api.proposePlantingGeometry({ ...request, plantCount: 10000 }); // CHANGE
    assert.equal(tooMany.ok, false); assert.ok(tooMany.capacity > 0); // CHANGE
    const partial = api.proposePlantingGeometry({ ...request, plantCount: tooMany.capacity }); // CHANGE
    assert.equal(partial.ok, true); assert.equal(partial.plantCount, tooMany.capacity); // CHANGE
    for (const offset of [-100000, 100000]) { // CHANGE
        const none = api.proposePlantingGeometry({ ...request, offsetXCm: offset }); // CHANGE
        assert.equal(none.ok, false); assert.equal(none.capacity, 0); assert.equal(none.slots.length, 0); // CHANGE
    } // CHANGE
    assert.equal(api.proposePlantingGeometry({ ...request, offsetXCm: 0, offsetYCm: 0 }).ok, true); // CHANGE
}); // CHANGE

test('small offsets move circles within the bed-fitted frame instead of being cancelled by placement', () => { // CHANGE
    const api = loadFittedPlantingGeometry(), request = input({ bedCell: bed(300, 300), fitAxisOverride: 'width', offsetXCm: 0, offsetYCm: 0 }); // CHANGE
    const before = api.proposePlantingGeometry(request), after = api.proposePlantingGeometry({ ...request, offsetXCm: 2 }); // CHANGE
    close(before.geometry.x, after.geometry.x); assert.equal(before.plantCount, after.plantCount); // CHANGE
    close(after.slots[0].x - before.slots[0].x, api.toPx(2)); // CHANGE
}); // CHANGE

test('offsets displace both axes from the same baseline, including partial assigned sections', () => { // CHANGE
    const api = loadFittedPlantingGeometry(); // CHANGE
    for (const fitAxisOverride of ['width', 'height']) { // CHANGE
        const request = input({ bedCell: bed(1000, 1000), spacingXCm: 30, spacingYCm: 30, vegDiameterCm: 20, plantCount: 6, fitAxisOverride, offsetXCm: 0, offsetYCm: 0 }); // CHANGE
        const original = api.proposePlantingGeometry(request), shifted = api.proposePlantingGeometry({ ...request, offsetXCm: 1.25, offsetYCm: -0.5 }); // CHANGE
        close(shifted.geometry.x, original.geometry.x); close(shifted.geometry.y, original.geometry.y); // CHANGE
        assert.equal(shifted.plantCount, original.plantCount); // CHANGE
        shifted.slots.forEach((slot, index) => { close(slot.x - original.slots[index].x, api.toPx(1.25)); close(slot.y - original.slots[index].y, api.toPx(-0.5)); }); // CHANGE
    } // CHANGE
}); // CHANGE

test('short-axis defaults, square ties, and explicit rotation preserve unequal spacing', () => { // CHANGE
    const api = loadFittedPlantingGeometry(); // CHANGE
    for (const [width, height, axis] of [[100, 500, 'width'], [500, 100, 'height'], [100, 100, 'width']]) { // CHANGE
        const proposal = api.proposePlantingGeometry(input({ bedCell: bed(width, height) })); // CHANGE
        assert.equal(proposal.fitAxis, axis); assert.equal(proposal.ok, true); // CHANGE
        const rotated = api.proposePlantingGeometry(input({ bedCell: bed(width, height), fitAxisOverride: axis === 'width' ? 'height' : 'width' })); // CHANGE
        assert.notEqual(rotated.fitAxis, axis); close(rotated.spacingXCm, 20); close(rotated.spacingYCm, 30); // CHANGE
        const perRow = proposal.fitAxis === 'width' ? proposal.cols : proposal.rows; // CHANGE
        assert.equal(proposal.plantCount % perRow, 0); assert.ok(proposal.plantCount >= 7); // CHANGE
    } // CHANGE
}); // CHANGE

test('physical row capacity excludes header and never forces a plant into a narrow bed', () => { // CHANGE
    const api = loadFittedPlantingGeometry(); // CHANGE
    const proposal = api.proposePlantingGeometry(input({ bedCell: bed(100, 27), fitAxisOverride: 'width', plantCount: 5 })); // CHANGE
    assert.equal(proposal.ok, true); assert.equal(proposal.rows, 1); // CHANGE
    assert.ok(proposal.geometry.height > 27); assert.ok(proposal.geometry.y < 60); // CHANGE
    const impossible = api.proposePlantingGeometry(input({ bedCell: bed(1, 1) })); // CHANGE
    assert.equal(impossible.ok, false); assert.equal(impossible.capacity, 0); assert.equal(impossible.plantCount, 0); // CHANGE
    assert.equal(impossible.reason, 'no_row_capacity'); // CHANGE
    assert.throws(() => api.createPlantingFromProposal({ moduleCell: { getAttribute: () => null }, proposal: impossible }), /physically fit/); // CHANGE
    for (const width of [0, -1, NaN, Infinity]) { // CHANGE
        const invalid = api.proposePlantingGeometry(input({ bedCell: bed(width, 100) })); // CHANGE
        assert.equal(invalid.ok, false); assert.equal(invalid.reason, 'invalid_bed_geometry'); // CHANGE
    } // CHANGE
}); // CHANGE

test('oversized demand reports complete-row capacity and fitting demand remains rounded up', () => { // CHANGE
    const api = loadFittedPlantingGeometry(); // CHANGE
    const oversized = api.proposePlantingGeometry(input({ bedCell: bed(100, 100), plantCount: 800 })); // CHANGE
    assert.equal(oversized.ok, false); assert.equal(oversized.plantCount, oversized.capacity); // CHANGE
    const partial = api.proposePlantingGeometry(input({ bedCell: bed(100, 100), plantCount: oversized.capacity })); // CHANGE
    assert.equal(partial.ok, true); assert.equal(partial.plantCount, oversized.capacity); // CHANGE
    assert.equal(api.proposePlantingGeometry(input()).plantCount, 10); // CHANGE
}); // CHANGE

test('dynamic headers, fitted diameter, and committed slot counts agree in detail and LOD', () => { // CHANGE
    const api = loadFittedPlantingGeometry(); // CHANGE
    for (const options of [input(), input({ bedCell: bed(2000, 2000), plantCount: 1200 }), input({ vegDiameterCm: 40 }), input({ bedCell: bed(100, 500, 37) })]) { // CHANGE
        const proposal = api.proposePlantingGeometry(options); // CHANGE
        const group = api.createPlantingFromProposal({ moduleCell: { getAttribute: () => null }, proposal }); // CHANGE
        assert.equal(Number(group.attrs.plant_count_actual), proposal.plantCount); // CHANGE
        assert.equal(Number(group.attrs.plant_count), proposal.plantCount); // CHANGE
        assert.equal(group.attrs.lod_collapsed, proposal.lodCollapsed ? '1' : '0'); // CHANGE
        assert.equal(group.attrs.bed_fit_width, proposal.fitAxis === 'width' ? '1' : '0'); // CHANGE
        assert.equal(group.attrs.bed_fit_height, proposal.fitAxis === 'height' ? '1' : '0'); // CHANGE
        close(api.groupLabelMetrics(group).bandPx, proposal.labelBandPx); // CHANGE
        const stats = api.classifyPlantingSlots(group, api.toPx(proposal.spacingXCm), api.toPx(proposal.spacingYCm), proposal.labelBandPx, api.readDisabledSet(group)); // CHANGE
        assert.equal(stats.actual, proposal.plantCount); // CHANGE
        proposal.slots.forEach(slot => { // CHANGE
            const center = api.shiftedSlotCenterLocal(group, slot.row, slot.col, api.toPx(proposal.spacingXCm), api.toPx(proposal.spacingYCm), proposal.labelBandPx); // CHANGE
            close(slot.x, center.x); close(slot.y, center.y); close(slot.r, api.toPx(Number(group.attrs.veg_diameter_cm)) / 2); // CHANGE
        }); // CHANGE
        const footprint = api.readPlantingFootprint(group); // CHANGE
        for (const key of ['x', 'y', 'width', 'height', 'rotation']) close(footprint[key], proposal.plantingRect[key]); // CHANGE
    } // CHANGE
}); // CHANGE

test('headers do not cause conflicts and separated dates do not occupy planting space', () => { // CHANGE
    const api = loadFittedPlantingGeometry(); // CHANGE
    const base = api.proposePlantingGeometry(input()); // CHANGE
    const header = { x: base.geometry.x, y: base.geometry.y, width: base.geometry.width, height: base.labelBandPx }; // CHANGE
    const actualPlants = { x: 40, y: 400, width: 100, height: 50 }; // CHANGE
    const headerOnly = api.proposePlantingGeometry(input({ occupancy: [occupancy(header, { plantingRect: actualPlants })] })); // CHANGE
    assert.equal(headerOnly.warnings.length, 0); close(headerOnly.geometry.y, base.geometry.y); // CHANGE
    const expired = api.proposePlantingGeometry(input({ occupancy: [occupancy({ x: 0, y: 0, width: 1000, height: 1000 }, { bedEntryISO: '2026-01-01', harvestEndISO: '2026-12-31' })] })); // CHANGE
    assert.equal(expired.warnings.length, 0); // CHANGE
}); // CHANGE

test('least occupied placement minimizes union area and keeps the first position on ties', () => { // CHANGE
    const api = loadFittedPlantingGeometry(); // CHANGE
    const all = occupancy({ x: 0, y: 0, width: 1000, height: 1000 }); // CHANGE
    const single = api.proposePlantingGeometry(input({ occupancy: [all] })); // CHANGE
    const duplicate = api.proposePlantingGeometry(input({ occupancy: [all, { ...all, groupId: 'duplicate' }] })); // CHANGE
    close(single.area, duplicate.area); close(single.geometry.y, duplicate.geometry.y); // CHANGE
    const blockedTop = occupancy({ x: 40, y: 50, width: 100, height: 100 }); // CHANGE
    const moved = api.proposePlantingGeometry(input({ occupancy: [blockedTop] })); // CHANGE
    assert.equal(moved.warnings.length, 0); assert.ok(moved.plantingRect.y >= 150); // CHANGE
    const [a, b] = [{ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 0, width: 10, height: 10 }]; // CHANGE
    close(api.plantingFootprintUnionArea([api.plantingFootprintPolygon(a), api.plantingFootprintPolygon(b)]), 150); // CHANGE
}); // CHANGE

test('Allocate permits warned incompatible overlap and bed scheduling retains its block', () => { // CHANGE
    const api = loadFittedPlantingGeometry(); // CHANGE
    for (const conflictKind of ['companion', 'incompatible', 'unknown']) { // CHANGE
        const existing = occupancy({ x: 0, y: 0, width: 1000, height: 1000 }, { conflictKind }); // CHANGE
        const allocation = api.proposePlantingGeometry(input({ occupancy: [existing] })); // CHANGE
        assert.equal(allocation.ok, true); assert.equal(allocation.status, 'warning'); // CHANGE
        assert.match(allocation.warnings[0], new RegExp(conflictKind === 'unknown' ? 'Unknown relationship' : conflictKind, 'i')); // CHANGE
        assert.match(allocation.warnings[0], /Carrot/); // CHANGE
        const scheduled = api.proposePlantingGeometry(input({ occupancy: [existing], fillCompleteRows: false, fillAvailableBed: true, overlapPolicy: undefined })); // CHANGE
        assert.equal(scheduled.ok, conflictKind !== 'incompatible'); // CHANGE
    } // CHANGE
}); // CHANGE

test('rotated footprints use actual intersections rather than overlapping bounding boxes', () => { // CHANGE
    const api = loadFittedPlantingGeometry(); // CHANGE
    const square = { x: 0, y: 0, width: 10, height: 10, rotation: 45 }; // CHANGE
    close(api.plantingFootprintUnionArea([api.plantingFootprintPolygon(square)]), 100); // CHANGE
    const corner = { x: -2, y: -2, width: 1, height: 1 }; // CHANGE
    close(api.plantingFootprintUnionArea([api.clipPlantingFootprint(api.plantingFootprintPolygon(square), corner)]), 0); // CHANGE
    const rotatedBed = bed(100, 500, 37); // CHANGE
    const existing = occupancy({ x: -1000, y: -1000, width: 4000, height: 4000 }, { conflictKind: 'companion' }); // CHANGE
    const proposal = api.proposePlantingGeometry(input({ bedCell: rotatedBed, occupancy: [existing] })); // CHANGE
    close(proposal.area, proposal.plantingRect.width * proposal.plantingRect.height); // CHANGE
    assert.equal(proposal.rotation, 37); assert.equal(proposal.warnings.length, 1); // CHANGE
}); // CHANGE
