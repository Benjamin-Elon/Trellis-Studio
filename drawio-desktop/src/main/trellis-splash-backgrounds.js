import { promises as fs } from 'fs'; // NEW

const SUPPORTED_SPLASH_BACKGROUND_EXTENSIONS = new Set(['.webp', '.jpg', '.jpeg', '.png']); // NEW

/**
 * Returns supported regular image files in a packaged Trellis splash directory.
 * Missing or unreadable directories intentionally behave like an empty gallery.
 */
export async function listTrellisSplashBackgrounds(directoryPath) { // NEW
	try { // NEW
		const entries = await fs.readdir(directoryPath, { withFileTypes: true }); // NEW

		return entries // NEW
			.filter((entry) => entry.isFile() && SUPPORTED_SPLASH_BACKGROUND_EXTENSIONS.has( // NEW
				entry.name.substring(entry.name.lastIndexOf('.')).toLowerCase())) // NEW
			.map((entry) => entry.name) // NEW
			.sort((left, right) => left.localeCompare(right)); // NEW
	} catch (error) { // NEW
		return []; // NEW
	} // NEW
} // NEW

/**
 * Selects one filename uniformly. Supplying the random source keeps boundary
 * behavior deterministic in tests without changing production randomness.
 */
export function chooseTrellisSplashBackground(filenames, random = Math.random) { // NEW
	if (!Array.isArray(filenames) || filenames.length === 0) return null; // NEW

	const sample = Math.max(0, Math.min(0.9999999999999999, Number(random()) || 0)); // NEW
	return filenames[Math.floor(sample * filenames.length)]; // NEW
} // NEW

/**
 * Creates a process-scoped selector. Its first result, including an empty
 * gallery result, remains stable for the lifetime of the Electron process.
 */
export function createTrellisSplashBackgroundSelector(directoryPath, random = Math.random) { // NEW
	let selectionPromise = null; // NEW

	return function getSelectedTrellisSplashBackground() { // NEW
		if (selectionPromise == null) { // NEW
			selectionPromise = listTrellisSplashBackgrounds(directoryPath).then((filenames) => // NEW
				chooseTrellisSplashBackground(filenames, random)); // NEW
		} // NEW

		return selectionPromise; // NEW
	}; // NEW
} // NEW
