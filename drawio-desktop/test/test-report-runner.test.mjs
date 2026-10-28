import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	buildTestReport,
	formatMarkdownReport,
	parseNdjsonEvents,
	parseCliArgs, planTestLanes, runCli, // CHANGE
} from '../scripts/test-report-runner.mjs';
import ndjsonReporter from '../scripts/test-report-ndjson-reporter.mjs'; // CHANGE

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runnerPath = path.join(projectRoot, 'scripts', 'test-report-runner.mjs');

function event(type, data) {
	return { type, data };
}

function runNode(args, cwd = projectRoot) {
	return new Promise((resolve, reject) => {
		const env = { ...process.env };
		delete env.NODE_TEST_CONTEXT; // CHANGE: nested fixture runs must execute instead of being skipped by node:test recursion guards.
		const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => { stdout += chunk; });
		child.stderr.on('data', (chunk) => { stderr += chunk; });
		child.on('error', reject);
		child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
	});
}

test('test report aggregates files and tests by descending duration', () => {
	const events = [
		event('test:pass', { name: 'fast b', file: 'C:/repo/test/b.test.mjs', line: 2, column: 1, details: { duration_ms: 5 } }),
		event('test:pass', { name: 'slow a', file: 'C:/repo/test/a.test.mjs', line: 3, column: 1, details: { duration_ms: 20 } }),
		event('test:pass', { name: 'fast a', file: 'C:/repo/test/a.test.mjs', line: 4, column: 1, details: { duration_ms: 1 } }),
		event('test:summary', { file: 'C:/repo/test/b.test.mjs', duration_ms: 30, counts: { tests: 1, passed: 1 } }),
		event('test:summary', { file: 'C:/repo/test/a.test.mjs', duration_ms: 80, counts: { tests: 2, passed: 2 } }),
		event('test:summary', { success: true, duration_ms: 120, counts: { tests: 3, passed: 3, failed: 0, skipped: 0, todo: 0 } }),
	];
	const report = buildTestReport(events, { projectRoot: 'C:/repo', generatedAt: '2026-09-15T00:00:00.000Z', nodeVersion: 'v22.20.0', exitCode: 0 });

	assert.deepEqual(report.files.map((file) => file.file), ['test/a.test.mjs', 'test/b.test.mjs']);
	assert.deepEqual(report.files[0].tests.map((testRecord) => testRecord.name), ['slow a', 'fast a']);
	assert.equal(report.files[0].testDurationMs, 21);
	assert.equal(report.status, 'passed');
});

test('default discovery assigns every file once and serializes native and runtime owners', () => { // CHANGE
	const files = ['./test/plain.test.mjs', './test/a-electron.test.cjs', './test/trellis-identity-runtime.test.mjs', './test/trellis-save-stress.test.mjs']; // CHANGE
	const options = parseCliArgs(['--test-name-pattern', 'two words']); // CHANGE
	const lanes = planTestLanes(options.testArgs, files, options.defaultDiscovery); // CHANGE
	assert.deepEqual(lanes.map(lane => lane.name), ['ordinary', 'native', 'runtime']); // CHANGE
	assert.deepEqual(lanes.flatMap(lane => lane.testArgs.filter(arg => files.includes(arg))).sort(), [...files].sort()); // CHANGE
	assert.ok(!lanes[0].testArgs.includes('--test-concurrency=1')); // CHANGE
	for (const lane of lanes.slice(1)) assert.ok(lane.testArgs.includes('--test-concurrency=1')); // CHANGE
	for (const lane of lanes) assert.deepEqual(lane.testArgs.slice(0, 2), ['--test-name-pattern', 'two words']); // CHANGE
	const selected = ['--test-name-pattern=a b', './test/a-electron.test.cjs']; // CHANGE
	assert.deepEqual(planTestLanes(selected, files)[0].testArgs, ['--test-concurrency=1', ...selected]); // CHANGE
}); // CHANGE

test('lane reports accumulate counts and retain process failures despite successful summaries', () => { // CHANGE
	const report = buildTestReport([event('test:summary', { success: false, duration_ms: 10, counts: { tests: 2, failed: 1, passed: 1 } }), event('test:summary', { success: true, duration_ms: 20, counts: { tests: 3, passed: 2, skipped: 1 } })], { exitCode: 1 }); // CHANGE
	assert.equal(report.status, 'failed'); assert.equal(report.counts.tests, 5); assert.equal(report.counts.failed, 1); assert.equal(report.durationMs, 30); // CHANGE
	assert.equal(buildTestReport([event('test:summary', { success: true })], { exitCode: 1 }).status, 'failed'); // CHANGE
}); // CHANGE

test('runner awaits lanes and continues after an earlier failed lane', async () => { // CHANGE
	const seen = []; let active = false, report; // CHANGE
	const code = await runCli([], { // CHANGE
		discover: async () => ['./test/plain.test.mjs', './test/a-electron.test.cjs'], makeTempDir: async () => '/tmp/lanes', // CHANGE
		runTests: async ({ testArgs }) => { assert.equal(active, false); active = true; await new Promise(resolve => setTimeout(resolve, 5)); seen.push(testArgs); active = false; return { code: seen.length === 1 ? 1 : 0 }; }, // CHANGE
		readFile: async () => JSON.stringify(event('test:summary', { success: true, counts: { tests: 1, passed: 1 } })), // CHANGE
		write: async value => { report = value; }, prune: async () => {}, rm: async () => {} // CHANGE
	}); // CHANGE
	assert.equal(code, 1); assert.equal(seen.length, 2); assert.equal(report.counts.tests, 2); assert.equal(report.status, 'failed'); // CHANGE
}); // CHANGE

test('test report markdown shows slowest file and test tables', () => {
	const report = buildTestReport([
		event('test:fail', { name: 'breaks loudly', file: 'C:/repo/test/slow.test.mjs', line: 7, column: 2, details: { duration_ms: 10, error: { code: 'ERR_TEST_FAILURE', cause: { message: 'Expected true' } } } }),
		event('test:summary', { file: 'C:/repo/test/slow.test.mjs', duration_ms: 15, counts: { tests: 1, failed: 1 } }),
		event('test:summary', { success: false, duration_ms: 20, counts: { tests: 1, passed: 0, failed: 1, skipped: 0, todo: 0 } }),
	], { projectRoot: 'C:/repo', generatedAt: '2026-09-15T00:00:00.000Z', nodeVersion: 'v22.20.0', exitCode: 1 });

	const markdown = formatMarkdownReport(report);

	assert.match(markdown, /# Test Duration Report/);
	assert.match(markdown, /\| test\/slow\.test\.mjs \| 15\.000 ms \| 10\.000 ms \| 1 \| 0 passed, 1 failed/);
	assert.match(markdown, /\| breaks loudly \| 10\.000 ms \| failed \| 7:2 \| Expected true \|/);
});

test('test report parser reads newline-delimited reporter events', () => {
	const events = parseNdjsonEvents('{"type":"test:summary","data":{"success":true}}\n\n{"type":"test:plan","data":{"count":1}}\n');

	assert.deepEqual(events.map((item) => item.type), ['test:summary', 'test:plan']);
});

test('structured reporter retains native Error messages, stacks and circular nested causes', async () => { // CHANGE
	const cause = new TypeError('inner failure'), original = Object.assign(new Error('outer failure', { cause }), { code: 'DIAGNOSTIC' }); // CHANGE
	const error = Object.create(Error.prototype, { ...Object.getOwnPropertyDescriptors(original), stack: { value: original.stack } }); cause.cause = error; // CHANGE: Node transports the evaluated stack string, rather than its native lazy getter.
	const lines = []; for await (const line of ndjsonReporter([{ type: 'test:fail', data: { details: { error } } }])) lines.push(line); // CHANGE
	const saved = JSON.parse(lines.join('')).data.details.error; // CHANGE
	assert.equal(saved.message, 'outer failure'); assert.equal(saved.code, 'DIAGNOSTIC'); assert.match(saved.stack, /outer failure/); // CHANGE
	assert.equal(saved.cause.message, 'inner failure'); assert.equal(saved.cause.name, 'TypeError'); assert.equal(saved.cause.cause, '[Circular Error]'); // CHANGE
}); // CHANGE

test('test report runner writes latest and history artifacts for passing tests', async () => {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-test-report-pass-'));
	const reportDir = path.join(tempDir, 'reports');
	const fixture = path.join(tempDir, 'fixture.test.mjs');
	await fs.writeFile(fixture, `
import test from 'node:test';
import assert from 'node:assert/strict';
test('fixture slow enough to report', async () => {
	await new Promise(resolve => setTimeout(resolve, 15));
	assert.equal(1, 1);
});
test('fixture quick', () => assert.equal(2, 2));
`);

	const result = await runNode([runnerPath, '--out-dir', reportDir, '--history-limit', '50', '--', fixture]);

	assert.equal(result.code, 0, result.stderr || result.stdout);
	const latest = JSON.parse(await fs.readFile(path.join(reportDir, 'latest.json'), 'utf8'));
	const markdown = await fs.readFile(path.join(reportDir, 'latest.md'), 'utf8');
	const history = await fs.readdir(path.join(reportDir, 'history'));

	assert.equal(latest.status, 'passed');
	assert.equal(latest.files.length, 1);
	const recorded = latest.files[0].tests; // CHANGE: operating-system scheduling can make the nominally quick fixture slower than its timer fixture.
	assert.deepEqual(recorded.map((testRecord) => testRecord.name).sort(), ['fixture quick', 'fixture slow enough to report']); // CHANGE
	assert.ok(recorded[0].durationMs >= recorded[1].durationMs); // CHANGE: verify measured sorting; fixed-duration parser tests establish the deterministic ordering contract.
	assert.match(markdown, /Slowest Files/);
	assert.equal(history.filter((entry) => entry.endsWith('.json')).length, 1);
	assert.equal(history.filter((entry) => entry.endsWith('.md')).length, 1);

	await fs.rm(tempDir, { recursive: true, force: true });
});

test('test report runner writes reports and preserves failing exit codes', async () => {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-test-report-fail-'));
	const reportDir = path.join(tempDir, 'reports');
	const fixture = path.join(tempDir, 'fixture-fail.test.mjs');
	await fs.writeFile(fixture, `
import test from 'node:test';
import assert from 'node:assert/strict';
test('fixture fails', () => assert.equal(1, 2));
`);

	const result = await runNode([runnerPath, '--out-dir', reportDir, '--history-limit', '50', '--', fixture]);

	assert.equal(result.code, 1);
	const latest = JSON.parse(await fs.readFile(path.join(reportDir, 'latest.json'), 'utf8'));
	assert.equal(latest.status, 'failed');
	assert.equal(latest.counts.failed, 1);
	assert.equal(latest.files[0].failures[0].name, 'fixture fails');
	assert.match(latest.files[0].failures[0].error, /1 !== 2/); // CHANGE: real child-process errors must reach the saved report with their original message.

	await fs.rm(tempDir, { recursive: true, force: true });
});
