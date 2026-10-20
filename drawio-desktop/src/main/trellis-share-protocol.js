// NEW: Pure parsing and integrity rules shared by the desktop sharing service and tests.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export const SHARE_SCHEMA = 1;
export const SYNCTHING_VERSION = '2.1.6';
export const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export const makeId = () => crypto.randomUUID();
/** Compatibility fingerprint for the existing, intentionally low-security Users invite store. */
export function inviteFingerprint(code, salt) {
    let hash = 2166136261;
    const value = String(salt || '') + '::invite::' + String(code || '').trim().toUpperCase();
    for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24); }
    return (hash >>> 0).toString(16);
}
export function safeId(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new Error('Invalid sharing identifier.');
    return value;
}
export function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
}
export function signRecord(payload, privateKey) {
    return { payload, signature: crypto.sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64') };
}
export function verifyRecord(record, publicKey) {
    try { return !!record && crypto.verify(null, Buffer.from(canonical(record.payload)), publicKey, Buffer.from(record.signature, 'base64')); }
    catch (_) { return false; }
}
export function parseXml(xml) {
    if (typeof xml !== 'string' || xml.length > 128 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Invalid diagram XML.');
    let invalid = false;
    const doc = new DOMParser({ errorHandler: { warning() { invalid = true; }, error() { invalid = true; }, fatalError() { invalid = true; } } }).parseFromString(xml, 'text/xml');
    if (invalid || !doc.documentElement) throw new Error('Invalid diagram XML.');
    return doc;
}
const serialize = node => new XMLSerializer().serializeToString(node);
/** Decode every page, retaining the original compressed/uncompressed representation. */
export function diagramDocument(xml) {
    const outer = parseXml(xml);
    const pages = [];
    if (outer.documentElement.nodeName === 'mxGraphModel') pages.push({ doc: outer, container: null });
    else if (outer.documentElement.nodeName === 'mxfile') {
        for (const page of Array.from(outer.getElementsByTagName('diagram'))) {
            const model = Array.from(page.childNodes).find(node => node.nodeType === 1 && node.nodeName === 'mxGraphModel');
            if (model) pages.push({ doc: parseXml(serialize(model)), container: page, compressed: false });
            else {
                const raw = zlib.inflateRawSync(Buffer.from(page.textContent.trim(), 'base64'), { maxOutputLength: 128 * 1024 * 1024 }).toString();
                pages.push({ doc: parseXml(decodeURIComponent(raw)), container: page, compressed: true });
            }
        }
    }
    if (!pages.length) throw new Error('Only XML .drawio canvases can be shared.');
    if (pages.length > 1) { // NEW: permission restoration cannot safely match ambiguous page identities.
        const pageIds = pages.map(page => page.container.getAttribute('id'));
        if (pageIds.some(id => !id) || new Set(pageIds).size !== pageIds.length) throw new Error('Shared multi-page canvases require unique page identifiers.');
    }
    return {
        pages,
        serialize() {
            for (const page of pages) if (page.container) {
                while (page.container.firstChild) page.container.removeChild(page.container.firstChild);
                const text = serialize(page.doc.documentElement);
                if (page.compressed) page.container.appendChild(outer.createTextNode(zlib.deflateRawSync(Buffer.from(encodeURIComponent(text))).toString('base64')));
                else page.container.appendChild(outer.importNode(page.doc.documentElement, true));
            }
            return serialize(outer);
        }
    };
}
function jsonAttr(node, key, fallback) {
    const raw = node.getAttribute(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (_) { throw new Error('Invalid canvas permission metadata.'); }
}
export function inspectDiagram(xml) {
    const document = diagramDocument(xml);
    const stores = [];
    const cells = [];
    for (const page of document.pages) {
        const byId = new Map();
        for (const cell of Array.from(page.doc.getElementsByTagName('mxCell'))) {
            const wrapper = cell.parentNode.nodeName === 'root' ? cell : cell.parentNode;
            const id = wrapper.getAttribute('id') || cell.getAttribute('id');
            const entry = { id, node: wrapper, parentId: cell.getAttribute('parent'), page: byId };
            byId.set(id, entry);
            cells.push(entry);
            if (wrapper.hasAttribute('trellis_users_json')) stores.push(jsonAttr(wrapper, 'trellis_users_json', {}));
        }
    }
    const store = stores[0] || { users: [], pendingUsers: [], invites: [] };
    if (stores.some(entry => canonical(entry) !== canonical(store))) throw new Error('Canvas pages contain conflicting user stores.');
    return { document, store, cells };
}
export function activeAdmin(state, userId) {
    return (state.store.users || []).find(user => user.id === userId && user.admin && !user.disabled);
}
/** Resolve active access teams from the same role cards and reciprocal links used by Users. */ // NEW
export function activeAccessTeams(state, userId) { // NEW
    const flag = (cell, name) => cell.node.getAttribute(name) === '1' || new RegExp('(?:^|;)' + name + '=1(?:;|$)').test(cell.node.getElementsByTagName('mxCell')[0]?.getAttribute('style') || cell.node.getAttribute('style')); // NEW
    const teams = state.cells.filter(cell => flag(cell, 'trellis_team_section') && cell.node.getAttribute('trellis_team_archived') !== '1' && cell.node.getAttribute('trellis_team_unassigned') !== '1'); // NEW
    const links = cell => String(cell.node.getAttribute('linkedTo') || '').split(',').map(id => id.trim()); // NEW
    const roles = state.cells.filter(cell => cell.node.getAttribute('trellis_role_user_id') === userId && cell.node.getAttribute('trellis_role_inactive') !== '1'); // NEW
    return new Set(teams.filter(team => roles.some(role => role.node.ownerDocument === team.node.ownerDocument && (role.parentId === team.id || links(role).includes(team.id) && links(team).includes(role.id)))).map(team => team.node.getAttribute('trellis_team_id') || team.id)); // NEW
} // NEW
export function hasCanvasAccess(state, userId, now = Date.now()) {
    const user = (state.store.users || []).find(entry => entry.id === userId && !entry.disabled);
    const invite = (state.store.invites || []).find(entry => entry.pendingUserId === userId && entry.status === 'pending' && entry.expiresAt > now);
    if (!user && !invite) return false;
    if (user?.admin) return true;
    const teamIds = activeAccessTeams(state, userId); // NEW: team access remains valid for peer membership and editing.
    return state.cells.some(cell => {
        const visited = new Set();
        for (let scope = cell; scope && !visited.has(scope.id); scope = scope.page.get(scope.parentId)) {
            visited.add(scope.id);
            const node = scope.node;
            if (node.getAttribute('trellis_owner_user_id') === userId) return true;
            if (user && node.getAttribute('trellis_access_open') === '1') return true;
            if (jsonAttr(node, 'trellis_access_user_ids_json', []).includes(userId)) return true;
            if (jsonAttr(node, 'trellis_access_grants_json', []).some(grant => (grant.userId === userId || grant.subjectType === 'team' && teamIds.has(grant.teamId)) && (grant.capabilities || []).length)) return true; // CHANGE
        }
        return false;
    });
}
/** Content conflict resolution never restores stale Users or scope permissions. */
export function preserveAccess(chosenXml, currentXml) {
    const chosen = inspectDiagram(chosenXml);
    const current = inspectDiagram(currentXml);
    const protectedName = name => name === 'trellis_project_name' || /^trellis_(users|owner|access|role_|team_|garden_team)/.test(name); // CHANGE: conflict recovery preserves the current administrator-controlled name.
    const currentPages = new Map(current.document.pages.map(page => [page.container?.getAttribute('id') || '', page.doc])); // NEW: page ordering is content, not an authorization identity.
    for (const page of chosen.document.pages) {
        const currentDocument = chosen.document.pages.length === 1 && current.document.pages.length === 1 ? current.document.pages[0].doc : currentPages.get(page.container?.getAttribute('id') || ''); // CHANGE: allow raw/wrapped single-page representations.
        const currentCells = new Map(current.cells.filter(cell => cell.node.ownerDocument === currentDocument).map(cell => [cell.id, cell]));
        for (const cell of chosen.cells.filter(entry => entry.node.ownerDocument === page.doc)) {
            for (const attr of Array.from(cell.node.attributes)) if (protectedName(attr.name)) cell.node.removeAttribute(attr.name);
            const source = currentCells.get(cell.id);
            if (source) for (const attr of Array.from(source.node.attributes)) if (protectedName(attr.name)) cell.node.setAttribute(attr.name, attr.value);
        }
    }
    // Keep the latest roster even when the chosen version removed its metadata cell.
    if (!chosen.cells.some(cell => cell.node.hasAttribute('trellis_users_json'))) throw new Error('Chosen version removes the canvas user metadata. Reconcile it before publishing.');
    return chosen.document.serialize();
}
export function encodeBlock(kind, payload) {
    return `-----BEGIN TRELLIS ${kind}-----\n${Buffer.from(JSON.stringify({ schema: SHARE_SCHEMA, ...payload })).toString('base64')}\n-----END TRELLIS ${kind}-----`;
}
/** Compare cells within stable page identities without attempting an XML merge. */
export function compareDiagramVersions(currentXml, chosenXml) { // NEW: bounded, inspectable content differences for admin review.
    function snapshot(node) {
        if (node.nodeType !== 1) return node.nodeValue;
        return { name: node.nodeName, attributes: Object.fromEntries(Array.from(node.attributes).map(attr => [attr.name, attr.value])), children: Array.from(node.childNodes).filter(child => child.nodeType === 1 || child.nodeType === 3 && child.nodeValue.trim()).map(snapshot) };
    }
    function index(xml) {
        const state = inspectDiagram(xml);
        const result = new Map();
        for (const page of state.document.pages) {
            const pageId = page.container?.getAttribute('id') || '';
            for (const cell of state.cells.filter(entry => entry.node.ownerDocument === page.doc)) {
                const model = cell.node.nodeName === 'mxCell' ? cell.node : cell.node.getElementsByTagName('mxCell')[0];
                if (!model || model.getAttribute('vertex') !== '1' && model.getAttribute('edge') !== '1') continue;
                result.set(JSON.stringify([pageId, cell.id]), { pageId, cellId: cell.id, label: cell.node.getAttribute('label') || cell.node.getAttribute('value') || cell.id, content: canonical(snapshot(cell.node)) });
            }
        }
        return result;
    }
    const before = index(currentXml);
    const after = index(chosenXml);
    const counts = { added: 0, changed: 0, removed: 0 };
    const cells = [];
    for (const key of new Set([...before.keys(), ...after.keys()])) {
        const original = before.get(key);
        const updated = after.get(key);
        const kind = !original ? 'added' : !updated ? 'removed' : original.content !== updated.content ? 'changed' : null;
        if (!kind) continue;
        counts[kind]++;
        const cell = updated || original;
        if (cells.length < 100) cells.push({ kind, pageId: cell.pageId, cellId: cell.cellId, label: cell.label.slice(0, 200) });
    }
    return { ...counts, cells, truncated: counts.added + counts.changed + counts.removed > cells.length };
}
export function decodeBlock(kind, text) {
    if (typeof text !== 'string' || text.length > 65536) throw new Error('Invalid Trellis sharing block.');
    const start = `-----BEGIN TRELLIS ${kind}-----`;
    const end = `-----END TRELLIS ${kind}-----`;
    const raw = text.slice(text.indexOf(start) + start.length, text.indexOf(end)).trim();
    if (!text.includes(start) || !text.includes(end) || !/^[A-Za-z0-9+/=\s]+$/.test(raw)) throw new Error('Paste the complete Trellis sharing block.');
    const result = JSON.parse(Buffer.from(raw, 'base64').toString());
    if (![SHARE_SCHEMA, 2].includes(result.schema)) throw new Error('Unsupported Trellis sharing version. Upgrade Trellis before joining.'); // CHANGE: v2 invitations isolate object journals from legacy files.
    safeId(result.shareId);
    safeId(result.diagramId);
    if (typeof result.deviceId !== 'string' || !/^[A-Z2-7-]{63}$/.test(result.deviceId)) throw new Error('Invalid Syncthing device ID.');
    return result;
}
