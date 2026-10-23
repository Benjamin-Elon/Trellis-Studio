/** Portable garden references. Shared by the renderer and signed-journal validator. // NEW
 * Records use portable identities; SQLite keys are garden-local bindings only. // NEW
 * Manifests and revisions are append-only, so saved consumers never follow a moving head. // NEW */
(function (root) { // NEW
    'use strict';
    const ATTR = 'trellis_references_json', PROPOSALS = 'trellis_reference_proposals_json', PIN = 'trellis_reference_pin';
    const CATALOGS = ['equipment_inventory_json', 'task_type_registry_json', 'equipment_capability_registry_json', 'workload_model_json', 'irrigation_catalog_json', 'task_recipe_library_json', 'scheduler_climate_model_defaults_json', 'scheduler_climate_model_plant_overrides_json']; // CHANGE
    const OPERATIONAL = {
        equipment_inventory_json: ['status', 'acquisitionMode', 'availability', 'availabilityStart', 'availabilityEnd', 'availabilityStartDate', 'availabilityEndDate', 'purchaseDate', 'replacementDate', 'replacementDateOverride', 'purchaseCost', 'purchasePrice', 'rentalCostPerDay', 'resaleValue', 'acquisitionCost', 'acquisitionDate', 'storageNotes', 'notes'], // NEW
        irrigation_catalog_json: ['stockState', 'stockQuantity']
    };
    const clone = value => JSON.parse(JSON.stringify(value));
    const validated = new WeakMap(); // NEW
    function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; } // NEW
    function canonical(value) {
        if (value === undefined) return 'undefined';
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
        return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    }
    const equal = (a, b) => canonical(a) === canonical(b);
    const uuid = () => root.crypto.randomUUID();
    function assert(ok, message) { if (!ok) throw new Error(message); }
    function identifier(value) { assert(typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value), 'Invalid reference schema identifier.'); return value; }
    function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
    function references(value, result = []) {
        if (!object(value) && !Array.isArray(value)) return result;
        if (object(value) && value.$ref) { assert(typeof value.$ref === 'string' && typeof value.column === 'string', 'Malformed portable relationship.'); result.push(value); }
        else Object.values(value).forEach(item => references(item, result));
        return result;
    }
    const JSON_RELATIONSHIPS = { plant_id: ['Plants', 'plant_id'], plantId: ['Plants', 'plant_id'], sourcePlantId: ['Plants', 'plant_id'], companionPlantId: ['Plants', 'plant_id'], anchorPlantId: ['Plants', 'plant_id'], variety_id: ['PlantVarieties', 'variety_id'], varietyId: ['PlantVarieties', 'variety_id'], city_id: ['Cities', 'city_id'], cityId: ['Cities', 'city_id'], default_planting_method: ['PlantingMethods', 'method_id'], default_planting_method_category: ['PlantingMethodCategories', 'method_category_id'] }; // NEW
    function portableJson(value, snapshot, rowEntities, key = '') { // NEW
        if (typeof value === 'string' && ['plant_set_key', 'plantSetKey', 'crop_set_key', 'cropSetKey', 'identityKey'].includes(key) && value) { // NEW: layout lookup keys are relationships too, even though legacy SQL stores them as strings.
            const plants = key === 'plant_set_key' || key === 'plantSetKey'; // NEW
            return { $join: value.split('+').map(token => { if (plants) return portableJson(token, snapshot, rowEntities, 'plantId'); const match = /^([pv]):(\d+)$/.exec(token); assert(match, 'Invalid companion crop identity.'); return { $join: [match[1], portableJson(match[2], snapshot, rowEntities, match[1] === 'v' ? 'varietyId' : 'plantId')], separator: ':' }; }), separator: '+', sort: plants ? 'numeric' : 'lexical' }; // NEW
        } // NEW
        if (value != null && value !== '' && typeof value !== 'object' && JSON_RELATIONSHIPS[key]) { const [table, column] = JSON_RELATIONSHIPS[key], matches = (snapshot.tables[table] || []).filter(row => String(row[column]) === String(value)); assert(matches.length === 1, 'A JSON reference is missing or ambiguous: ' + key); return { $ref: rowEntities.get(matches[0]), column }; } // NEW
        if (Array.isArray(value)) return value.map(item => portableJson(item, snapshot, rowEntities)); // NEW
        if (object(value)) return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, portableJson(item, snapshot, rowEntities, name)])); // NEW
        return value; // NEW
    } // NEW
    function schemaValid(schema) {
        assert(object(schema), 'Reference schema is missing.');
        for (const [name, table] of Object.entries(schema)) {
            identifier(name); assert(Array.isArray(table.columns) && table.columns.length > 0, 'Reference table needs columns.');
            const names = new Set();
            for (const column of table.columns) { identifier(column.name); assert(!names.has(column.name), 'Duplicate reference column.'); names.add(column.name); assert(/^(?:INTEGER|INT|SMALLINT|BIGINT|REAL|TEXT|STRING|BLOB|NUMERIC|BOOLEAN|BOOL|DATE|DATETIME|TIMESTAMP|FLOAT|DOUBLE(?: PRECISION)?|VARCHAR(?:\s*\(\d+\))?|CHAR(?:\s*\(\d+\))?|DECIMAL(?:\s*\(\d+(?:,\s*\d+)?\))?)?$/i.test(column.type || ''), 'Unsupported reference column type: ' + column.type); } // CHANGE
            assert(Array.isArray(table.pk) && table.pk.every(key => names.has(key)), 'Invalid reference primary key.');
            assert(Array.isArray(table.foreignKeys), 'Reference foreign keys are missing.');
            assert((table.uniqueKeys || []).every(keys => Array.isArray(keys) && keys.length && keys.every(key => names.has(key))), 'Invalid unique reference key.'); // NEW
            assert((table.normalizedUniqueKeys || []).every(keys => Array.isArray(keys) && keys.length && keys.every(key => names.has(key))), 'Invalid normalized reference key.'); // NEW
            for (const fk of table.foreignKeys) { identifier(fk.table); identifier(fk.from); identifier(fk.to); assert(names.has(fk.from) && schema[fk.table]?.columns.some(c => c.name === fk.to), 'Invalid reference relationship schema.'); }
        }
    }
    function validate(store, manifestId = store?.current) {
        if (Object.isFrozen(store) && validated.get(store)?.has(manifestId)) return store; // NEW: only deeply frozen snapshots can use validation caching.
        assert(store?.version === 1 && object(store.revisions) && object(store.manifests) && object(store.bindings), 'Unsupported or missing garden references.');
        schemaValid(store.schema);
        const manifest = store.manifests[manifestId]; assert(manifest && object(manifest.heads), 'The pinned reference manifest is missing.');
        for (const [entityId, revisionId] of Object.entries(manifest.heads)) {
            const revision = store.revisions[revisionId];
            assert(revision?.id === revisionId && revision.entityId === entityId && object(revision.data), 'Reference revision identity is invalid.');
            assert(typeof revision.retired === 'boolean', 'Reference retirement state is missing.');
            if (revision.kind.startsWith('table:')) {
                const table = revision.kind.slice(6), schema = store.schema[table], binding = store.bindings[entityId];
                assert(schema && binding?.table === table && object(binding.key), 'Reference binding is missing.');
                assert(schema.pk.every(key => binding.key[key] != null), 'Reference primary key is missing.');
                assert(Object.keys(revision.data).every(key => schema.columns.some(c => c.name === key)), 'Unknown reference column.');
            } else assert(CATALOGS.includes(revision.kind), 'Unknown reference catalog.');
            for (const ref of references(revision.data)) {
                const target = store.revisions[manifest.heads[ref.$ref]], binding = store.bindings[ref.$ref]; // CHANGE
                assert(target && (binding?.key[ref.column] != null || target.data[ref.column] != null || target.data.item?.[ref.column] != null), 'A required portable relationship is missing.'); // CHANGE
            }
        }
        const used = new Set();
        for (const [entityId, binding] of Object.entries(store.bindings)) {
            assert(store.schema[binding.table], 'Unknown binding table.');
            const key = canonical([binding.table, binding.key]); assert(!used.has(key), 'Reference numeric keys collide.'); used.add(key);
        }
        for (const kind of CATALOGS) { // NEW
            const records = Object.values(manifest.heads).map(rid => store.revisions[rid]).filter(rev => rev.kind === kind && !rev.retired), items = records.filter(rev => rev.data.item), metadata = records.filter(rev => rev.data.metadata), payloads = records.filter(rev => rev.data.payload); // NEW
            assert(new Set(items.map(rev => rev.data.item.id)).size === items.length, 'Distinct portable entities share a catalog ID. Map their identities explicitly.'); // NEW
            assert(metadata.length <= 1 && payloads.length <= 1 && (!items.length || metadata.length === 1) && (!payloads.length || !metadata.length && !items.length), 'Catalog metadata identities must be explicitly mapped.'); // NEW
        } // NEW
        if (!validated.has(store)) validated.set(store, new Set()); validated.get(store).add(manifestId); return store; // CHANGE
    }
    function newStore(schema, id = uuid) {
        schemaValid(schema); const current = id();
        return { version: 1, schema: clone(schema), revisions: {}, bindings: {}, manifests: { [current]: { id: current, heads: {} } }, current };
    }
    function revision(entityId, kind, data, retired = false, provenance = {}, id = uuid) { return { id: id(), entityId, kind, data: clone(data), retired, provenance: clone(provenance) }; }
    function publish(store, changes, id = uuid) {
        const next = clone(store), heads = { ...next.manifests[next.current].heads };
        for (const change of changes) { assert(!next.revisions[change.id] || equal(next.revisions[change.id], change), 'An immutable revision was changed.'); next.revisions[change.id] = clone(change); heads[change.entityId] = change.id; }
        const manifestId = id(); next.manifests[manifestId] = { id: manifestId, heads }; next.current = manifestId;
        validate(next); return next;
    }
    /** Convert an explicit SQLite snapshot to portable rows, resolving relationships by declared keys. */
    function capture(snapshot, previous = null, provenance = {}, id = uuid) {
        const store = previous ? clone(previous) : newStore(snapshot.schema, id);
        assert(equal(store.schema, snapshot.schema), 'Reference schema changed; use an explicit schema upgrade.');
        const byKey = new Map(Object.entries(store.bindings).map(([entity, binding]) => [canonical([binding.table, binding.key]), entity]));
        const rowEntities = new Map(), changes = [], present = new Set();
        for (const [table, rows] of Object.entries(snapshot.tables)) {
            const schema = store.schema[table]; assert(schema && Array.isArray(rows), 'Unknown snapshot table.');
            rows.forEach((row, index) => {
                const key = schema.pk.length ? Object.fromEntries(schema.pk.map(column => [column, row[column]])) : { __row: index };
                const encoded = canonical([table, key]), entity = byKey.get(encoded) || id();
                assert(!present.has(entity), 'Duplicate reference row key.'); present.add(entity);
                store.bindings[entity] = { table, key }; byKey.set(encoded, entity); rowEntities.set(row, entity);
            });
        }
        for (const [table, rows] of Object.entries(snapshot.tables)) for (const row of rows) {
            const data = clone(row), schema = store.schema[table], entity = rowEntities.get(row);
            for (const key of schema.pk) delete data[key];
            for (const fk of schema.foreignKeys) if (row[fk.from] != null && row[fk.from] !== '') { // CHANGE: empty optional relationships retain their original empty value.
                const targetRows = snapshot.tables[fk.table] || [], targets = targetRows.filter(candidate => equal(candidate[fk.to], row[fk.from])); // CHANGE
                assert(targets.length === 1, 'Missing or ambiguous ' + fk.table + ' dependency for ' + table + '.' + fk.from + '.'); const target = targets[0]; // CHANGE
                data[fk.from] = { $ref: rowEntities.get(target), column: fk.to };
            }
            for (const key of Object.keys(data)) if (/_json$/.test(key) && typeof data[key] === 'string' && data[key].trim()) { try { data[key] = { $json: portableJson(JSON.parse(data[key]), snapshot, rowEntities) }; } catch (error) { throw new Error(table + '.' + key + ': ' + error.message); } } // NEW
            for (const key of ['plant_set_key', 'crop_set_key']) if (typeof data[key] === 'string') data[key] = portableJson(data[key], snapshot, rowEntities, key); // NEW
            const old = store.revisions[store.manifests[store.current].heads[entity]];
            if (!old || !equal(old.data, data)) changes.push(revision(entity, 'table:' + table, data, old?.retired || false, provenance, id));
        }
        // Deletes become retirement; previous consumers retain their immutable rows.
        for (const [entity, rid] of Object.entries(store.manifests[store.current].heads)) {
            const old = store.revisions[rid];
            if (old.kind.startsWith('table:') && !present.has(entity) && !old.retired) changes.push(revision(entity, old.kind, old.data, true, provenance, id));
        }
        return changes.length ? publish(store, changes, id) : validate(store);
    }
    function project(store, manifestId = store.current) {
        validate(store, manifestId); const tables = Object.fromEntries(Object.keys(store.schema).map(table => [table, []]));
        const heads = store.manifests[manifestId].heads, entities = [];
        for (const [entity, rid] of Object.entries(heads)) {
            const rev = store.revisions[rid]; if (!rev.kind.startsWith('table:')) continue;
            const binding = store.bindings[entity], row = { ...clone(rev.data), ...binding.key };
            delete row.__row;
            for (const [key, value] of Object.entries(rev.data)) if (object(value)) row[key] = Object.hasOwn(value, '$json') ? JSON.stringify(resolvePortableValue(store, heads, value.$json)) : resolvePortableValue(store, heads, value); // CHANGE
            tables[binding.table].push(row); entities.push({ entityId: entity, table: binding.table, key: binding.key, retired: rev.retired });
        }
        return { schema: clone(store.schema), tables, entities };
    }
    function rowByKey(store, manifestId, table, key) { // NEW
        validate(store, manifestId); const heads = store.manifests[manifestId].heads; // NEW
        for (const [entity, rid] of Object.entries(heads)) { const binding = store.bindings[entity]; if (binding?.table === table && Object.entries(key).every(([name, value]) => String(binding.key[name]) === String(value))) return { ...clone(store.revisions[rid].data), ...binding.key }; } // NEW
        return null; // NEW
    } // NEW
    function catalogDefinition(kind, payload) {
        const data = clone(payload), fields = [...(OPERATIONAL[kind] || [])]; // CHANGE
        if (kind === 'task_recipe_library_json') fields.push('ownerUserId', 'ownerName', 'createdByUserId', 'updatedByUserId'); // NEW: garden ownership replaces recipe-user policy in portable definitions.
        if (Array.isArray(data.items)) data.items = data.items.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => !fields.includes(key)))).sort((a, b) => String(a.id).localeCompare(String(b.id), 'en')); // CHANGE: catalog order is presentation; rules within a definition retain their order.
        delete data.updatedAt; return data;
    }
    function catalogChanges(store, kind, payload, provenance = {}, id = uuid) { // CHANGE: collect a batch before publishing or resolving cross-catalog dependencies.
        assert(CATALOGS.includes(kind), 'Unknown garden catalog.');
        const data = catalogDefinition(kind, payload);
        const old = Object.values(store.manifests[store.current].heads).map(rid => store.revisions[rid]).filter(rev => rev.kind === kind), changes = []; // CHANGE
        function change(previous, value) { if (!previous || !equal(resolvePortableValue(store, store.manifests[store.current].heads, previous.data), value) || previous.retired) changes.push(revision(previous?.entityId || id(), kind, value, false, provenance, id)); } // CHANGE
        if (Array.isArray(data.items)) { // NEW: every reusable item can be selected and decided separately.
            const seen = new Set(); // NEW
            for (const item of data.items) { assert(typeof item.id === 'string' && item.id && !seen.has(item.id), 'Catalog items need unique stable IDs.'); seen.add(item.id); change(old.find(rev => rev.data.item?.id === item.id), { item }); } // NEW
            change(old.find(rev => rev.data.metadata), { metadata: Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'items')) }); // NEW
            for (const previous of old.filter(rev => rev.data.item && !seen.has(rev.data.item.id) && !rev.retired)) changes.push(revision(previous.entityId, kind, previous.data, true, provenance, id)); // NEW
        } else change(old.find(rev => rev.data.payload), { payload: data }); // NEW
        return changes; // CHANGE
    }
    const CATALOG_RELATIONSHIPS = { capabilities: 'equipment_capability_registry_json', requiredCapabilities: 'equipment_capability_registry_json', optionalCapabilities: 'equipment_capability_registry_json', recommendedCapabilities: 'equipment_capability_registry_json', capabilityId: 'equipment_capability_registry_json', relevantTaskTypes: 'task_type_registry_json', taskTypeId: 'task_type_registry_json' }; // NEW
    function encodeCatalogReferences(store, value, key = '') { // NEW
        if (value == null || value === '') return value; // NEW
        if (Array.isArray(value)) return value.map(item => encodeCatalogReferences(store, item, key)); // NEW
        if (object(value)) { if (value.$ref) return value; return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, encodeCatalogReferences(store, item, name)])); } // NEW
        const heads = store.manifests[store.current].heads; // NEW
        if (key === 'relevantCropIds') { const binding = Object.entries(store.bindings).find(([entity, binding]) => heads[entity] && binding.table === 'Plants' && String(binding.key.plant_id) === String(value)); assert(binding, 'Select an accepted crop before linking equipment to it.'); return { $ref: binding[0], column: 'plant_id', format: 'text' }; } // CHANGE
        const kind = CATALOG_RELATIONSHIPS[key]; if (!kind) return value; // NEW
        const targets = Object.entries(heads).filter(([, rid]) => store.revisions[rid].kind === kind && store.revisions[rid].data.item?.id === value); // NEW
        assert(targets.length === 1, 'A catalog dependency is missing or ambiguous: ' + key + ' ' + value); return { $ref: targets[0][0], column: 'id' }; // NEW
    } // NEW
    function resolvePortableValue(store, heads, value) { // NEW
        if (Array.isArray(value)) return value.map(item => resolvePortableValue(store, heads, item)); // NEW
        if (object(value) && value.$ref) { const target = store.revisions[heads[value.$ref]], binding = store.bindings[value.$ref]; assert(target, 'A portable definition dependency is missing.'); const resolved = binding?.key[value.column] ?? target.data.item?.[value.column] ?? target.data[value.column]; return value.format === 'lower' ? String(resolved).trim().toLowerCase() : value.format === 'text' ? String(resolved) : resolved; } // CHANGE
        if (object(value) && value.$join) { const values = value.$join.map(item => resolvePortableValue(store, heads, item)); if (value.sort) values.sort(value.sort === 'numeric' ? (a, b) => Number(a) - Number(b) : undefined); return values.join(value.separator); } // NEW
        if (object(value) && value.$entries) return Object.fromEntries(value.$entries.map(([key, item]) => [resolvePortableValue(store, heads, key), resolvePortableValue(store, heads, item)])); // NEW
        if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolvePortableValue(store, heads, item)])); // NEW
        return value; // NEW
    } // NEW
    function putCatalogBatch(store, payloads, provenance = {}, id = uuid) { // NEW
        const collected = Object.entries(payloads).flatMap(([kind, payload]) => catalogChanges(store, kind, payload, provenance, id)); // CHANGE
        const candidate = collected.length ? publish(store, collected, id) : store; // NEW: large source snapshots are copied once for a catalog batch.
        const changes = [], heads = candidate.manifests[candidate.current].heads; // NEW
        for (const [entity, rid] of Object.entries(heads)) { const previous = candidate.revisions[rid]; if (!Object.hasOwn(payloads, previous.kind)) continue; let data = encodeCatalogReferences(candidate, previous.data); // CHANGE
            if (previous.kind === 'scheduler_climate_model_plant_overrides_json' && data.payload && !data.payload.$entries) data = { payload: { $entries: Object.entries(data.payload).map(([key, value]) => { const match = /^(.*)::(\d+)$/.exec(key); assert(match, 'Invalid climate override identity.'); const city = Object.entries(heads).find(([, rid]) => candidate.revisions[rid].kind === 'table:Cities' && String(candidate.revisions[rid].data.city_name).trim().toLowerCase() === match[1]), plant = Object.entries(candidate.bindings).find(([entity, binding]) => heads[entity] && binding.table === 'Plants' && String(binding.key.plant_id) === match[2]); assert(city && plant, 'A climate override dependency is missing.'); return [{ $join: [{ $ref: city[0], column: 'city_name', format: 'lower' }, { $ref: plant[0], column: 'plant_id' }], separator: '::' }, value]; }) } }; // NEW
            if (!equal(previous.data, data)) changes.push(revision(entity, previous.kind, data, previous.retired, provenance, id)); // CHANGE
        } // NEW
        return changes.length ? publish(candidate, changes, id) : candidate; // NEW
    } // NEW
    function putCatalog(store, kind, payload, provenance = {}, id = uuid) { return putCatalogBatch(store, { [kind]: payload }, provenance, id); } // NEW
    function catalog(store, kind, manifestId = store.current) {
        validate(store, manifestId);
        const revisions = Object.values(store.manifests[manifestId].heads).map(rid => store.revisions[rid]).filter(item => item.kind === kind && !item.retired); // CHANGE
        if (!revisions.length) return null; // NEW
        const heads = store.manifests[manifestId].heads; // NEW
        const payload = revisions.find(rev => rev.data.payload); if (payload) return resolvePortableValue(store, heads, payload.data.payload); // CHANGE
        const metadata = revisions.find(rev => rev.data.metadata); assert(metadata, 'Catalog metadata is missing.'); // NEW
        const items = revisions.filter(rev => rev.data.item).map(rev => resolvePortableValue(store, heads, rev.data.item)); // CHANGE
        assert(new Set(items.map(item => item.id)).size === items.length, 'Distinct portable entities share a catalog ID. Map their identities explicitly.'); // NEW
        return { ...clone(metadata.data.metadata), items: items.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en')) }; // NEW
    }
    /** Arrays are intentional ordered values. Overlapping changes require an explicit owner choice. */
    function merge(base, current, incoming, resolutions = {}, path = '', conflicts = []) {
        if (equal(incoming, base) || equal(current, incoming)) return { value: cloneDefined(current), conflicts };
        if (equal(current, base)) return { value: cloneDefined(incoming), conflicts };
        if (object(base) && object(current) && object(incoming)) {
            const value = {};
            for (const key of new Set([...Object.keys(base), ...Object.keys(current), ...Object.keys(incoming)])) {
                const result = merge(base[key], current[key], incoming[key], resolutions, path + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1'), conflicts);
                if (result.value !== undefined) value[key] = result.value;
            }
            return { value, conflicts };
        }
        if (resolutions[path] === 'current') return { value: cloneDefined(current), conflicts };
        if (resolutions[path] === 'incoming') return { value: cloneDefined(incoming), conflicts };
        conflicts.push({ path, base: cloneDefined(base), current: cloneDefined(current), incoming: cloneDefined(incoming) });
        return { value: cloneDefined(current), conflicts };
    }
    function cloneDefined(value) { return value === undefined ? undefined : clone(value); }
    function proposal(base, candidate, author, source, target, note = '', id = uuid) {
        validate(base); validate(candidate);
        const changes = [], before = base.manifests[base.current].heads;
        for (const [entity, rid] of Object.entries(candidate.manifests[candidate.current].heads)) {
            const old = base.revisions[before[entity]], next = candidate.revisions[rid];
            if (!old || !equal([old.data, old.retired], [next.data, next.retired])) changes.push({ entityId: entity, base: old ? clone(old) : null, candidate: clone(next), binding: cloneDefined(candidate.bindings[entity]) });
        }
        assert(changes.length > 0, 'There are no definition changes to submit.');
        const allHeads = candidate.manifests[candidate.current].heads, dependencyIds = new Set(); // NEW
        function include(entity) { // NEW
            const next = candidate.revisions[allHeads[entity]]; assert(next, 'A proposal dependency is missing.'); // NEW
            if (!changes.some(item => item.entityId === entity)) { const old = base.revisions[before[entity]]; changes.push({ entityId: entity, base: old ? clone(old) : null, candidate: clone(next), binding: cloneDefined(candidate.bindings[entity]), dependency: true }); dependencyIds.add(entity); } // NEW
        } // NEW
        for (let index = 0; index < changes.length; index++) { // NEW
            const next = changes[index].candidate; references(next.data).forEach(ref => include(ref.$ref)); // NEW
            if (next.data.item) { const metadata = Object.values(allHeads).map(rid => candidate.revisions[rid]).find(rev => rev.kind === next.kind && rev.data.metadata); if (metadata) include(metadata.entityId); } // NEW
        } // NEW
        return { version: 1, id: id(), author, source: clone(source), target: clone(target), note: String(note).slice(0, 10000), schema: clone(candidate.schema), changes }; // CHANGE: dependencies are immutable proposal items, visible to the receiving owner.
    }
    function validateProposal(value) {
        assert(value?.version === 1 && typeof value.id === 'string' && typeof value.author === 'string' && object(value.source) && object(value.target) && Array.isArray(value.changes) && value.changes.length > 0, 'Malformed reference proposal.');
        schemaValid(value.schema); const entities = new Set();
        for (const item of value.changes) {
            assert(typeof item.entityId === 'string' && !entities.has(item.entityId) && item.candidate?.entityId === item.entityId && object(item.candidate.data) && typeof item.candidate.retired === 'boolean', 'Malformed proposal item.'); entities.add(item.entityId);
            assert(!item.base || item.base.entityId === item.entityId && item.base.kind === item.candidate.kind, 'Proposal base identity mismatch.');
        }
        return value;
    }
    function allocateBinding(store, entity, binding, data = {}) { // CHANGE
        if (store.bindings[entity]) return;
        assert(binding && store.schema[binding.table], 'New reference has no binding.');
        const next = clone(binding), schema = store.schema[binding.table];
        for (const key of schema.pk) if (data[key]?.$ref) { const ref = data[key], parent = store.bindings[ref.$ref]; assert(parent?.key[ref.column] != null, 'Select or map the required parent definition first.'); next.key[key] = parent.key[ref.column]; } // NEW
        const occupied = Object.values(store.bindings).filter(item => item.table === binding.table);
        if (occupied.some(item => equal(item.key, next.key))) {
            assert(schema.pk.length === 1, 'Composite key collision requires explicit identity mapping.');
            const key = schema.pk[0], column = schema.columns.find(c => c.name === key);
            assert(/INT/i.test(column.type), 'A catalog key already exists. Explicitly map its portable identity.'); next.key[key] = Math.max(0, ...occupied.map(item => Number(item.key[key]) || 0)) + 1; // CHANGE
        }
        store.bindings[entity] = next;
    }
    /** Preview is pure. Call again at commit and compare the whole source snapshot before mutation. */
    function review(store, request, selected, resolutions = {}, id = uuid, mappings = {}) { // CHANGE
        validate(store); validateProposal(request); assert(equal(store.schema, request.schema), 'The proposal uses a different reference schema.');
        request = mapProposal(request, mappings); // NEW
        const next = clone(store), changes = [], conflicts = [], heads = store.manifests[store.current].heads;
        const chosen = new Set(selected.map(entity => mappings[entity] || entity)); assert(chosen.size > 0, 'Select at least one proposal item.'); // CHANGE
        for (const entity of chosen) assert(request.changes.some(item => item.entityId === entity), 'Unknown selected proposal item.');
        function bind(item, visiting = new Set()) { // NEW: dependency order is independent of the order an editor selected rows.
            if (!item.candidate.kind.startsWith('table:') || next.bindings[item.entityId]) return; assert(!visiting.has(item.entityId), 'Cyclic new primary-key relationships require explicit identity mapping.'); visiting.add(item.entityId); // NEW
            for (const key of next.schema[item.binding.table].pk) { const ref = item.candidate.data[key]; if (!ref?.$ref || next.bindings[ref.$ref]) continue; const parent = request.changes.find(change => change.entityId === ref.$ref); assert(parent && chosen.has(parent.entityId), 'Select the required parent definition: ' + ref.$ref); bind(parent, visiting); } // NEW
            allocateBinding(next, item.entityId, item.binding, item.candidate.data); visiting.delete(item.entityId); // NEW
        } // NEW
        request.changes.filter(item => chosen.has(item.entityId)).forEach(item => bind(item)); // NEW
        for (const item of request.changes.filter(item => chosen.has(item.entityId))) {
            const current = store.revisions[heads[item.entityId]], incoming = item.candidate;
            assert(!current || current.kind === incoming.kind, 'Portable identity kind mismatch.');
            // An unknown UUID is explicitly adopted as a distinct entity; names and numbers never match identities.
            const result = !current ? { value: { data: clone(incoming.data), retired: incoming.retired }, conflicts: [] } : merge(item.base ? { data: item.base.data, retired: item.base.retired } : undefined, { data: current.data, retired: current.retired }, { data: incoming.data, retired: incoming.retired }, resolutions[item.entityId] || {}); // NEW
            result.conflicts.forEach(conflict => conflicts.push({ entityId: item.entityId, ...conflict }));
            if (!current || !equal(result.value, { data: current.data, retired: current.retired })) changes.push(revision(item.entityId, incoming.kind, result.value.data, result.value.retired, { ...incoming.provenance, proposalId: request.id, author: request.author }, id));
        }
        const result = changes.length ? publish(next, changes, id) : next;
        return { store: result, conflicts, selected: [...selected], mappedSelected: [...chosen] }; // CHANGE: decisions retain the submitted identities for idempotency and sender receipts.
    }
    function mapProposal(request, mappings = {}) { // NEW: an owner must explicitly map foreign identities; names and numbers are never sufficient.
        const mapped = clone(request), ids = new Set(); // NEW
        function remap(value) { if (!value || typeof value !== 'object') return; if (value.$ref && mappings[value.$ref]) value.$ref = mappings[value.$ref]; else Object.values(value).forEach(remap); } // NEW
        for (const item of mapped.changes) { // NEW
            const entity = mappings[item.entityId] || item.entityId; assert(!ids.has(entity), 'Two proposal items map to the same identity.'); ids.add(entity); item.entityId = entity; item.candidate.entityId = entity; if (item.base) item.base.entityId = entity; remap(item.candidate.data); if (item.base) remap(item.base.data); // NEW
        } // NEW
        return mapped; // NEW
    } // NEW
    function retire(store, entity, retired, provenance = {}, id = uuid) {
        validate(store); const current = store.revisions[store.manifests[store.current].heads[entity]]; assert(current, 'Unknown reference entity.');
        return publish(store, [revision(entity, current.kind, current.data, !!retired, provenance, id)], id);
    }
    function template(store, id = uuid) {
        validate(store); const heads = clone(store.manifests[store.current].heads), current = id();
        const result = { version: 1, schema: clone(store.schema), bindings: clone(store.bindings), revisions: Object.fromEntries(Object.values(heads).map(rid => [rid, clone(store.revisions[rid])])), manifests: { [current]: { id: current, heads } }, current };
        return validate(result);
    }
    /** A fresh garden has no historical consumers. Carry weather for its chosen city, // NEW
     * and compact creation's intermediate manifests before the first document write. */ // NEW
    function creationSnapshot(store, cityId, id = uuid) { // NEW
        const result = template(store, id), heads = result.manifests[result.current].heads; // NEW
        const selectedCity = Object.entries(result.bindings).find(([entity, binding]) => binding.table === 'Cities' && String(binding.key.city_id) === String(cityId) && heads[entity]); // NEW
        assert(selectedCity && !result.revisions[heads[selectedCity[0]]].retired, 'The selected city is not an active city in the accepted template.'); // CHANGE
        for (const [entity, rid] of Object.entries(heads)) { const rev = result.revisions[rid]; if (/^table:CityWeather/.test(rev.kind) && rev.data.city_id?.$ref !== selectedCity[0]) { delete heads[entity]; delete result.revisions[rid]; delete result.bindings[entity]; } } // NEW
        return validate(result); // NEW
    } // NEW
    function resetInventory(kind, payload) {
        const result = clone(payload);
        if (Array.isArray(result.items)) result.items.forEach(item => {
            (OPERATIONAL[kind] || []).forEach(key => delete item[key]);
            if (kind === 'equipment_inventory_json') item.status = 'wishlist';
            if (kind === 'irrigation_catalog_json') { item.stockState = 'unknown'; item.stockQuantity = 0; }
        });
        return result;
    }
    function localToday(timezone, now = new Date()) {
        assert(typeof timezone === 'string' && timezone.length > 0, 'Garden timezone is required to update existing plantings.');
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
        const part = type => parts.find(item => item.type === type).value; return part('year') + '-' + part('month') + '-' + part('day');
    }
    function canRecalculate(attrs, tasks, today) {
        if (attrs.tg_completed === '1' || attrs.completed === '1' || attrs.actual_harvest_date || Number(attrs.actual_yield_kg) > 0 || Number(attrs.planting_actual_yield_kg) > 0 || attrs.harvest_actual) return { ok: false, reason: 'Actual work or harvest is recorded.' }; // CHANGE
        if (tasks.some(task => ['DOING', 'DONE'].includes(task.workflow_state) || task.completed === '1')) return { ok: false, reason: 'A task has started or completed.' };
        const dates = [attrs.sow_date, attrs.sow_start, attrs.start_date, attrs.establishment_date, attrs.planting_date, attrs.indoor_start, attrs.transplant_date, attrs.lifespan_start].filter(Boolean); // CHANGE
        if (!dates.length || dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date)) return { ok: false, reason: 'The planting start date is missing or ambiguous.' };
        return dates.some(date => date <= today) ? { ok: false, reason: 'The planting start date has arrived.' } : { ok: true };
    }
    function parse(value, fallback) { return value ? JSON.parse(value) : fallback; } // NEW
    function logValid(log) { // NEW
        assert(log?.version === 1 && Array.isArray(log.requests) && Array.isArray(log.decisions), 'Invalid reference message log.'); // NEW
        const ids = new Set(); for (const request of log.requests) { validateProposal(request); assert(!ids.has(request.id), 'Duplicate reference request.'); ids.add(request.id); } // NEW
        const decisions = new Set(), items = new Set(); // NEW
        for (const decision of log.decisions) { // NEW
            assert(typeof decision.id === 'string' && !decisions.has(decision.id) && ['accepted', 'declined'].includes(decision.status) && typeof decision.actor === 'string' && Array.isArray(decision.items) && decision.items.length, 'Malformed reference decision.'); decisions.add(decision.id); // NEW
            const request = log.requests.find(item => item.id === decision.proposalId); assert(request, 'Decision proposal is missing.'); // NEW
            for (const item of decision.items) { const key = canonical([decision.proposalId, item]); assert(!items.has(key) && request.changes.some(change => change.entityId === item), 'Duplicate or unknown item decision.'); items.add(key); } // NEW
        } // NEW
        return log; // NEW
    } // NEW
    /** Applies before generic administrator authority. Requests are immutable and decisions belong to the current garden owner. */ // NEW
    function validateTransition(before, after, policy) { // NEW
        const empty = { version: 1, requests: [], decisions: [] }, oldLog = logValid(parse(before.proposals, empty)), nextLog = logValid(parse(after.proposals, empty)); // NEW
        for (const field of ['requests', 'decisions']) for (const item of oldLog[field]) assert(nextLog[field].some(next => next.id === item.id && equal(next, item)), 'Reference messages and decisions are immutable.'); // NEW
        const requests = nextLog.requests.filter(item => !oldLog.requests.some(old => old.id === item.id)), decisions = nextLog.decisions.filter(item => !oldLog.decisions.some(old => old.id === item.id)); // NEW
        for (const request of requests) assert(policy.editor && request.author === policy.actor && request.target.gardenId === policy.gardenId, 'Only an editor can submit their own proposal to this garden.'); // NEW
        for (const decision of decisions) assert(policy.owner && decision.actor === policy.actor, 'Only the receiving garden owner may decide reference changes.'); // NEW
        const changed = before.references !== after.references, oldStore = parse(before.references, null), next = parse(after.references, null); // NEW
        if (changed) { // NEW
            assert(next && policy.owner, 'Only the receiving garden owner may accept reference data.'); validate(next); // NEW
            if (!oldStore) assert(policy.initializing && !decisions.length, 'Garden references may only be initialized during creation.'); // NEW
            else { // NEW
                validate(oldStore); assert(equal(oldStore.schema, next.schema), 'Reference schema changes require a versioned upgrade.'); // NEW
                for (const field of ['revisions', 'manifests', 'bindings']) for (const [key, value] of Object.entries(oldStore[field])) assert(equal(next[field][key], value), 'Saved reference revisions, manifests and bindings are immutable.'); // NEW
                const accepted = decisions.filter(decision => decision.status === 'accepted'); assert(accepted.length === 1, 'Reference changes need one reviewed owner decision.'); // NEW
                const decision = accepted[0]; assert(decision.before === oldStore.current && decision.after === next.current, 'The acceptance preview is stale.'); // NEW
                const expected = review(oldStore, nextLog.requests.find(item => item.id === decision.proposalId), decision.items, decision.resolutions || {}, uuid, decision.mappings || {}); assert(!expected.conflicts.length, 'An overlapping reference field has no owner resolution.'); // CHANGE
                const values = store => Object.fromEntries(Object.entries(store.manifests[store.current].heads).map(([entity, rid]) => { const rev = store.revisions[rid]; return [entity, { kind: rev.kind, data: rev.data, retired: rev.retired, provenance: rev.provenance }]; })); // NEW
                assert(equal(values(expected.store), values(next)) && equal(expected.store.bindings, next.bindings), 'Accepted data differs from the reviewed proposal.'); // NEW
                const newHeads = next.manifests[next.current].heads; // NEW
                assert(Object.keys(next.revisions).every(rid => oldStore.revisions[rid] || Object.values(newHeads).includes(rid)) && Object.keys(next.manifests).every(mid => oldStore.manifests[mid] || mid === next.current), 'Unreviewed reference history was inserted.'); // NEW
            } // NEW
        } else for (const decision of decisions.filter(item => item.status === 'accepted')) { // NEW
            assert(oldStore && decision.before === oldStore.current && decision.after === oldStore.current, 'Acceptance must publish its reviewed manifest.'); // NEW
            const expected = review(oldStore, nextLog.requests.find(item => item.id === decision.proposalId), decision.items, decision.resolutions || {}, uuid, decision.mappings || {}); assert(!expected.conflicts.length && expected.store.current === oldStore.current, 'Acceptance omitted reference changes.'); // CHANGE
        } // NEW
        if (next) { // NEW
            for (const kind of CATALOGS) { // NEW
                const data = parse(after.catalogs?.[kind], null); // NEW
                if (before.catalogs?.[kind] === after.catalogs?.[kind] && !changed) continue; // NEW
                const accepted = catalog(next, kind); if (!accepted && !data) continue; assert(data && accepted && equal(catalogDefinition(kind, data), accepted), 'Reusable catalog definitions require owner acceptance.'); // CHANGE
            } // NEW
        } // NEW
        return true; // NEW
    } // NEW
    root.TrellisReferenceCore = Object.freeze({ ATTR, PROPOSALS, PIN, CATALOGS, OPERATIONAL, canonical, equal, clone, freeze, uuid, identifier, references, validate, newStore, capture, project, rowByKey, publish, revision, catalogDefinition, putCatalog, putCatalogBatch, catalog, merge, proposal, validateProposal, review, mapProposal, retire, template, creationSnapshot, resetInventory, localToday, canRecalculate, validateTransition, logValid }); // CHANGE
})(globalThis); // NEW
