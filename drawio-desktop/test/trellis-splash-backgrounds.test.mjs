import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import os from 'node:os'; // NEW
import path from 'node:path'; // NEW
import test from 'node:test'; // NEW
import { fileURLToPath } from 'node:url'; // NEW
import { // NEW
	chooseTrellisSplashBackground, // NEW
	createTrellisSplashBackgroundSelector, // NEW
	listTrellisSplashBackgrounds // NEW
} from '../src/main/trellis-splash-backgrounds.js'; // NEW

const testDirectory = path.dirname(fileURLToPath(import.meta.url)); // NEW
const packagedBackgroundDirectory = path.join(testDirectory, // NEW
	'../drawio/src/main/webapp/images/trellis-splash'); // NEW

function makePngHeader(width, height) { // NEW
	const buffer = Buffer.alloc(33); // NEW
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0); // NEW
	buffer.writeUInt32BE(13, 8); // NEW
	buffer.write('IHDR', 12, 'ascii'); // NEW
	buffer.writeUInt32BE(width, 16); // NEW
	buffer.writeUInt32BE(height, 20); // NEW
	buffer[24] = 8; // NEW
	buffer[25] = 2; // NEW
	return buffer; // NEW
} // NEW

test('packaged splash gallery includes the garden scene and excludes small icons', async () => { // CHANGE
	const backgrounds = await listTrellisSplashBackgrounds(packagedBackgroundDirectory); // NEW
	assert.ok(backgrounds.includes('trellis-garden-sunrise.png')); // CHANGE
	assert.equal(backgrounds.includes('trellis-splash-icon.png'), false); // NEW
}); // NEW

test('splash background listing includes valid large landscape regular files only', async (t) => { // CHANGE
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-splash-')); // NEW
	t.after(() => fs.rm(directory, { recursive: true, force: true })); // NEW
	await fs.writeFile(path.join(directory, 'b.PNG'), makePngHeader(1400, 700)); // CHANGE
	await fs.writeFile(path.join(directory, 'a.png'), makePngHeader(1200, 700)); // CHANGE
	await fs.writeFile(path.join(directory, 'notes.md'), 'ignored'); // NEW
	await fs.mkdir(path.join(directory, 'nested.jpg')); // NEW

	assert.deepEqual(await listTrellisSplashBackgrounds(directory), ['a.png', 'b.PNG']); // CHANGE
}); // NEW

test('splash background listing rejects small, portrait, and corrupt supported files', async (t) => { // NEW
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-splash-invalid-')); // NEW
	t.after(() => fs.rm(directory, { recursive: true, force: true })); // NEW
	await fs.writeFile(path.join(directory, 'large-landscape.png'), makePngHeader(1600, 900)); // NEW
	await fs.writeFile(path.join(directory, 'small-landscape.png'), makePngHeader(900, 600)); // NEW
	await fs.writeFile(path.join(directory, 'portrait.png'), makePngHeader(1200, 1600)); // NEW
	await fs.writeFile(path.join(directory, 'corrupt.png'), 'not an image'); // NEW

	assert.deepEqual(await listTrellisSplashBackgrounds(directory), ['large-landscape.png']); // NEW
}); // NEW

test('splash background listing treats missing and empty directories as empty galleries', async (t) => { // NEW
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-splash-empty-')); // NEW
	t.after(() => fs.rm(directory, { recursive: true, force: true })); // NEW

	assert.deepEqual(await listTrellisSplashBackgrounds(directory), []); // NEW
	assert.deepEqual(await listTrellisSplashBackgrounds(path.join(directory, 'missing')), []); // NEW
}); // NEW

test('pure random selection covers boundaries and permits repeat selections', () => { // NEW
	const filenames = ['a.webp', 'b.webp', 'c.webp']; // NEW

	assert.equal(chooseTrellisSplashBackground(filenames, () => 0), 'a.webp'); // NEW
	assert.equal(chooseTrellisSplashBackground(filenames, () => 0.999999), 'c.webp'); // NEW
	assert.equal(chooseTrellisSplashBackground([], () => 0.5), null); // NEW
	assert.equal(chooseTrellisSplashBackground(filenames, () => 0.4), 'b.webp'); // NEW
	assert.equal(chooseTrellisSplashBackground(filenames, () => 0.4), 'b.webp'); // NEW
}); // NEW

test('process-scoped selector reads and chooses only once', async (t) => { // NEW
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-splash-cache-')); // NEW
	t.after(() => fs.rm(directory, { recursive: true, force: true })); // NEW
	await fs.writeFile(path.join(directory, 'first.png'), makePngHeader(1200, 700)); // CHANGE
	let randomCalls = 0; // NEW
	const select = createTrellisSplashBackgroundSelector(directory, () => { // NEW
		randomCalls++; // NEW
		return 0; // NEW
	}); // NEW

	assert.equal(await select(), 'first.png'); // CHANGE
	await fs.writeFile(path.join(directory, 'second.png'), makePngHeader(1400, 800)); // CHANGE
	assert.equal(await select(), 'first.png'); // CHANGE
	assert.equal(randomCalls, 1); // NEW
}); // NEW
