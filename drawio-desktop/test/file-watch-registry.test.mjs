import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createFileWatchRegistry } from '../src/main/fileWatchRegistry.js';

const projectRoot = path.resolve(import.meta.dirname, '..');

function readProjectFile(relPath) {
	return fs.readFileSync(path.join(projectRoot, relPath), 'utf8');
}

function createFakeFs() {
	const watchCalls = [];
	const unwatchCalls = [];

	return {
		watchCalls,
		unwatchCalls,
		watchFile(filePath, listener) {
			watchCalls.push({ filePath, listener });
		},
		unwatchFile(filePath, listener) {
			unwatchCalls.push({ filePath, listener });
		}
	};
}

function createFakeWindow(id) {
	const messages = [];
	let destroyed = false;
	let webContentsDestroyed = false;

	return {
		id,
		messages,
		isDestroyed() {
			return destroyed;
		},
		destroy() {
			destroyed = true;
		},
		destroyWebContents() {
			webContentsDestroyed = true;
		},
		webContents: {
			isDestroyed() {
				return webContentsDestroyed;
			},
			send(channel, payload) {
				messages.push({ channel, payload });
			}
		}
	};
}

test('file watch registry creates one watcher for repeated window/path subscriptions', () => {
	const fakeFs = createFakeFs();
	const registry = createFileWatchRegistry({ fsModule: fakeFs, pathModule: path.win32, platform: 'win32' });
	const win = createFakeWindow(1);

	registry.watch('C:\\Garden\\plan.drawio', win);
	registry.watch('c:\\garden\\PLAN.drawio', win);

	assert.equal(fakeFs.watchCalls.length, 1);
	assert.equal(registry.getWatchedFileCount(), 1);

	fakeFs.watchCalls[0].listener({ mtimeMs: 2 }, { mtimeMs: 1 });
	assert.equal(win.messages[0].payload.path, 'c:\\garden\\PLAN.drawio');
});

test('file watch registry shares a path watcher across windows until final unwatch', () => {
	const fakeFs = createFakeFs();
	const registry = createFileWatchRegistry({ fsModule: fakeFs, pathModule: path.win32, platform: 'win32' });
	const firstWindow = createFakeWindow(1);
	const secondWindow = createFakeWindow(2);

	registry.watch('C:\\Garden\\plan.drawio', firstWindow);
	registry.watch('C:\\Garden\\plan.drawio', secondWindow);
	assert.equal(fakeFs.watchCalls.length, 1);

	registry.unwatch('C:\\Garden\\plan.drawio', firstWindow);
	assert.equal(fakeFs.unwatchCalls.length, 0);
	assert.equal(registry.getWatchedFileCount(), 1);

	registry.unwatch('C:\\Garden\\plan.drawio', secondWindow);
	assert.equal(fakeFs.unwatchCalls.length, 1);
	assert.equal(fakeFs.unwatchCalls[0].listener, fakeFs.watchCalls[0].listener);
	assert.equal(registry.getWatchedFileCount(), 0);
});

test('file watch registry broadcasts changes only to live subscribed windows', () => {
	const fakeFs = createFakeFs();
	const registry = createFileWatchRegistry({ fsModule: fakeFs, pathModule: path.win32, platform: 'win32' });
	const liveWindow = createFakeWindow(1);
	const closedWindow = createFakeWindow(2);

	registry.watch('C:\\Garden\\plan.drawio', liveWindow);
	registry.watch('C:\\Garden\\plan.drawio', closedWindow);
	closedWindow.destroy();

	fakeFs.watchCalls[0].listener({ mtimeMs: 2 }, { mtimeMs: 1 });

	assert.deepEqual(liveWindow.messages, [{
		channel: 'fileChanged',
		payload: {
			path: 'C:\\Garden\\plan.drawio',
			curr: { mtimeMs: 2 },
			prev: { mtimeMs: 1 }
		}
	}]);
	assert.deepEqual(closedWindow.messages, []);
	assert.equal(fakeFs.unwatchCalls.length, 0);

	registry.unwatch('C:\\Garden\\plan.drawio', liveWindow);
	assert.equal(fakeFs.unwatchCalls.length, 1);
});

test('desktop file watch lifecycle integration is marked and wired', () => {
	const electronSource = readProjectFile('src/main/electron.js');
	const preloadSource = readProjectFile('src/main/electron-preload.js');
	const electronAppSource = readProjectFile('drawio/src/main/webapp/js/diagramly/ElectronApp.js');

	assert.match(electronSource, /file-watch lifecycle management/, 'electron.js header should mark the lifecycle change');
	assert.match(preloadSource, /file-watch listener cleanup/, 'preload header should mark listener cleanup');
	assert.match(electronAppSource, /duplicate file-watch prevention/, 'ElectronApp header should mark duplicate watch prevention');
	assert.match(electronSource, /BrowserWindow\.fromWebContents\(event\.sender\)/, 'watch ownership should use the IPC sender window');
	assert.match(electronSource, /fileWatchRegistry\.unwatchWindow\(mainWindow\); \/\/ CHANGE/, 'closed windows should release file-watch subscriptions');
	assert.match(preloadSource, /else if \(msg\.action === 'unwatchFile'\) \{ \/\/ CHANGE[\s\S]*delete fileChangedListeners\[msg\.path\]; \/\/ CHANGE/, 'unwatch requests should remove preload file-change listeners');
	assert.match(electronAppSource, /if \(this\.watchedPath == newPath\) return; \/\/ CHANGE/, 'same-path renderer watch calls should return before IPC');
});
