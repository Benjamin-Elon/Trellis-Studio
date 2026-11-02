/** Three-way conflict review preserves object/dependency boundaries and unseen objects. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import { reviewDraft, resolveDraft } from '../src/main/trellis-draft-conflicts.js'; // NEW
import { objects } from '../src/main/trellis-collaboration-protocol.js'; // NEW
const key = id => JSON.stringify(['page', id]); // NEW
const canvas = (a = 'A', b = 'B') => '<mxfile><diagram id="page"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><object id="a" label="' + a + '"><mxCell parent="1" vertex="1"/></object><object id="b" label="' + b + '"><mxCell parent="1" vertex="1"/></object></root></mxGraphModel></diagram></mxfile>'; // NEW
const label = (xml, id) => objects(xml).get(key(id))?.label; // NEW
/** A new planting and generated tiles must be valid together before either can be accepted. */ // NEW
test('new planting, generated circles and linked task form one non-conflicting creation', () => { // NEW
    const base = canvas(); // NEW
    const additions = '<object id="planting" label="Dill" tiler_group="1"><mxCell parent="a" vertex="1"/></object><object id="circle" label="DILL" plant_tiler="1" auto="1"><mxCell parent="planting" vertex="1"/></object><object id="task" label="Sow" kanban_card="1" linkedTo="planting"><mxCell parent="b" vertex="1"/></object>'; // NEW
    const mine = base.replace('</root>', additions + '</root>'), review = reviewDraft(base, mine, base); // NEW
    assert.equal(review.groups.length, 1); assert.equal(review.groups[0].conflict, false); // NEW
    assert.ok(['planting', 'circle', 'task'].every(id => review.groups[0].keys.includes(key(id)))); // NEW
    const result = resolveDraft(base, mine, base, { token: review.token, mode: 'non-conflicting' }); // NEW
    assert.equal(objects(result.xml).size, objects(mine).size); assert.deepEqual(result.remaining, []); // NEW
}); // NEW
test('structural review ignores attribute order and formatting when content is already accepted', () => { // NEW
    const base = canvas(), mine = base.replace('<mxGraphModel>', '<mxGraphModel pageWidth="900">'); // NEW
    const accepted = mine.replace('id="a" label="A"', 'label="A" id="a"'); // NEW
    const review = reviewDraft(base, mine, accepted); // NEW
    assert.equal(review.groups[0].structural, true); assert.equal(review.groups[0].alreadyApplied, true); assert.equal(review.groups[0].conflict, false); // NEW
}); // NEW
function resolve(base, mine, accepted, mode, extra = {}) { return resolveDraft(base, mine, accepted, { token: reviewDraft(base, mine, accepted).token, mode, ...extra }); } // NEW
test('partial application commits only independent groups and preserves the conflicting private version', () => { // NEW
    const result = resolve(canvas(), canvas('Mine', 'Independent'), canvas('Peer'), 'non-conflicting'); // NEW
    assert.equal(result.ok, true); assert.equal(label(result.xml, 'a'), 'Peer'); assert.equal(label(result.xml, 'b'), 'Independent'); // NEW
    assert.equal(label(result.baseXml, 'a'), 'A', 'unreviewed accepted content is not silently refreshed'); assert.equal(label(result.remainingXml, 'a'), 'Mine'); assert.equal(label(result.remainingXml, 'b'), 'Independent'); assert.deepEqual(result.remaining, [key('a')]); // NEW
}); // NEW
test('keep accepted version dismisses selected proposals while apply mine rebases the complete reviewed object', () => { // NEW
    const accepted = resolve(canvas(), canvas('Mine'), canvas('Peer'), 'accepted'); assert.equal(label(accepted.remainingXml, 'a'), 'Peer'); assert.deepEqual(accepted.remaining, []); // NEW
    const mine = resolve(canvas(), canvas('Mine'), canvas('Peer'), 'mine'); assert.equal(label(mine.xml, 'a'), 'Mine'); assert.equal(mine.remainingXml, mine.baseXml); // NEW
}); // NEW
test('resolve later and stale review tokens cannot submit or discard changes', () => { // NEW
    const base = canvas(), draft = canvas('Mine'), accepted = canvas('Peer'); // NEW
    const later = resolve(base, draft, accepted, 'later'); assert.equal(later.remainingXml, draft); assert.equal(later.xml, accepted); assert.deepEqual(later.applied, []); // NEW
    const stale = resolveDraft(base, draft, canvas('Newer peer'), { token: reviewDraft(base, draft, accepted).token, mode: 'mine' }); assert.equal(stale.ok, false); assert.equal(stale.staleReview, true); // NEW
}); // NEW
test('different fields in one object remain a conflict and partial application is unavailable', () => { // NEW
    const base = canvas(), mine = base.replace('label="A"', 'label="Mine"'), accepted = base.replace('label="A"', 'label="A" notes="Peer notes"'); // NEW
    const review = reviewDraft(base, mine, accepted); assert.equal(review.groups.length, 1); assert.equal(review.groups[0].conflict, true); assert.equal(review.canApplyNonConflicting, false); // NEW
    const result = resolve(base, mine, accepted, 'non-conflicting'); assert.equal(result.xml, accepted); assert.equal(result.remainingXml, mine); // NEW
}); // NEW
test('parent deletion and its descendants stay in one indivisible group', () => { // NEW
    const base = canvas().replace('</root>', '<object id="child" label="Child"><mxCell vertex="1" parent="a"/></object></root>'); // NEW
    const draft = base.replace(/<object id="a"[^]*?<\/object>/, '').replace(/<object id="child"[^]*?<\/object>/, ''); // NEW
    const review = reviewDraft(base, draft, base.replace('label="A"', 'label="Peer"')); assert.equal(review.groups.length, 1); assert.equal(review.groups[0].conflict, true); assert.ok(review.groups[0].keys.includes(key('child'))); // NEW
}); // NEW
test('already accepted local content is acknowledged without producing another conflicting proposal', () => { // NEW
    const review = reviewDraft(canvas(), canvas('Mine'), canvas('Mine')); assert.equal(review.groups[0].alreadyApplied, true); assert.equal(review.groups[0].conflict, false); // NEW
    const result = resolve(canvas(), canvas('Mine'), canvas('Mine'), 'non-conflicting'); assert.equal(result.baseXml, result.remainingXml); assert.deepEqual(result.remaining, []); // NEW
}); // NEW
test('partial selection never silently drops another local group and unknown selections are rejected', () => { // NEW
    const base = canvas(), mine = canvas('Mine A', 'Mine B'), accepted = canvas('Peer A', 'Peer B'), review = reviewDraft(base, mine, accepted); // NEW
    const group = review.groups.find(group => group.keys.includes(key('a'))), result = resolve(base, mine, accepted, 'accepted', { groups: [group.id] }); // NEW
    assert.equal(label(result.remainingXml, 'a'), 'Peer A'); assert.equal(label(result.remainingXml, 'b'), 'Mine B'); assert.deepEqual(result.remaining, [key('b')]); // NEW
    assert.throws(() => resolve(base, mine, accepted, 'mine', { groups: ['unknown'] }), /Unknown/); // NEW
}); // NEW
