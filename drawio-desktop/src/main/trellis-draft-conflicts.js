/** Conservative three-way review: complete objects and dependency groups, never field merges. */ // NEW
import { incomingGroups, fields } from './trellis-object-views.js'; // NEW
import { objects, applyChanges, diffObjects } from './trellis-collaboration-protocol.js'; // NEW
import { canonical, digest } from './trellis-share-protocol.js'; // NEW

export function reviewDraft(baseXml, draftXml, acceptedXml) { // NEW
    const before = objects(baseXml), accepted = objects(acceptedXml), mine = objects(draftXml); // NEW
    const groups = incomingGroups(baseXml, { xml: draftXml, records: [], accepted: [] }).map(group => { // NEW
        const alreadyApplied = group.structural ? draftXml === acceptedXml : group.keys.every(key => (mine.get(key)?.hash || null) === (accepted.get(key)?.hash || null)); // NEW
        const changed = group.targets.includes('*') ? acceptedXml !== baseXml : group.targets.some(key => (before.get(key)?.hash || null) !== (accepted.get(key)?.hash || null)); // NEW
        let conflict = !alreadyApplied && changed; // NEW
        if (!conflict && !alreadyApplied) try { applyChanges(acceptedXml, group.changes); } catch (_) { conflict = true; } // NEW
        const details = group.keys.map(key => { const base = fields(before.get(key)), theirs = fields(accepted.get(key)), draft = fields(mine.get(key)); return { key, fields: [...new Set([...Object.keys(base), ...Object.keys(theirs), ...Object.keys(draft)])].filter(name => base[name] !== draft[name] || base[name] !== theirs[name]).map(name => ({ name, before: base[name] || '', accepted: theirs[name] || '', mine: draft[name] || '' })) }; }); // NEW
        return { ...group, conflict, alreadyApplied, details, labels: group.keys.map(key => accepted.get(key)?.label || before.get(key)?.label || key) }; // NEW
    }); // NEW
    const token = digest(canonical([baseXml, draftXml, acceptedXml, groups.map(group => [group.id, group.conflict])])); // NEW
    return { token, groups, canApplyNonConflicting: groups.some(group => !group.conflict) }; // NEW
} // NEW

/** Rebase only explicitly reviewed groups; the ordinary commit validator still enforces permissions. */ // NEW
export function resolveDraft(baseXml, draftXml, acceptedXml, { token, mode, groups: selected }) { // NEW
    const review = reviewDraft(baseXml, draftXml, acceptedXml); // NEW
    if (review.token !== token) return { ok: false, staleReview: true, review, reason: 'Accepted content or your draft changed. Review again.' }; // NEW
    if (!['accepted', 'mine', 'non-conflicting', 'later'].includes(mode)) throw new Error('Unsupported conflict resolution.'); // NEW
    if (selected && (!Array.isArray(selected) || selected.some(id => !review.groups.some(group => group.id === id)))) throw new Error('Unknown conflict group.'); // NEW
    let groups = review.groups.filter(group => !selected || selected.includes(group.id)); // NEW
    if (mode === 'later') return { ok: true, xml: acceptedXml, remainingXml: draftXml, applied: [], review }; // NEW
    if (mode === 'non-conflicting') groups = groups.filter(group => !group.conflict); // NEW
    const current = objects(acceptedXml); // NEW
    let xml = acceptedXml; // NEW
    if (mode !== 'accepted') for (const group of groups.filter(group => !group.alreadyApplied)) { // NEW
        const changes = group.changes.map(change => ({ ...change, before: change.key === '*' ? digest(xml) : current.get(change.key)?.hash || null })); // NEW
        xml = applyChanges(xml, changes); // NEW
    } // NEW
    // Update only reviewed objects in the private view; unrelated incoming content stays unrefreshed. // NEW
    let resolvedBaseXml = baseXml; // NEW
    for (const group of groups) { // NEW
        const index = objects(resolvedBaseXml); // NEW
        const changes = mode === 'accepted' ? group.structural ? [{ key: '*', xml: acceptedXml }] : group.keys.map(key => ({ key, xml: current.get(key)?.xml || null })) : group.changes; // NEW
        resolvedBaseXml = applyChanges(resolvedBaseXml, changes.map(change => ({ ...change, before: change.key === '*' ? digest(resolvedBaseXml) : index.get(change.key)?.hash || null }))); // NEW
    } // NEW
    let remainingXml = resolvedBaseXml; // NEW
    for (const group of review.groups.filter(group => !groups.includes(group))) { // NEW
        const index = objects(remainingXml); // NEW
        remainingXml = applyChanges(remainingXml, group.changes.map(change => ({ ...change, before: change.key === '*' ? digest(remainingXml) : index.get(change.key)?.hash || null }))); // NEW
    } // NEW
    return { ok: true, xml, baseXml: resolvedBaseXml, remainingXml, applied: groups.map(group => group.id), remaining: diffObjects(resolvedBaseXml, remainingXml).targets, review }; // NEW
} // NEW
