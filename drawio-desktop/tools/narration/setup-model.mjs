/** Download the pinned development model; narration generation itself never uses the network. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import { fileURLToPath } from 'node:url'; // NEW
import { Readable } from 'node:stream'; // NEW
import { pipeline } from 'node:stream/promises'; // NEW
import { createWriteStream } from 'node:fs'; // NEW
const directory = path.dirname(fileURLToPath(import.meta.url)); // NEW
const model = JSON.parse(await fs.readFile(path.join(directory, 'model.json'), 'utf8')); // NEW
const cache = path.resolve(directory, '../../.test-artifacts/narration-model', model.revision); // NEW
for (const name of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model.onnx']) { // NEW
    const destination = path.join(cache, name); // NEW
    try { await fs.access(destination); console.log('Reusing ' + name); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; } // NEW
    await fs.mkdir(path.dirname(destination), { recursive: true }); // NEW
    const response = await fetch('https://huggingface.co/' + model.repository + '/resolve/' + model.revision + '/' + name, { signal: AbortSignal.timeout(300000) }); // NEW
    if (!response.ok) throw new Error('Model download failed: ' + name + ' (' + response.status + ')'); // NEW
    const temporary = destination + '.download'; // NEW
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary)); // NEW
    await fs.rename(temporary, destination); console.log('Downloaded ' + name); // NEW
} // NEW
console.log('Pinned model ready: ' + cache); // NEW
