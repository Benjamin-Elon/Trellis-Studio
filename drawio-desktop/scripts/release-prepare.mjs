import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { createInterface } from 'readline/promises';
import { fileURLToPath, pathToFileURL } from 'url';

/**
 * Local release-prep CLI for Trellis for Drawio.
 *
 * This script intentionally stops at pushing a version commit and tag. GitHub
 * Actions owns installer builds and draft-release asset uploads, and humans own
 * final publication while builds are unsigned.
 */
export const RELEASE_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
export const EXPECTED_REMOTE = 'github.com/benjamin-elon/trellis-for-drawio';
export const ACTIONS_URL = 'https://github.com/Benjamin-Elon/Trellis-for-Drawio/actions/workflows/release.yml';
export const RELEASE_URL_BASE = 'https://github.com/Benjamin-Elon/Trellis-for-Drawio/releases/tag';

function usage() {
	return `Usage:
  yarn release:prepare
  yarn release:prepare 1.0.0-rc.1
  yarn release:prepare --bump patch|minor|major
  yarn release:prepare --dry-run 1.0.0-rc.1`;
}

export function isValidReleaseVersion(version) {
	return RELEASE_VERSION_RE.test(version);
}

/**
 * Converts an app version into the tag shape expected by the release workflow.
 */
export function formatTag(version) {
	if (!isValidReleaseVersion(version)) {
		throw new Error(`Invalid release version "${version}". Expected x.y.z or x.y.z-prerelease.`);
	}

	return `v${version}`;
}

/**
 * Computes stable patch/minor/major bumps. Prereleases must be entered exactly
 * so the script does not guess RC numbering policy.
 */
export function bumpVersion(currentVersion, bump) {
	if (!isValidReleaseVersion(currentVersion)) {
		throw new Error(`Current package version "${currentVersion}" is not a supported release version.`);
	}

	if (!['patch', 'minor', 'major'].includes(bump)) {
		throw new Error(`Unsupported bump "${bump}". Use patch, minor, or major.`);
	}

	const [major, minor, patch] = currentVersion.split('-')[0].split('.').map(Number);

	if (bump === 'major') {
		return `${major + 1}.0.0`;
	}

	if (bump === 'minor') {
		return `${major}.${minor + 1}.0`;
	}

	return `${major}.${minor}.${patch + 1}`;
}

/**
 * Parses the intentionally small CLI surface: exact version, stable bump, and
 * dry-run mode.
 */
export function parseArgs(argv) {
	const options = {
		dryRun: false,
		help: false,
		bump: null,
		exactVersion: null,
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		if (arg === '--dry-run') {
			options.dryRun = true;
		}
		else if (arg === '--help' || arg === '-h') {
			options.help = true;
		}
		else if (arg === '--bump') {
			const bump = argv[++i];

			if (bump == null) {
				throw new Error('--bump requires patch, minor, or major.');
			}

			options.bump = bump;
		}
		else if (arg.startsWith('--bump=')) {
			options.bump = arg.substring('--bump='.length);
		}
		else if (arg.startsWith('-')) {
			throw new Error(`Unknown option "${arg}".\n${usage()}`);
		}
		else if (options.exactVersion == null) {
			options.exactVersion = arg;
		}
		else {
			throw new Error(`Unexpected argument "${arg}". Only one exact version is allowed.`);
		}
	}

	if (options.bump != null && !['patch', 'minor', 'major'].includes(options.bump)) {
		throw new Error(`Unsupported bump "${options.bump}". Use patch, minor, or major.`);
	}

	if (options.bump != null && options.exactVersion != null) {
		throw new Error('Use either an exact version or --bump, not both.');
	}

	return options;
}

/**
 * Normalizes GitHub HTTPS and SSH remote URLs to a comparable owner/repo key.
 */
export function normalizeRemoteUrl(remoteUrl) {
	return remoteUrl
		.trim()
		.replace(/^git\+/, '')
		.replace(/^https?:\/\/github\.com\//i, 'github.com/')
		.replace(/^git@github\.com:/i, 'github.com/')
		.replace(/\.git$/i, '')
		.toLowerCase();
}

export function isExpectedRemote(remoteUrl) {
	return normalizeRemoteUrl(remoteUrl) === EXPECTED_REMOTE;
}

function resolvePaths() {
	const scriptPath = fileURLToPath(import.meta.url);
	const appDir = path.resolve(path.dirname(scriptPath), '..');
	const repoRoot = path.resolve(appDir, '..');

	return {
		appDir,
		repoRoot,
		packageJsonPath: path.join(appDir, 'package.json'),
		packageJsonRepoPath: 'drawio-desktop/package.json',
	};
}

export function resolveCommand(command, args, platform = process.platform, env = process.env) {
	if (platform === 'win32' && command === 'yarn') {
		return {
			command: env.ComSpec || 'cmd.exe',
			args: ['/d', '/s', '/c', 'yarn', ...args],
			displayCommand: `yarn ${args.join(' ')}`.trim(),
			resolvedCommand: `${env.ComSpec || 'cmd.exe'} /d /s /c yarn ${args.join(' ')}`.trim(),
			windowsYarn: true,
		}; // Release CLI: Windows cannot reliably spawn yarn.cmd directly from Node.
	}

	return {
		command,
		args,
		displayCommand: `${command} ${args.join(' ')}`.trim(),
		resolvedCommand: `${command} ${args.join(' ')}`.trim(),
		windowsYarn: false,
	};
}

function cleanOutput(value) {
	return value == null ? '' : String(value).trim();
}

export function formatCommandFailure({ command, args, cwd, resolved, result, captured = false }) {
	const lines = [
		`Command failed: ${command} ${args.join(' ')}`.trim(),
		`cwd: ${cwd}`,
		`resolved: ${resolved.resolvedCommand}`,
	];

	if (result.error != null) {
		lines.push(`spawn error: ${result.error.code || 'UNKNOWN'} ${result.error.message}`);
	}

	if (result.status != null) {
		lines.push(`exit status: ${result.status}`);
	}

	if (result.signal != null) {
		lines.push(`signal: ${result.signal}`);
	}

	const stderr = cleanOutput(result.stderr);
	const stdout = cleanOutput(result.stdout);

	if (captured && stderr.length > 0) {
		lines.push(`stderr:\n${stderr}`);
	}
	else if (captured && stdout.length > 0) {
		lines.push(`stdout:\n${stdout}`);
	}

	if (resolved.windowsYarn && result.error != null) {
		lines.push('hint: Yarn must be run through cmd.exe on Windows.');
	}

	return lines.join('\n');
}

function runCommand(command, args, cwd) {
	console.log(`> ${command} ${args.join(' ')}`);
	const resolved = resolveCommand(command, args);

	const result = spawnSync(resolved.command, resolved.args, {
		cwd,
		stdio: 'inherit',
		shell: false,
	});

	if (result.error != null) {
		throw new Error(formatCommandFailure({ command, args, cwd, resolved, result }));
	}

	if (result.status !== 0) {
		throw new Error(formatCommandFailure({ command, args, cwd, resolved, result }));
	}
}

function captureCommand(command, args, cwd, allowFailure = false) {
	const resolved = resolveCommand(command, args);
	const result = spawnSync(resolved.command, resolved.args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		shell: false,
	});

	if (result.error != null) {
		throw new Error(formatCommandFailure({ command, args, cwd, resolved, result, captured: true }));
	}

	if (!allowFailure && result.status !== 0) {
		throw new Error(formatCommandFailure({ command, args, cwd, resolved, result, captured: true }));
	}

	return result;
}

async function readPackage(packageJsonPath) {
	const raw = await fs.readFile(packageJsonPath, 'utf8');
	return JSON.parse(raw);
}

async function writePackageVersion(packageJsonPath, version) {
	const pkg = await readPackage(packageJsonPath);
	pkg.version = version;
	await fs.writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

function requireCleanWorktree(repoRoot) {
	const status = captureCommand('git', ['status', '--porcelain'], repoRoot).stdout.trim();

	if (status.length > 0) {
		throw new Error(`Release prep requires a clean git worktree before changing the version.\n${status}`);
	}
}

function requireOnlyPackageChanged(repoRoot, packageJsonRepoPath) {
	const lines = captureCommand('git', ['status', '--porcelain'], repoRoot).stdout
		.split(/\r?\n/)
		.filter(Boolean);
	const unexpected = lines.filter((line) => line.substring(3).replace(/\\/g, '/') !== packageJsonRepoPath);

	if (unexpected.length > 0) {
		throw new Error(`Release prep only expects ${packageJsonRepoPath} to change.\n${unexpected.join('\n')}`);
	}
}

function readCurrentBranch(repoRoot) {
	const result = captureCommand('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot, true);

	if (result.status !== 0) {
		throw new Error('Release prep requires a checked-out branch; detached HEAD is not supported.');
	}

	return result.stdout.trim();
}

function requireExpectedRemote(repoRoot) {
	const remote = captureCommand('git', ['remote', 'get-url', 'origin'], repoRoot).stdout.trim();

	if (!isExpectedRemote(remote)) {
		throw new Error(`origin must point to Benjamin-Elon/Trellis-for-Drawio. Found: ${remote}`);
	}

	return remote;
}

function requireTagDoesNotExist(repoRoot, tag) {
	const result = captureCommand('git', ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`], repoRoot, true);

	if (result.status === 0) {
		throw new Error(`Local tag ${tag} already exists.`);
	}
}

async function promptForVersion(currentVersion) {
	const patch = bumpVersion(currentVersion, 'patch');
	const minor = bumpVersion(currentVersion, 'minor');
	const major = bumpVersion(currentVersion, 'major');
	const rl = createInterface({ input: process.stdin, output: process.stdout });

	try {
		console.log(`Current version: ${currentVersion}`);
		console.log(`1) patch ${patch}`);
		console.log(`2) minor ${minor}`);
		console.log(`3) major ${major}`);
		console.log('4) exact version');

		const choice = (await rl.question('Choose next version [1]: ')).trim() || '1';

		if (choice === '1' || choice.toLowerCase() === 'patch') return patch;
		if (choice === '2' || choice.toLowerCase() === 'minor') return minor;
		if (choice === '3' || choice.toLowerCase() === 'major') return major;

		if (choice === '4' || choice.toLowerCase() === 'exact') {
			return (await rl.question('Exact version, for example 1.0.0-rc.1: ')).trim();
		}

		throw new Error(`Unknown version choice "${choice}".`);
	}
	finally {
		rl.close();
	}
}

async function resolveNextVersion(options, currentVersion) {
	if (options.exactVersion != null) {
		return options.exactVersion;
	}

	if (options.bump != null) {
		return bumpVersion(currentVersion, options.bump);
	}

	return promptForVersion(currentVersion);
}

function printPlan({ branch, currentVersion, version, tag, dryRun }) {
	const prefix = dryRun ? '[dry-run] ' : '';

	console.log(`${prefix}Release preparation plan:`);
	console.log(`${prefix}- Update drawio-desktop/package.json ${currentVersion} -> ${version}`);
	console.log(`${prefix}- Run yarn install --frozen-lockfile`);
	console.log(`${prefix}- Run yarn test`);
	console.log(`${prefix}- Commit Release ${tag}`);
	console.log(`${prefix}- Create annotated tag ${tag}`);
	console.log(`${prefix}- Push branch ${branch}`);
	console.log(`${prefix}- Push tag ${tag}`);
}

/**
 * Runs the strict release-prep flow. All mutating git operations happen only
 * after validation, install, and tests have succeeded.
 */
export async function runReleasePrepare(argv = process.argv.slice(2)) {
	const options = parseArgs(argv);

	if (options.help) {
		console.log(usage());
		return;
	}

	const paths = resolvePaths();
	const pkg = await readPackage(paths.packageJsonPath);
	const currentVersion = pkg.version;

	requireCleanWorktree(paths.repoRoot);
	const branch = readCurrentBranch(paths.repoRoot);
	requireExpectedRemote(paths.repoRoot);

	const version = await resolveNextVersion(options, currentVersion);

	if (!isValidReleaseVersion(version)) {
		throw new Error(`Invalid release version "${version}". Expected x.y.z or x.y.z-prerelease.`);
	}

	if (version === currentVersion) {
		throw new Error(`New version must differ from current version ${currentVersion}.`);
	}

	const tag = formatTag(version);
	requireTagDoesNotExist(paths.repoRoot, tag);
	printPlan({ branch, currentVersion, version, tag, dryRun: options.dryRun });

	if (!options.dryRun) {
		await writePackageVersion(paths.packageJsonPath, version);
		requireOnlyPackageChanged(paths.repoRoot, paths.packageJsonRepoPath);
	}

	runCommand('yarn', ['install', '--frozen-lockfile'], paths.appDir);
	runCommand('yarn', ['test'], paths.appDir);

	if (options.dryRun) {
		console.log('[dry-run] No files changed, commits created, tags created, or pushes performed.');
		console.log(`[dry-run] Actions: ${ACTIONS_URL}`);
		console.log(`[dry-run] Draft release URL after tag build: ${RELEASE_URL_BASE}/${tag}`);
		return;
	}

	requireOnlyPackageChanged(paths.repoRoot, paths.packageJsonRepoPath);

	runCommand('git', ['add', paths.packageJsonRepoPath], paths.repoRoot);
	runCommand('git', ['commit', '-m', `Release ${tag}`], paths.repoRoot);
	runCommand('git', ['tag', '-a', tag, '-m', `Trellis for Drawio ${version}`], paths.repoRoot);
	runCommand('git', ['push', 'origin', `HEAD:${branch}`], paths.repoRoot);
	runCommand('git', ['push', 'origin', tag], paths.repoRoot);

	console.log(`Release tag pushed: ${tag}`);
	console.log(`Actions: ${ACTIONS_URL}`);
	console.log(`Draft release URL after workflow creates it: ${RELEASE_URL_BASE}/${tag}`);
}

const isEntrypoint = process.argv[1] != null &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntrypoint) {
	runReleasePrepare().catch((error) => {
		console.error(`Release prepare failed: ${error.message}`);
		process.exitCode = 1;
	});
}
