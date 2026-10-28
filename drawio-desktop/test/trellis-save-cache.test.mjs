/** Exact inputs, bounded lifetime and caller-owned XML indexes. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import { createSaveCache, saveCache } from '../src/main/trellis-save-cache.js'; // NEW
import { objects, diffObjects } from '../src/main/trellis-collaboration-protocol.js'; // NEW

test('LRU reuse respects its budget, bypasses oversized values, and can be cleared', () => { // NEW
    const cache = createSaveCache(300); cache.set('a', 'A', 10); cache.set('b', 'B', 10); // NEW
    assert.equal(cache.get('a'), 'A'); cache.set('c', 'C', 10); assert.equal(cache.get('b'), undefined); // NEW
    assert.equal(cache.get('a'), 'A'); cache.set('oversized', 'large', 1000); assert.equal(cache.get('oversized'), undefined); // NEW
    assert.ok(cache.stats().bytes <= 300); assert.equal(cache.stats().evictions, 1); // NEW
    cache.clear(); assert.equal(cache.stats().bytes, 0); assert.equal(cache.get('a'), undefined); // NEW
}); // NEW

test('reused object indexes and DOM nodes remain independent of caller mutations', () => { // NEW
    saveCache.clear(); // NEW
    const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><object id="a" label="Original"><mxCell parent="1" vertex="1"/></object></root></mxGraphModel>'; // NEW
    const first = objects(xml), key = JSON.stringify(['', 'a']); // NEW
    first.get(key).node.setAttribute('label', 'Corrupted'); first.get(key).model.setAttribute('parent', 'wrong'); first.delete('["","0"]'); // NEW
    const second = objects(xml); assert.equal(second.size, 3); assert.equal(second.get(key).node.getAttribute('label'), 'Original'); assert.equal(second.get(key).model.getAttribute('parent'), '1'); // NEW
    assert.equal(second.get(key).node.parentNode.nodeName, 'root'); assert.notEqual(first.get(key).node.ownerDocument, second.get(key).node.ownerDocument); // NEW
    const changed = xml.replace('Original', 'Changed'); const warm = diffObjects(xml, changed); saveCache.clear(); // NEW
    assert.deepEqual(warm, diffObjects(xml, changed)); assert.equal(warm.changes.length, 1); // NEW
}); // NEW

test('cached multi-page indexes retain separate page documents and parent trees', () => { // NEW
    const model = '<mxGraphModel grid="1"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'; // NEW
    const xml = '<mxfile><diagram id="A">' + model + '</diagram><diagram id="B">' + model + '</diagram></mxfile>'; // NEW
    objects(xml); const index = objects(xml), a = index.get('["A","1"]').node, b = index.get('["B","1"]').node; // NEW
    assert.notEqual(a.ownerDocument, b.ownerDocument); assert.equal(a.parentNode.nodeName, 'root'); assert.equal(a.ownerDocument.documentElement.getAttribute('grid'), '1'); // NEW
    a.ownerDocument.documentElement.setAttribute('grid', 'corrupted'); assert.equal(objects(xml).get('["A","1"]').node.ownerDocument.documentElement.getAttribute('grid'), '1'); // NEW
}); // NEW

test('concurrent cache reservations cannot exceed the shared worker budget', () => { // NEW
    const counter = new Int32Array(new SharedArrayBuffer(4)), firstOwner = new Int32Array(new SharedArrayBuffer(4)), secondOwner = new Int32Array(new SharedArrayBuffer(4)); // NEW
    const first = createSaveCache(300, counter, firstOwner), second = createSaveCache(300, counter, secondOwner); // NEW
    first.set('a', 'A', 50); second.set('b', 'B', 50); assert.equal(second.get('b'), undefined); // NEW
    assert.ok(Atomics.load(counter, 0) <= 300); assert.equal(Atomics.load(firstOwner, 0), first.stats().bytes); // NEW
    first.clear(); second.set('b', 'B', 50); assert.equal(second.get('b'), 'B'); second.clear(); // NEW
    assert.equal(Atomics.load(counter, 0), 0); assert.equal(Atomics.load(firstOwner, 0), 0); assert.equal(Atomics.load(secondOwner, 0), 0); // NEW
}); // NEW
