/** Bound the production smoke from its parent without touching installed profiles or unrelated processes. */ // NEW
const fs = require('node:fs/promises'); // NEW
const os = require('node:os'); // NEW
const path = require('node:path'); // NEW
const { spawn, execFile } = require('node:child_process'); // NEW

async function run() { // NEW
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-smoke-run-')); // NEW
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('trellis-smoke-run-')) throw new Error('Unexpected smoke control directory.'); // NEW: validate the exact recursive-cleanup target.
    const stopFile = path.join(directory, 'stop'); // NEW
    const env = { ...process.env, TRELLIS_SMOKE_STOP_FILE: stopFile }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const child = spawn(require('electron'), [path.join(__dirname, '../test/helpers/garden-home-production-electron.cjs')], { env, windowsHide: true, stdio: 'inherit' }); // NEW
    let force; // NEW
    const timeout = setTimeout(async () => { // NEW
        console.error('Production smoke exceeded its parent deadline; requesting owned cleanup.'); // NEW
        await fs.writeFile(stopFile, '').catch(() => {}); // NEW
        force = setTimeout(() => { // NEW
            if (child.exitCode != null || child.signalCode != null) return; // NEW
            // This live child handle/PID belongs exclusively to this invocation. // NEW
            if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); // NEW
            else child.kill('SIGKILL'); // NEW
        }, 16000); // NEW
    }, process.env.TRELLIS_PHYSICAL_ANDROID_TEST === '1' ? 1830000 : process.env.TRELLIS_TEST_DEBUG === '1' ? 330000 : process.env.TRELLIS_GARDEN_PROJECTS_TEST === '1' ? 220000 : 140000); // CHANGE: keep the parent bound beyond the extended project regression suite's cleanup deadline.
    try { // NEW
        process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve(signal ? 1 : code ?? 1)); }); // NEW
    } finally { clearTimeout(timeout); clearTimeout(force); await fs.rm(directory, { recursive: true, force: true }); } // NEW
} // NEW
run().catch(error => { console.error(error); process.exitCode = 1; }); // NEW
