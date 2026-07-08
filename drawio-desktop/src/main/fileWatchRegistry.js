import fs from 'fs';
import path from 'path';

/**
 * Owns Electron file-watch subscriptions without stacking duplicate StatWatcher listeners.
 */
export function createFileWatchRegistry(options = {}) {
	const fsModule = options.fsModule || fs;
	const pathModule = options.pathModule || path;
	const platform = options.platform || process.platform;
	const watchedFiles = new Map();
	const watchedPathsByWindow = new Map();

	function resolveFilePath(filePath) {
		return pathModule.resolve(String(filePath));
	}

	function getWatchKey(filePath) {
		const resolvedPath = resolveFilePath(filePath);
		return platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
	}

	function isWindowLive(win) {
		if (win == null || typeof win.id === 'undefined') return false;
		if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return false;
		if (win.webContents == null) return false;
		if (typeof win.webContents.isDestroyed === 'function' && win.webContents.isDestroyed()) return false;
		return typeof win.webContents.send === 'function';
	}

	function rememberWindowPath(win, watchKey) {
		let windowPaths = watchedPathsByWindow.get(win.id);

		if (windowPaths == null) {
			windowPaths = new Set();
			watchedPathsByWindow.set(win.id, windowPaths);
		}

		windowPaths.add(watchKey);
	}

	function forgetWindowPath(winId, watchKey) {
		const windowPaths = watchedPathsByWindow.get(winId);

		if (windowPaths == null) return;

		windowPaths.delete(watchKey);

		if (windowPaths.size === 0) {
			watchedPathsByWindow.delete(winId);
		}
	}

	function stopWatchIfUnused(watchKey, entry) {
		if (entry.windows.size > 0) return;

		fsModule.unwatchFile(entry.filePath, entry.listener);
		watchedFiles.delete(watchKey);
	}

	function removeWindowFromEntry(watchKey, entry, winId) {
		if (!entry.windows.has(winId)) return;

		entry.windows.delete(winId);
		forgetWindowPath(winId, watchKey);
		stopWatchIfUnused(watchKey, entry);
	}

	function sendChangeToSubscribers(watchKey, entry, curr, prev) {
		for (const [winId, subscription] of Array.from(entry.windows.entries())) {
			const win = subscription.win;

			if (!isWindowLive(win)) {
				removeWindowFromEntry(watchKey, entry, winId);
				continue;
			}

			try {
				win.webContents.send('fileChanged', {
					path: subscription.responsePath,
					curr,
					prev
				});
			}
			catch (e) {
				// Ignore failed sends; later lifecycle cleanup will remove closed windows.
			}
		}
	}

	function getOrCreateEntry(filePath, watchKey) {
		let entry = watchedFiles.get(watchKey);

		if (entry != null) return entry;

		const resolvedPath = resolveFilePath(filePath);
		entry = {
			filePath: resolvedPath,
			windows: new Map(),
			listener: null
		};
		entry.listener = (curr, prev) => sendChangeToSubscribers(watchKey, entry, curr, prev);
		watchedFiles.set(watchKey, entry);
		fsModule.watchFile(resolvedPath, entry.listener);
		return entry;
	}

	return {
		watch(filePath, win) {
			if (filePath == null || !isWindowLive(win)) return null;

			const watchKey = getWatchKey(filePath);
			const entry = getOrCreateEntry(filePath, watchKey);

			if (!entry.windows.has(win.id)) {
				entry.windows.set(win.id, {
					win,
					responsePath: filePath
				});
				rememberWindowPath(win, watchKey);
			}
			else {
				entry.windows.get(win.id).responsePath = filePath;
			}

			return entry.filePath;
		},

		unwatch(filePath, win) {
			if (filePath == null || win == null || typeof win.id === 'undefined') return;

			const watchKey = getWatchKey(filePath);
			const entry = watchedFiles.get(watchKey);

			if (entry == null) return;

			removeWindowFromEntry(watchKey, entry, win.id);
		},

		unwatchWindow(win) {
			if (win == null || typeof win.id === 'undefined') return;

			const watchKeys = Array.from(watchedPathsByWindow.get(win.id) || []);

			for (const watchKey of watchKeys) {
				const entry = watchedFiles.get(watchKey);

				if (entry != null) {
					removeWindowFromEntry(watchKey, entry, win.id);
				}
			}
		},

		getWatchedFileCount() {
			return watchedFiles.size;
		}
	};
}
