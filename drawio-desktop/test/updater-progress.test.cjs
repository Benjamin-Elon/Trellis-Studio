const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

function readElectronMain() {
	return fs.readFileSync(path.join(projectRoot, 'src/main/electron.js'), 'utf8');
}

test('desktop updater download progress is marked and guarded', () => {
	const source = readElectronMain();

	assert.match(source, /Trellis update progress change \(2026-06-24\)/, 'electron.js should mark the updater progress change at the top of the file');
	assert.match(source, /let trellisUpdateDownloadInProgress = false; \/\/ NEW/, 'download progress should track active downloads');
	assert.match(source, /if \(trellisUpdateDownloadInProgress\) return; \/\/ NEW/, 'repeat update downloads should be ignored while active');
	assert.match(source, /if \(silentUpdate\) return;/, 'silent updates should keep suppressing visible progress UI');
	assert.match(source, /if \(silentUpdate \|\| !trellisUpdateDownloadInProgress\) return; \/\/ NEW/, 'downloaded updates should only prompt after a visible accepted download');
});

test('desktop updater progress starts indeterminate then switches to percent progress', () => {
	const source = readElectronMain();

	assert.match(source, /function beginTrellisUpdateDownload\(\)[\s\S]*trellisUpdateProgressBar = createTrellisUpdateProgressBar\(\); \/\/ NEW/, 'downloads should show an immediate indeterminate progress dialog');
	assert.match(source, /autoUpdater\.on\('download-progress', showTrellisUpdateDownloadProgress\) \/\/ NEW/, 'download progress events should drive the progress dialog');
	assert.match(source, /if \(!trellisUpdateProgressIsDeterminate\)[\s\S]*indeterminate: false,[\s\S]*initialValue: percent/, 'first valid percent should switch the progress dialog to determinate mode');
	assert.match(source, /progressBar\.value = percent; \/\/ NEW/, 'determinate progress should update the rendered progress value');
	assert.match(source, /trellisUpdateProgressBar\.detail = detail; \/\/ NEW[\s\S]*trellisUpdateProgressBar\.value = percent; \/\/ NEW/, 'subsequent progress events should update detail text and value');
});

test('desktop updater progress formats percent and speed detail text', () => {
	const source = readElectronMain();

	assert.match(source, /function formatTrellisUpdateSpeed\(bytesPerSecond\)/, 'speed formatting should live in a focused helper');
	assert.match(source, /bytesPerSecond \/ 1024/, 'speed formatting should start from bytes-per-second updater data');
	assert.match(source, /KB\/s/, 'speed formatting should support KB/s');
	assert.match(source, /MB\/s/, 'speed formatting should support MB/s');
	assert.match(source, /`\$\{percent\}% downloaded - \$\{speed\}`/, 'progress detail should include percent plus speed when available');
	assert.match(source, /`\$\{percent\}% downloaded`/, 'progress detail should fall back to percent-only when speed is unavailable');
});

test('desktop updater progress error path avoids private progressbar internals', () => {
	const source = readElectronMain();

	assert.match(source, /function showTrellisUpdateDownloadError\(e\)/, 'download errors should have a focused error-state helper');
	assert.match(source, /closable: true, \/\/ NEW[\s\S]*text: 'Trellis Studio update failed\.'/, 'download errors should show a closable error dialog');
	assert.match(source, /updateDownload\.catch\(showTrellisUpdateDownloadError\); \/\/ NEW/, 'download promise failures should update the progress dialog error state');
	assert.doesNotMatch(source, /_window/, 'updater progress should not depend on private electron-progressbar window internals');
	assert.match(source, /You will be prompted to install the update after download\./, 'initial update copy should match the actual install prompt flow');
});
