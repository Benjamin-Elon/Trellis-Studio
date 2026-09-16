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
} from '../scripts/test-report-runner.mjs';

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
	assert.deepEqual(latest.files[0].tests.map((testRecord) => testRecord.name), ['fixture slow enough to report', 'fixture quick']);
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

	await fs.rm(tempDir, { recursive: true, force: true });
});
