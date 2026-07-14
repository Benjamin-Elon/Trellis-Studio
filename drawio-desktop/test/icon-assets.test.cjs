const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

function readJson(relativePath) {
	return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function sha256(relativePath) {
	return crypto
		.createHash('sha256')
		.update(fs.readFileSync(path.join(projectRoot, relativePath)))
		.digest('hex');
}

function readPngDimensions(relativePath) {
	const buffer = fs.readFileSync(path.join(projectRoot, relativePath));
	assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG', `${relativePath} must be PNG`);
	return {
		width: buffer.readUInt32BE(16),
		height: buffer.readUInt32BE(20),
		colorType: buffer[25],
	};
}

function readIcoFrames(relativePath) {
	const buffer = fs.readFileSync(path.join(projectRoot, relativePath));
	assert.equal(buffer.readUInt16LE(0), 0, `${relativePath} must have a valid ICO header`);
	assert.equal(buffer.readUInt16LE(2), 1, `${relativePath} must contain icon images`);
	const count = buffer.readUInt16LE(4);
	const frames = new Map();

	for (let index = 0; index < count; index += 1) {
		const entryOffset = 6 + index * 16;
		const width = buffer[entryOffset];
		const size = width === 0 ? 256 : width;
		const byteLength = buffer.readUInt32LE(entryOffset + 8);
		const imageOffset = buffer.readUInt32LE(entryOffset + 12);
		frames.set(size, buffer.subarray(imageOffset, imageOffset + byteLength));
	}

	return frames;
}

function readIcoSizes(relativePath) {
	return [...readIcoFrames(relativePath).keys()];
}

function readAlphaMargins(relativePaths) {
	const script = [
		'import json, sys',
		'from PIL import Image',
		'result = {}',
		'for path in sys.argv[1:]:',
		'    with Image.open(path) as image:',
		'        alpha = image.convert("RGBA").getchannel("A")',
		'        left, top, right, bottom = alpha.getbbox()',
		'        result[path] = [left, top, image.width - right, image.height - bottom]',
		'print(json.dumps(result))',
	].join('\n');
	const absolutePaths = relativePaths.map((relativePath) => path.join(projectRoot, relativePath));
	const result = spawnSync('python', ['-c', script, ...absolutePaths], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const margins = JSON.parse(result.stdout);
	return Object.fromEntries(relativePaths.map((relativePath, index) => [relativePath, margins[absolutePaths[index]]]));
}

test('Trellis identity assets match the canonical raster masters', () => {
	const result = spawnSync('python', ['./scripts/generate_app_icons.py', '--check'], {
		cwd: projectRoot,
		encoding: 'utf8',
	});

	assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('canonical integrated-background sources retain their supplied bytes and dimensions', () => {
	assert.deepEqual(readPngDimensions('build/branding/trellis-mark-full.png'), {
		width: 875,
		height: 911,
		colorType: 6,
	});
	assert.deepEqual(readPngDimensions('build/branding/trellis-mark-small.png'), {
		width: 1022,
		height: 1036,
		colorType: 6,
	});
	assert.equal(
		sha256('build/branding/trellis-mark-full.png'),
		'aea15968cc71af4dff0fd6bd5ae1905beb11c7b4534c3593b908a16159f92871',
	);
	assert.equal(
		sha256('build/branding/trellis-mark-small.png'),
		'9a4c4909e276e9fd210a8890718f3f06d4320815c8cf641949e0784ee483fdfb',
	);
});

test('platform icon containers and multiresolution formats keep their required dimensions', () => {
	assert.deepEqual(readPngDimensions('build/appx/Wide310x150Logo.png'), { width: 310, height: 150, colorType: 6 });
	assert.deepEqual(readPngDimensions('build/appx/Square44x44Logo.png'), { width: 44, height: 44, colorType: 6 });
	assert.deepEqual(readPngDimensions('drawio/src/main/webapp/images/icon-192-maskable.png'), {
		width: 192,
		height: 192,
		colorType: 6,
	});
	assert.deepEqual(readPngDimensions('drawio/src/main/webapp/images/android-chrome-512x512.png'), {
		width: 512,
		height: 512,
		colorType: 6,
	});
	assert.deepEqual(readPngDimensions('drawio/src/main/webapp/images/mstile-150x150.png'), {
		width: 150,
		height: 150,
		colorType: 6,
	});
	assert.deepEqual(readPngDimensions('drawio/src/main/webapp/images/window-icon.png'), {
		width: 256,
		height: 256,
		colorType: 6,
	});
	assert.deepEqual(readPngDimensions('drawio/src/main/webapp/images/header-icon.png'), {
		width: 256,
		height: 256,
		colorType: 6,
	});
	assert.deepEqual(readIcoSizes('build/icon.ico'), [16, 24, 32, 48, 64, 128, 256]);
	assert.equal(fs.readFileSync(path.join(projectRoot, 'build/icon.icns')).subarray(0, 4).toString(), 'icns');
});

test('header and native window placements use their dedicated Trellis assets', () => {
	const generator = fs.readFileSync(path.join(projectRoot, 'scripts/generate_app_icons.py'), 'utf8');
	const electronMain = fs.readFileSync(path.join(projectRoot, 'src/main/electron.js'), 'utf8');
	const bootstrap = fs.readFileSync(path.join(projectRoot, 'drawio/src/main/webapp/js/bootstrap.js'), 'utf8');
	const graphEditorCss = fs.readFileSync(path.join(projectRoot, 'drawio/src/main/webapp/styles/grapheditor.css'), 'utf8');
	const worker = fs.readFileSync(path.join(projectRoot, 'drawio/src/main/webapp/service-worker.js'), 'utf8');

	assert.match(generator, /COMPACT_ICON_FILL_RATIO = 1\.00/);
	assert.match(generator, /LARGE_TRANSPARENT_ICON_FILL_RATIO = 0\.90/);
	assert.match(
		generator,
		/window_icon = fit_image\(masters\.small, \(256, 256\), COMPACT_ICON_FILL_RATIO\)/,
	);
	assert.match(
		generator,
		/header_icon = fit_image\(masters\.full, \(256, 256\), COMPACT_ICON_FILL_RATIO\)/,
	);
	assert.notEqual(
		sha256('drawio/src/main/webapp/images/window-icon.png'),
		sha256('drawio/src/main/webapp/images/header-icon.png'),
	);
	assert.match(electronMain, /icon: `\$\{codeDir\}\/images\/window-icon\.png`/);
	assert.doesNotMatch(electronMain, /icon: `\$\{codeDir\}\/images\/drawlogo256\.png`/);
	assert.match(bootstrap, /Editor\.logoImage = IMAGE_PATH \+ '\/header-icon\.png'/);
	assert.doesNotMatch(bootstrap, /Editor\.logoImage = IMAGE_PATH \+ '\/window-icon\.png'/);
	assert.match(bootstrap, /this\.openLink\('https:\/\/example\.com'\)/);
	assert.match(bootstrap, /mxEvent\.consume\(evt\)/);
	assert.match(bootstrap, /setAttribute\('title', 'Trellis Studio'\)/);
	assert.match(bootstrap, /setAttribute\('aria-label', 'Trellis Studio'\)/);
	const devLoad = bootstrap.indexOf("mxscript(drawDevUrl + 'js/diagramly/Devel.js');");
	const devInstall = bootstrap.indexOf('installTrellisBranding();', devLoad);
	const devHooks = bootstrap.indexOf('loadElectronDesktopHooks(function()', devInstall);
	assert.ok(devLoad >= 0 && devLoad < devInstall && devInstall < devHooks);
	const productionLoad = bootstrap.indexOf("mxscript('js/app.min.js', function()");
	const productionInstall = bootstrap.indexOf('installTrellisBranding();', productionLoad);
	const productionHooks = bootstrap.indexOf('loadElectronDesktopHooks(function()', productionInstall);
	assert.ok(productionLoad >= 0 && productionLoad < productionInstall && productionInstall < productionHooks);
	assert.match(graphEditorCss, /\.geAppIcon\s*\{[^}]*background-color: transparent;/s);
	assert.match(graphEditorCss, /\.geAppIcon\s*\{[^}]*background-size: contain;/s);
	assert.match(graphEditorCss, /\.geAppIcon\s*\{[^}]*opacity: 1;/s);
	assert.match(graphEditorCss, /\.geAppIcon\s*\{[^}]*width: 64px;[^}]*height: 64px;/s); // Trellis change: lock the doubled header mark dimensions.
	assert.match(graphEditorCss, /\.geMenubar\s*\{[^}]*padding: 0px 2px 0px 90px;/s); // Trellis change: prevent menu overlap with the larger mark.
	assert.match(graphEditorCss, /\.geFilenameContainer\s*\{[^}]*left: 92px;/s); // Trellis change: prevent title overlap with the larger mark.
	for (const url of ['js/bootstrap.js', 'styles/grapheditor.css', 'images/header-icon.png', 'images/window-icon.png']) {
		assert.ok(worker.includes(`url:"${url}",revision:"`));
	}
});

test('compact transparent icons use the full canvas without generator margins', () => {
	const compactIcons = [
		'build/16x16.png',
		'build/32x32.png',
		'build/48x48.png',
		'drawio/src/main/webapp/images/favicon-16x16.png',
		'drawio/src/main/webapp/images/favicon-32x32.png',
		'drawio/src/main/webapp/images/drawlogo48.png',
		'drawio/src/main/webapp/images/header-icon.png',
		'drawio/src/main/webapp/images/window-icon.png',
	];
	const margins = readAlphaMargins(compactIcons);

	for (const relativePath of compactIcons) {
		assert.ok(Math.min(...margins[relativePath]) === 0, `${relativePath} must touch a canvas edge`);
		assert.ok(Math.max(...margins[relativePath]) <= 1, `${relativePath} must have at most one centering pixel`);
	}
});

test('large transparent icons retain five-percent edge margins', () => {
	const largeIcons = [
		'build/64x64.png',
		'build/256x256.png',
		'drawio/src/main/webapp/images/icon-192.png',
	];
	const margins = readAlphaMargins(largeIcons);

	for (const relativePath of largeIcons) {
		const { width } = readPngDimensions(relativePath);
		const expectedMargin = width * 0.05;
		for (const margin of margins[relativePath]) {
			assert.ok(
				Math.abs(margin - expectedMargin) <= 2,
				`${relativePath} margin ${margin}px must remain within two pixels of 5% (${expectedMargin}px)`,
			);
		}
	}
});

test('ICO frames preserve the compact/full master routing boundary', () => {
	const desktopFrames = readIcoFrames('build/icon.ico');
	assert.deepEqual(desktopFrames.get(16), fs.readFileSync(path.join(projectRoot, 'build/16x16.png')));
	assert.deepEqual(desktopFrames.get(48), fs.readFileSync(path.join(projectRoot, 'build/48x48.png')));
	assert.deepEqual(desktopFrames.get(64), fs.readFileSync(path.join(projectRoot, 'build/64x64.png')));

	const faviconFrames = readIcoFrames('drawio/src/main/webapp/favicon.ico');
	assert.deepEqual(
		faviconFrames.get(16),
		fs.readFileSync(path.join(projectRoot, 'drawio/src/main/webapp/images/favicon-16x16.png')),
	);
	assert.deepEqual(
		faviconFrames.get(32),
		fs.readFileSync(path.join(projectRoot, 'drawio/src/main/webapp/images/favicon-32x32.png')),
	);
});

test('visible install metadata uses Trellis branding without changing compatibility identity', () => {
	const manifest = readJson('drawio/src/main/webapp/images/manifest.json');
	const appx = readJson('electron-builder-appx.json');
	const windows = readJson('electron-builder-win.json');
	const electronMain = fs.readFileSync(path.join(projectRoot, 'src/main/electron.js'), 'utf8');

	assert.equal(manifest.name, 'Trellis Studio');
	assert.equal(manifest.short_name, 'Trellis');
	assert.equal(manifest.background_color, '#FBFEBD');
	assert.equal(manifest.theme_color, '#5A2F0A');
	assert.equal(appx.appx.displayName, 'Trellis Studio');
	assert.equal(appx.appx.identityName, 'draw.io.draw.ioDiagrams');
	assert.equal(appx.appId, 'com.benjaminelon.trellisfordrawio');
	assert.ok(windows.fileAssociations.some((association) => association.ext === 'drawio'));
	assert.match(electronMain, /path\.join\(app\.getPath\('appData'\), 'draw\.io'\)/);
	assert.match(
		fs.readFileSync(path.join(projectRoot, 'drawio/src/main/webapp/images/browserconfig.xml'), 'utf8'),
		/<TileColor>#FBFEBD<\/TileColor>/,
	);
});
