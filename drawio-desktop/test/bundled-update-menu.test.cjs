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

test('bundled desktop update menu action falls back to Electron IPC', () => {
	for (const fileName of bundledFiles) {
		const source = readBundledFile(fileName);

		// Trellis ships these minified upstream files directly, so the menu action must not depend on an omitted prototype method.
		assert.match(source, /update IPC fallback/, `${fileName} should document the Trellis update fallback`);
		assert.match(source, /electron\.sendMessage\("checkForUpdates"\)/, `${fileName} should send update checks through Electron IPC`);
		assert.doesNotMatch(source, /addAction\("check4Updates",function\(\)\{[a-z]\.checkForUpdates\(\)\}\)/, `${fileName} should not call checkForUpdates without a fallback`);
	}
});
