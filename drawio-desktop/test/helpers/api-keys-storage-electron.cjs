// NEW: Isolated real OS encryption check; never loads the user's profile or credentials.
const { app, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const [mode, root] = process.argv.slice(2);
app.setPath('userData', path.join(root, 'electron-profile'));
app.whenReady().then(async () => {
    if (!safeStorage.isEncryptionAvailable() || process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') throw new Error('OS encryption unavailable.');
    const { createApiKeyStore } = await import(pathToFileURL(path.resolve(__dirname, '../../src/main/trellis-api-key-store.js')).href);
    const store = createApiKeyStore({ root, protect: text => safeStorage.encryptString(text).toString('base64'), unprotect: text => safeStorage.decryptString(Buffer.from(text, 'base64')) });
    if (mode === 'write') await store.save('synthetic-profile', 'openai', 'synthetic-electron-api-key');
    if (await store.read('synthetic-profile', 'openai') !== 'synthetic-electron-api-key') throw new Error('Round trip failed.');
    const disk = await fs.readFile(path.join(root, 'synthetic-profile/api-keys/openai.json'), 'utf8');
    if (disk.includes('synthetic-electron-api-key')) throw new Error('Plaintext found on disk.');
    console.log('OS encrypted profile key verified: ' + mode);
    app.exit(0);
}).catch(() => { console.error('OS encrypted profile key check failed.'); app.exit(1); });
