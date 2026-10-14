/** Verify compiled native process ownership with disposable host children; never access a connected device. */ // NEW
import fs from 'node:fs'; // NEW
import path from 'node:path'; // NEW
import { fileURLToPath } from 'node:url'; // NEW
import { execFileSync } from 'node:child_process'; // NEW
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // NEW
const output = path.resolve(project, '../.test-artifacts/android-network-policy'); fs.mkdirSync(output, { recursive: true }); // NEW
const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'); // NEW
const javaRoot = process.env.JAVA_HOME || 'C:/Program Files/Android/Android Studio/jbr'; // NEW
const binary = name => path.join(javaRoot, 'bin', name + (process.platform === 'win32' ? '.exe' : '')); // NEW
const compiled = path.join(project, 'android/app/build/intermediates/javac/debug/compileDebugJavaWithJavac/classes'); // NEW
if (!fs.existsSync(path.join(compiled, 'studio/trellis/field/TrellisSyncPlugin.class'))) throw new Error('Build the Android debug app before testing its compiled engine controls.'); // NEW
const cache = path.join(project, '.tool-cache/gradle/caches'); // NEW
const search = (directory, patterns) => execFileSync('rg', ['--files', directory, ...patterns.flatMap(pattern => ['-g', pattern])], { cwd: project, windowsHide: true, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean).map(filename => path.resolve(project, filename)); // NEW
const dependencies = [...search(path.join(cache, '8.14.3/transforms'), ['*-runtime.jar', 'classes.jar']), ...search(path.join(cache, 'modules-2/files-2.1'), ['*.jar']).filter(filename => /[/\\]androidx\./.test(filename) || /[/\\]org\.jetbrains\.kotlin[/\\]kotlin-stdlib/.test(filename))]; // NEW
const classpath = [compiled, path.join(project, 'node_modules/@capacitor/android/capacitor/build/intermediates/javac/debug/compileDebugJavaWithJavac/classes'), path.join(sdk, 'platforms/android-36/android.jar'), ...dependencies].join(path.delimiter); // NEW
execFileSync(binary('javac'), ['-cp', classpath, '-d', output, path.join(project, 'test/NativeEnginePolicyTest.java')], { windowsHide: true, stdio: 'inherit', timeout: 30000 }); // NEW
const run = fs.mkdtempSync(path.join(output, 'run-')); // NEW
const result = execFileSync(binary('java'), ['-cp', output + path.delimiter + classpath, 'studio.trellis.field.NativeEnginePolicyTest', run], { windowsHide: true, encoding: 'utf8', timeout: 30000 }); // NEW
const checked = JSON.parse(result.trim()); if (!checked.ok) throw new Error('Native engine ownership test failed.'); // NEW
fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify(checked, null, 2)); process.stdout.write(result); // NEW
