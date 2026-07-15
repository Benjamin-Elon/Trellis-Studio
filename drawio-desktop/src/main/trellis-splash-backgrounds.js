import { promises as fs } from 'fs'; // NEW
import path from 'path'; // NEW

const SUPPORTED_SPLASH_BACKGROUND_EXTENSIONS = new Set(['.webp', '.jpg', '.jpeg', '.png']); // NEW
const MIN_SPLASH_BACKGROUND_WIDTH = 1000; // NEW
const MIN_SPLASH_BACKGROUND_HEIGHT = 500; // NEW
const MIN_SPLASH_BACKGROUND_ASPECT_RATIO = 1.4; // NEW

function readPngSize(buffer) { // NEW
	if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null; // NEW
	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: 'png' }; // NEW
} // NEW

function readJpegSize(buffer) { // NEW
	if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null; // NEW
	let offset = 2; // NEW
	while (offset + 9 < buffer.length) { // NEW
		if (buffer[offset] !== 0xff) return null; // NEW
		const marker = buffer[offset + 1]; // NEW
		offset += 2; // NEW
		if (marker === 0xd9 || marker === 0xda) return null; // NEW
		if (offset + 2 > buffer.length) return null; // NEW
		const segmentLength = buffer.readUInt16BE(offset); // NEW
		if (segmentLength < 2 || offset + segmentLength > buffer.length) return null; // NEW
		if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || // NEW
			(marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) { // NEW
			return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3), format: 'jpeg' }; // NEW
		} // NEW
		offset += segmentLength; // NEW
	} // NEW
	return null; // NEW
} // NEW

function readWebpSize(buffer) { // NEW
	if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null; // NEW
	const chunk = buffer.toString('ascii', 12, 16); // NEW
	if (chunk === 'VP8X' && buffer.length >= 30) { // NEW
		return { // NEW
			width: 1 + buffer.readUIntLE(24, 3), // NEW
			height: 1 + buffer.readUIntLE(27, 3), // NEW
			format: 'webp' // NEW
		}; // NEW
	} // NEW
	if (chunk === 'VP8 ' && buffer.length >= 30) { // NEW
		return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff, format: 'webp' }; // NEW
	} // NEW
	if (chunk === 'VP8L' && buffer.length >= 25) { // NEW
		const bits = buffer.readUInt32LE(21); // NEW
		return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: 'webp' }; // NEW
	} // NEW
	return null; // NEW
} // NEW

function readImageSize(buffer) { // NEW
	return readPngSize(buffer) || readJpegSize(buffer) || readWebpSize(buffer); // NEW
} // NEW

function getSplashBackgroundRejectionReason(size) { // NEW
	if (size == null) return 'unreadable-image-metadata'; // NEW
	if (size.width < MIN_SPLASH_BACKGROUND_WIDTH) return 'width-below-minimum'; // NEW
	if (size.height < MIN_SPLASH_BACKGROUND_HEIGHT) return 'height-below-minimum'; // NEW
	if (size.width / size.height < MIN_SPLASH_BACKGROUND_ASPECT_RATIO) return 'aspect-ratio-below-minimum'; // NEW
	return null; // NEW
} // NEW

async function validateSplashBackgroundCandidate(directoryPath, filename) { // NEW
	const filePath = path.join(directoryPath, filename); // NEW
	try { // NEW
		const size = readImageSize(await fs.readFile(filePath)); // NEW
		const rejectionReason = getSplashBackgroundRejectionReason(size); // NEW
		if (rejectionReason != null) { // NEW
			return null; // NEW
		} // NEW
		return filename; // NEW
	} catch (error) { // NEW
		return null; // NEW
	} // NEW
} // NEW

/**
 * Returns supported regular image files in a packaged Trellis splash directory.
 * Missing or unreadable directories intentionally behave like an empty gallery.
 */
export async function listTrellisSplashBackgrounds(directoryPath) { // NEW
	try { // NEW
		const entries = await fs.readdir(directoryPath, { withFileTypes: true }); // NEW
		const supportedFilenames = entries // NEW
			.filter((entry) => entry.isFile() && SUPPORTED_SPLASH_BACKGROUND_EXTENSIONS.has( // NEW
				entry.name.substring(entry.name.lastIndexOf('.')).toLowerCase())) // NEW
			.map((entry) => entry.name) // NEW
			.sort((left, right) => left.localeCompare(right)); // NEW
		const filenames = (await Promise.all(supportedFilenames.map((filename) => // NEW
			validateSplashBackgroundCandidate(directoryPath, filename)))) // NEW
			.filter((filename) => filename != null); // NEW

		return filenames; // CHANGE
	} catch (error) { // NEW
		return []; // NEW
	} // NEW
} // NEW

/**
 * Selects one filename uniformly. Supplying the random source keeps boundary
 * behavior deterministic in tests without changing production randomness.
 */
export function chooseTrellisSplashBackground(filenames, random = Math.random) { // NEW
	if (!Array.isArray(filenames) || filenames.length === 0) { // CHANGE
		return null; // NEW
	} // NEW

	const sample = Math.max(0, Math.min(0.9999999999999999, Number(random()) || 0)); // NEW
	const selected = filenames[Math.floor(sample * filenames.length)]; // NEW
	return selected; // CHANGE
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

		return selectionPromise; // CHANGE
	}; // NEW
} // NEW
