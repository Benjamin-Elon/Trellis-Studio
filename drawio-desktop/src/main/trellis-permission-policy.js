/** XML adapter for the shared pure policy. Parsing and rich-text validation stay outside permission decisions. */ // NEW
import '../../drawio/src/main/webapp/js/trellis-permission-core.js'; // NEW
import { DOMParser } from '@xmldom/xmldom'; // NEW
import { policy } from './trellis-input-policy.js'; // NEW
import { inspectDiagram } from './trellis-share-protocol.js'; // NEW
import { validateReferenceChanges } from './trellis-reference-policy.js'; // NEW
export const permissions = globalThis.TrellisPermissionCore; // NEW
const attributes = node => Object.fromEntries(Array.from(node?.attributes || []).map(attribute => [attribute.name, attribute.value])); // NEW
/** Attribute order and formatting whitespace are representation details, not permission-bearing edits. */ // NEW
function normalizedNode(node) { // NEW
  return { // NEW
    name: node.nodeName, // NEW
    attributes: attributes(node), // NEW
    children: Array.from(node.childNodes || []).filter(child => child.nodeType === 1 || child.nodeType === 3 && child.nodeValue.trim()).map(child => child.nodeType === 1 ? normalizedNode(child) : child.nodeValue) // NEW
  }; // NEW
} // NEW

/** Preserve page-qualified identities and all permission-relevant relationships, including task source links. */ // NEW
export function permissionSnapshot(state) { // NEW
  const pages = new Map(state.document.pages.map(page => [page.doc, page.container?.getAttribute('id') || ''])); // NEW
  const cells = state.cells.map(cell => { // NEW
    const model = cell.node.nodeName === 'mxCell' ? cell.node : cell.node.getElementsByTagName('mxCell')[0], // NEW
      pageId = pages.get(cell.node.ownerDocument), // NEW
      parent = model.getAttribute('parent'); // NEW
    const values = attributes(cell.node), // NEW
      modelValues = attributes(model); // NEW
    for (const name of ['id', 'parent', 'style', 'vertex', 'edge', 'source', 'target', 'collapsed', 'visible', 'trellis_users_json']) delete modelValues[name]; // NEW
    delete values.trellis_users_json; // NEW: the roster has one canonical snapshot representation.
    return { // NEW
      key: JSON.stringify([pageId, cell.id]), // NEW
      id: cell.id, // NEW
      pageId, // NEW
      parent: parent ? JSON.stringify([pageId, parent]) : null, // NEW
      root: !parent, // NEW
      layer: !!parent && !cell.page.get(parent)?.parentId, // NEW
      attributes: values, // NEW
      style: model.getAttribute('style') || '', // NEW
      vertex: model.getAttribute('vertex') === '1', // NEW
      edge: model.getAttribute('edge') === '1', // NEW
      source: model.getAttribute('source') || '', // NEW
      target: model.getAttribute('target') || '', // NEW
      model: modelValues, // NEW
      modelContent: Array.from(model.childNodes).filter(node => node.nodeType === 1 && node.nodeName !== 'mxGeometry').map(normalizedNode), // NEW
      valueContent: cell.node === model ? [] : Array.from(cell.node.childNodes).filter(node => node !== model && (node.nodeType === 1 || node.nodeType === 3 && node.nodeValue.trim())).map(node => node.nodeType === 1 ? normalizedNode(node) : node.nodeValue), // NEW: non-model XML content is part of the actual value.
      geometry: model.getElementsByTagName('mxGeometry')[0] ? normalizedNode(model.getElementsByTagName('mxGeometry')[0]) : null, // NEW
      collapsed: model.getAttribute('collapsed') || '', // NEW
      visible: model.getAttribute('visible') || '' // NEW
    }; // NEW
  }); // NEW
  return permissions.snapshot({ // NEW
    store: state.store, // NEW
    cells // NEW
  }); // NEW
} // NEW

const COMMENT_TAGS = new Set(['div', 'p', 'span', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup', 'ul', 'ol', 'li', 'a', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre']); // NEW
const COMMENT_STYLES = new Set(['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'line-height', 'margin-left', 'margin-right', 'padding-left', 'list-style-type']); // NEW
/** Inspect the already-normalized text-only comment vocabulary without requiring a browser or mutating the proposal. */ // NEW
function normalizedCommentHtml(html) { // NEW
  policy.xmlText(html, true); // NEW: bound comment markup before allocating a DOM.
  let invalid = false; // NEW
  const document = new DOMParser({ // NEW
    errorHandler: { // NEW
      warning() { // NEW
        invalid = true; // NEW
      }, // NEW
      error() { // NEW
        invalid = true; // NEW
      }, // NEW
      fatalError() { // NEW
        invalid = true; // NEW
      } // NEW
    } // NEW
  }).parseFromString('<div>' + html.replace(/<br\s*>/gi, '<br/>').replace(/&nbsp;/g, '&#160;') + '</div>', 'text/xml'); // NEW
  if (invalid || /<!DOCTYPE|<!ENTITY|<\?/i.test(html)) throw new Error('Invalid comment HTML.'); // NEW
  for (const element of Array.from(document.getElementsByTagName('*'))) { // NEW
    if (!COMMENT_TAGS.has(element.nodeName.toLowerCase())) throw new Error('Unsupported comment element.'); // NEW
    for (const attribute of Array.from(element.attributes || [])) { // NEW
      if (attribute.name === 'style') { // NEW
        for (const declaration of attribute.value.split(';').filter(value => value.trim())) { // NEW
          const colon = declaration.indexOf(':'), // NEW
            property = declaration.slice(0, colon).trim().toLowerCase(), // NEW
            value = declaration.slice(colon + 1).trim(); // NEW
          if (colon < 1 || !(COMMENT_STYLES.has(property) || element.nodeName.toLowerCase() === 'pre' && property === 'white-space' && value === 'pre-wrap') || /url\s*\(|expression\s*\(|var\s*\(/i.test(value)) throw new Error('Unsupported comment style.'); // NEW
        } // NEW
      } else if (!(element.nodeName.toLowerCase() === 'a' && (attribute.name === 'rel' && attribute.value === 'noopener noreferrer' || attribute.name === 'href' && /^(https?:|mailto:|tel:|#)/i.test(attribute.value)))) throw new Error('Unsupported comment attribute.'); // NEW
    } // NEW
  } // NEW
  return html; // NEW
} // NEW

/** Reuse authorship/moderation/retention rules; a durable save may legitimately publish a command more than a minute later. Future timestamps remain invalid. */ // NEW
export function commentsChangeAllowed(before, after, actor, at) { // NEW
  return permissions.commentsChangeAllowed(before, after, actor, at, normalizedCommentHtml, Infinity); // NEW
} // NEW

/** A standalone model and its first single-page wrapper describe the same objects, not deletion/recreation. */ // NEW
function qualifyStandalone(snapshot, pageId) { // NEW
  if (!pageId || Object.values(snapshot.cells).some(cell => cell.pageId)) return snapshot; // NEW
  const key = id => JSON.stringify([pageId, id]); // NEW
  return permissions.snapshot({ store: snapshot.store, memberships: snapshot.memberships, provisionalUsers: snapshot.provisionalUsers, cells: Object.values(snapshot.cells).map(cell => ({ ...cell, pageId, key: key(cell.id), parent: cell.parent ? key(snapshot.cells[cell.parent].id) : null })) }); // NEW
} // NEW

/** Return a decision; callers retain ownership of publication, recovery, and rejection feedback. */ // NEW
export function validatePermissionChanges(beforeXml, afterXml, actor, at, options = {}) { // NEW
  try { // NEW
    validateReferenceChanges(beforeXml, afterXml, actor, at); // NEW: domain approval remains mandatory even for administrators.
    const afterState = inspectDiagram(afterXml), after = permissionSnapshot(afterState), pageId = afterState.document.pages.length === 1 ? afterState.document.pages[0].container?.getAttribute('id') : null; // CHANGE
    const before = qualifyStandalone(options.before || permissionSnapshot(inspectDiagram(beforeXml)), pageId); // CHANGE
    const policySnapshot = options.policy ? qualifyStandalone(options.policy, pageId) : before; // NEW
    return permissions.validateTransition(before, after, actor, at, { // NEW
      ...options, // NEW
      policy: policySnapshot, // NEW: only representation identity is aligned; all authority remains the prior policy.
      commentsChangeAllowed, // NEW
      referenceChangeAllowed: (old, next, names) => { const core = globalThis.TrellisReferenceCore; return !!(old.attributes[core.ATTR] || next.attributes[core.ATTR] || old.attributes[core.PROPOSALS] || next.attributes[core.PROPOSALS]) && names.length > 0 && names.every(name => [core.ATTR, core.PROPOSALS, ...core.CATALOGS].includes(name)); } // NEW: only independently validated reference fields receive the domain exception.
    }); // NEW
  } catch (error) { // NEW
    return { // NEW
      allowed: false, // NEW
      reason: error.message || 'Invalid permission data or proposal.' // NEW
    }; // NEW
  } // NEW
} // NEW
