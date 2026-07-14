const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const bundledFiles = [
	'drawio/src/main/webapp/js/app.min.js',
	'drawio/src/main/webapp/js/integrate.min.js',
];

function readBundledFile(fileName) {
	return fs.readFileSync(path.join(projectRoot, fileName), 'utf8');
}

test('bootstrap detects Trellis Electron through the preload bridge', () => {
	const source = readBundledFile('drawio/src/main/webapp/js/bootstrap.js');

	// Trellis keeps its own branding, so Electron detection must not require the old draw.io user-agent suffix.
	assert.match(source, /function isElectronRuntime\(\)/, 'bootstrap should centralize Electron runtime detection');
	assert.match(source, /versions\.electron != null/, 'bootstrap should detect Electron from exposed process versions');
	assert.match(source, /window\.electron != null/, 'bootstrap should detect Electron from the preload bridge');
	assert.match(source, /userAgent\.indexOf\(' draw\.io\/'\) > -1/, 'bootstrap should preserve the legacy draw.io user-agent fallback');
	assert.match(source, /var mxIsElectron = isElectronRuntime\(\);/, 'mxIsElectron should use the centralized detector');
	assert.doesNotMatch(source, /var mxIsElectron = navigator\.userAgent/, 'mxIsElectron should not directly require draw.io-branded user agents');
});

test('bootstrap uses shared Electron desktop hook paths', () => {
	const source = readBundledFile('drawio/src/main/webapp/js/bootstrap.js');

	// Trellis desktop hooks are shared by dev and packaged Electron bootstraps.
	assert.match(source, /function loadElectronDesktopHooks\(onLoaded\)/, 'bootstrap should centralize Electron hook loading');
	assert.match(source, /mxscript\('js\/diagramly\/DesktopLibrary\.js'/, 'bootstrap should load the real DesktopLibrary.js path');
	assert.match(source, /mxscript\('js\/diagramly\/ElectronApp\.js'/, 'bootstrap should load the real ElectronApp.js path');
	assert.doesNotMatch(source, /js\/desktop\/(?:DesktopLibrary|ElectronApp)\.js/, 'bootstrap should not reference removed js/desktop hook paths');
});

test('dev Electron bootstrap loads desktop hooks before PostConfig', () => {
	const source = readBundledFile('drawio/src/main/webapp/js/bootstrap.js');
	const develLoad = source.indexOf("mxscript(drawDevUrl + 'js/diagramly/Devel.js')");
	const hookCall = source.indexOf('loadElectronDesktopHooks(function()', develLoad);
	const postConfig = source.indexOf("mxscript(drawDevUrl + 'js/PostConfig.js')", hookCall);

	// Trellis dev mode must load ElectronApp.js before later config can start the app path.
	assert.notEqual(develLoad, -1, 'dev bootstrap should load Devel.js');
	assert.notEqual(hookCall, -1, 'dev bootstrap should use the shared Electron hook loader');
	assert.notEqual(postConfig, -1, 'dev bootstrap should load PostConfig after desktop hooks');
	assert.ok(develLoad < hookCall, 'dev Electron hook loader should run after Devel.js');
	assert.ok(hookCall < postConfig, 'dev PostConfig should wait for Electron hook loading');
});

test('production Electron bootstrap loads desktop hooks before App.main', () => {
	const source = readBundledFile('drawio/src/main/webapp/js/bootstrap.js');
	const loadApp = source.indexOf('function loadAppJS()');
	const hookCall = source.indexOf('loadElectronDesktopHooks(function()', loadApp);
	const readyGate = source.indexOf('mxScriptsLoaded = true;', hookCall);

	// Trellis packages app.min.js directly, so ElectronApp.js must patch desktop methods before App.main builds menus.
	assert.notEqual(loadApp, -1, 'production bootstrap should define loadAppJS');
	assert.notEqual(hookCall, -1, 'production bootstrap should use the shared Electron hook loader');
	assert.notEqual(readyGate, -1, 'production bootstrap should still mark scripts loaded');
	assert.ok(hookCall < readyGate, 'desktop hooks should load before App.main can run');
});

test('bundled desktop update menu option is removed', () => { // CHANGE
	for (const fileName of bundledFiles) {
		const source = readBundledFile(fileName);

		assert.doesNotMatch(source, /actions\.addAction\("check4Updates"/, `${fileName} should not define the old update menu action`); // CHANGE
		assert.doesNotMatch(source, /addMenuItems\([a-z],\["check4Updates","-"\]/, `${fileName} should not insert the old update menu item`); // CHANGE
	}
});

test('source desktop update menu options are removed while dialog IPC remains', () => { // CHANGE
	const electronSource = readBundledFile('src/main/electron.js');
	const menusSource = readBundledFile('drawio/src/main/webapp/js/diagramly/Menus.js');
	const electronAppSource = readBundledFile('drawio/src/main/webapp/js/diagramly/ElectronApp.js');

	assert.match(electronSource, /'canCheckForUpdates': canCheckForUpdates\(\) \? 1 : 0, \/\/ NEW/, 'Electron startup params should expose updater capability');
	assert.match(electronSource, /if \(!canCheckForUpdates\(\)\) return; \/\/ CHANGE/, 'IPC update requests should no-op when updates are unavailable');
	assert.match(electronSource, /ipcMain\.on\('checkForUpdates', checkForUpdatesFn\)/, 'Dialog update IPC should remain available'); // NEW
	assert.doesNotMatch(electronSource, /label: 'Check for updates'/, 'Native update menu item should be removed'); // CHANGE
	assert.doesNotMatch(electronSource, /checkForUpdates,\s*\{ type: 'separator' \}/, 'Native app submenu should not include checkForUpdates'); // NEW
	assert.doesNotMatch(electronSource, /Update checks are only available in packaged Trellis Studio releases/, 'Main process should not show the old packaged-build warning');
	assert.doesNotMatch(menusSource, /check4Updates/, 'Renderer Help menu should not include check4Updates'); // CHANGE
	assert.match(electronAppSource, /if \(urlParams\['canCheckForUpdates'\] == '1'\) \/\/ NEW/, 'ElectronApp update method should not send IPC when updates are unavailable');
});
