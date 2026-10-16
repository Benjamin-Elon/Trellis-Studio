const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { AppInfo } = require('app-builder-lib/out/appInfo'); // CHANGE: verify builder-derived launch names and public labels.
const { getWindowsInstallationDirName } = require('app-builder-lib/out/targets/targetUtil'); // CHANGE: guard the existing installer directory.

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

		// Trellis release: NSIS finish pages should offer the checked Run Trellis OS option.
		assert.equal(config.nsis?.runAfterFinish, true, `${fileName} NSIS must run after finish`);
	}

	const winConfig = readBuilderConfig('electron-builder-win.json');

	// Trellis release: the x64 MSI also supports electron-builder's finish-page run option.
	assert.equal(winConfig.msi?.runAfterFinish, true, 'electron-builder-win.json MSI must run after finish');
});

test('Electron Builder configs expose Trellis OS labels while preserving compatibility IDs', () => { // CHANGE: Trellis OS branding.
	for (const fileName of getBuilderConfigNames()) {
		const config = readBuilderConfig(fileName);
		const diagramAssociation = config.fileAssociations?.find((association) => association.ext === 'drawio'); // CHANGE

		assert.equal(config.appId, 'com.benjaminelon.trellisfordrawio', `${fileName} appId must remain compatible`);
		assert.equal(diagramAssociation?.name, 'Trellis OS Diagram', `${fileName} diagram association name must be branded`); // CHANGE
		assert.equal(diagramAssociation?.description, 'Trellis OS Diagram', `${fileName} diagram association description must be branded`); // CHANGE
		assert.equal(diagramAssociation?.mimeType, 'application/vnd.jgraph.mxfile', `${fileName} diagram MIME type must remain compatible`); // CHANGE
	}

	assert.equal(readBuilderConfig('electron-builder-appx.json').appx.identityName, 'draw.io.draw.ioDiagrams');
	assert.equal(readBuilderConfig('electron-builder-linux-mac.json').linux.executableName, 'trellis-studio');
	assert.equal(readBuilderConfig('electron-builder-snap.json').linux.executableName, 'trellis-studio');
});

test('Windows NSIS drawio file associations use the Trellis document icon', () => {
	const windowsConfigs = [
		'electron-builder-win.json',
		'electron-builder-win32.json',
		'electron-builder-win-arm64.json',
	];

	for (const fileName of windowsConfigs) {
		const config = readBuilderConfig(fileName);
		const diagramAssociation = config.fileAssociations?.find((association) => association.ext === 'drawio'); // CHANGE

		assert.equal(diagramAssociation?.icon, 'icon.ico', `${fileName} drawio association must use the Trellis icon`); // CHANGE
	}
});

test('Trellis OS display names preserve existing launch and installer paths', () => { // CHANGE
    const metadata = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')); // CHANGE
    assert.equal(metadata.name, 'trellis-studio'); // CHANGE: internal package identity stays stable.
    assert.equal(metadata.productName, 'Trellis OS'); // CHANGE
    assert.equal(metadata.repository.url, 'git+https://github.com/Benjamin-Elon/trellis-studio.git'); // CHANGE
    for (const fileName of getBuilderConfigNames()) { // CHANGE
        const config = readBuilderConfig(fileName); // CHANGE
        assert.equal(config.executableName, 'Trellis Studio', `${fileName} must pin the legacy executable/bundle basename`); // CHANGE
        for (const platform of ['win', 'mac', 'linux']) { // CHANGE
            if (platform === 'linux' && !config.linux) continue; // CHANGE
            const appInfo = new AppInfo({ metadata, config }, undefined, config[platform]); // CHANGE
            assert.equal(appInfo.productName, 'Trellis OS', `${fileName} ${platform} public name`); // CHANGE
            assert.equal(appInfo.productFilename, platform === 'linux' ? 'trellis-studio' : 'Trellis Studio', `${fileName} ${platform} launch basename`); // CHANGE
            if (platform === 'win') assert.equal(getWindowsInstallationDirName(appInfo, true), 'Trellis Studio', `${fileName} installer directory`); // CHANGE
        } // CHANGE
    } // CHANGE
}); // CHANGE
