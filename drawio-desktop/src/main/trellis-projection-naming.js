/** Recoverable, no-overwrite moves of local v2 projections. Call only inside the collaboration queue. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import { digest, inspectDiagram, makeId } from './trellis-share-protocol.js'; // NEW
import { naming, projectName } from './trellis-project-naming.js'; // NEW
const stat = filename => fs.lstat(filename).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); // NEW
export function createProjectionNaming({ profile, persist, sessions, beforeRename = async () => async () => {}, writeAtomic }) { // NEW
    /** Retain earlier basenames so draft migration can resume after a restart or a locked draft. */ // NEW
    async function adoptTarget(canvas, target, oldPath) { // NEW
        canvas.previousFilenames = [...new Set([...(canvas.previousFilenames || []), path.basename(oldPath)])].filter(name => name !== path.basename(target)); // NEW
        canvas.diagramPath = target; canvas.filename = path.basename(target); // NEW
        for (const session of sessions.values()) if (session.diagramPath === oldPath) session.diagramPath = target; // NEW
        await persist(); // NEW
    } // NEW
    /** Reject links and unrelated files before retiring either name. */ // NEW
    async function verified(filename, hash) { // NEW
        const info = await stat(filename); // NEW
        if (!info) return null; // NEW
        if (!info.isFile() || info.isSymbolicLink() || digest(await fs.readFile(filename, 'utf8')) !== hash) throw new Error('A file changed during project rename. Files were preserved.'); // NEW
        return info; // NEW
    } // NEW
    async function move(canvas, source, target, details) { // NEW
        const journalPath = path.join(profile, 'projection-renames', canvas.shareId + '.json'); // NEW
        let journal = await fs.readFile(journalPath, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); // NEW
        const isNew = !journal; // NEW
        if (!journal) { // NEW
            journal = { diagramId: canvas.diagramId, source: path.basename(source), target: path.basename(target), temporary: '.trellis-rename-' + makeId() + '.tmp', hash: digest(await fs.readFile(source, 'utf8')) }; // NEW
        } // NEW
        if (journal.diagramId !== canvas.diagramId || [journal.source, journal.target, journal.temporary].some(name => typeof name !== 'string' || path.basename(name) !== name)) throw new Error('Invalid project rename recovery journal.'); // NEW
        source = path.join(canvas.folderPath, journal.source); target = path.join(canvas.folderPath, journal.target); // NEW
        const temporary = path.join(canvas.folderPath, journal.temporary), oldPath = canvas.diagramPath; // NEW
        const finish = await beforeRename({ ...details, oldPath, path: target, filename: journal.target }); // NEW
        let committed = false, createdTarget = false; // CHANGE
        try { // NEW
            if (isNew) await writeAtomic(journalPath, JSON.stringify(journal)); // NEW: a busy editor leaves no stale journal behind.
            let original = await verified(source, journal.hash), holding = await verified(temporary, journal.hash); // NEW
            if (!original && !holding && await verified(target, journal.hash)) { await adoptTarget(canvas, target, oldPath); committed = true; await fs.unlink(journalPath); return; } // CHANGE: recover a crash after temporary cleanup but before journal cleanup.
            if (!holding && original) { await fs.link(source, temporary); holding = await verified(temporary, journal.hash); } // NEW
            if (!holding) throw new Error('The pending rename source is missing.'); // NEW
            const destination = await stat(target); // NEW
            const caseOnly = source !== target && destination && original && destination.ino === original.ino && destination.dev === original.dev && !(await fs.readdir(canvas.folderPath)).includes(journal.target); // CHANGE: distinguish a case-insensitive alias from an existing separate hard link.
            if (caseOnly) { await fs.unlink(source); original = null; } // NEW
            else if (destination && (destination.ino !== holding.ino || destination.dev !== holding.dev || destination.isSymbolicLink())) throw new Error('The new filename already exists. Choose another name or move that file.'); // NEW
            if (!destination || caseOnly) { await fs.link(temporary, target); createdTarget = true; } // CHANGE: link creation is atomic and never replaces an existing file.
            await verified(target, journal.hash); // NEW
            if (original && source !== target) await fs.unlink(source); // NEW
            await adoptTarget(canvas, target, oldPath); committed = true; // CHANGE
            await fs.unlink(temporary); await fs.unlink(journalPath); // NEW
        } catch (error) { // NEW
            const original = await stat(source), holding = await stat(temporary), destination = await stat(target); // NEW
            if (!committed && original && holding && original.ino === holding.ino && original.dev === holding.dev && createdTarget && destination?.ino === holding.ino && destination.dev === holding.dev) { // NEW
                await verified(target, journal.hash); await fs.unlink(target); await fs.unlink(temporary); await fs.rm(journalPath, { force: true }); // NEW: roll back our link when a locked original cannot be removed, so later saves can change its bytes safely.
                throw error; // NEW
            } // NEW
            if (original && (!holding || original.ino === holding.ino && original.dev === holding.dev && (!destination || destination.ino !== holding.ino || destination.dev !== holding.dev))) { if (holding) await fs.unlink(temporary); await fs.rm(journalPath, { force: true }); } // CHANGE: an untouched source permits choosing a different name or retrying a locked move.
            throw error; // NEW
        } finally { await finish({ ...details, committed, oldPath, path: canvas.diagramPath, filename: canvas.filename, previousPaths: (canvas.previousFilenames || []).map(name => path.join(canvas.folderPath, name)) }); } // CHANGE
    } // NEW
    async function reconcile(canvas, xml) { // NEW
        const shared = projectName(inspectDiagram(xml)); // NEW
        if (shared) { canvas.projectName = shared; canvas.label = shared; } // NEW
        if (!canvas.namingEnabled || !shared || canvas.localRemoved || canvas.projectRetired || canvas.projectFenced) return; // NEW
        const suffix = canvas.namingSuffix || '', desired = naming.filename(shared, suffix); // NEW
        const details = { diagramId: canvas.diagramId, projectName: shared, suffix, displayName: naming.displayName(shared, suffix), previousPaths: (canvas.previousFilenames || []).map(name => path.join(canvas.folderPath, name)) }; // CHANGE
        try { // NEW
            let source = canvas.diagramPath; // NEW
            if (!await stat(source)) { // NEW
                const matches = []; // NEW
                for (const name of await fs.readdir(canvas.folderPath)) if (/\.drawio$/i.test(name) && !/\.sync-conflict-/i.test(name)) { // NEW
                    const candidate = path.join(canvas.folderPath, name), info = await stat(candidate); if (!info?.isFile() || info.isSymbolicLink()) continue; // NEW
                    try { const state = inspectDiagram(await fs.readFile(candidate, 'utf8')); if (state.cells.some(cell => cell.node.getAttribute('trellis_history_id') === canvas.diagramId || cell.node.getAttribute('trellis_users_diagram_id') === canvas.diagramId)) matches.push(candidate); } catch (_) {} // NEW
                } // NEW
                if (matches.length > 1) throw new Error('Multiple files have this project identity. Resolve them before renaming.'); // NEW
                if (matches.length === 1) source = matches[0]; // NEW
            } // NEW
            const journal = await stat(path.join(profile, 'projection-renames', canvas.shareId + '.json')); // NEW
            if (journal || source !== path.join(canvas.folderPath, desired) || canvas.diagramPath !== source) await move(canvas, source, path.join(canvas.folderPath, desired), details); // NEW
            else if (canvas.namingDisplayName !== details.displayName || canvas.filenamePending) { const finish = await beforeRename({ ...details, oldPath: source, path: source, filename: canvas.filename }); await finish({ ...details, committed: true, oldPath: source, path: source, filename: canvas.filename }); } // CHANGE: retry failed draft/handle updates even if the physical filename already matches.
            canvas.namingDisplayName = details.displayName; // NEW
            canvas.filenamePending = canvas.filename !== desired; canvas.namingError = ''; // NEW
        } catch (error) { canvas.filenamePending = true; canvas.namingError = error.message; if (!await stat(canvas.diagramPath) || await stat(path.join(profile, 'projection-renames', canvas.shareId + '.json'))) throw error; } // CHANGE: an unfinished journal must recover before saves can replace its fingerprinted source.
        await persist(); // NEW
    } // NEW
    return { reconcile }; // NEW
} // NEW
