/** Local build never publishes to a store or changes desktop release metadata. // NEW */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (command, args, options = {}) => new Promise((resolve, reject) => { const child = spawn(command, args, { windowsHide: true, stdio: 'inherit', cwd: root, ...options }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Build command exited ' + code))); });
await run(process.execPath, [path.join(root, 'scripts', 'prepare-engine.mjs')]);
await run(process.execPath, [path.join(root, 'scripts', 'prepare-web.mjs')]);
await run(process.execPath, [path.join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'android']);
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const java = process.env.JAVA_HOME || 'C:/Program Files/Android/Android Studio/jbr';
await fs.writeFile(path.join(root, 'android', 'local.properties'), 'sdk.dir=' + sdk.replace(/\\/g, '/').replace(/:/g, '\\:') + '\n');
await run(process.platform === 'win32' ? 'cmd.exe' : path.join(root, 'android', 'gradlew'), process.platform === 'win32' ? ['/d', '/c', 'gradlew.bat', '--no-daemon', ':app:assembleDebug'] : ['--no-daemon', ':app:assembleDebug'], { cwd: path.join(root, 'android'), env: { ...process.env, JAVA_HOME: java, ANDROID_HOME: sdk, GRADLE_USER_HOME: path.join(root, '.tool-cache', 'gradle') } }); // CHANGE: build the APK and required dependencies without assembling unrelated library artifacts.
