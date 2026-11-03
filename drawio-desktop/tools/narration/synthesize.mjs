/** Development-only inference. Import this module only after finding new narration text. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import { fileURLToPath } from 'node:url'; // NEW
import { env, AutoTokenizer, StyleTextToSpeech2Model } from '@huggingface/transformers'; // NEW
import { KokoroTTS } from 'kokoro-js'; // NEW
const directory = path.dirname(fileURLToPath(import.meta.url)); // NEW
export const settings = JSON.parse(await fs.readFile(path.join(directory, 'model.json'), 'utf8')); // NEW
/** Load only local pinned assets. CPU execution needs no graphics hardware or installed Python. */ // NEW
export async function createSynthesizer() { // NEW
    const cache = path.resolve(directory, '../../.test-artifacts/narration-model', settings.revision); // NEW
    await fs.access(path.join(cache, 'onnx/model.onnx')); // NEW
    env.allowRemoteModels = false; // NEW
    const [model, tokenizer] = await Promise.all([ // NEW
        StyleTextToSpeech2Model.from_pretrained(cache, { dtype: settings.dtype, device: 'cpu', local_files_only: true, session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } }), // NEW: bound CPU use while retaining parallel inference.
        AutoTokenizer.from_pretrained(cache, { local_files_only: true }) // NEW
    ]); // NEW
    const tts = new KokoroTTS(model, tokenizer); // NEW
    return async (text, destination) => { // NEW
        const audio = await tts.generate(text, { voice: settings.voice, speed: settings.speed }); // NEW
        await audio.save(destination); // NEW
    }; // NEW
} // NEW
