/** Document naming policy; personal suffixes never enter the document. */ // NEW
import '../../drawio/src/main/webapp/js/trellis-project-naming.js'; // NEW
import { inspectDiagram, activeAdmin, canonical } from './trellis-share-protocol.js'; // NEW
export const naming = globalThis.TrellisProjectNaming; // NEW
const metadata = cell => cell.node.hasAttribute('trellis_users_diagram_id') || cell.node.hasAttribute('trellis_history_id'); // NEW
export function projectName(state) { // NEW
    const named = state.cells.filter(cell => cell.node.hasAttribute(naming.PROJECT_NAME_ATTR)); // NEW
    if (named.some(cell => !metadata(cell))) throw new Error('Project name must belong to document identity metadata.'); // NEW
    const names = named.map(cell => naming.projectName(cell.node.getAttribute(naming.PROJECT_NAME_ATTR))); // NEW
    if (names.some(name => name !== names[0])) throw new Error('Canvas pages contain conflicting project names.'); // NEW
    return names[0] || ''; // NEW
} // NEW
export function withProjectName(xml, name) { // NEW
    const state = inspectDiagram(xml), value = naming.projectName(name); // NEW
    const cells = state.cells.filter(metadata); // NEW
    if (!cells.length) throw new Error('Project identity metadata is missing.'); // NEW
    for (const cell of cells) cell.node.setAttribute(naming.PROJECT_NAME_ATTR, value); // NEW
    return state.document.serialize(); // NEW
} // NEW
/** Check before owner/grant and invitation exceptions: only a saved active admin qualifies. */ // NEW
export function validateProjectNameChange(beforeXml, afterXml, actor, authorityXml = beforeXml) { // CHANGE
    const before = inspectDiagram(beforeXml), after = inspectDiagram(afterXml); // NEW
    const values = state => state.document.pages.map(page => state.cells.filter(cell => cell.node.ownerDocument === page.doc && cell.node.hasAttribute(naming.PROJECT_NAME_ATTR)).map(cell => [cell.id, cell.node.getAttribute(naming.PROJECT_NAME_ATTR)])); // NEW
    if (canonical(values(before)) !== canonical(values(after)) && !activeAdmin(inspectDiagram(authorityXml), actor)) throw new Error('Only an active project administrator can change the shared project name.'); // CHANGE
    projectName(after); // NEW
} // NEW
