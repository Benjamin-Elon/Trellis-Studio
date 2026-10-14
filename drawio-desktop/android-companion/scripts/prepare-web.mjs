/** Bundle the exact shared desktop protocols, without network-hosted scripts. // NEW */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await fs.mkdir(path.join(root, 'www', 'shared'), { recursive: true });
for (const name of ['trellis-field-protocol.js', 'trellis-identity-protocol.js']) {
    await fs.copyFile(path.join(root, '..', 'drawio', 'src', 'main', 'webapp', 'js', name), path.join(root, 'www', 'shared', name));
}
