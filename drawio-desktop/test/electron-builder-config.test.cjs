const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

function readBuilderConfig(fileName) {
	return JSON.parse(fs.readFileSync(path.join(projectRoot, fileName), 'utf8'));
}

function getBuilderConfigNames() {
	return fs
		.readdirSync(projectRoot)
		.filter((fileName) => /^electron-builder.*\.json$/.test(fileName))
		.sort();
}

test('Electron Builder configs rebuild native modules for the packaged Electron runtime', () => {
	for (const fileName of getBuilderConfigNames()) {
		const config = readBuilderConfig(fileName);

		// Trellis uses better-sqlite3 from the packaged Electron app, so release builds must not ship Node-built binaries.
		assert.equal(config.npmRebuild, true, `${fileName} must keep npmRebuild enabled`);
	}
});

test('Windows installers offer to run Trellis after installation finishes', () => {
	const windowsConfigs = [
		'electron-builder-win.json',
		'electron-builder-win32.json',
		'electron-builder-win-arm64.json',
	];

	for (const fileName of windowsConfigs) {
		const config = readBuilderConfig(fileName);

		// Trellis release: NSIS finish pages should offer the checked Run Trellis Studio option.
		assert.equal(config.nsis?.runAfterFinish, true, `${fileName} NSIS must run after finish`);
	}

	const winConfig = readBuilderConfig('electron-builder-win.json');

	// Trellis release: the x64 MSI also supports electron-builder's finish-page run option.
	assert.equal(winConfig.msi?.runAfterFinish, true, 'electron-builder-win.json MSI must run after finish');
});

test('Electron Builder configs expose Trellis Studio labels while preserving compatibility IDs', () => {
	for (const fileName of getBuilderConfigNames()) {
		const config = readBuilderConfig(fileName);
		const drawioAssociation = config.fileAssociations?.find((association) => association.ext === 'drawio');

		assert.equal(config.appId, 'com.benjaminelon.trellisfordrawio', `${fileName} appId must remain compatible`); // CHANGE
		assert.equal(drawioAssociation?.name, 'Trellis Studio Diagram', `${fileName} drawio association name must be branded`); // CHANGE
		assert.equal(drawioAssociation?.description, 'Trellis Studio Diagram', `${fileName} drawio association description must be branded`); // CHANGE
		assert.equal(drawioAssociation?.mimeType, 'application/vnd.jgraph.mxfile', `${fileName} drawio MIME type must remain compatible`); // CHANGE
	}

	assert.equal(readBuilderConfig('electron-builder-appx.json').appx.identityName, 'draw.io.draw.ioDiagrams'); // CHANGE
	assert.equal(readBuilderConfig('electron-builder-linux-mac.json').linux.executableName, 'trellis-studio'); // CHANGE
	assert.equal(readBuilderConfig('electron-builder-snap.json').linux.executableName, 'trellis-studio'); // CHANGE
});
