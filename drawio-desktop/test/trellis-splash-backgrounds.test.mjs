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

test('packaged splash gallery includes the initial garden scene', async () => { // NEW
	assert.deepEqual(await listTrellisSplashBackgrounds(packagedBackgroundDirectory), // NEW
		['trellis-garden-sunrise.png']); // NEW
}); // NEW

test('splash background listing includes supported regular files only', async (t) => { // NEW
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-splash-')); // NEW
	t.after(() => fs.rm(directory, { recursive: true, force: true })); // NEW
	await fs.writeFile(path.join(directory, 'b.PNG'), 'image'); // NEW
	await fs.writeFile(path.join(directory, 'a.webp'), 'image'); // NEW
	await fs.writeFile(path.join(directory, 'notes.md'), 'ignored'); // NEW
	await fs.mkdir(path.join(directory, 'nested.jpg')); // NEW

	assert.deepEqual(await listTrellisSplashBackgrounds(directory), ['a.webp', 'b.PNG']); // NEW
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
	await fs.writeFile(path.join(directory, 'first.webp'), 'image'); // NEW
	let randomCalls = 0; // NEW
	const select = createTrellisSplashBackgroundSelector(directory, () => { // NEW
		randomCalls++; // NEW
		return 0; // NEW
	}); // NEW

	assert.equal(await select(), 'first.webp'); // NEW
	await fs.writeFile(path.join(directory, 'second.webp'), 'image'); // NEW
	assert.equal(await select(), 'first.webp'); // NEW
	assert.equal(randomCalls, 1); // NEW
}); // NEW
