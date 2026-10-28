/** Build a disposable visual projection; canonical and embedded source records remain unchanged. */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'; // NEW
import { diagramDocument } from './trellis-share-protocol.js'; // NEW
import { policy, LIMITS, parseJson, fail } from './trellis-input-policy.js'; // NEW
/** Resolve only explicit managed images through the caller's existing authorization. */
export async function prepareExportAssets(xml, readImage) { // NEW
  const document = diagramDocument(xml), // NEW
    resolved = new Map(); // NEW
  let total = 0; // NEW
  async function image(reference) { // NEW
    const match = /^(?:trellis-asset:\/\/[a-f0-9]+\/)?(assets\/[a-f0-9]{16}(?:\.[a-z0-9_-]+)?)$/i.exec(reference || ''); // NEW
    if (!match) return /^(?:data:image\/|(?:images|img|stencils|styles)\/)/i.test(reference || '') ? reference : policy.placeholder; // NEW
    if (!resolved.has(match[1])) { // NEW
      let value = policy.placeholder; // NEW
      try { // NEW
        const asset = await readImage(match[1]); // NEW
        total += asset.bytes.length; // NEW
        if (total > LIMITS.diagram) fail('INPUT_LIMIT', 'Export images exceed their combined byte limit.'); // NEW
        value = 'data:' + asset.mime + ',' + asset.bytes.toString('base64'); // NEW
      } catch (error) { // NEW
        if (error.code === 'INPUT_LIMIT') throw error; // NEW
      } // NEW
      resolved.set(match[1], value); // NEW
    } // NEW
    return resolved.get(match[1]); // NEW
  } // NEW
  for (const page of document.pages) for (const node of Array.from(page.doc.getElementsByTagName('*'))) { // NEW
    if (node.hasAttribute('style')) { // NEW
      const tokens = node.getAttribute('style').split(';'); // NEW
      for (let i = 0; i < tokens.length; i++) if (tokens[i].startsWith('image=')) tokens[i] = 'image=' + (await image(tokens[i].slice(6))); // NEW
      node.setAttribute('style', tokens.join(';')); // NEW
    } // NEW
    if (node.hasAttribute('backgroundImage')) { // NEW
      const background = parseJson(node.getAttribute('backgroundImage'), LIMITS.metadata); // NEW
      if (background && typeof background.src === 'string') { // NEW
        background.src = await image(background.src); // NEW
        node.setAttribute('backgroundImage', JSON.stringify(background)); // NEW
      } // NEW
    } // NEW
    for (const attr of ['label', 'value']) { // NEW
      const label = node.getAttribute(attr); // NEW
      if (!label || !/<img\b/i.test(label)) continue; // NEW
      const html = new DOMParser({ // NEW
        errorHandler: { // NEW
          warning() {}, // NEW
          error() {}, // NEW
          fatalError() {} // NEW
        } // NEW
      }).parseFromString('<div>' + label + '</div>', 'text/html'); // NEW
      for (const element of Array.from(html.getElementsByTagName('img'))) { // NEW
        element.setAttribute('src', await image(element.getAttribute('src'))); // NEW
        element.removeAttribute('srcset'); // NEW
      } // NEW
      const serializer = new XMLSerializer(); // NEW
      node.setAttribute(attr, Array.from(html.documentElement.childNodes).map(child => serializer.serializeToString(child)).join('')); // NEW
    } // NEW
  } // NEW
  const result = document.serialize(); // NEW
  policy.textLimit(result); // NEW
  return result; // NEW
} // NEW
