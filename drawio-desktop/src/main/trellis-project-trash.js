/** Recoverable filesystem moves. Callers authorize both paths before entering here. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import crypto from 'node:crypto'; // NEW

export async function readOptional(filename) { // NEW
    return fs.readFile(filename, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); // NEW
} // NEW

export async function atomicJson(filename, value) { // NEW
    await fs.mkdir(path.dirname(filename), { recursive: true }); // NEW
    const temporary = filename + '.' + crypto.randomUUID() + '.tmp'; // NEW
    try { await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600, flush: true }); await fs.rename(temporary, filename); } // NEW
    finally { await fs.rm(temporary, { force: true }); } // NEW
} // NEW

/** Refuse links and special files; a retained folder never imports data through a junction. */ // NEW
async function fingerprint(filename) { // NEW
    const stat = await fs.lstat(filename); // NEW
    if (stat.isSymbolicLink()) throw new Error('Trash cannot move symbolic links or junctions.'); // NEW
    if (stat.isFile()) return crypto.createHash('sha256').update(await fs.readFile(filename)).digest('hex'); // NEW
    if (!stat.isDirectory()) throw new Error('Trash supports only ordinary files and folders.'); // NEW
    const children = []; // NEW
    for (const name of (await fs.readdir(filename)).sort()) children.push([name, await fingerprint(path.join(filename, name))]); // NEW
    return crypto.createHash('sha256').update(JSON.stringify(children)).digest('hex'); // NEW
} // NEW

/** Persist intent first; interrupted cross-volume copies resume without overwriting unrelated data. */ // NEW
export async function moveRetained(source, destination, journalPath) { // NEW
    let journal = await readOptional(journalPath); // NEW
    if (journal && (journal.source !== source || journal.destination !== destination)) throw new Error('A different Trash move is still pending.'); // NEW
    if (!journal) { // NEW
        if (await fs.lstat(destination).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw Object.assign(new Error('The restore destination already exists. Choose another filename.'), { code: 'EEXIST' }); // NEW
        journal = { source, destination, hash: await fingerprint(source), phase: 'moving', staging: destination + '.' + crypto.randomUUID() + '.copying' }; // CHANGE
        await atomicJson(journalPath, journal); // NEW
    } // NEW
    await fs.mkdir(path.dirname(destination), { recursive: true }); // NEW
    const sourceExists = await fs.lstat(source).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }); // NEW
    const destinationExists = await fs.lstat(destination).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }); // NEW
    if (sourceExists && !destinationExists) { // NEW
        if (await fingerprint(source) !== journal.hash) throw new Error('The project changed while its Trash move was pending. Its files were preserved.'); // NEW
        try { await fs.rename(source, destination); } // NEW
        catch (error) { // NEW
            if (error.code !== 'EXDEV') throw error; // NEW
            const staging = journal.staging; // CHANGE: the journal owns a unique staging path, never a neighboring user file.
            if (typeof staging !== 'string' || !staging.startsWith(destination + '.') || !/\.[a-f0-9-]{36}\.copying$/.test(staging) || path.dirname(staging) !== path.dirname(destination)) throw new Error('Invalid retained-copy staging path.'); // NEW
            await fs.rm(staging, { recursive: true, force: true }); // NEW
            await fs.cp(source, staging, { recursive: true, errorOnExist: true, force: false }); // NEW
            if (await fingerprint(staging) !== journal.hash || await fingerprint(source) !== journal.hash) throw new Error('The retained copy could not be verified. The original was preserved.'); // NEW
            await fs.rename(staging, destination); // NEW
        } // NEW
    } // NEW
    if (await fingerprint(destination) !== journal.hash) throw new Error('The retained project differs from its move journal. No original files were removed.'); // NEW
    if (sourceExists && await fs.lstat(source).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) { // NEW
        if (await fingerprint(source) !== journal.hash) throw new Error('The original changed during the move and was preserved.'); // NEW
        await fs.rm(source, { recursive: true, force: true }); // NEW
    } // NEW
    await atomicJson(journalPath, { ...journal, phase: 'complete' }); // NEW
} // NEW

/** Replay causal lifecycle records, independent of clocks and arrival order. */ // NEW
export function projectLifecycle(records, diagramId) { // NEW
    const all = records.map(record => record.payload).filter(r => r.kind === 'garden-lifecycle' && r.diagramId === diagramId); // NEW
    const applied = new Map(); // CHANGE
    let progress = true; // NEW
    while (progress) { // NEW
        progress = false; // NEW
        for (const r of all) { // NEW
            if (applied.has(r.id) || !Array.isArray(r.parents) || r.parents.some(id => !applied.has(id))) continue; // NEW
            if (!['trash', 'restore', 'purge', 'left', 'rejoin'].includes(r.operation)) continue; // NEW
            const parents = r.parents.map(id => applied.get(id)); // NEW
            if (r.operation === 'restore' && (!parents.some(p => p.operation === 'trash' && p.id === r.target) || parents.some(p => ['purge', 'left'].includes(p.operation)))) continue; // NEW
            if (r.operation === 'purge' && !parents.some(p => p.operation === 'trash' && p.id === r.target)) continue; // NEW
            if (r.operation === 'rejoin' && (!parents.some(p => p.operation === 'left' && p.id === r.target) || parents.some(p => p.operation === 'purge'))) continue; // NEW
            applied.set(r.id, r); progress = true; // NEW
        } // NEW
    } // NEW
    const referenced = new Set([...applied.values()].flatMap(r => r.parents)); // NEW
    const heads = [...applied.values()].filter(r => !referenced.has(r.id)); // NEW
    const terminal = [...applied.values()].filter(r => r.operation === 'purge'); // NEW
    const left = heads.find(r => r.operation === 'left'); // NEW
    const trashed = heads.filter(r => r.operation === 'trash').sort((a, b) => a.id.localeCompare(b.id)); // NEW
    const state = terminal.length ? 'purged' : left ? 'left' : trashed.length ? 'trashed' : 'active'; // NEW
    return { state, heads: heads.map(r => r.id).sort(), record: terminal[0] || left || trashed[0] || heads[0] || null, pending: all.some(r => !applied.has(r.id)) }; // CHANGE: missing, cyclic, or invalid transitions fence the project.
} // NEW
