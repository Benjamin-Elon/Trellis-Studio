import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	chooseTrellisSplashBackground,
	createTrellisSplashBackgroundSelector,
	listTrellisSplashBackgrounds
} from '../src/main/trellis-splash-backgrounds.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const packagedBackgroundDirectory = path.join(testDirectory,
	'../drawio/src/main/webapp/images/trellis-splash');

function makePngHeader(width, height) {
	const buffer = Buffer.alloc(33);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
	buffer.writeUInt32BE(13, 8);
	buffer.write('IHDR', 12, 'ascii');
	buffer.writeUInt32BE(width, 16);
	buffer.writeUInt32BE(height, 20);
	buffer[24] = 8;
	buffer[25] = 2;
	return buffer;
}

test('packaged splash gallery includes the garden scene and excludes small icons', async () => {
	const backgrounds = await listTrellisSplashBackgrounds(packagedBackgroundDirectory);
	assert.ok(backgrounds.includes('trellis-garden-sunrise.png'));
	assert.equal(backgrounds.includes('trellis-splash-icon.png'), false);
});

test('splash background listing includes valid large landscape regular files only', async (t) => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-splash-'));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	await fs.writeFile(path.join(directory, 'b.PNG'), makePngHeader(1400, 700));
	await fs.writeFile(path.join(directory, 'a.png'), makePngHeader(1200, 700));
	await fs.writeFile(path.join(directory, 'notes.md'), 'ignored');
	await fs.mkdir(path.join(directory, 'nested.jpg'));

	assert.deepEqual(await listTrellisSplashBackgrounds(directory), ['a.png', 'b.PNG']);
});

test('splash background listing rejects small, portrait, and corrupt supported files', async (t) => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-splash-invalid-'));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	await fs.writeFile(path.join(directory, 'large-landscape.png'), makePngHeader(1600, 900));
	await fs.writeFile(path.join(directory, 'small-landscape.png'), makePngHeader(900, 600));
	await fs.writeFile(path.join(directory, 'portrait.png'), makePngHeader(1200, 1600));
	await fs.writeFile(path.join(directory, 'corrupt.png'), 'not an image');

	assert.deepEqual(await listTrellisSplashBackgrounds(directory), ['large-landscape.png']);
});

test('splash background listing treats missing and empty directories as empty galleries', async (t) => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-splash-empty-'));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));

	assert.deepEqual(await listTrellisSplashBackgrounds(directory), []);
	assert.deepEqual(await listTrellisSplashBackgrounds(path.join(directory, 'missing')), []);
});

test('pure random selection covers boundaries and permits repeat selections', () => {
	const filenames = ['a.webp', 'b.webp', 'c.webp'];

	assert.equal(chooseTrellisSplashBackground(filenames, () => 0), 'a.webp');
	assert.equal(chooseTrellisSplashBackground(filenames, () => 0.999999), 'c.webp');
	assert.equal(chooseTrellisSplashBackground([], () => 0.5), null);
	assert.equal(chooseTrellisSplashBackground(filenames, () => 0.4), 'b.webp');
	assert.equal(chooseTrellisSplashBackground(filenames, () => 0.4), 'b.webp');
});

test('process-scoped selector reads and chooses only once', async (t) => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-splash-cache-'));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	await fs.writeFile(path.join(directory, 'first.png'), makePngHeader(1200, 700));
	let randomCalls = 0;
	const select = createTrellisSplashBackgroundSelector(directory, () => {
		randomCalls++;
		return 0;
	});

	assert.equal(await select(), 'first.png');
	await fs.writeFile(path.join(directory, 'second.png'), makePngHeader(1400, 800));
	assert.equal(await select(), 'first.png');
	assert.equal(randomCalls, 1);
});
