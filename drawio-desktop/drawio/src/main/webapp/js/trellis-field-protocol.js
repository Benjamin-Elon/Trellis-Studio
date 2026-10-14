/**
 * Versioned field companion contracts and deterministic merge policy. // NEW
 * This module has no graph, filesystem, clock, or transport dependencies. // NEW
 * Desktop and Android load the same file; delivery is never acknowledgment. // NEW
 */
(function(root) {
    'use strict';
    const SCHEMA = 1;
    const MAX_BYTES = 32 * 1024 * 1024;
    const ID = /^[A-Za-z0-9_.:-]{1,160}$/;
    const STATES = ['TODO', 'DOING', 'DONE'];
    function fail(message) { throw new Error(message); }
    function identifier(value, label) {
        if (typeof value !== 'string' || !ID.test(value)) fail('Invalid ' + label + '.');
        return value;
    }
    /** Preserve the Task Manager's whitespace and Unicode code-point policy. */
    function normalizeAnnotation(value) {
        return Array.from(String(value == null ? '' : value).replace(/\s+/g, ' ').trim()).slice(0, 40).join('');
    }
    function calendarDay(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Invalid completion day.');
        const date = new Date(value + 'T12:00:00Z');
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail('Invalid completion day.');
        return value;
    }
    function version(value) {
        if (!value || !Number.isSafeInteger(value.time) || value.time < 0 || !Number.isSafeInteger(value.counter) || value.counter < 0) fail('Invalid field version.');
        identifier(value.deviceId, 'version device');
        return { time: value.time, deviceId: value.deviceId, counter: value.counter };
    }
    /** Lexical device ordering is locale-independent, including equal timestamps. */
    function compareVersions(a, b) {
        if (!a) return b ? -1 : 0;
        if (!b) return 1;
        const left = version(a), right = version(b);
        return Math.sign(left.time - right.time) || (left.deviceId < right.deviceId ? -1 : left.deviceId > right.deviceId ? 1 : 0) || Math.sign(left.counter - right.counter);
    }
    function progress(value) {
        if (!value || !STATES.includes(value.state)) fail('Invalid task progress.');
        return { state: value.state, completedDay: value.state === 'DONE' ? calendarDay(value.completedDay) : null };
    }
    function parse(input, expectedKind) {
        if (typeof input === 'string' && input.length > MAX_BYTES) fail('Field package is too large.');
        const value = typeof input === 'string' ? JSON.parse(input) : input;
        if (!value || value.schema !== SCHEMA || value.kind !== expectedKind) fail('Unsupported field package.');
        identifier(value.diagramId, 'diagram identity');
        identifier(value.workerId, 'worker identity');
        return value;
    }
    function validateUpdates(input) {
        const value = parse(input, 'task-updates');
        if (!Array.isArray(value.operations) || value.operations.length > 10000) fail('Invalid operation list.');
        const seen = new Set();
        const operations = value.operations.map(op => {
            identifier(op.id, 'operation identity');
            identifier(op.taskId, 'task identity');
            if (seen.has(op.id)) fail('Duplicate operation in package.');
            seen.add(op.id);
            if (!['progress', 'annotation'].includes(op.field)) fail('Unsupported task field.');
            if (op.field === 'annotation' && typeof op.value !== 'string') fail('Invalid annotation.');
            const stamp = version(op.version);
            if (op.id !== stamp.deviceId + ':' + stamp.counter || stamp.counter < 1) fail('Operation identity does not match its version.');
            return { id: op.id, taskId: op.taskId, field: op.field, value: op.field === 'progress' ? progress(op.value) : normalizeAnnotation(op.value), version: stamp };
        });
        return { schema: SCHEMA, kind: 'task-updates', diagramId: value.diagramId, workerId: value.workerId, operations };
    }
    function validateWork(input) {
        const value = parse(input, 'field-work');
        identifier(value.packageId, 'package identity');
        if (!Number.isSafeInteger(value.exportedAt) || value.exportedAt < 0 || !Array.isArray(value.tasks) || value.tasks.length > 10000) fail('Invalid field-work package.');
        const seen = new Set();
        const tasks = value.tasks.map(task => {
            identifier(task.id, 'task identity');
            if (seen.has(task.id)) fail('Duplicate task identity.');
            seen.add(task.id);
            const versions = task.versions || {};
            return { ...task, progress: progress(task.progress), annotation: normalizeAnnotation(task.annotation), versions: { progress: versions.progress ? version(versions.progress) : null, annotation: versions.annotation ? version(versions.annotation) : null }, locations: Array.isArray(task.locations) ? task.locations.map(id => identifier(id, 'location identity')) : [] };
        });
        const gardens = (value.gardens || []).map(garden => {
            identifier(garden.id, 'garden identity');
            if (typeof garden.png !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(garden.png) || !Number.isFinite(garden.width) || garden.width <= 0 || !Number.isFinite(garden.height) || garden.height <= 0 || !Array.isArray(garden.regions)) fail('Invalid garden preview.');
            for (const region of garden.regions) {
                identifier(region.id, 'garden object identity');
                if (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(region[key])) || region.width < 0 || region.height < 0) fail('Invalid garden selection region.');
                if (region.kind != null && !['planting-group', 'bed', 'plant', 'garden-object'].includes(region.kind)) fail('Invalid garden object kind.'); // NEW: additive region types preserve older package compatibility.
                if (region.rotation != null && (!Number.isFinite(region.rotation) || Math.abs(region.rotation) > 360)) fail('Invalid garden selection rotation.'); // NEW
            }
            return garden;
        });
        if (!Array.isArray(value.acknowledgments || [])) fail('Invalid acknowledgments.');
        return { ...value, tasks, gardens, acknowledgments: value.acknowledgments || [] };
    }
    /** Validate the complete input before calculating any updates or callbacks. */
    function mergeUpdates(workInput, updateInput, options = {}) {
        const work = validateWork(workInput), updates = validateUpdates(updateInput);
        if (work.diagramId !== updates.diagramId || work.workerId !== updates.workerId) fail('Updates belong to another diagram or worker.');
        const tasks = work.tasks.map(task => ({ ...task, versions: { ...task.versions } }));
        const byId = new Map(tasks.map(task => [task.id, task]));
        const ledger = new Map(work.acknowledgments.map(ack => [ack.id, ack]));
        const outcomes = [];
        for (const op of updates.operations) {
            if (ledger.has(op.id)) { outcomes.push(ledger.get(op.id)); continue; }
            const task = byId.get(op.taskId);
            let status;
            if (!task) status = options.hasObject?.(op.taskId) ? 'permission-rejected' : 'missing-object'; // CHANGE: omitted unauthorized tasks remain distinguishable from deleted objects.
            else if (options.canApply && !options.canApply(task, op, work.workerId)) status = 'permission-rejected';
            else if (compareVersions(op.version, task.versions[op.field]) <= 0) status = 'superseded';
            else { task[op.field] = op.value; task.versions[op.field] = op.version; status = 'applied'; }
            const outcome = { id: op.id, taskId: op.taskId, field: op.field, version: op.version, status };
            ledger.set(op.id, outcome);
            outcomes.push(outcome);
        }
        return { work: { ...work, tasks, acknowledgments: [...ledger.values()] }, outcomes };
    }
    /** Overlay pending local edits on refreshed work without claiming delivery. */
    function refreshWork(incoming, pending) {
        const work = validateWork(incoming);
        if (!pending || !pending.operations.length) return { work, pending: pending || { schema: SCHEMA, kind: 'task-updates', diagramId: work.diagramId, workerId: work.workerId, operations: [] } };
        const updates = validateUpdates(pending);
        const acknowledged = new Set(work.acknowledgments.map(ack => ack.id));
        const remaining = { ...updates, operations: updates.operations.filter(op => !acknowledged.has(op.id)) };
        return { work: mergeUpdates(work, remaining).work, pending: remaining };
    }
    root.TrellisFieldProtocol = Object.freeze({ SCHEMA, MAX_BYTES, identifier, normalizeAnnotation, calendarDay, version, compareVersions, progress, validateWork, validateUpdates, mergeUpdates, refreshWork });
})(typeof globalThis !== 'undefined' ? globalThis : window);
