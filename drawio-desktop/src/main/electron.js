// Trellis changes: file-system/database bridges, file-watch lifecycle management, forked support/update URLs, updater guards, app-info/release metadata.
/*
 * Trellis update progress change (2026-06-24):
 * Download-only updater progress uses guarded helpers with indeterminate fallback,
 * percent/speed detail text, and controlled cleanup/error UI.
 */

import fs from 'fs';
import { promises as fsProm } from 'fs';
import path from 'path';
import url, { fileURLToPath } from 'url'; // CHANGE: validate file requests before allowing local resources.
import {
	Menu as menu, shell, dialog, session, screen,
	clipboard, nativeImage, ipcMain, app, BrowserWindow, Tray, safeStorage // CHANGE: OS-protect temporary device pairing credentials.
} from 'electron';
import crc from 'crc';
import zlib from 'zlib';
import log from 'electron-log';
import { program } from 'commander';
import elecUpPkg from 'electron-updater';
const { autoUpdater } = elecUpPkg;
import { PDFDocument } from '@cantoo/pdf-lib';
import Store from 'electron-store';
import ProgressBar from 'electron-progressbar';
import contextMenu from 'electron-context-menu';
import { spawn } from 'child_process';
import { disableUpdate as disUpPkg } from './disableUpdate.js';
import { createFileWatchRegistry } from './fileWatchRegistry.js';
import { createTrellisSplashBackgroundSelector } from './trellis-splash-backgrounds.js';
import { createSyncthingService } from './trellis-syncthing-service.js'; // NEW
import { createSharingTray, createSharingGroup, setSharingStartup } from './trellis-sharing-tray.js'; // NEW
import { assertSharingFileAccess } from './trellis-sharing-files.js'; // NEW: generic filesystem IPC must not expose service credentials.
import { createIdentityService } from './trellis-identity-service.js'; // NEW
import { createGardenLibraryService } from './trellis-garden-library-service.js'; // NEW
import { createFieldService } from './trellis-field-service.js'; // NEW
import { EventEmitter } from 'node:events'; // NEW
import { createLifecycleCoordinator, requestWindowReply, cleanupClosedWindow, lastWindowPolicy } from './trellis-lifecycle.js'; // NEW

// (ADD): SQLite
import Database from 'better-sqlite3';

const fileWatchRegistry = createFileWatchRegistry();
let sharingService = null; // NEW
let sharingTray = null; // NEW
let sharingTrayCreation = null; // NEW: concurrent Share/Join requests must not create duplicate trays.
const sharingEvents = new EventEmitter(); // CHANGE: one tray subscription observes all transports.
let configuredIdentities = []; // NEW: installed, non-revoked identities determine background eligibility.
let backgroundReady = null, backgroundFailureShown = false, identityRefreshTask = null; // NEW
const sharingWindowPaths = new Map(); // NEW: bind sharing IPC to the caller's watched document.
const identityTransports = new Map(); // NEW: each identity has a separate daemon and registry.
let identityService = null, gardenLibraryService = null, fieldService = null, identityRefreshTimer = null; // CHANGE

try {
	const drawioUserDataPath = path.join(app.getPath('appData'), 'draw.io'); // CHANGE: preserve the existing legacy runtime profile.

	if (!fs.existsSync(drawioUserDataPath)) {
		fs.mkdirSync(drawioUserDataPath, { recursive: true }); // Trellis release: ensure electron-store and Chromium can use the compatibility path.
	}

	app.setPath('userData', drawioUserDataPath); // CHANGE: keep plugins, localStorage, drafts, and settings under the old profile.
}
catch (e) {
	console.error('Failed to preserve legacy userData path:', e); // CHANGE: launch with Electron default if compatibility pin fails.
}

let store;

try {
	store = new Store();
}
catch (e) {
	console.error('Failed to initialize electron-store:', e);
	store = null;
}

// (ADD): keep track of open DBs by an id (string)
const dbRegistry = new Map();
const dbRegistryPaths = new Map();
const TRELLIS_BUILT_IN_DB_REL_PATH = '../../trellis_database/Trellis_database.sqlite';
/** Generate a simple id; you can replace with something stronger if needed */
function makeDbId() {
	return Math.random().toString(36).slice(2);
}

//(ADD)
function getLiveDbPath(dbName = 'Trellis_database.sqlite') {
	const dir = path.join(getAppDataFolder(), 'trellis_database');
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	return path.join(dir, dbName);
}

// (ADD)
function ensureSeededDb(seedRelPath, livePath) {
	// seedRelPath is repo-relative to electron.js directory OR absolute
	const seedAbs = path.resolve(__dirname, seedRelPath);

	if (!fs.existsSync(seedAbs)) throw new Error('Seed DB missing');
	if (fs.existsSync(livePath)) return livePath;

	const parent = path.dirname(livePath);
	if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });

	fs.copyFileSync(seedAbs, livePath);
	return livePath;
}

function ensureCreatedDb(livePath) {
	const parent = path.dirname(livePath);
	if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
	if (!fs.existsSync(livePath)) fs.closeSync(fs.openSync(livePath, 'a'));
	return livePath;
}

function compareDbPath(dbPath) {
	const resolved = path.resolve(dbPath);
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function closeRegisteredDbsForPath(dbPath) {
	const wanted = compareDbPath(dbPath);
	for (const [dbId, registeredPath] of dbRegistryPaths.entries()) {
		if (compareDbPath(registeredPath) !== wanted) continue;
		const db = dbRegistry.get(dbId);
		if (db) db.close();
		dbRegistry.delete(dbId);
		dbRegistryPaths.delete(dbId);
	}
}

function trellisDbBackupPath(dbPath) {
	const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
	const parsed = path.parse(dbPath);
	return path.join(parsed.dir, `${parsed.name}.${stamp}.bak${parsed.ext}`);
}

function restoreBuiltInTrellisDatabase(options) {
	options = options || {};
	const dbName = String(options.dbName || 'Trellis_database.sqlite');
	const sourceRelPath = String(options.seedRelPath || TRELLIS_BUILT_IN_DB_REL_PATH);
	const sourcePath = path.resolve(__dirname, sourceRelPath);
	if (!fs.existsSync(sourcePath)) throw new Error(`Built-in Trellis database missing: ${sourcePath}`);
	const dbPath = getLiveDbPath(dbName);
	const parent = path.dirname(dbPath);
	if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
	closeRegisteredDbsForPath(dbPath);
	const backupPath = fs.existsSync(dbPath) ? trellisDbBackupPath(dbPath) : null;
	try {
		if (backupPath) fs.copyFileSync(dbPath, backupPath);
		fs.copyFileSync(sourcePath, dbPath);
		return { dbPath, backupPath, sourcePath };
	} catch (e) {
		try {
			if (backupPath && fs.existsSync(backupPath) && fs.existsSync(dbPath)) {
				fs.copyFileSync(backupPath, dbPath);
			}
		} catch (_) { }
		throw e;
	}
}

function readTrellisDatabaseInfo(dbPath) {
	const info = { path: dbPath, exists: fs.existsSync(dbPath), sizeBytes: 0, modifiedAt: null, plantCount: 0, visiblePlantCount: 0 }; // CHANGE: restore UI needs lightweight DB metadata.
	if (!info.exists) return info;
	try {
		const stat = fs.statSync(dbPath);
		info.sizeBytes = stat.size;
		info.modifiedAt = stat.mtime.toISOString();
		const db = new Database(dbPath, { readonly: true, fileMustExist: true });
		try {
			info.plantCount = Number(db.prepare('SELECT COUNT(*) AS count FROM Plants').get().count || 0);
			info.visiblePlantCount = Number(db.prepare('SELECT COUNT(*) AS count FROM Plants WHERE abbr IS NOT NULL').get().count || 0);
		}
		finally {
			db.close();
		}
	}
	catch (e) {
		info.error = e && e.message ? e.message : String(e);
	}
	return info;
}

function getTrellisDatabaseInfo(options) {
	options = options || {};
	const dbName = String(options.dbName || 'Trellis_database.sqlite');
	const sourceRelPath = String(options.seedRelPath || TRELLIS_BUILT_IN_DB_REL_PATH);
	const sourcePath = path.resolve(__dirname, sourceRelPath);
	const livePath = getLiveDbPath(dbName);
	return {
		live: readTrellisDatabaseInfo(livePath),
		builtin: readTrellisDatabaseInfo(sourcePath)
	};
}

// (ADD): validate DB path and allow read-only open by default
function validateDbPath(dbPath) {
	const abs = path.resolve(dbPath);
	if (abs.startsWith(appBaseDir)) throw new Error('DB path not permitted');
	if (!fs.existsSync(abs)) throw new Error('DB file not found');
	return abs;
}

const disableUpdate = disUpPkg() ||
	process.env.DRAWIO_DISABLE_UPDATE === 'true' ||
	process.argv.indexOf('--disable-update') !== -1 ||
	fs.existsSync('/.flatpak-info'); //This file indicates running in flatpak sandbox
const silentUpdate = !disableUpdate && (process.env.DRAWIO_SILENT_UPDATE === 'true' ||
	process.argv.indexOf('--silent-update') !== -1);
autoUpdater.logger = log
autoUpdater.logger.transports.file.level = 'info'; // CHANGE: preserve shutdown phases and owned-child outcomes in the existing rotating log.
autoUpdater.logger.transports.console.level = 'error'
autoUpdater.autoDownload = silentUpdate
autoUpdater.autoInstallOnAppQuit = silentUpdate
const trellisReleaseUrl = 'https://github.com/Benjamin-Elon/trellis-studio'; // Trellis release: single source for public release links.
const trellisSupportUrl = `${trellisReleaseUrl}/issues`; // Trellis release: keep support links on the fork.
const trellisReleasesApiUrl = 'https://api.github.com/repos/Benjamin-Elon/trellis-studio/releases?per_page=10';
const trellisReleasesTimeoutMs = 15000;
const trellisUpdateProgressTitle = 'Trellis OS Update'; // CHANGE: Trellis OS branding.
const trellisUpdateProgressText = 'Downloading Trellis OS update...'; // CHANGE: Trellis OS branding.
let trellisUpdateDownloadInProgress = false;
let trellisUpdateProgressBar = null;
let trellisUpdateProgressIsDeterminate = false;

function canCheckForUpdates() {
	return !disableUpdate && app.isPackaged; // Trellis release: dev runs do not have packaged updater metadata.
}

function checkForTrellisUpdates() {
	if (!canCheckForUpdates()) return false; // Trellis release: avoid missing app-update.yml errors outside packaged builds.

	try {
		const updateCheck = autoUpdater.checkForUpdates();

		if (updateCheck != null && typeof updateCheck.catch === 'function') {
			updateCheck.catch(e => log.error('@update-check-error@\n', e));
		}

		return true;
	}
	catch (e) {
		log.error('@update-check-error@\n', e);
		return false;
	}
}

function roundTrellisUpdatePercent(percent) {
	if (typeof percent !== 'number' || !Number.isFinite(percent)) return null;

	return Math.max(0, Math.min(100, Math.round(percent * 100) / 100));
}

function formatTrellisUpdateSpeed(bytesPerSecond) {
	if (typeof bytesPerSecond !== 'number' || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '';

	const kilobytesPerSecond = bytesPerSecond / 1024;

	if (kilobytesPerSecond < 1024) {
		return `${Math.round(kilobytesPerSecond * 10) / 10} KB/s`;
	}

	return `${Math.round((kilobytesPerSecond / 1024) * 10) / 10} MB/s`;
}

function formatTrellisDownloadDetail(progressInfo) {
	const percent = roundTrellisUpdatePercent(progressInfo?.percent);

	if (percent == null) return 'Downloading update...';

	const speed = formatTrellisUpdateSpeed(progressInfo?.bytesPerSecond);

	return speed ? `${percent}% downloaded - ${speed}` : `${percent}% downloaded`;
}

function createTrellisUpdateProgressBar(options = {}) {
	return new ProgressBar({
		indeterminate: options.indeterminate !== false,
		initialValue: options.initialValue || 0,
		closeOnComplete: false,
		title: trellisUpdateProgressTitle,
		text: options.text || trellisUpdateProgressText,
		detail: options.detail || 'Downloading update...',
		browserWindow: {
			closable: options.closable === true,
		},
	});
}

function closeTrellisUpdateProgressBar() {
	if (trellisUpdateProgressBar == null) return;

	try {
		trellisUpdateProgressBar.close();
	}
	catch (e) {
		log.error('@update-progress-close-error@\n', e);
	}

	trellisUpdateProgressBar = null;
	trellisUpdateProgressIsDeterminate = false;
}

function beginTrellisUpdateDownload() {
	closeTrellisUpdateProgressBar();
	trellisUpdateDownloadInProgress = true;
	trellisUpdateProgressIsDeterminate = false;
	trellisUpdateProgressBar = createTrellisUpdateProgressBar();
}

function showTrellisUpdateDownloadError(e) {
	if (!trellisUpdateDownloadInProgress) return;

	const message = e && e.message ? e.message : e;
	trellisUpdateDownloadInProgress = false;
	closeTrellisUpdateProgressBar();
	trellisUpdateProgressBar = createTrellisUpdateProgressBar({
		closable: true,
		indeterminate: false,
		initialValue: 100,
		text: 'Trellis OS update failed.', // CHANGE: Trellis OS branding.
		detail: `Error occurred while downloading update. ${message}`,
	});
}

function showTrellisUpdateDownloadProgress(progressInfo) {
	if (!trellisUpdateDownloadInProgress || silentUpdate) return;

	const percent = roundTrellisUpdatePercent(progressInfo?.percent);

	if (percent == null) return;

	const detail = formatTrellisDownloadDetail(progressInfo);

	if (!trellisUpdateProgressIsDeterminate) {
		closeTrellisUpdateProgressBar();
		trellisUpdateProgressIsDeterminate = true;
		trellisUpdateProgressBar = createTrellisUpdateProgressBar({
			indeterminate: false,
			initialValue: percent,
			detail,
		});
		const progressBar = trellisUpdateProgressBar;

		progressBar.on('ready', function () {
			if (trellisUpdateProgressBar !== progressBar || !trellisUpdateDownloadInProgress) return;

			progressBar.detail = detail;
			progressBar.value = percent;
		});
		return;
	}

	trellisUpdateProgressBar.detail = detail;
	trellisUpdateProgressBar.value = percent;
}

function finishTrellisUpdateDownload() {
	trellisUpdateDownloadInProgress = false;
	closeTrellisUpdateProgressBar();
}

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

//Command option to disable hardware acceleration
if (process.argv.indexOf('--disable-acceleration') !== -1) {
	app.disableHardwareAcceleration();
}

// Configure context menu for text fields
contextMenu({
	showCopyImage: true,
	showSaveImage: true,
	showSaveImageAs: true,
	showLookUpSelection: false,
	showSearchWithGoogle: false,
	showCopyLink: false,
	showSelectAll: true,
	append: (defaultActions, params, browserWindow) => [
		{
			label: 'Paste and Match Style',
			// Only show this item when there's a text in the clipboard
			visible: clipboard.availableFormats().includes('text/plain'),
			click: () => {
				// Execute the paste command in the focused window
				browserWindow.webContents.pasteAndMatchStyle();
			}
		}
	]
});

const __DEV__ = process.env.DRAWIO_ENV === 'dev'

let windowsRegistry = []
let cmdQPressed = false
const lifecycle = createLifecycleCoordinator({ // NEW
	getWindows: () => windowsRegistry.slice(), prepare: prepareWindowClose, validate: validateWindowClose, release: releaseWindowClose, discard: discardWindowDraft, // NEW
	commit: async (win, approval) => { await discardWindowDraft(win, approval); if (!win.isDestroyed()) win.destroy(); }, // NEW
	destroy: win => { if (!win.isDestroyed()) win.destroy(); }, stop: stopTrellisResources, exit: () => app.quit(), // NEW
	onState: (state, reason) => { cmdQPressed = state === 'stopping services' || state === 'ready to exit'; log.info('Trellis lifecycle:', state, reason); }, // NEW
	onError: error => { log.error('Trellis shutdown:', error.message); if (lifecycle.acceptsWork) dialog.showErrorBox('Trellis could not close', error.message); } // NEW
}); // NEW
let closeRequestSequence = 0; // NEW
let firstWinLoaded = false
let firstWinFilePath = null
const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'
let enableSpellCheck = store != null ? store.get('enableSpellCheck') : false;
enableSpellCheck = enableSpellCheck != null ? enableSpellCheck : isMac;
let enableStoreBkp = store != null ? (store.get('enableStoreBkp') != null ? store.get('enableStoreBkp') : true) : false;
let dialogOpen = false;
let enablePlugins = true;
const codeDir = path.join(__dirname, '/../../drawio/src/main/webapp');
const getTrellisSplashBackground = createTrellisSplashBackgroundSelector(
	path.join(codeDir, 'images', 'trellis-splash'));
const codeUrl = url.pathToFileURL(codeDir).href.replace(/\/.\:\//, str => str.toUpperCase()); // Fix for windows drive letter
// Production app uses asar archive, so we need to go up two more level. It's extra cautious since asar is read-only anyway.
const appBaseDir = path.join(__dirname, __dirname.endsWith(path.join('resources', 'app.asar', 'src', 'main')) ?
	'/../../../../' : '/../../');
let appZoom = 1;
// Disabled by default
let isGoogleFontsEnabled = store != null ? (store.get('isGoogleFontsEnabled') != null ? store.get('isGoogleFontsEnabled') : false) : false;

//Read config file
var queryObj = {
	'dev': __DEV__ ? 1 : 0,
	'test': __DEV__ ? 1 : 0,
	'gapi': 0,
	'db': 0,
	'od': 0,
	'gh': 0,
	'gl': 0,
	'tr': 0,
	'browser': 0,
	'picker': 0,
	'mode': 'device',
	'export': 'https://convert.diagrams.net/node/export',
	'disableUpdate': disableUpdate ? 1 : 0,
	'canCheckForUpdates': canCheckForUpdates() ? 1 : 0,
	'enableSpellCheck': enableSpellCheck ? 1 : 0,
	'enableStoreBkp': enableStoreBkp ? 1 : 0,
	'isGoogleFontsEnabled': isGoogleFontsEnabled ? 1 : 0
};

try {
	if (fs.existsSync(process.cwd() + '/urlParams.json')) {
		let urlParams = JSON.parse(fs.readFileSync(process.cwd() + '/urlParams.json'));

		for (var param in urlParams) {
			queryObj[param] = urlParams[param];
		}
	}
}
catch (e) {
	console.log('Error in urlParams.json file: ' + e.message);
}

// Trying sandboxing the renderer for more protection
//app.enableSandbox(); // This maybe the reason snap stopped working

// Only allow request from the app code itself
function validateSender(frame) {
	try { return !!frame && !frame.isDestroyed?.() && typeof frame.url === 'string' && frame.url.replace(/\/.\:\//, str => str.toUpperCase()).startsWith(codeUrl); } // CHANGE: disposed IPC frames have no usable URL.
	catch (_) { return false; } // NEW
}

function isWithinDisplayBounds(pos) {
	const displays = screen.getAllDisplays();

	return displays.reduce((result, display) => {
		const area = display.workArea
		return (
			result ||
			(pos.x >= area.x &&
				pos.y >= area.y &&
				pos.x < area.x + area.width &&
				pos.y < area.y + area.height)
		)
	}, false)
}

function createWindow(opt = {}) {
	if (!lifecycle.acceptsWindows) return null; // NEW: confirmations and committed shutdown cannot acquire new windows.
	let lastWinSizeStr = (store && store.get('lastWinSize')) || '1200,800,0,0,false,false';
	let lastWinSize = lastWinSizeStr ? lastWinSizeStr.split(',') : [1200, 800];

	// TODO On some Mac OS, double click the titlebar set incorrect window size
	if (lastWinSize[0] < 500) {
		lastWinSize[0] = 500;
	}

	if (lastWinSize[1] < 500) {
		lastWinSize[1] = 500;
	}

	let options = Object.assign(
		{
			backgroundColor: '#FFF',
			width: parseInt(lastWinSize[0]),
			height: parseInt(lastWinSize[1]),
			icon: `${codeDir}/images/window-icon.png`, // Trellis change: force the small-design mark for title-bar and taskbar placements.
			webviewTag: false,
			webSecurity: true,
			webPreferences: {
				preload: `${__dirname}/electron-preload.js`,
				spellcheck: enableSpellCheck,
				contextIsolation: true,
				disableBlinkFeatures: 'Auxclick' // Is this needed?
			}
		}, opt)

	if (lastWinSize[2] != null) {
		options.x = parseInt(lastWinSize[2]);
	}

	if (lastWinSize[3] != null) {
		options.y = parseInt(lastWinSize[3]);
	}

	if (!isWithinDisplayBounds(options)) {
		options.x = null;
		options.y = null;
	}

	let mainWindow = new BrowserWindow(options)
	const contentsId = mainWindow.webContents.id; // NEW: the getter is invalid after Electron destroys the window.
	windowsRegistry.push(mainWindow)

	if (lastWinSize[4] === 'true') {
		mainWindow.maximize()
	}

	if (lastWinSize[5] === 'true') {
		mainWindow.setFullScreen(true);
	}

	if (__DEV__) {
		console.log('createWindow', opt)
	}

	//Cannot be read before app is ready
	queryObj['appLang'] = app.getLocale();

	let ourl = url.format(
		{
			pathname: `${codeDir}/index.html`,
			protocol: 'file:',
			query: queryObj,
			slashes: true
		})

	mainWindow.loadURL(ourl)

	if (__DEV__) {
		mainWindow.webContents.openDevTools()
	}

	const openDevTools = e => { // CHANGE: this listener belongs to exactly one live window.
		if (mainWindow.isDestroyed() || e.sender.id !== contentsId || !validateSender(e.senderFrame)) return; // NEW
		mainWindow.webContents.openDevTools(); // CHANGE
	}; // NEW
	ipcMain.on('openDevTools', openDevTools); // CHANGE

	function rememberWinSize(win) {
		if (store != null) {
			const size = win.getSize();
			const pos = win.getPosition();
			store.set('lastWinSize', size[0] + ',' + size[1] + ',' + pos[0] + ',' + pos[1] + ',' + win.isMaximized() + ',' + win.isFullScreen());
		}
	}

	mainWindow.on('maximize', function () {
		if (canNotifyWindow(mainWindow)) mainWindow.webContents.send('maximize'); // CHANGE: late native events cannot target a disposed renderer.
	});

	mainWindow.on('unmaximize', function () {
		if (canNotifyWindow(mainWindow)) mainWindow.webContents.send('unmaximize'); // CHANGE
	});

	mainWindow.on('resize', function () {
		if (canNotifyWindow(mainWindow)) mainWindow.webContents.send('resize'); // CHANGE
	});

	mainWindow.on('close', event => { // CHANGE: the coordinator owns confirmation and destruction.
		if (lifecycle.state === 'ready to exit') return; // NEW
		event.preventDefault(); // NEW
		if (lifecycle.acceptsWindows) { // CHANGE
			try { rememberWinSize(mainWindow); } catch (error) { log.warn('Window preferences:', error.message); } // NEW: a preference-write failure must not prevent document confirmation.
			void lifecycle.requestClose(mainWindow); // NEW
		} // NEW
	}); // CHANGE
	mainWindow.on('closed', () => { // CHANGE: cleanup never reads a destroyed webContents getter.
		cleanupClosedWindow({ window: mainWindow, contentsId, windows: windowsRegistry, watches: fileWatchRegistry, paths: sharingWindowPaths, // NEW
			services: [sharingService, ...identityTransports.values()].filter(Boolean), disposers: [() => ipcMain.removeListener('openDevTools', openDevTools)], onError: error => log.warn('Window cleanup:', error.message) }); // NEW
	}); // CHANGE

	return mainWindow
}

function isPluginsEnabled() {
	return enablePlugins;
}
// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
	// AFTER app.whenReady
	const pluginFolder = path.join(getAppDataFolder(), 'plugins');
	try {
		if (!fs.existsSync(pluginFolder)) {
			fs.mkdirSync(pluginFolder, { recursive: true });
		}
	} catch (e) {
		console.error('Plugin folder creation failed:', e);
	}

	// (ADD) Always set enablePlugins = true
	enablePlugins = true;

	// Enforce our CSP on all contents
	session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				// Replace the first sha with the one of the current version shown in the console log (the second one is for the second script block which is rarely changed)
				// 3rd sha is for electron-progressbar
				'Content-Security-Policy': ['default-src \'self\'; script-src \'self\' \'sha256-f6cHSTUnCvbQqwa6rKcbWIpgN9dLl0ROfpEKTQUQPr8=\' \'sha256-6g514VrT/cZFZltSaKxIVNFF46+MFaTSDTPB8WfYK+c=\' \'sha256-ZQ86kVKhLmcnklYAnUksoyZaLkv7vvOG9cc/hBJAEuQ=\'; connect-src \'self\'' +
					(isGoogleFontsEnabled ? ' https://fonts.googleapis.com https://fonts.gstatic.com' : '') + '; img-src * data:; media-src *; font-src *; frame-src \'none\'; style-src \'self\' \'unsafe-inline\'' +
					(isGoogleFontsEnabled ? ' https://fonts.googleapis.com' : '') + '; base-uri \'none\';child-src \'self\';object-src \'none\';']
			}
		})
	});

	const pluginsCodeUrl = url.pathToFileURL(path.join(getAppDataFolder(), '/plugins/')).href.replace(/\/.\:\//, str => str.toUpperCase());

	// Enforce loading file only from our app directory
	session.defaultSession.webRequest.onBeforeRequest({ urls: ['file://*'] }, async (details, callback) => { // CHANGE: only registered shared images may load outside application directories.
		const url = details.url.replace(/\/.\:\//, str => str.toUpperCase());
		try {
			await assertSharingFileAccess(fileURLToPath(details.url), path.join(app.getPath('userData'), 'trellis-sharing')); // NEW: private files cannot be fetched through a plugin-directory alias.
			await assertSharingFileAccess(fileURLToPath(details.url), path.join(app.getPath('userData'), 'trellis-identities')); // NEW: encrypted identity credentials remain inaccessible through file requests too.
			if (url.startsWith(codeUrl) || isPluginsEnabled() && url.startsWith(pluginsCodeUrl)) { callback({}); return; }
			if (details.resourceType === 'image') { // CHANGE: registered assets from identity gardens use the same narrow allowlist.
				for (const service of [sharingService, ...identityTransports.values()].filter(Boolean)) if (await service.isManagedAssetRequest(details.webContentsId, details.url)) { callback({}); return; } // NEW
			} // NEW
			console.log('Blocked loading file from ' + details.url, url, codeUrl, pluginsCodeUrl);
			callback({ cancel: true });
		} catch (_) { callback({ cancel: true }); } // CHANGE: fail closed on path validation errors.
	});

	ipcMain.on('newfile', (e, arg) => {
		if (!validateSender(e.senderFrame)) return null;

		let opts = {};

		if (arg) {
			if (arg.width) {
				opts.width = arg.width;
			}

			if (arg.height) {
				opts.height = arg.height;
			}
		}

		createWindow(opts);
	})

	let argv = process.argv

	// https://github.com/electron/electron/issues/4690#issuecomment-217435222
	if (process.defaultApp != true) {
		argv.unshift(null)
	}

	var validFormatRegExp = /^(pdf|svg|png|jpeg|jpg|xml)$/;
	var themeRegExp = /^(dark|light)$/;
	var linkTargetRegExp = /^(auto|new-win|same-win)$/;

	function argsRange(val) {
		return val.split('..').map(n => parseInt(n, 10) - 1);
	}

	try {
		program.allowExcessArguments();
		program
			.version(app.getVersion())
			.usage('[options] <input file/folder>')
			.argument('[input file/folder]', 'input diagram file or a folder with diagram files') // CHANGE
			.allowUnknownOption() //-h and --help are considered unknown!!
			.option('-c, --create', 'creates a new empty file if no file is passed')
			.option('--trellis-background', 'start managed canvas syncing in the tray') // NEW
			.option('-k, --check', 'does not overwrite existing files')
			.option('-x, --export', 'export the input file/folder based on the given options')
			.option('-r, --recursive', 'for a folder input, recursively convert all files in sub-folders also')
			.option('-o, --output <output file/folder>', 'specify the output file/folder. If omitted, the input file name is used for output with the specified format as extension')
			.option('-f, --format <format>',
				'if output file name extension is specified, this option is ignored (file type is determined from output extension, possible export formats are pdf, png, jpg, svg, and xml)',
				validFormatRegExp, 'pdf')
			.option('-q, --quality <quality>',
				'output image quality for JPEG (default: 90)', parseInt)
			.option('-t, --transparent',
				'set transparent background for PNG')
			.option('-e, --embed-diagram',
				'includes a copy of the diagram (for PNG, SVG and PDF formats only)')
			.option('--embed-svg-images',
				'Embed Images in SVG file (for SVG format only)')
			.option('--embed-svg-fonts <true/false>',
				'Embed Fonts in SVG file (for SVG format only). Default is true', function (x) { return x === 'true' }, true)
			.option('-b, --border <border>',
				'sets the border width around the diagram (default: 0)', parseInt)
			.option('-s, --scale <scale>',
				'scales the diagram size', parseFloat)
			.option('--width <width>',
				'fits the generated image/pdf into the specified width, preserves aspect ratio.', parseInt)
			.option('--height <height>',
				'fits the generated image/pdf into the specified height, preserves aspect ratio.', parseInt)
			.option('--crop',
				'crops PDF to diagram size')
			.option('-a, --all-pages',
				'export all pages (for PDF format only)')
			.option('-p, --page-index <pageIndex>',
				'selects a specific page (1-based); if not specified and the format is an image, the first page is selected', (i) => parseInt(i) - 1)
			.option('-l, --layers <comma separated layer indexes>',
				'selects which layers to export (applies to all pages), if not specified, all layers are selected')
			.option('-g, --page-range <from>..<to>',
				'selects a page range (1-based, for PDF format only)', argsRange)
			.option('-u, --uncompressed',
				'Uncompressed XML output (for XML format only)')
			.option('-z, --zoom <zoom>',
				'scales the application interface', parseFloat)
			.option('--svg-theme <theme>',
				'Theme of the exported SVG image (dark, light, auto [default])', themeRegExp, 'auto')
			.option('--svg-links-target <target>',
				'Target of links in the exported SVG image (auto [default], new-win, same-win)', linkTargetRegExp, 'auto')
			.option('--enable-plugins',
				'Enable Plugins')
			.parse(argv)
	}
	catch (e) {
		//On parse error, return [exit and commander will show the error message]
		return;
	}

	var options = program.opts();
	enablePlugins = true

	if (options.zoom != null) {
		appZoom = options.zoom;
	}

	//Start export mode?
	if (options.export) {
		var dummyWin = new BrowserWindow({
			show: false,
			webPreferences: {
				preload: `${__dirname}/electron-preload.js`,
				contextIsolation: true,
				disableBlinkFeatures: 'Auxclick' // Is this needed?
			}
		});

		windowsRegistry.push(dummyWin);

		/*ipcMain.on('log', function(event, msg)
		{
			console.log(msg);
		});*/

		try {
			//Prepare arguments and confirm it's valid
			var format = null;
			var outType = null;

			//Format & Output
			if (options.output) {
				try {
					var outStat = fs.statSync(options.output);

					if (outStat.isDirectory()) {
						outType = { isDir: true };
					}
					else //If we can get file stat, then it exists
					{
						throw 'Error: Output file already exists';
					}
				}
				catch (e) //on error, file doesn't exist and it is not a dir
				{
					outType = { isFile: true };

					format = path.extname(options.output).substr(1);

					if (!validFormatRegExp.test(format)) {
						format = null;
					}
				}
			}

			if (format == null) {
				format = options.format;
			}

			let from = null, to = null;

			if (options.pageIndex != null && options.pageIndex >= 0) {
				from = options.pageIndex;
				to = options.pageIndex;
				options.allPages = false;
			}
			else if (options.pageRange && options.pageRange.length == 2) {
				const [rangeFrom, rangeTo] = options.pageRange;

				if (rangeFrom >= 0 && rangeTo >= 0 && rangeFrom <= rangeTo) {
					from = rangeFrom;
					to = rangeTo;
					options.allPages = false;
				}
				else {
					console.error('Invalid page range: must be non-negative and from ≤ to');
					process.exit(1);
				}
			}

			var expArgs = {
				format: format,
				w: options.width > 0 ? options.width : null,
				h: options.height > 0 ? options.height : null,
				bg: options.transparent ? 'none' : '#ffffff',
				from: from,
				to: to,
				allPages: format == 'pdf' && options.allPages,
				scale: (options.scale || 1),
				embedXml: options.embedDiagram ? '1' : '0',
				embedImages: options.embedSvgImages ? '1' : '0',
				embedFonts: options.embedSvgFonts ? '1' : '0',
				jpegQuality: options.quality,
				uncompressed: options.uncompressed,
				theme: options.svgTheme,
				linkTarget: options.svgLinksTarget,
				crop: (options.crop && format == 'pdf') ? '1' : '0'
			};

			options.border = options.border > 0 ? options.border : 0;

			if (format === 'pdf') {
				expArgs.pageMargin = options.border;
			}
			else {
				expArgs.border = options.border;
			}

			if (options.layers) {
				expArgs.extras = JSON.stringify({ layers: options.layers.split(',') });
			}

			var paths = program.args;

			// Remove --no-sandbox arg from the paths
			if (Array.isArray(paths)) {
				paths = paths.filter(function (path) { return path != null && path != '--no-sandbox'; });
			}

			// If a file is passed 
			if (paths !== undefined && paths[0] != null) {
				var inStat = null;

				try {
					inStat = fs.statSync(paths[0]);
				}
				catch (e) {
					throw 'Error: input file/directory not found';
				}

				var files = [];

				function addDirectoryFiles(dir, isRecursive) {
					fs.readdirSync(dir).forEach(function (file) {
						var filePath = path.join(dir, file);
						var stat = fs.statSync(filePath);

						if (stat.isFile() && path.basename(filePath).charAt(0) != '.') {
							files.push(filePath);
						}
						if (stat.isDirectory() && isRecursive) {
							addDirectoryFiles(filePath, isRecursive)
						}
					});
				}

				if (inStat.isFile()) {
					files.push(paths[0]);
				}
				else if (inStat.isDirectory()) {
					addDirectoryFiles(paths[0], options.recursive);
				}

				if (files.length > 0) {
					var fileIndex = 0;

					function processOneFile() {
						var curFile = files[fileIndex];

						try {
							var ext = path.extname(curFile);

							let fileContent = fs.readFileSync(curFile, ext === '.png' || ext === '.vsdx' ? null : 'utf-8');

							if (ext === '.vsdx') {
								dummyWin.loadURL(`file://${codeDir}/vsdxImporter.html`);

								const contents = dummyWin.webContents;

								contents.on('did-finish-load', function () {
									contents.send('import', fileContent);

									ipcMain.once('import-success', function (e, xml) {
										if (!validateSender(e.senderFrame)) return null;

										expArgs.xml = xml;
										startExport();
									});

									ipcMain.once('import-error', function (e) {
										if (!validateSender(e.senderFrame)) return null;

										console.error('Error: cannot import VSDX file: ' + curFile);
										next();
									});
								});
							}
							else {
								if (ext === '.csv') {
									expArgs.csv = fileContent;
								}
								else if (ext === '.png') {
									expArgs.xmlEncoded = true;
									expArgs.xml = Buffer.from(fileContent).toString('base64');
								}
								else {
									expArgs.xml = fileContent;
								}

								startExport();
							}

							function next() {
								fileIndex++;

								if (fileIndex < files.length) {
									processOneFile();
								}
								else {
									cmdQPressed = true;
									dummyWin.destroy();
								}
							};

							function startExport() {
								var mockEvent = {
									reply: function (msg, data) {
										try {
											if (data == null || data.length == 0) {
												console.error('Error: Export failed: ' + curFile);
											}
											else if (msg == 'export-success') {
												var outFileName = null;

												if (outType != null) {
													if (outType.isDir) {
														outFileName = path.join(options.output, path.basename(curFile,
															path.extname(curFile))) + '.' + format;
													}
													else {
														outFileName = options.output;
													}
												}
												else if (inStat.isFile()) {
													outFileName = path.join(path.dirname(paths[0]), path.basename(paths[0],
														path.extname(paths[0]))) + '.' + format;

												}
												else //dir
												{
													outFileName = path.join(path.dirname(curFile), path.basename(curFile,
														path.extname(curFile))) + '.' + format;
												}

												try {
													var counter = 0;
													var realFileName = outFileName;

													if (program.rawArgs.indexOf('-k') > -1 || program.rawArgs.indexOf('--check') > -1) {
														while (fs.existsSync(realFileName)) {
															counter++;
															realFileName = path.join(path.dirname(outFileName), path.basename(outFileName,
																path.extname(outFileName))) + '-' + counter + path.extname(outFileName);
														}
													}

													fs.writeFileSync(realFileName, data, null, { flag: 'wx' });
													console.log(curFile + ' -> ' + realFileName);
												}
												catch (e) {
													console.error('Error writing to file: ' + outFileName);
												}
											}
											else {
												console.error('Error: ' + data + ': ' + curFile);
											}

											next();
										}
										finally {
											mockEvent.finalize();
										}
									}
								};

								exportDiagram(mockEvent, expArgs, true);
							};
						}
						catch (e) {
							console.error('Error reading file: ' + curFile);
							next();
						}
					}

					processOneFile();
				}
				else {
					throw 'Error: input file/directory not found or directory is empty';
				}
			}
			else {
				throw 'Error: An input file must be specified';
			}
		}
		catch (e) {
			console.error(e);

			cmdQPressed = true;
			dummyWin.destroy();
		}

		return;
	}
	else if (program.rawArgs.indexOf('-h') > -1 || program.rawArgs.indexOf('--help') > -1 || program.rawArgs.indexOf('-V') > -1 || program.rawArgs.indexOf('--version') > -1) //To prevent execution when help/version arg is used
	{
		app.quit();
		return;
	}

	//Prevent multiple instances of the application (casuses issues with configuration)
	const gotTheLock = app.requestSingleInstanceLock()

	if (!gotTheLock) {
		app.quit()
		return; // NEW: the second instance must never start another synchronization process.
	}
	else {
		app.on('second-instance', (event, commandLine, workingDirectory) => {
			// Creating a new window while a save/open dialog is open crashes the app
			if (dialogOpen || !lifecycle.acceptsWindows) return; // CHANGE: do not reopen during Quit.

			//Create another window
			let win = createWindow()

			bindWindowLoad(win, () => { // CHANGE: only this window's renderer may complete its load.
				const potFile = commandLine[commandLine.length - 1]; // NEW
				if (potFile && fs.existsSync(potFile)) win.webContents.send('args-obj', { args: [potFile] }); // NEW
			}); // CHANGE
		})
	}

	const background = initializeBackgroundSync(); // CHANGE: resume installed identity transports while credentials remain locked.
	if (options.trellisBackground && (!program.args || !program.args.length)) { // CHANGE
		background.then(async () => { // NEW
			await ensureSharingTray(); // NEW
			if (!lifecycle.acceptsWindows) return; // NEW
			if (hasConfiguredSync() && !sharingTray) await quitWithoutTray(); // NEW
			else if (!hasConfiguredSync()) await lifecycle.requestQuit('background startup without configured sync'); // NEW
		}).catch(error => { log.error('Background startup:', error.message); void quitWithoutTray(); }); // NEW
		return; // CHANGE
	} // CHANGE
	background.catch(error => log.warn('Background startup:', error.message)); // CHANGE
	let win = createWindow()

	bindWindowLoad(win, () => { // CHANGE
		if (firstWinFilePath != null) { program.args = program.args || []; program.args.push(firstWinFilePath); } // NEW
		firstWinLoaded = true; win.webContents.send('args-obj', { args: program.args, create: options.create }); // NEW
	}); // CHANGE

	function toggleSpellCheck(e) {
		if (e != null && !validateSender(e.senderFrame)) return null;

		if (store != null) {
			enableSpellCheck = !enableSpellCheck;
			store.set('enableSpellCheck', enableSpellCheck);
		}
	};

	ipcMain.on('toggleSpellCheck', toggleSpellCheck);

	function toggleStoreBkp(e) {
		if (e != null && !validateSender(e.senderFrame)) return null;

		if (store != null) {
			enableStoreBkp = !enableStoreBkp;
			store.set('enableStoreBkp', enableStoreBkp);
		}
	};

	ipcMain.on('toggleStoreBkp', toggleStoreBkp);

	function toggleGoogleFonts(e) {
		if (e != null && !validateSender(e.senderFrame)) return null;

		if (store != null) {
			isGoogleFontsEnabled = !isGoogleFontsEnabled;
			store.set('isGoogleFontsEnabled', isGoogleFontsEnabled);
		}
	}

	ipcMain.on('toggleGoogleFonts', toggleGoogleFonts);

	function toggleFullscreen(e) {
		if (e != null && !validateSender(e.senderFrame)) return null;

		let win = BrowserWindow.getFocusedWindow();

		if (win != null) {
			win.setFullScreen(!win.isFullScreen());
		}
	};

	ipcMain.on('toggleFullscreen', toggleFullscreen);

	let updateNoAvailAdded = false;

	function checkForUpdatesFn(e) {
		if (e != null && e.senderFrame != null &&
			!validateSender(e.senderFrame)) return null;

		if (!canCheckForUpdates()) return;

		const updateCheckStarted = checkForTrellisUpdates(); // Trellis release: use electron-builder metadata instead of a hard-coded feed.

		if (!updateCheckStarted) return;

		if (store != null) {
			store.set('dontCheckUpdates', false);
		}

		if (!updateNoAvailAdded) {
			updateNoAvailAdded = true;
			autoUpdater.on('update-not-available', (info) => {
				dialog.showMessageBox(
					{
						type: 'info',
						title: 'No updates found',
						message: 'Your application is up-to-date',
					})
			})
		}
	};

	var zoomSteps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1,
		1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

	// Zooms to the next zoom step
	function zoomInFn() {
		var zoomFactor = win.webContents.zoomFactor;
		var newZoomFactor = zoomSteps[zoomSteps.length - 1];

		for (var i = 0; i < zoomSteps.length; i++) {
			if (zoomSteps[i] - zoomFactor > 0.01) {
				newZoomFactor = zoomSteps[i];
				break;
			}
		}

		win.webContents.zoomFactor = newZoomFactor;
	};

	// Zooms to the previous zoom step
	function zoomOutFn() {
		var zoomFactor = win.webContents.zoomFactor;
		var newZoomFactor = zoomSteps[0];

		for (var i = zoomSteps.length - 1; i >= 0; i--) {
			if (zoomSteps[i] - zoomFactor < -0.01) {
				newZoomFactor = zoomSteps[i];
				break;
			}
		}

		win.webContents.zoomFactor = newZoomFactor;
	};

	// Resets the zoom factor
	function resetZoomFn() {
		win.webContents.zoomFactor = 1;
	};

	let zoomIn = {
		label: 'Zoom In',
		click: zoomInFn
	};

	let zoomOut = {
		label: 'Zoom Out',
		click: zoomOutFn
	};

	let resetZoom = {
		label: 'Actual Size',
		click: resetZoomFn
	};

	ipcMain.on('checkForUpdates', checkForUpdatesFn);
	ipcMain.on('zoomIn', zoomInFn);
	ipcMain.on('zoomOut', zoomOutFn);
	ipcMain.on('resetZoom', resetZoomFn);

	if (isMac) {
		let template = [{
			label: app.name,
			submenu: [
				{
					label: 'About ' + app.name,
					click() { shell.openExternal(trellisReleaseUrl); } // Trellis release: point About to this project.
				},
				{
					label: 'Support',
					click() { shell.openExternal(trellisSupportUrl); } // Trellis release: point Support to this project.
				},
				resetZoom,
				zoomIn,
				zoomOut,
				{ type: 'separator' },
				{ role: 'hide' },
				{ role: 'hideothers' },
				{ role: 'unhide' },
				{ type: 'separator' },
				{ role: 'quit' }
			]
		}, {
			label: 'Edit',
			submenu: [
				{ role: 'undo' },
				{ role: 'redo' },
				{ type: 'separator' },
				{ role: 'cut' },
				{ role: 'copy' },
				{ role: 'paste' },
				{ role: 'pasteAndMatchStyle' },
				{ role: 'selectAll' }
			]
		}]

		const menuBar = menu.buildFromTemplate(template)
		menu.setApplicationMenu(menuBar)
	}
	else //hide  menubar in win/linux
	{
		menu.setApplicationMenu(null)
	}

	if (store == null || (!disableUpdate && !store.get('dontCheckUpdates'))) {
		checkForTrellisUpdates() // Trellis release: packaged builds use generated GitHub updater metadata.
	}
})

/** Last-window close remains reachable in the tray, or exits with one explanation. */ // NEW
app.on('window-all-closed', () => { // CHANGE
	if (!lifecycle.acceptsWindows) return; // NEW
	if (cmdQPressed) { void lifecycle.requestQuit('command-line completion'); return; } // NEW: completed CLI exports must not start background sharing.
	void handleLastWindowClosed(); // NEW
}); // CHANGE
async function handleLastWindowClosed() { // NEW
	await initializeBackgroundSync().catch(error => log.warn('Background sync:', error.message)); // NEW
	if (!lifecycle.acceptsWindows || windowsRegistry.length) return; // NEW
	await ensureSharingTray(); // NEW
	const policy = lastWindowPolicy({ platform: process.platform, configuredSync: hasConfiguredSync(), trayAvailable: !!sharingTray }); // NEW
	if (policy === 'explain and quit') await quitWithoutTray(); // NEW
	else if (policy === 'quit') await lifecycle.requestQuit('last window'); // NEW
} // NEW

app.on('activate', function () {
	if (__DEV__) {
		console.log('app on activate', windowsRegistry.length)
	}

	// On OS X it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
	if (windowsRegistry.length === 0 && lifecycle.acceptsWindows) { // CHANGE
		createWindow()
	}
})

app.on('will-finish-launching', function () {
	app.on("open-file", function (event, filePath) {
		event.preventDefault();
		// Creating a new window while a save/open dialog is open crashes the app
		if (dialogOpen || !lifecycle.acceptsWindows) return; // CHANGE: do not reopen during Quit.

		if (firstWinLoaded) {
			let win = createWindow();

			bindWindowLoad(win, () => win.webContents.send('args-obj', { args: [filePath] })); // CHANGE
		}
		else {
			firstWinFilePath = filePath
		}
	});
});

app.on('web-contents-created', (event, contents) => {
	// Disable navigation
	contents.on('will-navigate', (event, navigationUrl) => {
		event.preventDefault()
	})

	// Limit creation of new windows (we also override window.open)
	contents.setWindowOpenHandler(({ url }) => {
		// We allow external absolute URLs to be open externally (check openExternal for details) and also empty windows (url -> about:blank)
		if (url.startsWith('about:blank')) {
			return {
				action: 'allow',
				overrideBrowserWindowOptions: {
					fullscreenable: false,
					webPreferences: {
						contextIsolation: true
					}
				}
			}
		}
		else if (!openExternal(url)) {
			return { action: 'deny' }
		}
	})

	// Disable all webviews
	contents.on('will-attach-webview', (event, webPreferences, params) => {
		event.preventDefault()
	})
})

autoUpdater.on('error', e => { log.error('@error@\n', e); showTrellisUpdateDownloadError(e); })

autoUpdater.on('download-progress', showTrellisUpdateDownloadProgress)

autoUpdater.on('update-downloaded', (info) => {
	if (silentUpdate || !trellisUpdateDownloadInProgress) return;

	finishTrellisUpdateDownload();

	// Ask user to update the app
	dialog.showMessageBox(
		{
			type: 'question',
			buttons: ['Install', 'Later'],
			defaultId: 0,
			message: 'A new version of ' + app.name + ' has been downloaded',
			detail: 'It will be installed the next time you restart the application',
		}).then(result => {
			if (result.response === 0) {
				void lifecycle.requestQuit('install update', () => autoUpdater.quitAndInstall()); // CHANGE: updater bypasses Electron close hooks, so approve documents first.
			}
		})
})

autoUpdater.on('update-available', (a, b) => {
	if (silentUpdate) return;
	if (trellisUpdateDownloadInProgress) return;

	dialog.showMessageBox(
		{
			type: 'question',
			buttons: ['Ok', 'Cancel', 'Don\'t Ask Again'],
			title: 'Confirm Update',
			message: 'Update available.\n\nWould you like to download and install new version?',
			detail: 'You will be prompted to install the update after download.',
		}).then(result => {
			if (result.response === 0) {
				if (trellisUpdateDownloadInProgress) return;

				beginTrellisUpdateDownload();

				try {
					const updateDownload = autoUpdater.downloadUpdate();

					if (updateDownload != null && typeof updateDownload.catch === 'function') {
						updateDownload.catch(showTrellisUpdateDownloadError);
					}
				}
				catch (e) {
					showTrellisUpdateDownloadError(e);
				}
			}
			else if (result.response === 2 && store != null) {
				//save in settings don't check for updates
				store.set('dontCheckUpdates', true)
			}
		})
})

//Pdf export
const MICRON_TO_PIXEL = 264.58 		//264.58 micron = 1 pixel
const PIXELS_PER_INCH = 100.117		// Usually it is 100 pixels per inch but this give better results
const PNG_CHUNK_IDAT = 1229209940;
const LARGE_IMAGE_AREA = 30000000;

//NOTE: Key length must not be longer than 79 bytes (not checked)
function writePngWithText(origBuff, key, text, compressed, base64encoded) {
	var isDpi = key == 'dpi';
	var inOffset = 0;
	var outOffset = 0;
	var data = text;
	var dataLen = isDpi ? 9 : key.length + data.length + 1; //we add 1 zeros with non-compressed data, for pHYs it's 2 of 4-byte-int + 1 byte

	//prepare compressed data to get its size
	if (compressed) {
		data = zlib.deflateRawSync(encodeURIComponent(text));
		dataLen = key.length + data.length + 2; //we add 2 zeros with compressed data
	}

	var outBuff = Buffer.allocUnsafe(origBuff.length + dataLen + 4); //4 is the header size "zTXt", "tEXt" or "pHYs"

	try {
		var magic1 = origBuff.readUInt32BE(inOffset);
		inOffset += 4;
		var magic2 = origBuff.readUInt32BE(inOffset);
		inOffset += 4;

		if (magic1 != 0x89504e47 && magic2 != 0x0d0a1a0a) {
			throw new Error("PNGImageDecoder0");
		}

		outBuff.writeUInt32BE(magic1, outOffset);
		outOffset += 4;
		outBuff.writeUInt32BE(magic2, outOffset);
		outOffset += 4;
	}
	catch (e) {
		log.error(e.message, { stack: e.stack });
		throw new Error("PNGImageDecoder1");
	}

	try {
		while (inOffset < origBuff.length) {
			var length = origBuff.readInt32BE(inOffset);
			inOffset += 4;
			var type = origBuff.readInt32BE(inOffset)
			inOffset += 4;

			if (type == PNG_CHUNK_IDAT) {
				// Insert zTXt chunk before IDAT chunk
				outBuff.writeInt32BE(dataLen, outOffset);
				outOffset += 4;

				var typeSignature = isDpi ? 'pHYs' : (compressed ? "zTXt" : "tEXt");
				outBuff.write(typeSignature, outOffset);

				outOffset += 4;

				if (isDpi) {
					var dpm = Math.round(parseInt(text) / 0.0254) || 3937; //One inch is equal to exactly 0.0254 meters. 3937 is 100dpi

					outBuff.writeInt32BE(dpm, outOffset);
					outBuff.writeInt32BE(dpm, outOffset + 4);
					outBuff.writeInt8(1, outOffset + 8);
					outOffset += 9;

					data = Buffer.allocUnsafe(9);
					data.writeInt32BE(dpm, 0);
					data.writeInt32BE(dpm, 4);
					data.writeInt8(1, 8);
				}
				else {
					outBuff.write(key, outOffset);
					outOffset += key.length;
					outBuff.writeInt8(0, outOffset);
					outOffset++;

					if (compressed) {
						outBuff.writeInt8(0, outOffset);
						outOffset++;
						data.copy(outBuff, outOffset);
					}
					else {
						outBuff.write(data, outOffset);
					}

					outOffset += data.length;
				}

				var crcVal = 0xffffffff;
				crcVal = crc.crcjam(typeSignature, crcVal);
				crcVal = crc.crcjam(data, crcVal);

				// CRC
				outBuff.writeInt32BE(crcVal ^ 0xffffffff, outOffset);
				outOffset += 4;

				// Writes the IDAT chunk after the zTXt
				outBuff.writeInt32BE(length, outOffset);
				outOffset += 4;
				outBuff.writeInt32BE(type, outOffset);
				outOffset += 4;

				origBuff.copy(outBuff, outOffset, inOffset);

				// Encodes the buffer using base64 if requested
				return base64encoded ? outBuff.toString('base64') : outBuff;
			}

			outBuff.writeInt32BE(length, outOffset);
			outOffset += 4;
			outBuff.writeInt32BE(type, outOffset);
			outOffset += 4;

			origBuff.copy(outBuff, outOffset, inOffset, inOffset + length + 4);// +4 to move past the crc

			inOffset += length + 4;
			outOffset += length + 4;
		}
	}
	catch (e) {
		log.error(e.message, { stack: e.stack });
		throw e;
	}
}

async function mergePdfs(pdfFiles, xml) {
	if (pdfFiles.length == 1) {
		// Converts to PDF 1.7 with compression
		const pdfDoc = await PDFDocument.load(pdfFiles[0]);
		pdfDoc.setCreator('diagrams.net');

		// KNOWN: Attachments produce smaller files but break
		// internal links in pdf-lib so using Subject for now
		if (xml != null) {
			pdfDoc.setSubject(encodeURIComponent(xml).
				replace(/\(/g, "\\(").replace(/\)/g, "\\)"));
		}

		const pdfBytes = await pdfDoc.save();

		return Buffer.from(pdfBytes);
	}

	try {
		const pdfDoc = await PDFDocument.create();
		pdfDoc.setCreator('diagrams.net');

		if (xml != null) {
			//Embed diagram XML as file attachment
			await pdfDoc.attach(Buffer.from(xml).toString('base64'), 'diagram.xml', {
				mimeType: 'application/vnd.jgraph.mxfile',
				description: 'Diagram Content'
			});
		}

		for (var i = 0; i < pdfFiles.length; i++) {
			const pdfFile = await PDFDocument.load(pdfFiles[i].buffer);
			const pages = await pdfDoc.copyPages(pdfFile, pdfFile.getPageIndices());
			pages.forEach(p => pdfDoc.addPage(p));
		}

		const pdfBytes = await pdfDoc.save();
		return Buffer.from(pdfBytes);
	}
	catch (e) {
		throw new Error('Error during PDF combination: ' + e.message);
	}
}

//TODO Use canvas to export images if math is not used to speedup export (no capturePage). Requires change to export3.html also
function exportDiagram(event, args, directFinalize) {
	if (event != null && event.senderFrame != null &&
		!validateSender(event.senderFrame)) return null;

	var browser = null;

	try {
		browser = new BrowserWindow({
			webPreferences: {
				preload: `${__dirname}/electron-preload.js`,
				backgroundThrottling: false,
				contextIsolation: true,
				disableBlinkFeatures: 'Auxclick', // Is this needed?
				offscreen: true,
			},
			show: false,
			frame: false,
			enableLargerThanScreen: true,
			transparent: args.format == 'png' && (args.bg == null || args.bg == 'none'),
			parent: windowsRegistry[0] //set parent to first opened window. Not very accurate, but useful when all visible windows are closed
		});

		browser.loadURL(`file://${codeDir}/export3.html`);

		const contents = browser.webContents;
		var from = args.from;
		var to = args.to;
		var pdfs = [];

		contents.on('did-finish-load', function () {
			//Set finalize here since it is call in the reply below
			function finalize() {
				browser.destroy();
			};

			if (directFinalize === true) {
				event.finalize = finalize;
			}
			else {
				//Destroy the window after response being received by caller
				ipcMain.once('export-finalize', finalize);
			}

			function renderingFinishHandler(e, renderInfo) {
				if (!validateSender(e.senderFrame)) return null;

				if (renderInfo == null) {
					replyToLiveFrame(event, 'export-error');
					return;
				}

				var pageCount = renderInfo.pageCount, bounds = null;
				//For some reason, Electron 9 doesn't send this object as is without stringifying. Usually when variable is external to function own scope
				try {
					bounds = JSON.parse(renderInfo.bounds);
				}
				catch (e) {
					bounds = null;
				}

				var pdfOptions = {};
				var hasError = false;

				if (bounds == null || bounds.width < 5 || bounds.height < 5) //very small page size never return from printToPDF
				{
					//A workaround to detect errors in the input file or being empty file
					hasError = true;
				}
				else {
					pdfOptions = {
						preferCSSPageSize: true,
						printBackground: true
					}
				}

				var base64encoded = args.base64 == '1';

				if (hasError) {
					replyToLiveFrame(event, 'export-error');
				}
				else if (args.format == 'png' || args.format == 'jpg' || args.format == 'jpeg') {
					//Adds an extra pixel to prevent scrollbars from showing
					var newBounds = { width: Math.ceil(bounds.width + bounds.x) + 1, height: Math.ceil(bounds.height + bounds.y) + 1 };
					browser.setBounds(newBounds);

					//TODO The browser takes sometime to show the graph (also after resize it takes some time to render)
					//	 	1 sec is most probably enough (for small images, 5 for large ones) BUT not a stable solution
					setTimeout(function () {
						browser.capturePage().then(function (img) {
							//Image is double the given bounds, so resize is needed!
							var tScale = 1;

							//If user defined width and/or height, enforce it precisely here. Height override width
							if (args.h) {
								tScale = args.h / newBounds.height;
							}
							else if (args.w) {
								tScale = args.w / newBounds.width;
							}

							newBounds.width *= tScale;
							newBounds.height *= tScale;
							img = img.resize(newBounds);

							var data = args.format == 'png' ? img.toPNG() : img.toJPEG(args.jpegQuality || 90);

							if (args.dpi != null && args.format == 'png') {
								data = writePngWithText(data, 'dpi', args.dpi);
							}

							if (args.embedXml == "1" && args.format == 'png') {
								data = writePngWithText(data, "mxGraphModel", args.xml, true,
									base64encoded);
							}
							else {
								if (base64encoded) {
									data = data.toString('base64');
								}
							}

							replyToLiveFrame(event, 'export-success', data);
						});
					}, bounds.width * bounds.height < LARGE_IMAGE_AREA ? 1000 : 5000);
				}
				else if (args.format == 'pdf') {
					if (args.print) {
						pdfOptions = {
							scaleFactor: args.pageScale,
							printBackground: true,
							pageSize: {
								width: args.pageWidth * MICRON_TO_PIXEL,
								//This height adjustment fixes the output. TODO Test more cases
								height: (args.pageHeight * 1.025) * MICRON_TO_PIXEL
							},
							margins: {
								marginType: 'none' // no margin
							}
						};

						contents.print(pdfOptions, (success, errorType) => {
							//Consider all as success
							replyToLiveFrame(event, 'export-success', {});
							// Notify the user with an error if it fails
							if (!success && errorType != 'Print job canceled') {
								dialog.showMessageBox(null, {
									type: 'error',
									title: 'Printing Error',
									message: 'There was an error printing. ' + errorType
								});
							}
						});
					}
					else {
						contents.printToPDF(pdfOptions).then(async (data) => {
							pdfs.push(data);
							to = to > pageCount ? pageCount : to;
							from++;

							if (from < to) {
								args.from = from;
								args.to = from;
								ipcMain.once('render-finished', renderingFinishHandler);
								contents.send('render', args);
							}
							else {
								// TODO extract the correct xml if the source was a pnd file
								data = await mergePdfs(pdfs, args.embedXml == '1' ? args.xml : null);
								replyToLiveFrame(event, 'export-success', data);
							}
						})
							.catch((error) => {
								replyToLiveFrame(event, 'export-error', error);
							});
					}
				}
				else if (args.format == 'svg') {
					contents.send('get-svg-data');

					ipcMain.once('svg-data', (e, data) => {
						if (!validateSender(e.senderFrame)) return null;

						replyToLiveFrame(event, 'export-success', data);
					});
				}
				else {
					replyToLiveFrame(event, 'export-error', 'Error: Unsupported format');
				}
			};

			ipcMain.once('render-finished', renderingFinishHandler);

			if (args.format == 'xml') {
				ipcMain.once('xml-data', (e, data) => {
					if (!validateSender(e.senderFrame)) return null;

					replyToLiveFrame(event, 'export-success', data);
				});

				ipcMain.once('xml-data-error', (e) => {
					if (!validateSender(e.senderFrame)) return null;

					replyToLiveFrame(event, 'export-error');
				});
			}

			args.border = args.border || 0;
			args.scale = args.scale || 1;

			if (args.filename != null && args.filename != '') {
				var filename = decodeURIComponent(args.filename);

				if (filename.substring(filename.length - 4) == '.pdf') {
					filename = filename.substring(0, filename.length - 4);
				}

				if (filename.substring(filename.length - 7) == '.drawio') {
					filename = filename.substring(0, filename.length - 7);
				}

				args.fileTitle = filename;
			}

			contents.send('render', args);
		});
	}
	catch (e) {
		if (browser != null) {
			browser.destroy();
		}

		replyToLiveFrame(event, 'export-error', e);
		console.log('export-error', e);
	}
};

ipcMain.on('export', exportDiagram);

//================================================================
// Renderer Helper functions
//================================================================

const { O_SYNC, O_CREAT, O_WRONLY, O_TRUNC, O_RDONLY } = fs.constants;
const DRAFT_PREFEX = '.$';
const OLD_DRAFT_PREFEX = '~$';
const DRAFT_EXT = '.dtmp';
const BKP_PREFEX = '.$';
const OLD_BKP_PREFEX = '~$';
const BKP_EXT = '.bkp';

/**
 * Checks the file content type
 * Confirm content is xml, json, pdf, png, jpg, svg, vsdx ...
 */
function checkFileContent(body, enc) {
	if (body != null) {
		let head, headBinay;

		if (typeof body === 'string') {
			if (enc === 'base64') {
				headBinay = Buffer.from(body.substring(0, 22), 'base64');
				head = headBinay.toString();
			}
			else {
				head = body.substring(0, 16);
				headBinay = Buffer.from(head);
			}
		}
		else {
			head = new TextDecoder("utf-8").decode(body.subarray(0, 16));
			headBinay = body;
		}

		let c1 = head[0],
			c2 = head[1],
			c3 = head[2],
			c4 = head[3],
			c5 = head[4],
			c6 = head[5],
			c7 = head[6],
			c8 = head[7],
			c9 = head[8],
			c10 = head[9],
			c11 = head[10],
			c12 = head[11],
			c13 = head[12],
			c14 = head[13],
			c15 = head[14],
			c16 = head[15];

		let cc1 = headBinay[0],
			cc2 = headBinay[1],
			cc3 = headBinay[2],
			cc4 = headBinay[3],
			cc5 = headBinay[4],
			cc6 = headBinay[5],
			cc7 = headBinay[6],
			cc8 = headBinay[7],
			cc9 = headBinay[8],
			cc10 = headBinay[9],
			cc11 = headBinay[10],
			cc12 = headBinay[11],
			cc13 = headBinay[12],
			cc14 = headBinay[13],
			cc15 = headBinay[14],
			cc16 = headBinay[15];

		if (c1 == '<') {
			// text/html
			if (c2 == '!'
				|| ((c2 == 'h'
					&& (c3 == 't' && c4 == 'm' && c5 == 'l'
						|| c3 == 'e' && c4 == 'a' && c5 == 'd')
					|| (c2 == 'b' && c3 == 'o' && c4 == 'd'
						&& c5 == 'y')))
				|| ((c2 == 'H'
					&& (c3 == 'T' && c4 == 'M' && c5 == 'L'
						|| c3 == 'E' && c4 == 'A' && c5 == 'D')
					|| (c2 == 'B' && c3 == 'O' && c4 == 'D'
						&& c5 == 'Y')))) {
				return true;
			}

			// application/xml
			if (c2 == '?' && c3 == 'x' && c4 == 'm' && c5 == 'l'
				&& c6 == ' ') {
				return true;
			}

			// application/svg+xml
			if (c2 == 's' && c3 == 'v' && c4 == 'g' && c5 == ' ') {
				return true;
			}

			// Embed cases img and iframe
			if (c2 == 'i' && c3 == 'm' && c4 == 'g' && c5 == ' '
				|| (c2 == 'i' && c3 == 'f' && c4 == 'r' && c5 == 'a'
					&& c6 == 'm' && c7 == 'e' && c8 == ' ')) {
				return true;
			}
		}

		// big and little (identical) endian UTF-8 encodings, with BOM
		// application/xml
		if (cc1 == 0xef && cc2 == 0xbb && cc3 == 0xbf) {
			if (c4 == '<' && c5 == '?' && c6 == 'x') {
				return true;
			}
		}

		// big and little endian UTF-16 encodings, with byte order mark
		// application/xml
		if (cc1 == 0xfe && cc2 == 0xff) {
			if (cc3 == 0 && c4 == '<' && cc5 == 0 && c6 == '?' && cc7 == 0
				&& c8 == 'x') {
				return true;
			}
		}

		// application/xml
		if (cc1 == 0xff && cc2 == 0xfe) {
			if (c3 == '<' && cc4 == 0 && c5 == '?' && cc6 == 0 && c7 == 'x'
				&& cc8 == 0) {
				return true;
			}
		}

		// big and little endian UTF-32 encodings, with BOM
		// application/xml
		if (cc1 == 0x00 && cc2 == 0x00 && cc3 == 0xfe && cc4 == 0xff) {
			if (cc5 == 0 && cc6 == 0 && cc7 == 0 && c8 == '<' && cc9 == 0
				&& cc10 == 0 && cc11 == 0 && c12 == '?' && cc13 == 0
				&& cc14 == 0 && cc15 == 0 && c16 == 'x') {
				return true;
			}
		}

		// application/xml
		if (cc1 == 0xff && cc2 == 0xfe && cc3 == 0x00 && cc4 == 0x00) {
			if (c5 == '<' && cc6 == 0 && cc7 == 0 && cc8 == 0 && c9 == '?'
				&& cc10 == 0 && cc11 == 0 && cc12 == 0 && c13 == 'x'
				&& cc14 == 0 && cc15 == 0 && cc16 == 0) {
				return true;
			}
		}

		// application/pdf (%PDF-)
		if (cc1 == 37 && cc2 == 80 && cc3 == 68 && cc4 == 70 && cc5 == 45) {
			return true;
		}

		// image/png
		if ((cc1 == 137 && cc2 == 80 && cc3 == 78 && cc4 == 71 && cc5 == 13
			&& cc6 == 10 && cc7 == 26 && cc8 == 10) ||
			(cc1 == 194 && cc2 == 137 && cc3 == 80 && cc4 == 78 && cc5 == 71 && cc6 == 13 //Our embedded PNG+XML
				&& cc7 == 10 && cc8 == 26 && cc9 == 10)) {
			return true;
		}

		// image/jpeg
		if (cc1 == 0xFF && cc2 == 0xD8 && cc3 == 0xFF) {
			if (cc4 == 0xE0 || cc4 == 0xEE) {
				return true;
			}

			/**
			 * File format used by digital cameras to store images.
			 * Exif Format can be read by any application supporting
			 * JPEG. Exif Spec can be found at:
			 * http://www.pima.net/standards/it10/PIMA15740/Exif_2-1.PDF
			 */
			if ((cc4 == 0xE1) && (c7 == 'E' && c8 == 'x' && c9 == 'i'
				&& c10 == 'f' && cc11 == 0)) {
				return true;
			}
		}

		// image/webp
		if (cc1 == 0x52 && cc2 == 0x49 && cc3 == 0x46 && cc4 == 0x46)	//RIFF
		{
			if (cc9 == 0x57 && cc10 == 0x45 && cc11 == 0x42 && cc12 == 0x50) //WEBP
			{
				return true;
			}
		}

		// vsdx, vssx (also zip, jar, odt, ods, odp, docx, xlsx, pptx, apk, aar)
		if (cc1 == 0x50 && cc2 == 0x4B && cc3 == 0x03 && cc4 == 0x04) {
			return true;
		}
		else if (cc1 == 0x50 && cc2 == 0x4B && cc3 == 0x03 && cc4 == 0x06) {
			return true;
		}

		// json
		if (c1 == '{' || c1 == '[') {
			return true;
		}

		// mxfile, mxlibrary, mxGraphModel
		if (c1 == '<' && c2 == 'm' && c3 == 'x') {
			return true;
		}
	}

	return false;
};

function isConflict(origStat, stat) {
	return stat != null && origStat != null && stat.mtimeMs != origStat.mtimeMs;
};

function getDraftFileName(fileObject) {
	let filePath = fileObject.path;
	let draftFileName = '', counter = 1, uniquePart = '';

	do {
		draftFileName = path.join(path.dirname(filePath), DRAFT_PREFEX + path.basename(filePath) + uniquePart + DRAFT_EXT);
		uniquePart = '_' + counter++;
	} while (fs.existsSync(draftFileName));

	return draftFileName;
};

async function getFileDrafts(fileObject) {
	let filePath = fileObject.path;
	let draftsPaths = [], drafts = [], draftFileName, counter = 1, uniquePart = '';

	do {
		draftsPaths.push(draftFileName);
		draftFileName = path.join(path.dirname(filePath), DRAFT_PREFEX + path.basename(filePath) + uniquePart + DRAFT_EXT);
		uniquePart = '_' + counter++;
	} while (fs.existsSync(draftFileName)); //TODO this assume continuous drafts names

	//Port old draft files to new prefex
	counter = 1;
	uniquePart = '';
	let draftExists = false;

	do {
		draftFileName = path.join(path.dirname(filePath), OLD_DRAFT_PREFEX + path.basename(filePath) + uniquePart + DRAFT_EXT);
		draftExists = fs.existsSync(draftFileName);

		if (draftExists) {
			const newDraftFileName = path.join(path.dirname(filePath), DRAFT_PREFEX + path.basename(filePath) + uniquePart + DRAFT_EXT);
			await fsProm.rename(draftFileName, newDraftFileName);
			draftsPaths.push(newDraftFileName);
		}

		uniquePart = '_' + counter++;
	} while (draftExists); //TODO this assume continuous drafts names

	//Skip the first null element
	for (let i = 1; i < draftsPaths.length; i++) {
		try {
			let stat = await fsProm.lstat(draftsPaths[i]);
			drafts.push({
				data: await fsProm.readFile(draftsPaths[i], 'utf8'),
				created: stat.ctimeMs,
				modified: stat.mtimeMs,
				path: draftsPaths[i]
			});
		}
		catch (e) { } // Ignore
	}

	return drafts;
};

async function saveDraft(fileObject, data) {
	var draftFileName = fileObject.draftFileName || getDraftFileName(fileObject);

	if (!checkFileContent(data) || path.resolve(draftFileName).startsWith(appBaseDir)) {
		throw new Error('Invalid file data');
	}
	else {
		await fsProm.writeFile(draftFileName, data, 'utf8');

		if (isWin) {
			try {
				// Add Hidden attribute:
				var child = spawn('attrib', ['+h', draftFileName]);
				child.on('error', function (err) {
					console.log('hiding draft file error: ' + err);
				});
			} catch (e) { }
		}

		return draftFileName;
	}
}

async function saveFile(fileObject, data, origStat, overwrite, defEnc) {
	if (!checkFileContent(data) || path.resolve(fileObject.path).startsWith(appBaseDir)) {
		throw new Error('Invalid file data');
	}

	var retryCount = 0;
	var backupCreated = false;
	var bkpPath = path.join(path.dirname(fileObject.path), BKP_PREFEX + path.basename(fileObject.path) + BKP_EXT);
	const oldBkpPath = path.join(path.dirname(fileObject.path), OLD_BKP_PREFEX + path.basename(fileObject.path) + BKP_EXT);
	var writeEnc = defEnc || fileObject.encoding;

	var writeFile = async function () {
		let fh;

		try {
			// O_SYNC is for sync I/O and reduce risk of file corruption
			fh = await fsProm.open(fileObject.path, O_SYNC | O_CREAT | O_WRONLY | O_TRUNC);
			await fsProm.writeFile(fh, data, writeEnc);
			await fh.sync(); // Flush to disk
		}
		finally {
			await fh?.close();
		}

		let stat2 = await fsProm.stat(fileObject.path);
		// Workaround for possible writing errors is to check the written
		// contents of the file and retry 3 times before showing an error
		let writtenData = await fsProm.readFile(fileObject.path, writeEnc);

		if (data != writtenData) {
			retryCount++;

			if (retryCount < 3) {
				return await writeFile();
			}
			else {
				throw new Error('all saving trials failed');
			}
		}
		else {
			//We'll keep the backup file in case the original file is corrupted. TODO When should we delete the backup file?
			if (backupCreated) {
				//fs.unlink(bkpPath, (err) => {}); //Ignore errors!

				//Delete old backup file with old prefix
				if (fs.existsSync(oldBkpPath)) {
					fs.unlink(oldBkpPath, (err) => { }); //Ignore errors
				}
			}

			return stat2;
		}
	};

	async function doSaveFile(isNew) {
		if (enableStoreBkp && !isNew) {
			//Copy file to backup file (after conflict and stat is checked)
			let bkpFh;

			try {
				//Use file read then write to open the backup file direct sync write to reduce the chance of file corruption
				let fileContent = await fsProm.readFile(fileObject.path, writeEnc);
				bkpFh = await fsProm.open(bkpPath, O_SYNC | O_CREAT | O_WRONLY | O_TRUNC);
				await fsProm.writeFile(bkpFh, fileContent, writeEnc);
				await bkpFh.sync(); // Flush to disk
				backupCreated = true;
			}
			catch (e) {
				if (__DEV__) {
					console.log('Backup file writing failed', e); //Ignore
				}
			}
			finally {
				await bkpFh?.close();

				if (isWin) {
					try {
						// Add Hidden attribute:
						var child = spawn('attrib', ['+h', bkpPath]);
						child.on('error', function (err) {
							console.log('hiding backup file error: ' + err);
						});
					} catch (e) { }
				}
			}
		}

		return await writeFile();
	};

	if (overwrite) {
		return await doSaveFile(true);
	}
	else {
		let stat = fs.existsSync(fileObject.path) ?
			await fsProm.stat(fileObject.path) : null;

		if (stat && isConflict(origStat, stat)) {
			throw new Error('conflict');
		}
		else {
			return await doSaveFile(stat == null);
		}
	}
};

async function writeFile(filePath, data, enc) {
	const abs = path.resolve(filePath);

	// Allow trusted text writes requested as UTF-8
	if (enc === 'utf8' && !abs.startsWith(appBaseDir)) {
		let fh;
		try {
			fh = await fsProm.open(abs, O_SYNC | O_CREAT | O_WRONLY | O_TRUNC);
			await fsProm.writeFile(fh, data, enc);
			await fh.sync();
		} finally {
			await fh?.close();
		}
		return;
	}

	if (!checkFileContent(data, enc) || abs.startsWith(appBaseDir)) {
		throw new Error('Invalid file data');
	}

	let fh;
	try {
		fh = await fsProm.open(abs, O_SYNC | O_CREAT | O_WRONLY | O_TRUNC);
		await fsProm.writeFile(fh, data, enc);
		await fh.sync();
	} finally {
		await fh?.close();
	}
}

function getAppDataFolder() {
	try {
		var appDataDir = app.getPath('appData');
		var drawioDir = appDataDir + '/draw.io';

		if (!fs.existsSync(drawioDir)) //Usually this dir already exists
		{
			fs.mkdirSync(drawioDir);
		}

		return drawioDir;
	}
	catch (e) { }

	return '.';
};

function getDocumentsFolder() {
	//On windows, misconfigured Documents folder cause an exception
	try {
		return app.getPath('documents');
	}
	catch (e) { }

	return '.';
};

function getPicturesFolder() {
	// On some systems, the configured Pictures folder can be unavailable.
	try {
		return app.getPath('pictures');
	}
	catch (e) { }

	return getDocumentsFolder();
}; // NEW

function checkFileExists(pathParts) {
	let filePath = path.join(...pathParts);
	return { exists: fs.existsSync(filePath), path: filePath };
};

async function showOpenDialog(defaultPath, filters, properties) {
	let win = BrowserWindow.getFocusedWindow();

	return dialog.showOpenDialog(win, {
		defaultPath: (typeof defaultPath === 'string' ? defaultPath : undefined),
		filters: filters,
		properties: properties
	});
};

async function showSaveDialog(defaultPath, filters) {
	let win = BrowserWindow.getFocusedWindow();

	return dialog.showSaveDialog(win, {
		defaultPath: defaultPath,
		filters: filters
	});
};

async function installPlugin(filePath) {
	if (!enablePlugins) return {};

	var pluginsDir = path.join(getAppDataFolder(), '/plugins');

	if (!fs.existsSync(pluginsDir)) {
		fs.mkdirSync(pluginsDir);
	}

	var pluginName = path.basename(filePath);
	var dstFile = path.join(pluginsDir, pluginName);

	if (fs.existsSync(dstFile)) {
		throw new Error('fileExists');
	}
	else {
		await fsProm.copyFile(filePath, dstFile);
	}

	return { pluginName: pluginName, selDir: path.dirname(filePath) };
}

function getPluginFile(plugin) {
	if (!enablePlugins) return null;

	const prefix = path.join(getAppDataFolder(), '/plugins/');
	const pluginFile = path.join(prefix, plugin);

	if (pluginFile.startsWith(prefix) && fs.existsSync(pluginFile)) {
		return pluginFile;
	}

	return null;
}

function uninstallPlugin(plugin) {
	const pluginFile = getPluginFile(plugin);

	if (pluginFile != null) {
		fs.unlinkSync(pluginFile);
	}
}

function dirname(path_p) {
	return path.dirname(path_p);
}

async function readFile(filename, encoding) {
	const abs = path.resolve(filename);
	const data = await fsProm.readFile(filename, encoding);

	// Allow trusted text reads explicitly requested as UTF-8
	if (encoding === 'utf8' && !abs.startsWith(appBaseDir)) {
		return data;
	}

	if (checkFileContent(data, encoding) && !abs.startsWith(appBaseDir)) {
		return data;
	}

	throw new Error('Invalid file data');
}


async function fileStat(file) {
	return await fsProm.stat(file);
}

async function isFileWritable(file) {
	try {
		await fsProm.access(file, fs.constants.W_OK);
		return true;
	}
	catch (e) {
		return false;
	}
}

function clipboardAction(method, data) {
	if (method == 'writeText') {
		clipboard.writeText(data);
	}
	else if (method == 'readText') {
		return clipboard.readText();
	}
	else if (method == 'writeImage') {
		clipboard.write({
			image:
				nativeImage.createFromDataURL(data.dataUrl), html: '<img src="' +
					data.dataUrl + '" width="' + data.w + '" height="' + data.h + '">'
		});
	}
}

async function deleteFile(file) {
	// Reading the header of the file to confirm it is a file we can delete
	let fh = await fsProm.open(file, O_RDONLY).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); // CHANGE
	if (!fh) return; // NEW
	let buffer = Buffer.allocUnsafe(16);
	await fh.read(buffer, 0, 16);
	await fh.close();

	if (checkFileContent(buffer) && !path.resolve(file).startsWith(appBaseDir)) {
		await fsProm.unlink(file);
	}
}

function windowAction(method, win = BrowserWindow.getFocusedWindow()) { // CHANGE: IPC actions use their requesting window, including hidden editors.
	if (win?.isDestroyed()) return; // NEW

	if (win) {
		if (method == 'minimize') {
			win.minimize();
		}
		else if (method == 'maximize') {
			win.maximize();
		}
		else if (method == 'unmaximize') {
			win.unmaximize();
		}
		else if (method == 'close') {
			win.close();
		}
		else if (method == 'isMaximized') {
			return win.isMaximized();
		}
		else if (method == 'removeAllListeners') {
			win.removeAllListeners();
		}
	}
}

const allowedUrls = /^(?:https?|mailto|tel|callto):/i;

function openExternal(url) {
	//Only open http(s), mailto, tel, and callto links
	if (allowedUrls.test(url)) {
		shell.openExternal(url);
		return true;
	}

	return false;
}

function getTrellisAppInfo() {
	return {
		productName: app.name,
		version: app.getVersion(),
		repoUrl: trellisReleaseUrl,
		releasesUrl: `${trellisReleaseUrl}/releases`,
		issuesUrl: trellisSupportUrl,
		isPackaged: app.isPackaged,
		canCheckForUpdates: canCheckForUpdates()
	};
}

/** Deferred IPC/export results must not target a destroyed or replaced renderer frame. */ // NEW
function replyToLiveFrame(event, channel, payload) { // NEW
	if (!('senderFrame' in event)) return event.reply(channel, payload); // NEW: preserve main-owned CLI export error propagation.
	try { // NEW
		if (event.sender?.isDestroyed?.() || ('senderFrame' in event && !validateSender(event.senderFrame))) return; // NEW
		event.reply(channel, payload); // NEW: main-owned CLI export events also use this path.
	} catch (error) { log.warn('Renderer reply skipped:', error.message); } // NEW
} // NEW
/** A live window may have a disposed frame after renderer startup failure or crash. */ // NEW
function canNotifyWindow(win) { // NEW
	if (!lifecycle.acceptsWork || win.isDestroyed()) return false; // NEW
	try { const contents = win.webContents; return !contents.isDestroyed() && !contents.isCrashed() && !contents.mainFrame.isDestroyed(); } // NEW
	catch (_) { return false; } // NEW
} // NEW
/** Reject late background work once the quit transaction has committed. */ // NEW
function assertTrellisRunning() { if (!lifecycle.acceptsWork) throw new Error('Trellis is shutting down.'); } // NEW
function hasConfiguredSync() { return !!sharingService?.hasBackgroundWork() || configuredIdentities.length > 0; } // NEW
function configuredTransports() { return [sharingService?.hasBackgroundWork() ? sharingService : null, ...configuredIdentities.map(identity => identityTransports.get(identity.id))].filter(Boolean); } // NEW
const sharingGroup = createSharingGroup({ // NEW
	getServices: configuredTransports, canStart: () => lifecycle.acceptsWork, // NEW
	getIdentityStatuses: () => configuredIdentities.map(identity => ({ label: identity.username + ' identity', connectedCollaborators: null, ...identityTransports.get(identity.id)?.backgroundStatus() })), // NEW
	subscribe: listener => { sharingEvents.on('status', listener); return () => sharingEvents.off('status', listener); } // NEW
}); // NEW
/** A background-only Windows/Linux session exits when its final configured share is retired. */ // NEW
function maybeFinishBackground() { // NEW
	if (sharingTray && process.platform !== 'darwin' && lifecycle.acceptsWindows && windowsRegistry.length === 0 && !hasConfiguredSync()) void lifecycle.requestQuit('no configured sync'); // NEW
} // NEW
/** Refresh the installed registry independently of unlocked credentials or daemon creation. */ // NEW
async function refreshConfiguredIdentities() { // NEW
	const identities = await getIdentityService(); // NEW
	const result = await identities.list(); // NEW
	assertTrellisRunning(); configuredIdentities = result.identities.filter(identity => !identity.error && !identity.revoked); sharingEvents.emit('status'); maybeFinishBackground(); // NEW
} // NEW
/** Serialize periodic refresh so a slow catalog operation cannot stack transports. */ // NEW
async function refreshIdentityBackground() { // NEW
	assertTrellisRunning(); await identityService.refresh(); // NEW
	await refreshConfiguredIdentities(); // NEW
	for (const identity of configuredIdentities) { assertTrellisRunning(); await gardenLibraryService.processDownloads(identity.id); } // NEW
	await ensureSharingTray(); // NEW
} // NEW
/** Startup and last-window close share one initialization of configured background owners. */ // NEW
function initializeBackgroundSync() { // NEW
	if (backgroundReady) return backgroundReady; // NEW
	backgroundReady = (async () => { // NEW
		const legacy = await getSharingService(); // NEW
		await refreshConfiguredIdentities(); // NEW
		await Promise.allSettled([legacy.hasBackgroundWork() ? legacy.start() : Promise.resolve(), refreshIdentityBackground()]); // NEW
		assertTrellisRunning(); await ensureSharingTray(); // NEW
	})(); // NEW
	return backgroundReady; // NEW
} // NEW
/** A missing tray never leaves an unreachable daemon behind after the final window closes. */ // NEW
async function quitWithoutTray() { // NEW
	if (!lifecycle.acceptsWork) return; // NEW
	if (!backgroundFailureShown) { // NEW
		backgroundFailureShown = true; dialog.showErrorBox('Background syncing unavailable', 'Trellis could not create its tray controls. Trellis will stop syncing and close. Saved changes will sync the next time you open it.'); // NEW
	} // NEW
	await lifecycle.requestQuit('tray unavailable'); // NEW
} // NEW
/** Window-load IPC is sender-scoped and removed when its owner closes. */ // NEW
function bindWindowLoad(win, callback) { // NEW
	const contents = win.webContents, senderId = contents.id; let loaded = false, ready = false, completed = false; // NEW
	const cleanup = () => { ipcMain.removeListener('app-load-finished', receive); contents.removeListener('did-finish-load', didLoad); win.removeListener('closed', cleanup); }; // NEW
	const finish = () => { if (completed || win.isDestroyed() || !loaded || !ready || !lifecycle.acceptsWork) return; completed = true; cleanup(); callback(); }; // NEW
	const receive = event => { if (event.sender.id !== senderId || !validateSender(event.senderFrame)) return; ready = true; finish(); }; // NEW
	const didLoad = () => { if (win.isDestroyed()) return; loaded = true; contents.zoomFactor = appZoom; contents.setVisualZoomLevelLimits(1, appZoom); finish(); }; // NEW
	ipcMain.on('app-load-finished', receive); contents.on('did-finish-load', didLoad); win.once('closed', cleanup); // NEW
} // NEW
/** Request a private document preparation step with bounded, correlated IPC. */ // NEW
function closeReply(win, phase, approval, timeoutMs = 1000) { // NEW
	return requestWindowReply({ ipcMain, window: win, channel: 'isModified', replyChannel: 'isModified-result', validateSender, timeoutMs, // NEW
		payload: { uniqueId: 'close-' + (++closeRequestSequence), phase, snapshotId: approval?.snapshotId } }); // NEW
} // NEW
/** Freeze only saves while all open handles and their drafts follow a local projection move. */ // NEW
const projectRenamePaths = new Map(); // NEW
async function prepareProjectionRename(input) { // NEW
	const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value); // NEW
	const targets = windowsRegistry.filter(win => !win.isDestroyed() && sharingWindowPaths.get(win.webContents.id) && canonical(sharingWindowPaths.get(win.webContents.id)) === canonical(input.oldPath)); // NEW
	const ask = (win, phase, extra = {}) => requestWindowReply({ ipcMain, window: win, channel: 'trellisProjectNaming', replyChannel: 'trellisProjectNaming-result', validateSender, timeoutMs: 5000, payload: { ...input, ...extra, phase, uniqueId: 'naming-' + (++closeRequestSequence) } }); // NEW
	const prepared = []; // NEW
	try { // NEW
		for (const win of targets) { const reply = await ask(win, 'prepare'); if (reply.error) throw new Error(reply.error); prepared.push(win); } // NEW
	} catch (error) { for (const win of targets) if (!win.isDestroyed()) win.webContents.send('trellisProjectNaming', { ...input, phase: 'cancel' }); throw error; } // NEW
	projectRenamePaths.set(input.oldPath, null); // NEW
	for (const win of prepared) fileWatchRegistry.unwatch(input.oldPath, win); // NEW
	return async outcome => { // NEW
		const drafts = new Map(), errors = []; // CHANGE
		try { // NEW
			if (outcome.committed) { // NEW
				projectRenamePaths.delete(outcome.path); projectRenamePaths.set(input.oldPath, outcome.path); // CHANGE
				for (const previousPath of new Set([input.oldPath, ...(outcome.previousPaths || [])])) if (previousPath !== outcome.path && path.dirname(previousPath) === path.dirname(outcome.path)) { // CHANGE
					try { // NEW
						for (const draft of await getFileDrafts({ path: previousPath })) { // NEW
							const target = getDraftFileName({ path: outcome.path }); // NEW
							try { await fsProm.link(draft.path, target); await fsProm.unlink(draft.path); drafts.set(draft.path, target); } catch (error) { errors.push(error); } // NEW
						} // NEW
					} catch (error) { errors.push(error); } // NEW
				} // NEW
			} else projectRenamePaths.delete(input.oldPath); // NEW
			for (const win of prepared) if (!win.isDestroyed()) { // NEW
				const watched = sharingWindowPaths.get(win.webContents.id); // NEW
				if (watched && canonical(watched) !== canonical(input.oldPath) && canonical(watched) !== canonical(outcome.path)) continue; // NEW: navigation to another document must not inherit this project's watcher.
				try { // NEW
					const nextPath = outcome.committed ? outcome.path : input.oldPath; // NEW
					sharingWindowPaths.set(win.webContents.id, nextPath); fileWatchRegistry.watch(nextPath, win); // NEW
					const reply = await ask(win, outcome.committed ? 'commit' : 'cancel', { ...outcome, drafts: [...drafts] }); // NEW
					if (reply.error) throw new Error(reply.error); // NEW
				} catch (error) { errors.push(error); } // NEW: notify other prepared editors even if one editor fails to acknowledge.
			} // NEW
			if (errors.length) throw new Error('Filename update pending: ' + errors.map(error => error.message).join('; ')); // NEW
		} finally { for (const win of prepared) if (!win.isDestroyed()) win.webContents.send('trellisProjectNaming', { ...input, phase: 'cancel' }); } // NEW
	}; // NEW
} // NEW
/** Preserve remote drafts before retiring a project; an unresponsive editor blocks file removal. */ // NEW
async function prepareProjectRetirement(input) { // NEW
	let filename = input.path; // NEW
	if (!filename) { // NEW
		for (const service of [sharingService, ...identityTransports.values()].filter(Boolean)) { // NEW
			const canvas = (await service.listCanvases()).find(c => c.shareId === input.shareId); // NEW
			if (canvas) { filename = canvas.path; break; } // NEW
		} // NEW
	} // NEW
	if (!filename) return; // NEW
	const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value); // NEW
	const targets = windowsRegistry.filter(win => !win.isDestroyed() && sharingWindowPaths.get(win.webContents.id) && canonical(sharingWindowPaths.get(win.webContents.id)) === canonical(filename)); // NEW
	try { // NEW
		for (const win of targets) { // NEW
			const ask = phase => requestWindowReply({ ipcMain, window: win, channel: 'trellisProjectRetiring', replyChannel: 'trellisProjectRetiring-result', validateSender, timeoutMs: 10000, payload: { uniqueId: 'project-' + (++closeRequestSequence), phase, path: filename } }); // NEW
			const draft = await ask('prepare'); if (draft.error) throw new Error(draft.error); // NEW
			if (draft.modified) { // NEW
				if (typeof draft.xml !== 'string' || Buffer.byteLength(draft.xml) > 128 * 1024 * 1024) throw new Error('The project draft could not be preserved.'); // NEW
				const recoveryRoot = path.join(app.getPath('userData'), 'project-draft-recovery'); await fsProm.mkdir(recoveryRoot, { recursive: true }); // NEW
				await fsProm.writeFile(path.join(recoveryRoot, 'draft-' + Date.now() + '-' + win.webContents.id + '.drawio'), draft.xml, { flag: 'wx', mode: 0o600, flush: true }); // NEW
			} // NEW
			const committed = await ask('commit'); if (committed.error) throw new Error(committed.error); // NEW
		} // NEW
	} finally { for (const win of targets) if (!win.isDestroyed()) win.webContents.send('trellisProjectRetiring', { phase: 'cancel', path: filename }); } // NEW
} // NEW
/** The local-file actions must never bypass synchronized project retirement. */ // NEW
async function assertStandaloneProject(filename) { // NEW
	await assertSharingFileAccess(filename, path.join(app.getPath('userData'), 'trellis-identities')); // NEW
	await assertSharingFileAccess(filename, path.join(app.getPath('userData'), 'trellis-sharing')); // NEW
	await assertSharingFileAccess(filename, path.join(app.getPath('userData'), 'garden-file-trash')); // NEW
	const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value); // NEW
	for (const service of [sharingService, ...identityTransports.values()].filter(Boolean)) { // NEW
		if ((await service.listCanvases()).some(canvas => canonical(canvas.path) === canonical(filename))) throw new Error('Use the identity library actions to delete or restore this synchronized project.'); // NEW
	} // NEW
} // NEW
/** Late editor saves cannot recreate files in a retired managed folder. */ // NEW
async function assertProjectWriteAllowed(filename) { // NEW
	if (typeof filename !== 'string') return; // NEW
	if (projectRenamePaths.has(filename) && projectRenamePaths.get(filename) !== filename) throw new Error('This project file is being renamed. Retry the save after its filename updates.'); // NEW
	const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value); // NEW
	for (const service of [sharingService, ...identityTransports.values()].filter(Boolean)) { // NEW
		if ((await service.listCanvases()).some(canvas => (canvas.retired || canvas.fenced) && canonical(canvas.path) === canonical(filename))) throw new Error('This project is retired. Restore it from Trash before saving or opening it.'); // NEW
	} // NEW
} // NEW
/** Keep all drafts and transports intact while asking the existing unsaved-change questions. */ // NEW
async function prepareWindowClose(win) { // NEW
	try { // NEW
		const reply = await closeReply(win, 'prepare');
		if (reply.error) throw new Error(reply.error); // NEW // NEW
		if (win.isDestroyed()) return reply; // NEW
		if (!reply.isModified) return reply; // NEW
		const answer = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Cancel', 'Discard Changes'], defaultId: 0, cancelId: 0, title: 'Confirm', message: 'The document has unsaved changes. Do you really want to quit without saving?' }); // NEW
		return answer === 1 ? reply : null; // NEW
	} catch (error) { // NEW
		if (win.isDestroyed()) return { forced: true }; // NEW
		log.warn('Editor close check:', error.message); // NEW
		const answer = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Cancel', 'Close Anyway'], defaultId: 0, cancelId: 0, title: 'Confirm', message: 'Trellis could not check whether the current document has unsaved changes. Close anyway?' }); // NEW
		return answer === 1 ? { forced: true } : null; // NEW
	} // NEW
} // NEW
/** Seal only the exact renderer-local snapshot that the user approved. */ // NEW
async function validateWindowClose(win, approval) { // NEW
	if (approval.forced || win.isDestroyed()) return true; // NEW
	try { const reply = await closeReply(win, 'seal', approval); if (reply.error) throw new Error(reply.error); return !!reply.snapshotValid; } // NEW
	catch (error) { if (win.isDestroyed()) return true; throw error; } // NEW
} // NEW
function releaseWindowClose(win) { if (!win.isDestroyed()) win.webContents.send('isModified', { phase: 'cancel' }); } // NEW
/** Remove drafts only after every window approves; failures leave the application running. */ // NEW
async function discardWindowDraft(win, approval) { // NEW
	if (win.isDestroyed() || approval.forced) return; // NEW: Close Anyway retains the recoverable draft.
	const reply = await closeReply(win, 'discard', approval, 10000); // NEW
	if (reply.error) throw new Error('The document draft could not be removed: ' + reply.error); // NEW
	if (!reply.snapshotValid) throw new Error('The document changed during Quit. Review it and try again.'); // NEW
} // NEW
/** Stop every owned transport in parallel, then release local watchers, databases, and tray. */ // NEW
async function stopTrellisResources({ deadline }) { // NEW
	clearInterval(identityRefreshTimer); identityRefreshTimer = null; // NEW
	const services = [sharingService, ...identityTransports.values()].filter(Boolean); // NEW
	const results = await Promise.allSettled(services.map(service => service.stop({ deadline }))); // NEW
	for (const result of results) if (result.status === 'rejected') log.error('Owned transport shutdown failed:', result.reason.message); // NEW
	for (const win of windowsRegistry) fileWatchRegistry.unwatchWindow(win); // NEW
	for (const [id, db] of dbRegistry) { try { db.close(); } catch (error) { log.warn('Database shutdown:', error.message); } dbRegistry.delete(id); dbRegistryPaths.delete(id); } // NEW
	sharingTray?.dispose(); sharingTray = null; // NEW
	if (results.some(result => result.status === 'rejected')) throw new Error('An owned transport did not finish shutdown. See the shutdown log for its termination outcome.'); // NEW: do not proceed to installer launch after unverified termination.
} // NEW

async function getSharingService() { // NEW: single service for all application windows.
	assertTrellisRunning(); // NEW
	if (!sharingService) {
		sharingService = createSyncthingService({ beforeProjectionRename: prepareProjectionRename, userDataPath: app.getPath('userData'), documentsPath: app.getPath('documents'), privatePaths: [path.join(app.getPath('userData'), 'trellis-sharing'), path.join(app.getPath('userData'), 'trellis-identities')], beforeStart: async () => { for (const identity of configuredIdentities) await gardenLibraryService?.fenceTransport(identity.id); }, binaryRoot: app.isPackaged ? path.join(process.resourcesPath, 'syncthing') : path.join(__dirname, '../../vendor/syncthing'), setStartup: enabled => setSharingStartup(app, enabled, store), canStart: () => lifecycle.acceptsWork, onLifecycle: entry => log.info('Syncthing lifecycle:', entry.phase, entry.pids) }); // CHANGE // CHANGE: explicit asset import cannot copy identity credentials.
		sharingService.onStatus(status => {
			sharingEvents.emit('status'); maybeFinishBackground(); // CHANGE
			for (const win of windowsRegistry) if (canNotifyWindow(win)) win.webContents.send('trellisShareStatus', sharingService.listStatus(win.webContents.id)); // CHANGE: exclude each window's current actor from its count.
		});
	}
	await sharingService.initialize();
	return sharingService;
}
/** Own identity credentials and transfer services outside every renderer. */ // NEW
function assertRememberedIdentityProtection() { // NEW: Linux's fallback is not secure enough for persistent login.
	if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('Operating-system credential protection is unavailable.'); // NEW
} // NEW
async function getIdentityService() { // NEW
	assertTrellisRunning(); // NEW
	if (!identityService) {
		const root = path.join(app.getPath('userData'), 'trellis-identities');
		identityService = createIdentityService({
			root,
			protectPending(text) { if (!safeStorage.isEncryptionAvailable()) throw new Error('Operating-system credential protection is unavailable.'); return safeStorage.encryptString(text).toString('base64'); },
			unprotectPending(text) { return safeStorage.decryptString(Buffer.from(text, 'base64')); },
			protectSession(text) { assertRememberedIdentityProtection(); return safeStorage.encryptString(text).toString('base64'); }, // NEW: secrets stay in the main process.
			unprotectSession(text) { assertRememberedIdentityProtection(); return safeStorage.decryptString(Buffer.from(text, 'base64')); }, // NEW
			transportFactory: async (identityId, profileRoot) => {
				assertTrellisRunning(); // NEW
				if (!identityTransports.has(identityId)) {
					const service = createSyncthingService({ beforeProjectionRename: prepareProjectionRename, userDataPath: profileRoot, profilePath: path.join(profileRoot, 'transport'), privatePaths: [root, path.join(app.getPath('userData'), 'trellis-sharing')], beforeStart: () => gardenLibraryService?.fenceTransport(identityId), documentsPath: app.getPath('documents'), canvasesRoot: path.join(app.getPath('documents'), 'Trellis', 'Garden Library', identityId), binaryRoot: app.isPackaged ? path.join(process.resourcesPath, 'syncthing') : path.join(__dirname, '../../vendor/syncthing'), setStartup: enabled => setSharingStartup(app, enabled, store), canStart: () => lifecycle.acceptsWork, onLifecycle: entry => log.info('Syncthing lifecycle:', entry.phase, entry.pids) }); // CHANGE // CHANGE
					service.onStatus(() => { sharingEvents.emit('status'); maybeFinishBackground(); for (const win of windowsRegistry) if (canNotifyWindow(win)) { win.webContents.send('trellisIdentityStatus', { session: identityService.session() }); win.webContents.send('trellisShareStatus', service.listStatus(win.webContents.id)); } }); // CHANGE: managed gardens reuse existing sharing status and conflict UI.
					identityTransports.set(identityId, service);
				}
				return identityTransports.get(identityId);
			},
			adoptTransport: async (provisionalId, identityId, profileRoot) => {
				await identityTransports.get(provisionalId)?.stop(); identityTransports.delete(provisionalId);
				const source = path.join(root, provisionalId, 'transport'), destination = path.join(profileRoot, 'transport');
				if (fs.existsSync(source) && !fs.existsSync(destination)) await fsProm.rename(source, destination);
			}
		});
		gardenLibraryService = createGardenLibraryService({ // CHANGE
			identities: identityService, legacyService: getSharingService, // NEW
			getTrashRoot: () => path.join(app.getPath('userData'), 'garden-file-trash'), beforeRetire: prepareProjectRetirement, // NEW
			validateStandalonePath: assertStandaloneProject, // NEW
			getLocalFolder: () => store?.get('trellis.localGardenProjectsFolder') || path.join(app.getPath('documents'), 'Trellis', 'Local Garden Projects'), // NEW
			setLocalFolder: folder => { if (!store) throw new Error('Local folder settings could not be saved.'); store.set('trellis.localGardenProjectsFolder', folder); }, // NEW
			validateLocalPath: filename => assertSharingFileAccess(filename, path.join(app.getPath('userData'), 'trellis-identities')), // NEW
			listCities: () => { // NEW: read the existing live catalog without creating or migrating tables.
				const live = getLiveDbPath(), filename = fs.existsSync(live) ? live : path.resolve(__dirname, TRELLIS_BUILT_IN_DB_REL_PATH); // CHANGE: the bundled city catalog is available before the editor seeds its live database.
				if (!fs.existsSync(filename)) return []; // NEW
				const database = new Database(filename, { readonly: true, fileMustExist: true }); // NEW
				try { return database.prepare('SELECT * FROM Cities ORDER BY city_name').all(); } finally { database.close(); } // NEW
			} // NEW
		}); // CHANGE
		fieldService = createFieldService({ identities: identityService, library: gardenLibraryService }); // NEW
		identityService.onChange(session => { if (lifecycle.acceptsWork) void refreshConfiguredIdentities().catch(error => log.warn('Identity registry:', error.message)); sharingEvents.emit('status'); for (const win of windowsRegistry) if (canNotifyWindow(win)) win.webContents.send('trellisIdentityStatus', { session }); });
		identityRefreshTimer = setInterval(() => { // CHANGE: never overlap refresh or acquire transports during committed Quit.
			if (!lifecycle.acceptsWork || identityRefreshTask) return; // NEW
			identityRefreshTask = refreshIdentityBackground().catch(error => log.warn('Identity sync:', error.message)).finally(() => { identityRefreshTask = null; }); // NEW
		}, 5000); // CHANGE
		identityRefreshTimer.unref();
	}
	await identityService.initialize();
	return identityService;
}
/** Select a daemon from the watched file, never a renderer-supplied identity. */ // NEW
async function getScopedSharingService(callerId, diagramPath) { // NEW
	const watched = diagramPath || sharingWindowPaths.get(callerId);
	if (watched) {
		const libraryRoot = path.resolve(app.getPath('documents'), 'Trellis', 'Garden Library');
		const relative = path.relative(libraryRoot, path.resolve(watched));
		if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
			const identityId = relative.split(path.sep)[0], identities = await getIdentityService();
			if ((await identities.list()).identities.some(entry => entry.id === identityId)) return identities.transport(identityId);
		}
	}
	return getSharingService();
}
/** Reuse the existing renderer modification handshake across all editor windows. */ // NEW
async function lockIdentitySafely() { // NEW
	for (const win of windowsRegistry) {
		if (win.isDestroyed()) continue;
		const uniqueId = 'identity-lock-' + (++closeRequestSequence); // CHANGE
		const reply = await requestWindowReply({ ipcMain, window: win, channel: 'isModified', replyChannel: 'isModified-result', payload: { uniqueId }, validateSender, timeoutMs: 10000 }); // CHANGE
		if (win.isDestroyed()) continue; // NEW
		const modified = reply.isModified; // NEW
		if (modified) {
			const answer = await dialog.showMessageBox(win, { type: 'question', buttons: ['Cancel', 'Discard Changes and Log Out'], defaultId: 0, cancelId: 0, title: 'Log out of Trellis', message: 'This window has unsaved changes. Save them before logging out, or discard them.' });
			if (win.isDestroyed()) continue; // NEW
			if (answer.response !== 1) return { ok: false, canceled: true };
		}
	}
	await (await getIdentityService()).lock(); // CHANGE: do not report logout until the remembered credential has been removed.
	for (const win of windowsRegistry) if (canNotifyWindow(win)) win.webContents.send('trellisIdentityLocked');
	return { ok: true };
}
/** One aggregate tray remains useful for legacy shares and locked identity libraries. */ // NEW
async function ensureSharingTray() { // CHANGE
	if (!lifecycle.acceptsWork || sharingTray || backgroundFailureShown || !hasConfiguredSync()) return; // NEW
	if (sharingTrayCreation) return sharingTrayCreation; // CHANGE
	sharingTrayCreation = (async () => { // CHANGE
		try { // NEW
			const tray = await createSharingTray({ app, Tray, Menu: menu, nativeImage, service: sharingGroup, store, iconPath: path.join(codeDir, 'images/window-icon.png'), openWindow: diagramPath => { // CHANGE
				const win = createWindow(); if (!win) return; // NEW
				if (diagramPath) bindWindowLoad(win, () => win.webContents.send('args-obj', { args: [diagramPath] })); // CHANGE
			} }); // NEW
			if (!lifecycle.acceptsWork) tray.dispose(); else sharingTray = tray; // NEW: delayed native tray creation cannot survive shutdown.
		} catch (error) { log.error('Sharing tray unavailable:', error.message); void quitWithoutTray(); } // CHANGE
	})().finally(() => { sharingTrayCreation = null; }); // CHANGE
	return sharingTrayCreation; // CHANGE
} // CHANGE
async function getTrellisSyncthingShareInfo(args) { // CHANGE: real managed-share lookup replaces unavailable stub.
	return (await getScopedSharingService(null, args.diagramPath)).shareInfo(args); // CHANGE: identity gardens use their scoped daemon.
}
app.on('before-quit', event => { // CHANGE: approve every document before stopping any service.
	if (lifecycle.state === 'ready to exit') return; // NEW
	event.preventDefault(); void lifecycle.requestQuit('explicit quit'); // CHANGE
}); // CHANGE

async function openTrellisEmailDraft(args) { // CHANGE: await the email-specific handoff without changing other external links.
	const source = args || {};
	const to = String(source.to || '').trim();
	const subject = String(source.subject || 'Trellis garden canvas invite');
	const body = String(source.body || '');
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, reason: 'A valid recipient email is required.' };
	const url = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
	if (process.platform === 'win32' && url.length > 2081) return { ok: false, reason: 'This invitation is too long for a Windows email link. Use Copy Invitation and paste it into a new email.' }; // NEW
	try { // NEW
		await shell.openExternal(url); // NEW: a successful handoff cannot confirm that a compose window appeared.
		return { ok: true }; // NEW
	} catch (_) { // NEW
		return { ok: false, reason: 'Your mail app could not be opened. Check your default email app, see Email didn’t open?, or use Copy Invitation.' }; // NEW
	} // NEW
}

async function getTrellisReleases() {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), trellisReleasesTimeoutMs);

	try {
		const response = await fetch(trellisReleasesApiUrl, {
			headers: { Accept: 'application/vnd.github+json' },
			signal: controller.signal
		});

		if (!response.ok) throw new Error(`GitHub releases request failed: ${response.status}`);

		const releases = await response.json();
		if (!Array.isArray(releases)) throw new Error('GitHub releases response was not an array');
		return releases;
	}
	finally {
		clearTimeout(timeout);
	}
}

function getRequestWindow(event) {
	return event != null ? BrowserWindow.fromWebContents(event.sender) : null;
}

function watchFile(filePath, win) {
	return fileWatchRegistry.watch(filePath, win);
}

function unwatchFile(filePath, win) {
	fileWatchRegistry.unwatch(filePath, win);
}

ipcMain.on("rendererReq", async (event, args) => {
	if (!validateSender(event.senderFrame)) return null;

	try {
		assertTrellisRunning(); // NEW: late renderer commands cannot acquire resources after shutdown commits.
		let ret = null;
		const profile = path.join(app.getPath('userData'), 'trellis-sharing'); // NEW: retain ordinary filesystem APIs while protecting the service profile.
		const paths = [args.path, args.filename, args.file, args.filePath, args.dbPath, args.fileObject?.path];
		if (typeof args.seedRelPath === 'string') paths.push(path.resolve(__dirname, args.seedRelPath));
		if (typeof args.dbName === 'string') paths.push(getLiveDbPath(args.dbName));
		if (Array.isArray(args.pathParts) && args.pathParts.every(part => typeof part === 'string')) paths.push(path.join(...args.pathParts));
		if (typeof args.plugin === 'string') paths.push(path.join(getAppDataFolder(), 'plugins', args.plugin));
		for (const filename of paths) { await assertSharingFileAccess(filename, profile); await assertSharingFileAccess(filename, path.join(app.getPath('userData'), 'trellis-identities')); } // CHANGE: generic IPC cannot read pairing or identity credentials.

		assertTrellisRunning(); // NEW: path validation may have overlapped committed Quit.
		if (['saveFile', 'writeFile', 'saveDraft', 'watchFile'].includes(args.action)) await assertProjectWriteAllowed(args.path || args.fileObject?.path); // NEW
		switch (args.action) {
			case 'saveFile':
				ret = await saveFile(args.fileObject, args.data, args.origStat, args.overwrite, args.defEnc);
				break;
			case 'writeFile':
				ret = await writeFile(args.path, args.data, args.enc);
				break;
			case 'saveDraft':
				ret = await saveDraft(args.fileObject, args.data);
				break;
			case 'getFileDrafts':
				ret = await getFileDrafts(args.fileObject);
				break;
			case 'getDocumentsFolder':
				ret = await getDocumentsFolder();
				break;
			case 'getPicturesFolder':
				ret = await getPicturesFolder();
				break; // NEW
			case 'checkFileExists':
				ret = await checkFileExists(args.pathParts);
				break;
			case 'showOpenDialog':
				dialogOpen = true;
				ret = await showOpenDialog(args.defaultPath, args.filters, args.properties);
				ret = ret.filePaths;
				dialogOpen = false;
				break;
			case 'showSaveDialog':
				dialogOpen = true;
				ret = await showSaveDialog(args.defaultPath, args.filters);
				ret = ret.canceled ? null : ret.filePath;
				dialogOpen = false;
				break;
			case 'installPlugin':
				ret = await installPlugin(args.filePath);
				break;
			case 'uninstallPlugin':
				ret = await uninstallPlugin(args.plugin);
				break;
			case 'getPluginFile':
				ret = await getPluginFile(args.plugin);
				break;
			case 'isPluginsEnabled':
				ret = enablePlugins;
				break;
			case 'dirname':
				ret = await dirname(args.path);
				break;
			case 'readFile':
				ret = await readFile(args.filename, args.encoding);
				break;
			case 'clipboardAction':
				ret = await clipboardAction(args.method, args.data);
				break;
			case 'deleteFile':
				ret = await deleteFile(args.file);
				break;
			case 'fileStat':
				ret = await fileStat(args.file);
				break;
			case 'isFileWritable':
				ret = await isFileWritable(args.file);
				break;
			case 'windowAction':
				ret = await windowAction(args.method, getRequestWindow(event)); // CHANGE
				break;
			case 'openExternal':
				ret = await openExternal(args.url);
				break;
			case 'getTrellisAppInfo':
				ret = getTrellisAppInfo();
				break;
			case 'getTrellisDatabaseInfo':
				ret = getTrellisDatabaseInfo(args); // CHANGE: restore UI can compare live and built-in DB state.
				break;
			case 'getTrellisReleases':
				ret = await getTrellisReleases();
				break;
			case 'getTrellisSyncthingShareInfo':
				ret = await getTrellisSyncthingShareInfo(args); // CHANGE
				break;
			case 'trellisShare': { // NEW: narrow sharing methods; never proxy arbitrary REST requests.
				const service = await getScopedSharingService(event.sender.id); // CHANGE: managed identity gardens use their own service.
				const callerId = event.sender.id;
				const payload = args.payload || {};
				if (args.method === 'setContext') {
					const watched = sharingWindowPaths.get(callerId);
					if (payload.diagramPath && (!watched || path.resolve(payload.diagramPath) !== path.resolve(watched))) throw new Error('Sharing document context does not match this window.');
					service.setContext(callerId, payload);
					ret = { ok: true };
				} else if (args.method === 'getStatus') ret = { ok: true, canvases: service.listStatus(callerId) }; // CHANGE
				else if (args.method === 'listCanvases') ret = { ok: true, canvases: await service.listCanvases() }; // NEW: no diagram or daemon startup is required.
				else if (args.method === 'joinCanvas') ret = await service.joinCanvas(payload);
				else if (args.method === 'openAsset') { const reason = await shell.openPath(await service.assetPath(callerId, payload)); ret = { ok: !reason, reason }; } // NEW: open only registered, explicitly copied assets.
				else if (args.method === 'setPaused') ret = await service.setPausedForContext(callerId, payload); // CHANGE: bind renderer pause controls to its open canvas.
				else if (['collaborationAction', 'upgradeCollaboration', 'setupCanvas', 'createInviteBlock', 'createDeviceInvite', 'requestMembership', 'listRequests', 'setConflictState', 'saveRecoveryCopy', 'inspectConflict', 'resolveConflict', 'exportHistory', 'importHistory', 'recovery'].includes(args.method)) ret = await service[args.method](callerId, payload); // CHANGE: all coordination remains bound to the watched document.
				else throw new Error('Unsupported sharing operation.');
				if (['setupCanvas', 'joinCanvas', 'recovery'].includes(args.method)) await ensureSharingTray(service);
				break;
			}
			case 'trellisApiKeys': { // NEW: fixed operations, validated sender, and authenticated identity queue.
				if (!['status', 'save', 'remove'].includes(args.method)) throw new Error('Unsupported API key operation.');
				ret = await (await getIdentityService()).apiKeys(args.method, args.payload || {});
				break;
			}
			case 'trellisIdentity': { // NEW: explicit dispatch never exposes credential or transport objects.
				const identities = await getIdentityService(), payload = args.payload || {};
				if (args.method === 'getSession') ret = identities.session();
				else if (args.method === 'lock') ret = await lockIdentitySafely();
				else if (args.method === 'getDevices') ret = (await identities.requireSession(true)).devices.map(device => ({ id: device.id, name: device.name, kind: device.kind }));
				else if (['list', 'create', 'unlock', 'changePassword', 'createPairRequest', 'approvePairRequest', 'importSetup', 'removeDevice'].includes(args.method)) ret = await identities[args.method](payload);
				else throw new Error('Unsupported identity operation.');
				break;
			}
			case 'trellisGardenLibrary': { // NEW
				await getIdentityService();
				const payload = args.payload || {};
				if (args.method === 'selectLocalFolder') { // NEW: authorize scanning only a folder explicitly selected in the native dialog.
					const paths = await showOpenDialog(undefined, undefined, ['openDirectory']); // NEW
					ret = paths?.length ? await gardenLibraryService.configureLocalFolder(paths[0]) : { ok: false, canceled: true }; // NEW
					break; // NEW
				} // NEW
				if (['importCurrent', 'completeStarter'].includes(args.method)) { // CHANGE: starter completion is bound to the same watched-document authority as import.
					if (!payload.path || path.resolve(payload.path) !== path.resolve(sharingWindowPaths.get(event.sender.id) || '')) throw new Error('Import the currently opened, saved diagram.');
					await assertSharingFileAccess(payload.path, path.join(app.getPath('userData'), 'trellis-identities'));
				}
				if (!['list', 'create', 'completeStarter', 'importCurrent', 'rename', 'setSuffix', 'duplicate', 'download', 'setOffline', 'removeLocal', 'listLocal', 'cities', 'getReferenceCity', 'setReferenceCity', 'actions', 'trash', 'restore', 'purge', 'leave', 'listTrash'].includes(args.method)) throw new Error('Unsupported Garden library operation.'); // CHANGE
				ret = await gardenLibraryService[args.method](payload);
				break;
			}
			case 'trellisField': { // NEW: only the watched garden may export or acknowledge field changes.
				await getIdentityService(); const payload = args.payload || {};
				if (!['publishWork', 'pendingUpdates', 'importUpdates', 'acknowledge'].includes(args.method)) throw new Error('Unsupported field operation.');
				if (args.method === 'acknowledge' && path.resolve(payload.path || '') !== path.resolve(sharingWindowPaths.get(event.sender.id) || '')) throw new Error('Field acknowledgment must come from this window’s saved diagram.');
				ret = await fieldService[args.method](payload); break;
			}
			case 'openTrellisEmailDraft':
				ret = await openTrellisEmailDraft(args); // CHANGE: report rejected launches through the existing IPC result.
				break;
			case 'getTrellisSplashBackground':
				ret = await getTrellisSplashBackground();
				break;
			case 'restoreBuiltInTrellisDatabase':
				ret = restoreBuiltInTrellisDatabase();
				break;
			case 'watchFile':
				ret = await watchFile(args.path, getRequestWindow(event));
				sharingWindowPaths.set(event.sender.id, args.path); // NEW
				break;
			case 'unwatchFile':
				ret = await unwatchFile(args.path, getRequestWindow(event));
				if (sharingWindowPaths.get(event.sender.id) === args.path) { sharingWindowPaths.delete(event.sender.id); sharingService?.forgetContext(event.sender.id); for (const service of identityTransports.values()) service.forgetContext(event.sender.id); } // CHANGE: old identity context cannot authorize a replacement document.
				break;
			case 'exit':
				app.quit();
				break;
			case 'isFullscreen':
				ret = getRequestWindow(event)?.isFullScreen() ?? false; // CHANGE: startup and shutdown do not require a focused window.
				break;
			// (ADD)
			case 'dbResolvePath': {
				const dbName = String(args.dbName || 'Trellis_database.sqlite');
				const livePath = getLiveDbPath(dbName);
			  
				const seedRel = args.seedRelPath == null ? null : String(args.seedRelPath);
				const effectiveSeedRel = seedRel || '../../trellis_database/Trellis_database.sqlite';
				const seedAbs = path.resolve(__dirname, effectiveSeedRel);
			  
				const ensured = args.reset === true
				  ? restoreBuiltInTrellisDatabase({ dbName, seedRelPath: effectiveSeedRel }).dbPath
				  : (args.createIfMissing === true && seedRel == null ? ensureCreatedDb(livePath) : ensureSeededDb(seedAbs, livePath));
			  
				replyToLiveFrame(event, 'mainResp', {
				  reqId: args.reqId,
				  data: { dbPath: ensured }
				});
				break;
			  }			  
			// (ADD)
			case 'dbOpen': {
				// args: { dbPath, readOnly?: boolean, pragma?: object }
				const abs = validateDbPath(args.dbPath);
				const options = { readonly: !!args.readOnly, fileMustExist: args.fileMustExist !== false };
				const db = new Database(abs, options);

				// Optional pragmas (e.g., { journal_mode: 'OFF', synchronous: 0 })
				if (args.pragma && typeof args.pragma === 'object') {
					for (const [key, val] of Object.entries(args.pragma)) {
						if (val === undefined || val === null) continue;
						db.pragma(`${key}=${val}`);
					}
				}
				const dbId = makeDbId();
				dbRegistry.set(dbId, db);
				dbRegistryPaths.set(dbId, abs);
				// reply with handle
				replyToLiveFrame(event, 'mainResp', { reqId: args.reqId, data: { dbId } });
				break;
			}
			// (ADD)	
			case 'dbClose': {
				// args: { dbId }
				const db = dbRegistry.get(args.dbId);
				if (db) { db.close(); dbRegistry.delete(args.dbId); }
				dbRegistryPaths.delete(args.dbId);
				replyToLiveFrame(event, 'mainResp', { reqId: args.reqId, data: true });
				break;
			}
			// (ADD)
			case 'dbQuery': {
				// args: { dbId, sql, params?: any[] | object }
				const db = dbRegistry.get(args.dbId);
				if (!db) throw new Error('db not open');
				const stmt = db.prepare(args.sql);
				const rows = Array.isArray(args.params) || typeof args.params === 'object'
					? stmt.all(args.params)
					: stmt.all();
				replyToLiveFrame(event, 'mainResp', { reqId: args.reqId, data: rows });
				break;
			}
			// (ADD)
			case 'dbExec': {
				// args: { dbId, sql, params?: any[] | object }
				const db = dbRegistry.get(args.dbId);
				if (!db) throw new Error('db not open');
				const stmt = db.prepare(args.sql);
				const info = Array.isArray(args.params) || typeof args.params === 'object'
					? stmt.run(args.params)
					: stmt.run();
				// better-sqlite3 returns info with changes, lastInsertRowid
				replyToLiveFrame(event, 'mainResp', { reqId: args.reqId, data: { changes: info.changes, lastInsertRowid: String(info.lastInsertRowid) } });
				break;
			}
			// (ADD)
			case 'dbPragma': {
				// args: { dbId, name }   // read-only pragma fetch
				const db = dbRegistry.get(args.dbId);
				if (!db) throw new Error('db not open');
				const out = db.pragma(args.name, { simple: true });
				replyToLiveFrame(event, 'mainResp', { reqId: args.reqId, data: out });
				break;
			}

		};

		replyToLiveFrame(event, 'mainResp', { success: true, data: ret, reqId: args.reqId }); // CHANGE
	}
	catch (e) {
		replyToLiveFrame(event, 'mainResp', { error: true, msg: e.message, e: e, reqId: args.reqId }); // CHANGE
	}
});
