/** Run every local suite with separate totals and an auditable source manifest. */ // CHANGE
import { spawn, execFile } from 'node:child_process'; // CHANGE
import { promisify } from 'node:util'; // CHANGE
import fs from 'node:fs/promises'; // CHANGE
import path from 'node:path'; // CHANGE
import crypto from 'node:crypto'; // CHANGE
import { fileURLToPath } from 'node:url'; // CHANGE
const script = fileURLToPath(import.meta.url), project = path.resolve(path.dirname(script), '..'); // CHANGE
const exec = promisify(execFile); // CHANGE

/** Include tracked and untracked implementation/configuration inputs, excluding generated caches and results. */ // CHANGE
export async function sourceManifest() { // CHANGE
    const { stdout } = await exec('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: project, maxBuffer: 32 * 1024 * 1024, windowsHide: true }); // CHANGE
    const files = [...new Set(stdout.split('\0').filter(name => name && !/(?:^|\/)(?:node_modules|build|dist|\.gradle|\.tool-cache|\.test-artifacts|test-results)(?:\/|$)/.test(name) && /\.(?:[cm]?js|json|py|java|kt|gradle|xml|html|css|properties|toml)$/.test(name)))].sort(); // CHANGE
    const entries = {}; // CHANGE
    for (const name of files) { try { entries[name] = crypto.createHash('sha256').update(await fs.readFile(path.join(project, name))).digest('hex'); } catch (error) { if (error.code !== 'ENOENT') throw error; entries[name] = 'missing'; } } // CHANGE
    return entries; // CHANGE
} // CHANGE

/** These are independent suites; their test/scenario counts must never be added together. */ // CHANGE
export function fullSuiteCommands(output, env = process.env) { // CHANGE
    const android = path.join(project, 'android-companion'), javaRoot = env.JAVA_HOME || 'C:/Program Files/Android/Android Studio/jbr'; // CHANGE
    const androidEnv = { JAVA_HOME: javaRoot, ANDROID_HOME: env.ANDROID_HOME || path.join(env.LOCALAPPDATA || '', 'Android/Sdk'), GRADLE_USER_HOME: path.join(android, '.tool-cache/gradle') }; // CHANGE
    return [ // CHANGE
        { name: 'node', command: process.execPath, args: ['scripts/test-report-runner.mjs', '--out-dir', path.join(output, 'node')], env: { TRELLIS_SYNCTHING_RUNTIME_TEST: '1', TRELLIS_SAVE_STRESS_TEST: '1', TRELLIS_DIALOG_BENCHMARK: '1', TRELLIS_GARDEN_JOIN_ELECTRON_TEST: '1', TRELLIS_IDENTITY_LOGIN_ELECTRON_TEST: '1' } }, // CHANGE
        { name: 'python', command: env.PYTHON || 'python', args: ['-m', 'unittest', 'discover', '-s', './test/trellis_seed', '-p', 'test_*.py'] }, // CHANGE
        { name: 'android-host', command: process.execPath, args: ['--test', 'test/*.test.mjs'], cwd: android }, // CHANGE
        { name: 'android-jvm', command: path.join(javaRoot, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), args: ['-classpath', 'gradle/wrapper/gradle-wrapper.jar', 'org.gradle.wrapper.GradleWrapperMain', '--no-daemon', '--offline', '--rerun-tasks', ':app:testDebugUnitTest'], cwd: path.join(android, 'android'), env: androidEnv }, // CHANGE: execute assertions on each full run rather than accepting an UP-TO-DATE test result.
        { name: 'android-native-ownership', command: process.execPath, args: ['scripts/test-native-engine-policy.mjs'], cwd: android, env: androidEnv }, // CHANGE
        { name: 'production-home', command: process.execPath, args: ['scripts/run-production-smoke.cjs'] } // CHANGE
    ]; // CHANGE
} // CHANGE

/** Keep an independent log and honor the actual child exit, including signals and launch errors. */ // CHANGE
async function runSuite(suite, logPath) { // CHANGE
    const log = await fs.open(logPath, 'w'); // CHANGE
    try { // CHANGE
        return await new Promise(resolve => { // CHANGE
            const env = { ...process.env, ...suite.env }; delete env.NODE_TEST_CONTEXT; delete env.ELECTRON_RUN_AS_NODE; // CHANGE
            const child = spawn(suite.command, suite.args, { cwd: suite.cwd || project, env, windowsHide: true, stdio: ['ignore', log.fd, log.fd] }); // CHANGE
            child.once('error', error => resolve({ exitCode: 1, error: error.message })); // CHANGE
            child.once('close', (code, signal) => resolve({ exitCode: signal ? 1 : code ?? 1, signal })); // CHANGE
        }); // CHANGE
    } finally { await log.close(); } // CHANGE
} // CHANGE

/** Continue after failures to provide complete coverage, then invalidate results if inputs changed during the run. */ // CHANGE
export async function runFullSuite(output, operations = {}) { // CHANGE
    const manifest = operations.manifest || sourceManifest, execute = operations.execute || runSuite; // CHANGE
    await fs.mkdir(output, { recursive: true }); const before = await manifest(), results = []; // CHANGE
    await fs.writeFile(path.join(output, 'source-before.json'), JSON.stringify(before, null, 2)); // CHANGE
    for (const suite of operations.suites || fullSuiteCommands(output)) { // CHANGE
        console.log('FULL_SUITE:', suite.name, 'started', new Date().toISOString()); const started = Date.now(), log = path.join(output, suite.name + '.log'); // CHANGE
        let result; try { result = await execute(suite, log); } catch (error) { result = { exitCode: 1, error: error.message }; } // CHANGE
        results.push({ name: suite.name, ...result, durationMs: Date.now() - started, log }); console.log('FULL_SUITE:', suite.name, 'exit', result.exitCode); // CHANGE
    } // CHANGE
    const after = await manifest(), changedSources = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => before[name] !== after[name]); // CHANGE
    const status = results.some(result => result.exitCode !== 0) ? 'failed' : changedSources.length ? 'invalidated' : 'passed'; // CHANGE
    const summary = { generatedAt: new Date().toISOString(), status, sourceStable: changedSources.length === 0, changedSources, suites: results }; // CHANGE
    await fs.writeFile(path.join(output, 'source-after.json'), JSON.stringify(after, null, 2)); // CHANGE
    await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2)); // CHANGE
    await fs.writeFile(path.join(output, 'summary.md'), '# Full local suite\n\nStatus: ' + status + '. Source stable: ' + summary.sourceStable + '.\n\n| Suite | Exit | Duration (ms) |\n| --- | ---: | ---: |\n' + results.map(result => '| ' + result.name + ' | ' + result.exitCode + ' | ' + result.durationMs + ' |').join('\n') + '\n\nEach suite retains its own counts and log. Node details are in node/latest.md.\n' + (changedSources.length ? '\nChanged inputs:\n' + changedSources.map(name => '- ' + name).join('\n') + '\n' : '')); // CHANGE
    return summary; // CHANGE
} // CHANGE

if (process.argv[1] && path.resolve(process.argv[1]) === script) { // CHANGE
    const args = process.argv.slice(2); // CHANGE
    if (args.length && !(args.length === 2 && args[0] === '--out-dir')) throw new Error('Usage: node scripts/test-full-suite.mjs [--out-dir directory]'); // CHANGE
    const output = path.resolve(args[1] || path.join(project, 'test-results/full', new Date().toISOString().replace(/[:.]/g, '-'))); // CHANGE
    runFullSuite(output).then(summary => { console.log('Full suite report:', path.join(output, 'summary.md')); process.exitCode = summary.status === 'passed' ? 0 : 1; }).catch(error => { console.error(error); process.exitCode = 1; }); // CHANGE
} // CHANGE
