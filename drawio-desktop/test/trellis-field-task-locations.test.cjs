/** Production link normalization and visibility must agree with planting preview identities. */ // CHANGE
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'); // CHANGE
const { parse } = require('@babel/parser'), traverse = require('@babel/traverse').default; // CHANGE
const webapp = path.resolve(__dirname, '../drawio/src/main/webapp'); // CHANGE
function functions(file, names) { // CHANGE
    const source = fs.readFileSync(path.join(webapp, file), 'utf8'), found = []; // CHANGE
    traverse(parse(source), { FunctionDeclaration({ node }) { if (names.includes(node.id?.name)) found.push(source.slice(node.start, node.end)); } }); // CHANGE
    assert.equal(found.length, names.length); return found.join('\n'); // CHANGE
} // CHANGE
const normalization = functions('plugins/garden_planner_plugins/Vertex_Linking_Standalone.js', ['isTilerGroup', 'findTilerGroupAncestor', 'normalizeForLinkingAndPrimary']); // CHANGE
const locations = functions('js/trellis-field-runtime.js', ['readable', 'linkedPlantingGroups', 'gardenObjectKind']); // CHANGE
for (const scenario of ['direct', 'child', 'duplicates', 'missing', 'unreadable-group', 'unreadable-child', 'no-field-id']) test('field task locations preserve planting identity: ' + scenario, () => { // CHANGE
    const bed = { id: 'bed', garden_bed: '1', trellis_field_object_id: 'bed-field' }, group = { id: 'group', parent: bed, tiler_group: '1', trellis_field_object_id: 'group-field' }, child = { id: 'child', parent: group, plant_tiler: '1' }; // CHANGE
    const cells = new Map([bed, group, child].map(cell => [cell.id, cell])), denied = new Set(), model = { getCell: id => cells.get(id), getParent: cell => cell.parent }, graph = { getModel: () => model }; // CHANGE
    const attr = (cell, key) => cell?.[key] || '', users = () => ({ isAdmin: () => false, getAccessSummary: cell => ({ effectiveOpen: !denied.has(cell.id) }) }); // CHANGE
    const context = vm.createContext({ graph, model, attr, getAttr: attr, users, ID_ATTR: 'trellis_field_object_id' }); // CHANGE
    graph.__trellisPlantingLinking = { normalizeSelection: vm.runInContext(normalization + '; normalizeForLinkingAndPrimary', context) }; // CHANGE
    const api = vm.runInContext(locations + '; ({linkedPlantingGroups,gardenObjectKind})', context); // CHANGE
    if (scenario === 'unreadable-group') denied.add('group'); if (scenario === 'unreadable-child') denied.add('child'); if (scenario === 'no-field-id') delete group.trellis_field_object_id; // CHANGE
    const links = scenario === 'direct' ? 'group' : scenario === 'duplicates' ? 'group,child,group,absent' : scenario === 'missing' ? 'bed,absent' : 'child'; // CHANGE
    const result = Array.from(api.linkedPlantingGroups({ linkedTo: links })); // CHANGE
    assert.deepEqual(result, ['direct', 'child', 'duplicates'].includes(scenario) ? [group] : []); assert.equal(api.gardenObjectKind(group), 'planting-group'); assert.equal(api.gardenObjectKind(bed), 'bed'); // CHANGE
}); // CHANGE
