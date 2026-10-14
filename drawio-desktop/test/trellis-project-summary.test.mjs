import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import { projectSummary, cityRecord, averageDistance } from '../src/main/trellis-project-summary.js'; // NEW
import { countProjectSeeds } from '../src/main/trellis-syncthing-service.js'; // NEW
const cities = [{ cityId: 'a', name: 'Origin', latitude: 0, longitude: 0 }, { cityId: 'b', name: 'East', latitude: 0, longitude: 1 }]; // NEW
function diagram(users, modules = [], pending = []) { // NEW
    const store = JSON.stringify({ usersEnabled: true, users, invites: pending }).replace(/"/g, '&quot;'); // NEW
    return '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_json="' + store + '"><mxCell parent="0"/></object>' + modules.map((city, index) => '<object id="g' + index + '" garden_module="1" city_id="' + city + '"><mxCell parent="1" vertex="1"/></object>').join('') + '</root></mxGraphModel>'; // NEW
} // NEW
test('classification requires configured sharing and distinct enabled joined users with access', () => { // NEW
    const users = [{ id: 'a', admin: true }, { id: 'b', admin: true }, { id: 'c', admin: true, disabled: true }, { id: 'd', admin: false }]; // NEW
    const xml = diagram(users, [], [{ status: 'pending', expiresAt: Date.now() + 10000, pendingUserId: 'pending' }]); // NEW
    assert.equal(projectSummary(xml, cities, true).userCount, 2); // NEW
    assert.equal(projectSummary(xml, cities, true).classification, 'shared'); // NEW
    assert.equal(projectSummary(xml, cities, false).classification, 'private'); // NEW
    assert.equal(projectSummary(diagram([users[0], { ...users[1], disabled: true }]), cities, true).classification, 'private'); // NEW
    assert.equal(projectSummary(xml, cities, true).pendingInvitationCount, 1); // NEW
}); // NEW
test('each located module contributes once, with missing and ambiguous cities excluded', () => { // NEW
    const summary = projectSummary(diagram([{ id: 'a', admin: true }], ['a', 'a', 'b', 'missing']), cities, true); // NEW
    assert.equal(summary.gardenModuleCount, 4); assert.equal(summary.moduleCities.length, 3); // NEW
    assert.ok(Math.abs(averageDistance(cities[0], summary.moduleCities) - 111.195 / 3) < 0.01); // NEW
    assert.equal(projectSummary(diagram([], ['b']), [...cities, cities[1]], false).moduleCities.length, 0); // NEW
    assert.equal(averageDistance(null, cities), null); assert.equal(averageDistance(cities[0], []), null); // NEW
    assert.equal(cityRecord({ latitude: '', longitude: 0 }), null); assert.equal(cityRecord({ latitude: 0, longitude: 181 }), null); // NEW
}); // NEW
test('great-circle distance handles the date line, poles, and valid zero coordinates', () => { // NEW
    assert.ok(averageDistance({ latitude: 0, longitude: 179 }, [{ latitude: 0, longitude: -179 }]) < 223); // NEW
    assert.ok(averageDistance({ latitude: 90, longitude: 0 }, [{ latitude: 90, longitude: 120 }]) < 0.001); // NEW
    assert.equal(averageDistance(cities[0], [cities[0]]), 0); // NEW
}); // NEW
test('seeds count serving devices independently, excluding offline, paused, partial, and unshared peers', async () => { // NEW
    const queried = [], complete = { completion: 100, needItems: 0, globalItems: 10, remoteState: 'valid' }; // NEW
    const members = ['local', 'peer1', 'peer2', 'partial', 'paused', 'notSharing', 'offline', 'peer1'].map(deviceId => ({ deviceId, userId: 'same-user' })); // NEW
    const result = await countProjectSeeds({ members, deviceId: 'local', hasLocalCopy: true, connections: Object.fromEntries(members.filter(member => member.deviceId !== 'offline').map(member => [member.deviceId, { connected: true }])), completion: async id => { queried.push(id); return id === 'partial' ? { ...complete, completion: 80, needItems: 2 } : id === 'paused' || id === 'notSharing' ? { remoteState: id } : complete; } }); // NEW
    assert.equal(result, 3); assert.equal(queried.includes('offline'), false); assert.equal(queried.filter(id => id === 'peer1').length, 1); // NEW
}); // NEW
test('missing completion telemetry remains Unknown while known absence yields zero seeds', async () => { // NEW
    const options = { members: [{ deviceId: 'peer' }], deviceId: 'local', hasLocalCopy: false, connections: { peer: { connected: true } }, completion: async () => ({}) }; // NEW
    assert.equal(await countProjectSeeds(options), null); // NEW
    assert.equal(await countProjectSeeds({ ...options, connections: {} }), 0); // NEW
    assert.equal(await countProjectSeeds({ ...options, completion: async () => { throw new Error('Transport unavailable'); } }), null); // NEW
}); // NEW
