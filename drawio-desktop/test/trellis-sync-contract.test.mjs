/** Independent workflow expectations prevent shared producer/consumer mistakes from agreeing silently. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import { SYNC_PROTOCOL, encodeBlock } from '../src/main/trellis-share-protocol.js'; // NEW
import { parseGardenInvitation } from '../src/main/trellis-garden-join-service.js'; // NEW
import { createGardenCommunityService } from '../src/main/trellis-garden-community-service.js'; // NEW
import { canClaimCurrentActivity } from '../src/main/trellis-syncthing-service.js'; // NEW
import { inspectDiagram } from '../src/main/trellis-share-protocol.js'; // NEW
import { permissionSnapshot } from '../src/main/trellis-permission-policy.js'; // NEW

test('new invitations use garden 4 and the v4 namespace; old invitations remain rejected', () => { // NEW
    assert.equal(SYNC_PROTOCOL.garden, 4); assert.equal(SYNC_PROTOCOL.community, 2); // NEW
    const invite = { schema: 2, protocolVersion: 4, deviceId: Array(8).fill('AAAAAAA').join('-'), shareId: 'garden', diagramId: 'diagram', folderId: 'trellis-v4-garden', inviteId: 'invite', pendingUserId: 'member', email: 'member@example.org', code: 'code', expiresAt: Date.now() + 60000, coordinatorPublicKey: 'key', filename: 'Garden.drawio' }; // NEW
    assert.equal(parseGardenInvitation(encodeBlock('INVITE', invite)).folderId, 'trellis-v4-garden'); // NEW
    assert.equal(parseGardenInvitation(encodeBlock('INVITE', { ...invite, protocolVersion: 5, folderId: 'trellis-v5-garden' })).protocolVersion, 5); // CHANGE: new projects use their own namespace without reclassifying legacy projects.
    assert.throws(() => parseGardenInvitation(encodeBlock('INVITE', { ...invite, protocolVersion: 3, folderId: 'trellis-v3-garden' })), /Only version 4/); // NEW
    assert.throws(() => parseGardenInvitation(encodeBlock('INVITE', { ...invite, folderId: 'trellis-v3-garden' })), /invalid project details/); // NEW
}); // NEW

test('unqualified community capability never starts transports or reads retained journals', async () => { // NEW
    const unexpected = () => { throw new Error('Retained community processing was invoked'); }; // NEW
    const service = createGardenCommunityService({ identities: { transport: unexpected, requireSession: unexpected }, library: { catalog: unexpected, verifiedRecords: unexpected } }); // NEW
    await service.refresh('identity'); // NEW
    assert.equal((await service.list()).inactive, true); // NEW
    await assert.rejects(service.create({}), { code: 'SYNC_CAPABILITY_UNAVAILABLE' }); // NEW
    assert.throws(() => SYNC_PROTOCOL.requireCapability('peerProposals'), { code: 'SYNC_CAPABILITY_UNAVAILABLE' }); // NEW
}); // NEW

test('cached activity authority expires with an invitation even when accepted XML is unchanged', () => { // NEW
    const store = { usersEnabled: true, users: [{ id: 'admin', admin: true }], invites: [{ pendingUserId: 'pending', status: 'pending', expiresAt: 2000 }] }; // NEW
    const xml = '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_json="' + JSON.stringify(store).replaceAll('"', '&quot;') + '"><mxCell parent="0"/></object><object id="garden" garden_module="1"><mxCell vertex="1" parent="1"/></object></root></mxGraphModel>'; // NEW
    const policy = { snapshot: permissionSnapshot(inspectDiagram(xml)), ranks: new Map(), storedUsers: new Set(['admin']), bootstrapKeys: new Set() }, key = '["","garden"]'; // NEW
    assert.equal(canClaimCurrentActivity(policy, 'pending', key, 1000), true); // NEW
    assert.equal(canClaimCurrentActivity(policy, 'pending', key, 2001), false); // NEW
    assert.equal(canClaimCurrentActivity(policy, 'admin', key, 2001), true); // NEW
    assert.equal(policy.ranks.size, 1, 'Only stable roster authority is cached.'); // NEW
}); // NEW
