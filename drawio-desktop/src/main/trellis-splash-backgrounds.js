import { promises as fs } from 'fs';
import path from 'path';

const SUPPORTED_SPLASH_BACKGROUND_EXTENSIONS = new Set(['.webp', '.jpg', '.jpeg', '.png']);
const MIN_SPLASH_BACKGROUND_WIDTH = 1000;
const MIN_SPLASH_BACKGROUND_HEIGHT = 500;
const MIN_SPLASH_BACKGROUND_ASPECT_RATIO = 1.4;

function readPngSize(buffer) {
	if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: 'png' };
}

function readJpegSize(buffer) {
	if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
	let offset = 2;
	while (offset + 9 < buffer.length) {
		if (buffer[offset] !== 0xff) return null;
		const marker = buffer[offset + 1];
		offset += 2;
		if (marker === 0xd9 || marker === 0xda) return null;
		if (offset + 2 > buffer.length) return null;
		const segmentLength = buffer.readUInt16BE(offset);
		if (segmentLength < 2 || offset + segmentLength > buffer.length) return null;
		if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
			return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3), format: 'jpeg' };
		}
		offset += segmentLength;
	}
	return null;
}

function readWebpSize(buffer) {
	if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
	const chunk = buffer.toString('ascii', 12, 16);
	if (chunk === 'VP8X' && buffer.length >= 30) {
		return {
			width: 1 + buffer.readUIntLE(24, 3),
			height: 1 + buffer.readUIntLE(27, 3),
			format: 'webp'
		};
	}
	if (chunk === 'VP8 ' && buffer.length >= 30) {
		return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff, format: 'webp' };
	}
	if (chunk === 'VP8L' && buffer.length >= 25) {
		const bits = buffer.readUInt32LE(21);
		return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: 'webp' };
	}
	return null;
}

function readImageSize(buffer) {
	return readPngSize(buffer) || readJpegSize(buffer) || readWebpSize(buffer);
}

function getSplashBackgroundRejectionReason(size) {
	if (size == null) return 'unreadable-image-metadata';
	if (size.width < MIN_SPLASH_BACKGROUND_WIDTH) return 'width-below-minimum';
	if (size.height < MIN_SPLASH_BACKGROUND_HEIGHT) return 'height-below-minimum';
	if (size.width / size.height < MIN_SPLASH_BACKGROUND_ASPECT_RATIO) return 'aspect-ratio-below-minimum';
	return null;
}

async function validateSplashBackgroundCandidate(directoryPath, filename) {
	const filePath = path.join(directoryPath, filename);
	try {
		const size = readImageSize(await fs.readFile(filePath));
		const rejectionReason = getSplashBackgroundRejectionReason(size);
		if (rejectionReason != null) {
			return null;
		}
		return filename;
	} catch (error) {
		return null;
	}
}

/**
 * Returns supported regular image files in a packaged Trellis splash directory.
 * Missing or unreadable directories intentionally behave like an empty gallery.
 */
export async function listTrellisSplashBackgrounds(directoryPath) {
	try {
		const entries = await fs.readdir(directoryPath, { withFileTypes: true });
		const supportedFilenames = entries
			.filter((entry) => entry.isFile() && SUPPORTED_SPLASH_BACKGROUND_EXTENSIONS.has(
				entry.name.substring(entry.name.lastIndexOf('.')).toLowerCase()))
			.map((entry) => entry.name)
			.sort((left, right) => left.localeCompare(right));
		const filenames = (await Promise.all(supportedFilenames.map((filename) =>
			validateSplashBackgroundCandidate(directoryPath, filename))))
			.filter((filename) => filename != null);

		return filenames;
	} catch (error) {
		return [];
	}
}

/**
 * Selects one filename uniformly. Supplying the random source keeps boundary
 * behavior deterministic in tests without changing production randomness.
 */
export function chooseTrellisSplashBackground(filenames, random = Math.random) {
	if (!Array.isArray(filenames) || filenames.length === 0) {
		return null;
	}

	const sample = Math.max(0, Math.min(0.9999999999999999, Number(random()) || 0));
	const selected = filenames[Math.floor(sample * filenames.length)];
	return selected;
}

/**
 * Creates a process-scoped selector. Its first result, including an empty
 * gallery result, remains stable for the lifetime of the Electron process.
 */
export function createTrellisSplashBackgroundSelector(directoryPath, random = Math.random) {
	let selectionPromise = null;

	return function getSelectedTrellisSplashBackground() {
		if (selectionPromise == null) {
			selectionPromise = listTrellisSplashBackgrounds(directoryPath).then((filenames) =>
				chooseTrellisSplashBackground(filenames, random));
		}

		return selectionPromise;
	};
}
