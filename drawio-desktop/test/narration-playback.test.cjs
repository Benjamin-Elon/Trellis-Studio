/** Native-event races and fallback are controlled without depending on installed system voices. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const { JSDOM } = require('jsdom'); // NEW
function fixture(t) { // NEW
    const dom = new JSDOM('<!doctype html><body><section></section></body>', { url: 'https://trellis.test/', runScripts: 'outside-only' }); t.after(() => dom.window.close()); // NEW
    const w = dom.window, timers = new Map(), audio = [], spoken = [], ended = [], errors = []; let id = 0, cancelled = 0; // NEW
    w.setTimeout = fn => { timers.set(++id, fn); return id; }; w.clearTimeout = id => timers.delete(id); // NEW
    w.Audio = class { // NEW
        constructor(src) { this.src = src; this.currentTime = 0; this.paused = 0; audio.push(this); } // NEW
        play() { return Promise.resolve(); } // NEW
        pause() { this.paused++; } // NEW
        removeAttribute() {} load() {} // NEW
    }; // NEW
    w.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } }; // NEW
    w.speechSynthesis = { speak: speech => spoken.push(speech), cancel: () => cancelled++, getVoices: () => [{ lang: 'en-US', localService: true }] }; // NEW
    w.TrellisNarrationRecordings = { clips: [{ text: 'Current instructions.', file: 'clip-0001.mp3' }] }; // NEW
    w.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-narration.js'), 'utf8')); // NEW
    const owner = w.document.querySelector('section'); // NEW
    const play = (text = 'Current instructions.', own = owner) => w.TrellisNarration.play({ owner: own, text, onEnd: () => ended.push(text), onError: error => errors.push(error) }); // NEW
    return { w, owner, play, audio, spoken, ended, errors, timers, cancelled: () => cancelled }; // NEW
} // NEW
test('exact transcript plays a local clip, completes once, and releases the media resource', t => { // NEW
    const f = fixture(t); f.play(); const audio = f.audio[0], end = audio.onended; // NEW
    assert.match(audio.src, /\/audio\/narration\/clip-0001\.mp3$/); assert.equal(f.spoken.length, 0); // NEW
    end(); end(); assert.deepEqual(f.ended, ['Current instructions.']); assert.equal(audio.paused, 1); assert.equal(f.timers.size, 0); // NEW
}); // NEW
test('missing text and media failure fall back once; only system completion completes the reading', t => { // NEW
    const f = fixture(t); f.play(); const failed = f.audio[0].onerror, oldEnd = f.audio[0].onended; // NEW
    failed(); failed(); oldEnd(); // NEW
    assert.equal(f.spoken.length, 1); assert.equal(f.spoken[0].text, 'Current instructions.'); assert.equal(f.ended.length, 0); // NEW
    f.spoken[0].onend(); assert.equal(f.ended.length, 1); // NEW
    f.play('Changed instructions.'); assert.equal(f.audio.length, 1); assert.equal(f.spoken.at(-1).text, 'Changed instructions.'); // NEW
    f.spoken.at(-1).onerror({ error: 'synthesis-failed' }); assert.equal(f.errors.length, 1); assert.equal(f.ended.length, 1); // NEW
}); // NEW
test('navigation/replay invalidates captured media and system callbacks and only the owner can stop', t => { // NEW
    const f = fixture(t); f.play(); const oldEnd = f.audio[0].onended, oldError = f.audio[0].onerror; // NEW
    f.play(); oldEnd(); oldError(); assert.equal(f.ended.length, 0); assert.equal(f.spoken.length, 0); // NEW
    f.w.TrellisNarration.stop({}); assert.equal(f.audio[1].paused, 0); // NEW
    f.audio[1].onerror(); const speechEnd = f.spoken[0].onend, speechError = f.spoken[0].onerror; // NEW
    f.w.TrellisNarration.stop(f.owner); speechEnd(); speechError({ error: 'interrupted' }); // NEW
    assert.equal(f.ended.length, 0); assert.equal(f.errors.length, 0); assert.equal(f.cancelled(), 1); // NEW
}); // NEW
test('stalled media falls back and stalled system speech fails without retry loops', t => { // NEW
    const f = fixture(t); f.play(); // NEW
    const startup = [...f.timers.values()][0]; f.timers.clear(); startup(); assert.equal(f.spoken.length, 1); // NEW
    const timeout = [...f.timers.values()][0]; f.timers.clear(); timeout(); // NEW
    assert.equal(f.errors.length, 1); assert.equal(f.spoken.length, 1); assert.equal(f.timers.size, 0); // NEW
}); // NEW
test('media progress renews the stall guard and removing its owner cancels before late completion', async t => { // NEW
    const f = fixture(t); f.play(); const audio = f.audio[0], end = audio.onended, before = [...f.timers.keys()][0]; // NEW
    audio.currentTime = 1; audio.ontimeupdate(); assert.notEqual([...f.timers.keys()][0], before); // NEW
    f.owner.remove(); end(); await Promise.resolve(); // NEW
    assert.equal(f.ended.length, 0); assert.equal(f.errors.length, 0); assert.equal(audio.paused, 1); assert.equal(f.timers.size, 0); // NEW
}); // NEW
test('rejected play promises cannot revive a replaced reading', async t => { // NEW
    const f = fixture(t); let reject; // NEW
    f.w.Audio.prototype.play = () => new Promise((resolve, fail) => { reject = fail; }); // NEW
    f.play(); const oldReject = reject; f.play(); oldReject(new Error('NotAllowedError')); await Promise.resolve(); // NEW
    assert.equal(f.spoken.length, 0); assert.equal(f.errors.length, 0); // NEW
    reject(new Error('NotAllowedError')); await Promise.resolve(); assert.equal(f.spoken.length, 1); // NEW
}); // NEW
test('fallback preserves the system default when no local English voice is listed', t => { // NEW
    const f = fixture(t); f.w.speechSynthesis.getVoices = () => [{ lang: 'en-US', localService: false }]; // NEW
    f.play('Unrecorded instructions.'); // NEW
    assert.equal(f.spoken.length, 1); assert.equal(f.spoken[0].voice, undefined); assert.equal(f.errors.length, 0); // NEW
    f.spoken[0].onend(); assert.deepEqual(f.ended, ['Unrecorded instructions.']); // NEW
}); // NEW
