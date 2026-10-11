// NEW: Keep service secrets out of renderer file APIs and synchronized asset copies.
import fs from 'node:fs/promises';
import path from 'node:path';

/** Resolve existing ancestors too, so creating a file through a directory alias is checked. */
async function canonicalPath(filename) {
    const absolute = path.resolve(filename);
    try { return await fs.realpath(absolute); }
    catch (err) {
        if (!['ENOENT', 'ENOTDIR'].includes(err.code)) throw err;
        const parent = path.dirname(absolute);
        if (parent === absolute) return absolute;
        return path.join(await canonicalPath(parent), path.basename(absolute));
    }
}

/** Recovery documents remain user-accessible; all other service profile data is main-only. */
export async function assertSharingFileAccess(filename, profilePath) {
    if (typeof filename !== 'string') return;
    const candidates = [[path.resolve(profilePath), path.resolve(filename)], [await canonicalPath(profilePath), await canonicalPath(filename)]]; // CHANGE: protect named secrets even if the secret itself is an external symlink.
    for (const [profile, resolved] of candidates) {
        const relative = path.relative(profile, resolved);
        if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) continue;
        const first = relative.split(path.sep)[0];
        if ((process.platform === 'win32' ? first.toLowerCase() : first) !== 'recovery') throw new Error('Private sharing service files are not accessible to renderer plugins or shared assets.');
    }
}
