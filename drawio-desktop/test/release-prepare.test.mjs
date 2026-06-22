import assert from 'node:assert/strict';
import test from 'node:test';
import {
	bumpVersion,
	formatCommandFailure,
	formatTag,
	isExpectedRemote,
	isValidReleaseVersion,
	normalizeRemoteUrl,
	parseArgs,
	resolveCommand,
} from '../scripts/release-prepare.mjs';

test('validates Trellis release semver strings', () => {
	assert.equal(isValidReleaseVersion('1.0.0'), true);
	assert.equal(isValidReleaseVersion('1.0.0-rc.1'), true);
	assert.equal(isValidReleaseVersion('29.0.3-trellis.1'), true);

	assert.equal(isValidReleaseVersion('v1.0.0'), false);
	assert.equal(isValidReleaseVersion('1.0'), false);
	assert.equal(isValidReleaseVersion('1'), false);
	assert.equal(isValidReleaseVersion('1.0.0-'), false);
});

test('formats release tags from exact versions', () => {
	assert.equal(formatTag('1.0.0'), 'v1.0.0');
	assert.equal(formatTag('1.0.0-rc.1'), 'v1.0.0-rc.1');
	assert.throws(() => formatTag('v1.0.0'), /Invalid release version/);
});

test('computes stable version bumps', () => {
	assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
	assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
	assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
	assert.equal(bumpVersion('1.2.3-rc.1', 'patch'), '1.2.4');
	assert.throws(() => bumpVersion('1.2.3', 'rc'), /Unsupported bump/);
});

test('parses release CLI arguments', () => {
	assert.deepEqual(parseArgs(['--dry-run', '1.0.0-rc.1']), {
		dryRun: true,
		help: false,
		bump: null,
		exactVersion: '1.0.0-rc.1',
	});
	assert.deepEqual(parseArgs(['--bump=patch']), {
		dryRun: false,
		help: false,
		bump: 'patch',
		exactVersion: null,
	});
	assert.throws(() => parseArgs(['1.0.0', '--bump', 'patch']), /either an exact version or --bump/);
	assert.throws(() => parseArgs(['--bump', 'rc']), /Unsupported bump/);
	assert.throws(() => parseArgs(['1.0.0', '1.0.1']), /Unexpected argument/);
});

test('normalizes supported GitHub remotes', () => {
	assert.equal(
		normalizeRemoteUrl('git+https://github.com/Benjamin-Elon/Trellis-for-Drawio.git'),
		'github.com/benjamin-elon/trellis-for-drawio',
	);
	assert.equal(
		normalizeRemoteUrl('git@github.com:Benjamin-Elon/Trellis-for-Drawio.git'),
		'github.com/benjamin-elon/trellis-for-drawio',
	);
	assert.equal(isExpectedRemote('https://github.com/Benjamin-Elon/Trellis-for-Drawio.git'), true);
	assert.equal(isExpectedRemote('https://github.com/jgraph/drawio-desktop.git'), false);
});

test('resolves Yarn through cmd.exe on Windows', () => {
	assert.deepEqual(
		resolveCommand('yarn', ['install', '--frozen-lockfile'], 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }),
		{
			command: 'C:\\Windows\\System32\\cmd.exe',
			args: ['/d', '/s', '/c', 'yarn', 'install', '--frozen-lockfile'],
			displayCommand: 'yarn install --frozen-lockfile',
			resolvedCommand: 'C:\\Windows\\System32\\cmd.exe /d /s /c yarn install --frozen-lockfile',
			windowsYarn: true,
		},
	);
});

test('keeps non-Yarn commands direct', () => {
	assert.deepEqual(resolveCommand('git', ['status', '--porcelain'], 'win32', {}), {
		command: 'git',
		args: ['status', '--porcelain'],
		displayCommand: 'git status --porcelain',
		resolvedCommand: 'git status --porcelain',
		windowsYarn: false,
	});
});

test('formats explicit command failures', () => {
	const spawnError = new Error('spawnSync yarn.cmd EINVAL');
	spawnError.code = 'EINVAL';
	const message = formatCommandFailure({
		command: 'yarn',
		args: ['install', '--frozen-lockfile'],
		cwd: 'C:\\repo\\drawio-desktop',
		resolved: resolveCommand('yarn', ['install', '--frozen-lockfile'], 'win32', { ComSpec: 'cmd.exe' }),
		result: {
			error: spawnError,
			status: null,
			signal: null,
			stdout: '',
			stderr: '',
		},
		captured: true,
	});

	assert.match(message, /Command failed: yarn install --frozen-lockfile/);
	assert.match(message, /cwd: C:\\repo\\drawio-desktop/);
	assert.match(message, /resolved: cmd\.exe \/d \/s \/c yarn install --frozen-lockfile/);
	assert.match(message, /spawn error: EINVAL spawnSync yarn\.cmd EINVAL/);
	assert.match(message, /hint: Yarn must be run through cmd\.exe on Windows\./);
});

test('formats captured stderr before stdout', () => {
	const message = formatCommandFailure({
		command: 'git',
		args: ['status', '--porcelain'],
		cwd: '/repo',
		resolved: resolveCommand('git', ['status', '--porcelain'], 'linux', {}),
		result: {
			error: null,
			status: 128,
			signal: null,
			stdout: 'stdout details',
			stderr: 'stderr details',
		},
		captured: true,
	});

	assert.match(message, /exit status: 128/);
	assert.match(message, /stderr:\nstderr details/);
	assert.doesNotMatch(message, /stdout:\nstdout details/);
});
