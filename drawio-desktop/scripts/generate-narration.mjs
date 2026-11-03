/** Reuse recordings by exact transcript equality; a no-op run never imports or loads Kokoro. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import vm from 'node:vm'; // NEW
import { spawnSync } from 'node:child_process'; // NEW
import { fileURLToPath, pathToFileURL } from 'node:url'; // NEW
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // NEW
const webapp = path.join(project, 'drawio/src/main/webapp'); // NEW
export const defaultDirectory = path.join(webapp, 'audio/narration'); // NEW
/** Catalog and manifest scripts are also directly loadable by the browser without a fetch dependency. */ // NEW
export async function loadData(filename, name) { // NEW
    const window = {}; vm.runInNewContext(await fs.readFile(filename, 'utf8'), { window }, { filename }); return window[name]; // NEW
} // NEW
/** Ordinary runs need only readable, nontruncated MP3s; full decoding belongs to --check. */ // NEW
export async function readExistingAudio(filename, clip) { // NEW
    let bytes; // NEW
    try { bytes = await fs.readFile(filename); } catch (error) { throw new Error('Unreadable narration: ' + filename + '. Restore the existing recording. ' + error.message); } // NEW
    const mp3 = bytes.subarray(0, 3).toString() === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0; // NEW
    if (!mp3 || bytes.length < 1000 || clip.bytes && bytes.length !== clip.bytes) throw new Error('Corrupt or truncated narration: ' + filename + '. Restore the existing recording.'); // NEW
} // NEW
/** Reject unreadable assets; ordinary generation must never replace an existing recording. */ // NEW
export function inspectAudio(filename) { // NEW
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,channels:format=duration', '-of', 'json', filename], { encoding: 'utf8', windowsHide: true }); // NEW
    if (probe.error || probe.status !== 0) throw new Error('Unreadable narration: ' + filename + '. Restore the existing recording. ' + (probe.error?.message || probe.stderr)); // NEW
    const info = JSON.parse(probe.stdout); // NEW
    if (info.streams?.[0]?.codec_name !== 'mp3' || info.streams[0].channels !== 1 || !(Number(info.format?.duration) > 0)) throw new Error('Invalid narration audio: ' + filename); // NEW
    const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', filename, '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true }); // NEW
    if (decode.error || decode.status !== 0 || decode.stderr.trim()) throw new Error('Corrupt narration: ' + filename + '. Restore the existing recording.'); // NEW
    return Number(info.format.duration); // NEW
} // NEW
/** Encode only new recordings; normal validation and no-op runs never rewrite audio. */ // NEW
export function encodeAudio(wav, destination) { // NEW
    const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '96k', '-af', 'loudnorm=I=-18:TP=-1:LRA=7', destination], { encoding: 'utf8', windowsHide: true }); // NEW
    if (result.error || result.status !== 0) throw new Error('Narration encoding failed: ' + (result.error?.message || result.stderr)); // NEW
} // NEW
/** Write only on a real change and replace the manifest atomically after each completed clip. */ // NEW
async function saveManifest(filename, manifest) { // NEW
    const source = '/** Generated transcript/recording pairs. Retain old entries for text reversions. */ // NEW\nwindow.TrellisNarrationRecordings = ' + JSON.stringify(manifest, null, 2) + '; // NEW\n'; // NEW
    const temporary = filename + '.tmp'; await fs.writeFile(temporary, source); await fs.rename(temporary, filename); // NEW
} // NEW
/** The injectable synthesizer/validator make incremental generation testable without model downloads. */ // NEW
export async function generateNarration({ texts, directory = defaultDirectory, check = false, createSynthesizer, validate = readExistingAudio, validateGenerated = inspectAudio, encode = encodeAudio, provenance } = {}) { // NEW
    const manifestPath = path.join(directory, 'manifest.js'); // NEW
    let manifest; // NEW
    try { manifest = await loadData(manifestPath, 'TrellisNarrationRecordings'); } catch (error) { if (error.code !== 'ENOENT') throw error; manifest = { version: 1, clips: [] }; } // NEW
    if (manifest?.version !== 1 || !Array.isArray(manifest.clips)) throw new Error('Invalid narration manifest.'); // NEW
    const known = new Map(); // NEW
    for (const clip of manifest.clips) { // NEW
        if (typeof clip.text !== 'string' || !/^clip-\d+\.mp3$/.test(clip.file) || known.has(clip.text)) throw new Error('Invalid or duplicate narration entry.'); // NEW
        await validate(path.join(directory, clip.file), clip); // NEW
        if (check && validate === readExistingAudio) inspectAudio(path.join(directory, clip.file)); // NEW
        known.set(clip.text, clip); // NEW
    } // NEW
    const unique = [...new Set(texts)], missing = unique.filter(text => !known.has(text)); // NEW
    if (check && missing.length) throw new Error(missing.length + ' narration texts need recording. Run npm run assets:narration.'); // NEW
    if (!missing.length) return { generated: 0, reused: unique.length, retained: manifest.clips.length }; // NEW
    await fs.mkdir(directory, { recursive: true }); // NEW
    const files = await fs.readdir(directory); // NEW
    let number = Math.max(0, ...files.map(name => Number(name.match(/^clip-(\d+)\.mp3$/)?.[1] || 0))); // NEW
    // The expensive dependency is imported only when a previously unrecorded transcript exists. // NEW
    if (!createSynthesizer) { // NEW
        const generator = await import('../tools/narration/synthesize.mjs'); // NEW
        createSynthesizer = generator.createSynthesizer; provenance = generator.settings; // NEW
    } // NEW
    console.log('Reusing ' + (unique.length - missing.length) + ' recordings; generating ' + missing.length + ' new transcripts.'); // NEW
    const synthesize = await createSynthesizer(); // NEW
    for (const text of missing) { // NEW
        const file = 'clip-' + String(++number).padStart(4, '0') + '.mp3', destination = path.join(directory, file); // NEW
        const temporary = path.join(directory, '.' + file + '.tmp.mp3'); // NEW
        const work = path.join(project, '.test-artifacts/narration-generation'); await fs.mkdir(work, { recursive: true }); // NEW
        const wav = path.join(work, process.pid + '-' + file + '.wav'); // NEW: isolate temporary waveforms from other generator/test processes.
        try { // NEW
            await synthesize(text, wav); // NEW
            await encode(wav, temporary); // NEW
            const duration = await validateGenerated(temporary); // NEW
            await fs.rename(temporary, destination); // NEW
            manifest.clips.push({ text, file, duration, bytes: (await fs.stat(destination)).size, provenance }); // NEW
            await saveManifest(manifestPath, manifest); // NEW
            console.log('Recorded ' + file + ': ' + text); // NEW
        } finally { // NEW
            await fs.rm(wav, { force: true }); await fs.rm(temporary, { force: true }); // NEW
        } // NEW
    } // NEW
    return { generated: missing.length, reused: unique.length - missing.length, retained: manifest.clips.length }; // NEW
} // NEW
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) { // NEW
    try { // NEW
        const catalog = await loadData(path.join(webapp, 'js/trellis-narration-catalog.js'), 'TrellisNarrationCatalog'); // NEW
        const texts = process.argv.includes('--sample') ? ['oath', 'settings-name', 'confirmThePlanningYearThenUseAdd'].map(id => catalog.text(id)) : catalog.entries(); // NEW
        const result = await generateNarration({ texts, check: process.argv.includes('--check') }); // NEW
        console.log(JSON.stringify(result)); // NEW
    } catch (error) { console.error(error.message); process.exitCode = 1; } // NEW
} // NEW
