/** Object freshness, durable per-user checkpoints, review races, and independent window views. */ // NEW
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createObjectViews, incomingGroups } from '../src/main/trellis-object-views.js';
import { diffObjects, objects } from '../src/main/trellis-collaboration-protocol.js';

const key = id => JSON.stringify(['', id]);
const xml = (a = 'A1', b = 'B0') => '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><object id="a" label="' + a + '"><mxCell parent="1" vertex="1"/></object><object id="b" label="' + b + '"><mxCell parent="1" vertex="1"/></object></root></mxGraphModel>';
const state = content => ({ xml: content, records: [], accepted: [] });
async function fixture(t) {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-object-views-'));
    t.after(async () => { // CHANGE: constrain recursive cleanup to this fixture's owned temporary directory.
        assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir())); assert.ok(path.basename(profile).startsWith('trellis-object-views-'));
        await fs.rm(profile, { recursive: true, force: true });
    });
    let fail = false;
    const writeAtomic = async (filename, contents) => { if (fail) throw new Error('Simulated disk failure'); await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, contents); };
    const make = () => createObjectViews({ profile, canvas: { diagramId: 'diagram' }, writeAtomic });
    return { profile, make, views: make(), fail: value => { fail = value; }, actor: { callerId: 1, userId: 'alice' } };
}
async function refresh(views, actor, current, ids) {
    const review = await views.action(actor, { kind: 'review', groups: ids }, current);
    const prepared = await views.action(actor, { kind: 'prepare-refresh', groups: ids, token: review.token }, current);
    assert.notEqual(prepared.ok, false);
    return views.action(actor, { kind: 'ack-refresh', receipt: prepared.receipt }, current);
}

test('saving A2 keeps B0 displayed and remembered while B1 is accepted elsewhere', async t => {
    const { views, actor, make } = await fixture(t);
    await views.action(actor, { kind: 'open-view' }, state(xml()));
    const latest = state(xml('A1', 'B1'));
    assert.equal((await views.action(actor, { kind: 'changes' }, latest)).groups.length, 1);
    await views.saved(actor, xml(), xml('A2'));
    assert.equal(objects(views.get(actor).xml).get(key('b')).label, 'B0');
    const reopened = await make().action({ ...actor, callerId: 2 }, { kind: 'open-view' }, state(xml('A2', 'B1')));
    assert.equal(objects(reopened.xml).get(key('a')).label, 'A2');
    assert.equal(objects(reopened.xml).get(key('b')).label, 'B0');
    assert.deepEqual(reopened.groups[0].objects.map(object => object.key), [key('b')]);
});

test('remembered ordering does not accumulate deletion tombstones after completed saves', async t => { // NEW
    const {views,actor,profile} = await fixture(t), base = xml(); // NEW
    await views.open(actor,state(base)); // NEW
    for (let index = 0; index < 100; index++) { // NEW
        const added = base.replace('</root>','<object id="temporary-'+index+'"><mxCell parent="1" vertex="1"/></object></root>'); // NEW
        await views.saved(actor,base,added); await views.saved(actor,added,base); // NEW
    } // NEW
    const name = (await fs.readdir(path.join(profile,'object-views'))).find(name => name.endsWith('.json')); // NEW
    const saved = JSON.parse(await fs.readFile(path.join(profile,'object-views',name),'utf8')); // NEW
    assert.deepEqual(saved.versions,{}); assert.equal(saved.floor,saved.sequence); // NEW
}); // NEW

test('an outstanding older acknowledgement cannot resurrect a newer deletion', async t => { // NEW
    const {views,actor,make,profile} = await fixture(t), other = {...actor,callerId:2}, base = xml(); // NEW
    await views.open(actor,state(base)); await views.open(other,state(base)); // NEW
    const older = state(xml('A2')), review = await views.action(actor,{kind:'review'},older); // NEW
    const pending = await views.action(actor,{kind:'prepare-refresh',token:review.token},older); // NEW
    const deleted = base.replace('<object id="a" label="A1"><mxCell parent="1" vertex="1"/></object>',''); // NEW
    await refresh(views,other,state(deleted)); // NEW
    await views.action(actor,{kind:'ack-refresh',receipt:pending.receipt},older); // NEW
    const reopened = await make().open({...actor,callerId:3},state(deleted)); // NEW
    assert.equal(objects(reopened.xml).has(key('a')),false); // NEW
    await views.saved(other,deleted,deleted.replace('B0','B1')); // NEW
    const name = (await fs.readdir(path.join(profile,'object-views'))).find(name => name.endsWith('.json')); // NEW
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(profile,'object-views',name),'utf8')).versions,{}); // NEW
}); // NEW

test('an older acknowledgement still merges independent objects after a newer save', async t => { // NEW
    const {views,actor,make} = await fixture(t), other = {...actor,callerId:2}, base = xml(); // NEW
    await views.open(actor,state(base)); await views.open(other,state(base)); // NEW
    const older = state(xml('A1','B1')), review = await views.action(actor,{kind:'review'},older); // NEW
    const pending = await views.action(actor,{kind:'prepare-refresh',token:review.token},older); // NEW
    await views.saved(other,base,xml('A2')); // NEW
    await views.action(actor,{kind:'ack-refresh',receipt:pending.receipt},older); // NEW
    assert.equal((await make().open({...actor,callerId:3},state(xml('A2','B1')))).xml,xml('A2','B1')); // NEW
}); // NEW

test('refreshing in one window changes remembered objects without refreshing another window', async t => {
    const { views, actor, make } = await fixture(t), other = { ...actor, callerId: 2 };
    await views.action(actor, { kind: 'open-view' }, state(xml()));
    await views.action(other, { kind: 'open-view' }, state(xml()));
    const current = state(xml('A1', 'B1'));
    await refresh(views, actor, current);
    assert.equal(objects(views.get(other).xml).get(key('b')).label, 'B0');
    const reopened = await make().action({ ...actor, callerId: 3 }, { kind: 'open-view' }, current);
    assert.equal(objects(reopened.xml).get(key('b')).label, 'B1');
    assert.equal(reopened.groups.length, 0);
});

test('a changed review does not prepare a refresh until the new token is submitted', async t => {
    const { views, actor } = await fixture(t);
    await views.action(actor, { kind: 'open-view' }, state(xml()));
    const review = await views.action(actor, { kind: 'review' }, state(xml('A1', 'B1')));
    const result = await views.action(actor, { kind: 'prepare-refresh', token: review.token }, state(xml('A1', 'B2')));
    assert.equal(result.ok, false); assert.notEqual(result.review.token, review.token);
    assert.equal(objects(views.get(actor).xml).get(key('b')).label, 'B0');
});

test('Refresh All skips blocked groups but never splits a signed transaction', async t => {
    const { views, actor } = await fixture(t);
    await views.action(actor, { kind: 'open-view' }, state(xml()));
    const current = state(xml('A2', 'B1'));
    const review = await views.action(actor, { kind: 'review' }, current);
    const prepared = await views.action(actor, { kind: 'prepare-refresh', token: review.token, blockedTargets: [key('a')] }, current);
    assert.equal(prepared.skipped.length, 1); assert.deepEqual(prepared.changes.map(change => change.key), [key('b')]);
    const delta = diffObjects(xml(), current.xml);
    current.records = [{ id: 'together', kind: 'edit', userId: 'other', ...delta }]; current.accepted = ['together'];
    const combined = await views.action(actor, { kind: 'review' }, current);
    assert.equal(combined.groups.length, 1);
    const blocked = await views.action(actor, { kind: 'prepare-refresh', token: combined.token, blockedTargets: [key('a')] }, current);
    assert.equal(blocked.changes.length, 0);
});

test('a failed checkpoint retains pending changes and permits retry of the same receipt', async t => {
    const { views, actor, fail } = await fixture(t);
    await views.action(actor, { kind: 'open-view' }, state(xml()));
    const current = state(xml('A1', 'B1')), review = await views.action(actor, { kind: 'review' }, current);
    const prepared = await views.action(actor, { kind: 'prepare-refresh', token: review.token }, current);
    fail(true); await assert.rejects(views.action(actor, { kind: 'ack-refresh', receipt: prepared.receipt }, current), /disk failure/);
    assert.equal((await views.action(actor, { kind: 'changes' }, current)).groups.length, 1);
    fail(false); await views.action(actor, { kind: 'ack-refresh', receipt: prepared.receipt }, current);
    const duplicate = await views.action(actor, { kind: 'ack-refresh', receipt: prepared.receipt }, current); assert.equal(duplicate.groups.length, 0); // NEW: durable acknowledgements survive a lost reply.
    assert.equal((await views.action(actor, { kind: 'changes' }, current)).groups.length, 0);
});

test('receipt identity, interrupted refresh and corruption cannot silently advance a remembered object', async t => {
    const { views, actor, make, profile } = await fixture(t);
    await views.action(actor, { kind: 'open-view' }, state(xml()));
    const current = state(xml('A1', 'B1')), review = await views.action(actor, { kind: 'review' }, current);
    const prepared = await views.action(actor, { kind: 'prepare-refresh', token: review.token }, current);
    await assert.rejects(views.action({ ...actor, callerId: 2 }, { kind: 'ack-refresh', receipt: prepared.receipt }, current), /expired|changed/);
    const reopened = await make().action(actor, { kind: 'open-view' }, current);
    assert.equal(objects(reopened.xml).get(key('b')).label, 'B0');
    const directory = path.join(profile, 'object-views'), [filename] = await fs.readdir(directory);
    await fs.writeFile(path.join(directory, filename), 'corrupt');
    const fresh = make();
    await assert.rejects(fresh.action(actor, { kind: 'open-view' }, current), /Remembered view unavailable/);
    assert.equal((await fresh.action(actor, { kind: 'reset-view' }, current)).groups.length, 0);
});

test('net reversals clear badges and dependent parent deletion forms one safe group', () => {
    assert.deepEqual(incomingGroups(xml(), state(xml())), []);
    const before = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="parent" vertex="1" parent="1"/><mxCell id="child" vertex="1" parent="parent"/></root></mxGraphModel>';
    const after = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
    const delta = diffObjects(before, after), current = { xml: after, records: [{ id: 'delete', kind: 'edit', ...delta }], accepted: ['delete'] };
    const groups = incomingGroups(before, current);
    assert.equal(groups.length, 1); assert.equal(groups[0].keys.length, 2);
});

test('loss of previously initialized objects requires explicit recovery', async t => { // NEW
    const { views, actor, make, profile } = await fixture(t);
    await views.action(actor, { kind: 'open-view' }, state(xml()));
    const directory = path.join(profile, 'object-views'), filename = (await fs.readdir(directory)).find(name => name.endsWith('.json'));
    await fs.unlink(path.join(directory, filename));
    await assert.rejects(make().action(actor, { kind: 'open-view' }, state(xml('A1', 'B1'))), /objects are missing/);
});

test('page changes require an explicit structural review and blocked groups remain whole', async t => { // NEW
    const { views, actor } = await fixture(t), before = '<mxfile><diagram id="p1" name="One">' + xml() + '</diagram></mxfile>';
    const after = '<mxfile><diagram id="p1" name="Renamed">' + xml() + '</diagram><diagram id="p2" name="Two">' + xml() + '</diagram></mxfile>';
    await views.action(actor, { kind: 'open-view' }, state(before));
    const current = state(after), review = await views.action(actor, { kind: 'review' }, current);
    assert.equal(review.groups.length, 1); assert.equal(review.groups[0].structural, true);
    const blocked = await views.action(actor, { kind: 'prepare-refresh', token: review.token, blockedTargets: ['*'] }, current);
    assert.equal(blocked.changes.length, 0);
    const prepared = await views.action(actor, { kind: 'prepare-refresh', token: review.token }, current);
    assert.equal(prepared.structural, true); assert.equal(prepared.changes[0].key, '*');
    const acknowledged = await views.action(actor, { kind: 'ack-refresh', receipt: prepared.receipt }, current);
    assert.equal(objects(acknowledged.xml).has(JSON.stringify(['p2', 'a'])), true);
});
