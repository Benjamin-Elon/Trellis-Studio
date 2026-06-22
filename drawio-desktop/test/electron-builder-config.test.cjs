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
