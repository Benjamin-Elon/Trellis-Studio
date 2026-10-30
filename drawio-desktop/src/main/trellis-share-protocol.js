// NEW: Pure parsing and integrity rules shared by the desktop sharing service and tests.
import crypto from 'node:crypto';
import '../../drawio/src/main/webapp/js/trellis-permission-core.js'; // NEW
import zlib from 'node:zlib';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { policy, LIMITS, parseJson, validateJson, textLimit } from './trellis-input-policy.js'; // NEW

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
    if (!policy.isSafeIdentifier(value) || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new Error('Invalid sharing identifier.');
    return value;
}
export function canonical(value) { // CHANGE: bound structure once before recursive signature encoding.
    validateJson(value); // NEW
    const encode = item => Array.isArray(item) ? '[' + item.map(encode).join(',') + ']' : item && typeof item === 'object' ? '{' + Object.keys(item).sort().map(key => JSON.stringify(key) + ':' + encode(item[key])).join(',') + '}' : JSON.stringify(item); // NEW
    return encode(value); // NEW
}
export function signRecord(payload, privateKey) {
    return { payload, signature: crypto.sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64') };
}
export function verifyRecord(record, publicKey) {
    try { if (!record || !record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload) || typeof record.signature !== 'string' || record.signature.length > 256) return false; return crypto.verify(null, Buffer.from(canonical(record.payload)), publicKey, Buffer.from(record.signature, 'base64')); }
    catch (_) { return false; }
}
export function parseXml(xml) {
    try { textLimit(xml); } catch (_) { throw Object.assign(new Error('Invalid diagram XML: size limit.'), { code: 'INPUT_LIMIT' }); } // CHANGE
    policy.xmlText(xml); // CHANGE
    let invalid = false;
    const doc = new DOMParser({ errorHandler: { warning() { invalid = true; }, error() { invalid = true; }, fatalError() { invalid = true; } } }).parseFromString(xml, 'text/xml');
    if (invalid || !doc.documentElement) throw new Error('Invalid diagram XML.');
    policy.validateNode(doc.documentElement, false); return doc; // CHANGE
}
const serialize = node => new XMLSerializer().serializeToString(node);
/** Decode every page, retaining the original compressed/uncompressed representation. */
export function diagramDocument(xml, maximum = LIMITS.diagram) { // CHANGE: consumers may impose a smaller aggregate budget.
    maximum = Math.min(LIMITS.diagram, maximum);
    const outer = parseXml(xml);
    const pages = []; let decodedBytes = 0; // CHANGE
    const accept = page => { const text = serialize(page.doc.documentElement); decodedBytes += Buffer.byteLength(text); if (decodedBytes > maximum) policy.fail('INPUT_LIMIT', 'Decoded diagram exceeds its total byte limit.'); policy.validateModel(page.doc.documentElement); pages.push(page); }; // NEW
    if (outer.documentElement.nodeName === 'mxGraphModel') accept({ doc: outer, container: null });
    else if (outer.documentElement.nodeName === 'mxfile') {
        for (const page of Array.from(outer.getElementsByTagName('diagram'))) {
            const model = Array.from(page.childNodes).find(node => node.nodeType === 1 && node.nodeName === 'mxGraphModel');
            if (model) accept({ doc: parseXml(serialize(model)), container: page, compressed: false });
            else {
                const raw = zlib.inflateRawSync(Buffer.from(page.textContent.trim(), 'base64'), { maxOutputLength: Math.max(1, (maximum - decodedBytes) * 3) }).toString();
                accept({ doc: parseXml(decodeURIComponent(raw)), container: page, compressed: true });
            }
        }
    }
    if (!pages.length) throw new Error('Only XML .drawio canvases can be shared.');
    policy.validatePageIds(pages.map(page => page.container?.getAttribute('id'))); // CHANGE: reject names inherited by native page dictionaries too.
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
    try { return parseJson(raw, LIMITS.diagram); } catch (_) { throw new Error('Invalid canvas permission metadata.'); }
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
    for (const field of ['users', 'pendingUsers', 'invites']) if (store[field] !== undefined) { if (!Array.isArray(store[field])) policy.fail('INVALID_SCHEMA', 'Invalid canvas user store.'); const ids = new Set(); for (const item of store[field]) { if (!item || typeof (item.id || (field === 'invites' && item.pendingUserId)) !== 'string' || ids.has(item.id || item.pendingUserId)) policy.fail('INVALID_SCHEMA', 'Invalid or duplicate user-store identity.'); ids.add(item.id || item.pendingUserId); } } // NEW
    if (stores.some(entry => canonical(entry) !== canonical(store))) throw new Error('Canvas pages contain conflicting user stores.');
    return { document, store, cells };
}
export function activeAdmin(state, userId) {
    return (state.store.users || []).find(user => user.id === userId && user.admin && !user.disabled);
}
/** Resolve active access teams from the same role cards and reciprocal links used by Users. */ // NEW
export function activeAccessTeams(state, userId) { // CHANGE
    const pageIds = new Map(state.document.pages.map(page => [page.doc, page.container?.getAttribute('id') || ''])); // NEW
    const cells = state.cells.map(cell => { const pageId = pageIds.get(cell.node.ownerDocument), model = cell.node.nodeName === 'mxCell' ? cell.node : cell.node.getElementsByTagName('mxCell')[0]; return { key: JSON.stringify([pageId, cell.id]), id: cell.id, pageId, parent: cell.parentId ? JSON.stringify([pageId, cell.parentId]) : null, style: model.getAttribute('style') || '', attributes: Object.fromEntries(['trellis_team_section', 'trellis_team_id', 'trellis_team_archived', 'trellis_team_unassigned', 'trellis_role_user_id', 'trellis_role_inactive', 'role_card', 'linkedTo'].map(name => [name, cell.node.getAttribute(name)])) }; }); // NEW
    return new Set(globalThis.TrellisPermissionCore.activeTeams({ cells: Object.fromEntries(cells.map(cell => [cell.key, cell])) }, userId)); // CHANGE
} // CHANGE
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
            if (jsonAttr(node, 'trellis_access_grants_json', []).some(grant => !grant.derived && (grant.userId === userId || grant.subjectType === 'team' && teamIds.has(grant.teamId)) && (grant.preset === 'visitor' || grant.preset === 'viewer' || (grant.capabilities || []).length))) return true; // CHANGE: Visitor grants provide read access without editing capabilities.
        }
        return false;
    });
}
/** Sharing handoff blocks always identify the current protocol. */ // CHANGE
export function encodeBlock(kind, payload) {
    return `-----BEGIN TRELLIS ${kind}-----\n${Buffer.from(JSON.stringify({ schema: 2, ...payload })).toString('base64')}\n-----END TRELLIS ${kind}-----`; // CHANGE
}
export function decodeBlock(kind, text) {
    if (typeof text !== 'string' || text.length > 65536) throw new Error('Invalid Trellis sharing block.');
    const start = `-----BEGIN TRELLIS ${kind}-----`;
    const end = `-----END TRELLIS ${kind}-----`; // CHANGE
    const raw = text.slice(text.indexOf(start) + start.length, text.indexOf(end)).trim();
    if (!text.includes(start) || !text.includes(end) || !/^[A-Za-z0-9+/=\s]+$/.test(raw)) throw new Error('Paste the complete Trellis sharing block.');
    const result = parseJson(Buffer.from(raw, 'base64').toString(), LIMITS.invitation); // CHANGE
    if (result.schema !== 2 || result.protocolVersion !== 4) throw new Error('Unsupported Trellis sharing protocol. Only version 4 invitations and replies are supported.'); // CHANGE
    safeId(result.shareId);
    safeId(result.diagramId);
    if (typeof result.deviceId !== 'string' || !/^[A-Z2-7-]{63}$/.test(result.deviceId)) throw new Error('Invalid Syncthing device ID.');
    return result;
}
