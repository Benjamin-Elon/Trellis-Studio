import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_TEST_PATTERNS = ['./test/*.test.cjs', './test/*.test.mjs'];
const DEFAULT_REPORT_DIR = path.join(PROJECT_ROOT, 'test-results');
const DEFAULT_HISTORY_LIMIT = 50;
const REPORTER_PATH = path.join(SCRIPT_DIR, 'test-report-ndjson-reporter.mjs');

function normalizeSlashes(value) {
	return String(value || '').replace(/\\/g, '/');
}

function stableTimestamp(date = new Date()) {
	return date.toISOString().replace(/[:.]/g, '-');
}

function roundMs(value) {
	return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}

function zeroCounts() {
	return { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0, suites: 0 };
}

function addCounts(target, source = {}) {
	for (const key of Object.keys(target)) {
		target[key] += Number(source[key] || 0);
	}
}

function statusFromEventType(type, details = {}) {
	if (type === 'test:pass') return 'passed';
	if (type === 'test:fail') return 'failed';
	if (type === 'test:skip') return 'skipped';
	if (type === 'test:todo') return 'todo';
	if (details.cancelled) return 'cancelled';
	return details.passed === false ? 'failed' : 'unknown';
}

function errorSummary(error) {
	if (!error) return '';
	const cause = error.cause && typeof error.cause === 'object' ? error.cause : null;
	return String(
		cause?.message ||
		error.message ||
		cause?.code ||
		error.code ||
		error.failureType ||
		'Test failed',
	);
}

function relativePath(file, projectRoot) {
	if (!file) return '';
	const absolute = path.resolve(file);
	const relative = path.relative(projectRoot, absolute);
	return normalizeSlashes(relative && !relative.startsWith('..') ? relative : file);
}

function fileKey(file) {
	return path.resolve(String(file || ''));
}

function ensureFile(files, file, projectRoot) {
	const key = fileKey(file);
	if (!files.has(key)) {
		files.set(key, {
			file: relativePath(file, projectRoot),
			absoluteFile: path.resolve(file),
			durationMs: 0,
			testDurationMs: 0,
			counts: zeroCounts(),
			tests: [],
			failures: [],
		});
	}
	return files.get(key);
}

function sortByDurationThenName(left, right) {
	return (right.durationMs || 0) - (left.durationMs || 0) || String(left.name || left.file).localeCompare(String(right.name || right.file));
}

export function parseNdjsonEvents(text) {
	return String(text || '')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

export function buildTestReport(events, options = {}) {
	const projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT);
	const generatedAt = options.generatedAt || new Date().toISOString();
	const files = new Map();
	const runCounts = zeroCounts();
	let runDurationMs = 0;
	let runSuccess = options.exitCode === 0;

	for (const event of events) {
		const data = event?.data || {};

		if (data.file) ensureFile(files, data.file, projectRoot);

		if (event.type === 'test:summary' && data.file) {
			const file = ensureFile(files, data.file, projectRoot);
			file.durationMs = roundMs(data.duration_ms || file.durationMs);
			file.counts = { ...zeroCounts(), ...file.counts, ...data.counts };
			continue;
		}

		if (event.type === 'test:summary' && !data.file) {
			runDurationMs = roundMs(data.duration_ms || runDurationMs);
			runSuccess = Boolean(data.success);
			Object.assign(runCounts, { ...zeroCounts(), ...data.counts });
			continue;
		}

		if (!['test:pass', 'test:fail', 'test:skip', 'test:todo'].includes(event.type) || !data.file) {
			continue;
		}

		const file = ensureFile(files, data.file, projectRoot);
		const details = data.details || {};
		const durationMs = roundMs(details.duration_ms || 0);
		const testRecord = {
			name: String(data.name || '(unnamed test)'),
			status: statusFromEventType(event.type, details),
			durationMs,
			line: data.line || null,
			column: data.column || null,
			error: errorSummary(details.error),
		};

		file.tests.push(testRecord);
		file.testDurationMs = roundMs(file.testDurationMs + durationMs);
		if (testRecord.status === 'failed') file.failures.push(testRecord);
	}

	for (const file of files.values()) {
		if (!file.counts.tests) {
			file.counts = zeroCounts();
			for (const testRecord of file.tests) {
				file.counts.tests += 1;
				if (testRecord.status === 'passed') file.counts.passed += 1;
				else if (testRecord.status === 'failed') file.counts.failed += 1;
				else if (testRecord.status === 'skipped') file.counts.skipped += 1;
				else if (testRecord.status === 'todo') file.counts.todo += 1;
				else if (testRecord.status === 'cancelled') file.counts.cancelled += 1;
			}
		}
		file.tests.sort(sortByDurationThenName);
	}

	if (!runCounts.tests && files.size) {
		for (const file of files.values()) addCounts(runCounts, file.counts);
	}

	const sortedFiles = Array.from(files.values()).sort(sortByDurationThenName);
	const slowestTests = sortedFiles
		.flatMap((file) => file.tests.map((testRecord) => ({ ...testRecord, file: file.file })))
		.sort(sortByDurationThenName)
		.slice(0, 25);

	return {
		version: 1,
		generatedAt,
		status: runSuccess ? 'passed' : 'failed',
		nodeVersion: options.nodeVersion || process.version,
		durationMs: runDurationMs || roundMs(sortedFiles.reduce((sum, file) => sum + file.durationMs, 0)),
		counts: runCounts,
		files: sortedFiles,
		slowestTests,
	};
}

function markdownCell(value) {
	return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function formatMs(value) {
	return `${roundMs(value).toFixed(3)} ms`;
}

function formatCounts(counts) {
	return `${counts.passed || 0} passed, ${counts.failed || 0} failed, ${counts.skipped || 0} skipped, ${counts.todo || 0} todo`;
}

export function formatMarkdownReport(report) {
	const lines = [
		'# Test Duration Report',
		'',
		`- Status: ${report.status}`,
		`- Generated: ${report.generatedAt}`,
		`- Node: ${report.nodeVersion}`,
		`- Total duration: ${formatMs(report.durationMs)}`,
		`- Counts: ${formatCounts(report.counts)}`,
		'',
		'## Slowest Files',
		'',
		'| File | Wall duration | Test duration | Tests | Result |',
		'| --- | ---: | ---: | ---: | --- |',
	];

	for (const file of report.files) {
		lines.push(`| ${markdownCell(file.file)} | ${formatMs(file.durationMs)} | ${formatMs(file.testDurationMs)} | ${file.counts.tests || file.tests.length} | ${markdownCell(formatCounts(file.counts))} |`);
	}

	if (report.slowestTests.length) {
		lines.push('', '## Slowest Tests', '', '| Test | File | Duration | Status | Location |', '| --- | --- | ---: | --- | --- |');
		for (const testRecord of report.slowestTests) {
			const location = testRecord.line ? `${testRecord.line}${testRecord.column ? `:${testRecord.column}` : ''}` : '';
			lines.push(`| ${markdownCell(testRecord.name)} | ${markdownCell(testRecord.file)} | ${formatMs(testRecord.durationMs)} | ${markdownCell(testRecord.status)} | ${location} |`);
		}
	}

	for (const file of report.files) {
		lines.push('', `## ${file.file}`, '', `Wall duration: ${formatMs(file.durationMs)}; test duration: ${formatMs(file.testDurationMs)}; ${formatCounts(file.counts)}.`, '');
		lines.push('| Test | Duration | Status | Location | Failure |', '| --- | ---: | --- | --- | --- |');
		for (const testRecord of file.tests) {
			const location = testRecord.line ? `${testRecord.line}${testRecord.column ? `:${testRecord.column}` : ''}` : '';
			lines.push(`| ${markdownCell(testRecord.name)} | ${formatMs(testRecord.durationMs)} | ${markdownCell(testRecord.status)} | ${location} | ${markdownCell(testRecord.error)} |`);
		}
		if (!file.tests.length) lines.push('| _(no test events)_ | 0.000 ms | unknown |  |  |');
	}

	lines.push('');
	return `${lines.join('\n')}`;
}

async function writeReport(report, reportDir, timestamp) {
	const historyDir = path.join(reportDir, 'history');
	const json = `${JSON.stringify(report, null, 2)}\n`;
	const markdown = formatMarkdownReport(report);
	const jsonName = `${timestamp}.json`;
	const markdownName = `${timestamp}.md`;

	await fs.mkdir(historyDir, { recursive: true });
	await Promise.all([
		fs.writeFile(path.join(reportDir, 'latest.json'), json),
		fs.writeFile(path.join(reportDir, 'latest.md'), markdown),
		fs.writeFile(path.join(historyDir, jsonName), json),
		fs.writeFile(path.join(historyDir, markdownName), markdown),
	]);
}

async function pruneHistory(reportDir, limit) {
	if (!Number.isFinite(limit) || limit <= 0) return;
	const historyDir = path.join(reportDir, 'history');
	let entries;
	try {
		entries = await fs.readdir(historyDir);
	} catch (error) {
		if (error.code === 'ENOENT') return;
		throw error;
	}

	const stems = new Set(entries.map((entry) => entry.replace(/\.(json|md)$/i, '')));
	const stale = Array.from(stems).sort().slice(0, Math.max(0, stems.size - limit));
	await Promise.all(stale.flatMap((stem) => [
		fs.rm(path.join(historyDir, `${stem}.json`), { force: true }),
		fs.rm(path.join(historyDir, `${stem}.md`), { force: true }),
	]));
}

function parseCliArgs(argv) {
	const options = {
		reportDir: DEFAULT_REPORT_DIR,
		historyLimit: DEFAULT_HISTORY_LIMIT,
		testArgs: [],
	};
	let passthrough = false;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (passthrough) {
			options.testArgs.push(arg);
		} else if (arg === '--') {
			passthrough = true;
		} else if (arg === '--out-dir') {
			options.reportDir = path.resolve(argv[++index]);
		} else if (arg.startsWith('--out-dir=')) {
			options.reportDir = path.resolve(arg.slice('--out-dir='.length));
		} else if (arg === '--history-limit') {
			options.historyLimit = Number(argv[++index]);
		} else if (arg.startsWith('--history-limit=')) {
			options.historyLimit = Number(arg.slice('--history-limit='.length));
		} else {
			options.testArgs.push(arg);
		}
	}

	if (!options.testArgs.length) options.testArgs = DEFAULT_TEST_PATTERNS.slice();
	return options;
}

function runNodeTests({ testArgs, eventsPath }) {
	const args = [
		'--test',
		'--test-reporter=spec',
		'--test-reporter-destination=stdout',
		`--test-reporter=${pathToFileURL(REPORTER_PATH).href}`,
		`--test-reporter-destination=${eventsPath}`,
		...testArgs,
	];

	return new Promise((resolve) => {
		const child = spawn(process.execPath, args, { cwd: PROJECT_ROOT, stdio: 'inherit' });
		child.on('close', (code, signal) => resolve({ code, signal }));
		child.on('error', (error) => {
			console.error(error);
			resolve({ code: 1, signal: null });
		});
	});
}

export async function runCli(argv = process.argv.slice(2), operations = {}) {
	const {
		parseArgs = parseCliArgs,
		makeTempDir = fs.mkdtemp,
		readFile = fs.readFile,
		rm = fs.rm,
		runTests = runNodeTests,
		write = writeReport,
		prune = pruneHistory,
		now = () => new Date(),
	} = operations;
	const options = parseArgs(argv);
	const timestamp = stableTimestamp(now());
	const tempDir = await makeTempDir(path.join(os.tmpdir(), 'trellis-test-events-'));
	const eventsPath = path.join(tempDir, 'events.ndjson');
	const result = await runTests({ testArgs: options.testArgs, eventsPath });
	let events = [];

	try {
		events = parseNdjsonEvents(await readFile(eventsPath, 'utf8'));
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}

	const exitCode = result.code == null ? 1 : result.code;
	const report = buildTestReport(events, {
		exitCode,
		generatedAt: now().toISOString(),
		nodeVersion: process.version,
		projectRoot: PROJECT_ROOT,
	});

	await write(report, options.reportDir, timestamp);
	await prune(options.reportDir, options.historyLimit);
	await rm(tempDir, { recursive: true, force: true });
	console.log(`\nTest duration report: ${path.relative(PROJECT_ROOT, path.join(options.reportDir, 'latest.md'))}`);

	return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
	runCli()
		.then((exitCode) => {
			process.exitCode = exitCode;
		})
		.catch((error) => {
			console.error(error);
			process.exitCode = 1;
		});
}
