/** Shared non-mutating validation and display policy. Load before any document decoder. */
(function (root) { // NEW
  'use strict'; // NEW

  const REVISION = 1, // NEW
    MiB = 1024 * 1024; // NEW
  const LIMITS = Object.freeze({ // NEW
    diagram: 128 * MiB, // NEW
    record: 128 * MiB, // NEW
    history: 180 * MiB, // NEW
    metadata: 8 * MiB, // NEW
    invitation: 65536, // NEW
    depth: 128, // NEW
    records: 50000, // NEW
    replay: 256 * MiB, // NEW
    timeout: 30000, // NEW
    heap: 512, // NEW
    attachment: 128 * MiB, // NEW
    raster: 32 * MiB, // NEW
    pixels: 32000000, // NEW
    svg: 8 * MiB // NEW
  }); // NEW
  const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']); // NEW
  const unsafeIds = new Set([...unsafeKeys, ...Object.getOwnPropertyNames(Object.prototype), ...Object.getOwnPropertyNames(Array.prototype)]); // NEW: native mxGraph dictionaries still inherit Object/Array properties.
  function isSafeIdentifier(value) { return typeof value === 'string' && value.length > 0 && !unsafeKeys.has(value) && !Object.prototype.hasOwnProperty.call(Object.prototype, value); } // NEW
  function validatePageIds(ids) { if (!Array.isArray(ids) || ids.some(id => id ? !isSafeIdentifier(id) : ids.length > 1) || new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length) fail('INVALID_MODEL', 'Document pages require unique safe page identifiers.'); return ids; } // NEW
  const tags = ['p', 'div', 'span', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup', 'ul', 'ol', 'li', 'a', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td']; // NEW
  const styles = new Set(['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'line-height', 'margin-left', 'margin-right', 'padding-left', 'padding-right', 'white-space', 'vertical-align', 'border', 'border-collapse', 'border-color', 'border-width', 'border-style', 'width', 'height', 'max-width', 'list-style-type']); // NEW
  const placeholder = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="140" height="30"><rect width="140" height="30" fill="#eee"/><text x="5" y="20" font-size="12">Image unavailable</text></svg>'); // NEW
  function fail(code, message) { // NEW
    throw Object.assign(new Error(message), { // NEW
      code // NEW
    }); // NEW
  } // NEW
  function bytes(value) { // NEW
    if (root.Buffer?.byteLength) return root.Buffer.byteLength(value, 'utf8'); // NEW
    let length = 0; // NEW
    for (const char of value) { // NEW
      const code = char.codePointAt(0); // NEW
      length += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4; // NEW
    } // NEW
    return length; // NEW
  } // NEW
  function textLimit(value, maximum = LIMITS.diagram) { // NEW
    if (typeof value !== 'string' || value.length > maximum || bytes(value) > maximum) fail('INPUT_LIMIT', 'Input exceeds its byte limit.'); // NEW
    return value; // NEW
  } // NEW
  /** Reject excessive nesting before allocating a DOM; quoted markup and CDATA are inert. */
  function xmlText(value, html = false) { // NEW
    textLimit(value); // NEW
    const tokens = /<!DOCTYPE\b|<!ENTITY\b|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?([^\s<>'"/!?=]+)(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi, stack = [], voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']); // NEW: count Unicode element names before native XML parsing validates their syntax.
    const htmlDeclaration = /^\s*<!doctype\s+html\s*>\s*<html(?:\s|>)/i.test(value) ? value.search(/<!doctype/i) : -1; // NEW: an entity-free HTML declaration has no external dependency.
    let depth = 0, count = 0, token; // NEW
    while ((token = tokens.exec(value))) { // NEW
      if (/^<!DOCTYPE|^<!ENTITY/i.test(token[0])) { if (token.index !== htmlDeclaration || !/^<!DOCTYPE/i.test(token[0])) fail('INVALID_XML', 'Document entities are disabled.'); continue; } // NEW
      if (/^<!\[/i.test(token[0]) && !token[0].startsWith('<![CDATA[')) fail('INVALID_XML', 'Invalid XML declaration.'); // NEW
      if (!token[1]) continue; // NEW
      if (token[0].startsWith('</')) { // NEW
        if (!html && stack.pop() !== token[1]) fail('INVALID_XML', 'Mismatched XML element.'); depth = Math.max(0, depth - 1); // NEW
      } else { // NEW
        if (++count > 1000000 || depth + 1 > LIMITS.depth) fail('DEPTH_LIMIT', 'XML exceeds its complexity limit.'); // NEW
        if (!/\/\s*>$/.test(token[0]) && !(html && voidTags.has(token[1].toLowerCase()))) { depth++; if (!html) stack.push(token[1]); } // NEW
      } // NEW
    } // NEW
    if (!html && stack.length) fail('INVALID_XML', 'Unclosed XML element.'); return value; // NEW
  } // NEW
  /** Scan nesting before parsing, without mistaking quoted brackets for containers. */
  function json(text, maximum = LIMITS.metadata) { // NEW
    textLimit(text, maximum); // NEW
    let depth = 0, // NEW
      count = 0; // NEW
    for (let index = 0; index < text.length; index++) { // NEW
      const char = text[index]; // NEW
      if (char === '"') { // NEW
        let end = index; // NEW
        for (;;) { // NEW
          end = text.indexOf('"', end + 1); // NEW
          if (end < 0) fail('INVALID_JSON', 'Invalid JSON input.'); // NEW
          let escapes = 0; // NEW
          for (let cursor = end - 1; cursor > index && text.charCodeAt(cursor) === 92; cursor--) escapes++; // NEW
          if (escapes % 2 === 0) break; // NEW
        } // NEW
        index = end; // NEW
      } else if (char === '{' || char === '[') { // NEW
        if (++depth > LIMITS.depth || ++count > 1000000) fail('DEPTH_LIMIT', 'JSON exceeds its complexity limit.'); // NEW
      } else if (char === '}' || char === ']') depth--;else if (char === ',' && ++count > 1000000) fail('DEPTH_LIMIT', 'JSON exceeds its complexity limit.'); // NEW
    } // NEW
    let value; // NEW
    try { // NEW
      value = JSON.parse(text); // NEW
    } catch (_) { // NEW
      fail('INVALID_JSON', 'Invalid JSON input.'); // NEW
    } // NEW
    jsonValue(value); // NEW
    return value; // NEW
  } // NEW
  /** Bound received objects before recursive canonicalization or domain validation. */
  function jsonValue(value) { // NEW
    const stack = [[value, 0, false]], // NEW
      seen = new Set(); // NEW
    let count = 0; // NEW
    while (stack.length) { // NEW
      const [item, depth, exit] = stack.pop(); // NEW
      if (exit) { // NEW
        seen.delete(item); // NEW
        continue; // NEW
      } // NEW
      if (depth > LIMITS.depth || ++count > 1000000) fail('DEPTH_LIMIT', 'Structured input exceeds its complexity limit.'); // NEW
      if (typeof item === 'number' && !Number.isFinite(item)) fail('INVALID_NUMBER', 'Non-finite numbers are not supported.'); // NEW
      if (!item || typeof item !== 'object') continue; // NEW
      if (seen.has(item)) fail('INVALID_STRUCTURE', 'Cyclic structured input is not supported.'); // NEW
      seen.add(item); // NEW
      stack.push([item, depth, true]); // NEW
      for (const key of Object.keys(item)) { // NEW
        if (unsafeKeys.has(key)) fail('INVALID_KEY', 'Unsafe structured property.'); // NEW
        stack.push([item[key], depth + 1]); // NEW
      } // NEW
    } // NEW
    return value; // NEW
  } // NEW
  /** Iterative XML checks precede codec construction; caller-owned DOM is never changed. */
  function validateNode(node, graph = true) { // NEW
    if (!node || node.nodeType !== 1 || node.nodeName === 'parsererror') fail('INVALID_XML', 'Invalid document XML.'); // NEW
    const stack = [[node, 1]]; // NEW
    let count = 0; // NEW
    while (stack.length) { // NEW
      const [current, depth] = stack.pop(); // NEW
      if (depth > LIMITS.depth || ++count > 1000000) fail('DEPTH_LIMIT', 'XML exceeds its complexity limit.'); // NEW
      if (graph && /^(?:include|script|mx.*Change)$/i.test(current.nodeName)) fail('UNSAFE_CODEC', 'Document-controlled codec instructions are not supported.'); // NEW
      if (graph && current.nodeName === 'mxCell') { // NEW
        const id = current.parentNode?.nodeName !== 'root' && current.parentNode?.getAttribute?.('id') || current.getAttribute('id'); // NEW
        if (id && unsafeIds.has(id)) fail('INVALID_MODEL', 'Canvas objects need safe identifiers.'); // NEW
        if (id && current.getAttribute('parent') === id) fail('PARENT_CYCLE', 'Canvas contains a parent cycle.'); // NEW: standalone decodeCell checks precede native insertion.
      } // NEW
      for (const attr of Array.from(current.attributes || [])) if (unsafeKeys.has(attr.name) || attr.name === 'as' && unsafeKeys.has(attr.value)) fail('INVALID_KEY', 'Unsafe codec property.'); // NEW
      if (graph) for (const attr of Array.from(current.attributes || [])) if (/_json$/.test(attr.name) && attr.value) json(attr.value, LIMITS.diagram); // NEW
      for (let child = current.lastChild; child; child = child.previousSibling) { // NEW
        if (child.nodeType === 10) fail('INVALID_XML', 'Document entities are not supported.'); // NEW
        if (child.nodeType === 1) stack.push([child, depth + 1]); // NEW
      } // NEW
    } // NEW
    return node; // NEW
  } // NEW
  /** Check a complete model's identities and parent forest in linear time. */
  function validateModel(node) { // NEW
    validateNode(node); // NEW
    const roots = Array.from(node.childNodes || []).filter(n => n.nodeType === 1 && n.nodeName === 'root'); // NEW
    if (node.nodeName !== 'mxGraphModel' || roots.length !== 1) fail('INVALID_MODEL', 'Canvas model needs one root.'); // NEW
    const cells = new Map(); // NEW
    for (const wrapper of Array.from(roots[0].childNodes).filter(n => n.nodeType === 1)) { // NEW
      const models = wrapper.nodeName === 'mxCell' ? [wrapper] : Array.from(wrapper.childNodes).filter(n => n.nodeType === 1 && n.nodeName === 'mxCell'); // NEW
      if (models.length !== 1) fail('INVALID_MODEL', 'Canvas object needs one native cell.'); // NEW
      const cell = models[0], // NEW
        id = wrapper.getAttribute('id') || cell.getAttribute('id'); // NEW
      if (!id || unsafeIds.has(id) || cells.has(id)) fail('INVALID_MODEL', 'Canvas objects need unique safe identifiers.'); // NEW
      if (wrapper !== cell && cell.hasAttribute('id') && cell.getAttribute('id') !== id) fail('INVALID_MODEL', 'Wrapped cell identity does not match its object.'); // NEW
      cells.set(id, cell); // NEW
      for (const geometry of Array.from(cell.getElementsByTagName('mxGeometry'))) for (const name of ['x', 'y', 'width', 'height']) if (geometry.hasAttribute(name) && !Number.isFinite(Number(geometry.getAttribute(name)))) fail('INVALID_NUMBER', 'Canvas geometry must be finite.'); // NEW
    } // NEW
    if (node.getElementsByTagName('mxCell').length !== cells.size) fail('INVALID_MODEL', 'Native cells must be direct model objects.'); // NEW
    const done = new Set(); // NEW
    for (const [id, cell] of cells) { // NEW
      for (const name of ['parent', 'source', 'target']) { // NEW
        const ref = cell.getAttribute(name); // NEW
        if (ref && !cells.has(ref)) fail('INVALID_REFERENCE', 'Canvas contains a missing object reference.'); // NEW
      } // NEW
      const chain = new Set(); // NEW
      let current = id; // NEW
      while (current && !done.has(current)) { // NEW
        if (chain.has(current)) fail('PARENT_CYCLE', 'Canvas contains a parent cycle.'); // NEW
        chain.add(current); // NEW
        current = cells.get(current)?.getAttribute('parent'); // NEW
      } // NEW
      for (const key of chain) done.add(key); // NEW
    } // NEW
    return node; // NEW
  } // NEW
  function link(value) { // NEW
    const text = String(value || '').trim(); // NEW
    return /^(?:https?:|mailto:|tel:|callto:|#|data:page\/|assets\/)/i.test(text) && !/[\u0000-\u001f\u007f]/.test(text) ? text : null; // NEW
  } // NEW
  /** A template's content is inert, including detached images and event attributes. */
  function displayInput(value) { // NEW
    try { const text = String(value ?? ''); xmlText(text, true); return text; } catch (_) { blocked(); return null; } // NEW: reject pathological display markup before native HTML parsing.
  } // NEW
  function plainText(value) { // NEW
    const text = displayInput(value); if (text === null) return 'Content unavailable'; // NEW
    const template = root.document.createElement('template'); // NEW
    template.innerHTML = text; // NEW
    for (const node of template.content.querySelectorAll('script,style,iframe,object,embed,svg,math,audio,video,img,link,meta,template')) node.remove(); // NEW
    return String(template.content.textContent || '').replace(/\s+/g, ' ').trim(); // NEW
  } // NEW
  const imageCache = new Map(); // NEW
  let assetBase = null, assetContextResolved = false, missingManagedImage = false; // NEW
  function setAssetBase(value) { // NEW
    assetContextResolved = true; // NEW
    assetBase = /^trellis-asset:\/\/[a-f0-9]+\/$/.test(value || '') ? value : null; if (!assetBase && missingManagedImage) blocked('ASSET_UNAVAILABLE'); if (assetBase) missingManagedImage = false; // NEW
  } // NEW
  /** Inspect raster headers and frame rectangles before a browser/native decoder allocates pixels. */
  function rasterInfo(data) { // NEW
    if (!data || data.length > LIMITS.raster) fail('IMAGE_LIMIT', 'Image exceeds its encoded limit.'); // NEW
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength), // NEW
      ascii = (offset, size) => String.fromCharCode(...data.subarray(offset, offset + size)); // NEW
    let mime, // NEW
      width = 0, // NEW
      height = 0, // NEW
      pixels = 0, // NEW
      frameCount = 0; // NEW
    const frame = (w, h) => { // NEW
      if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1 || (pixels += w * h) > LIMITS.pixels) fail('IMAGE_LIMIT', 'Image exceeds its decoded pixel limit.'); // NEW
      frameCount++; // NEW
      width ||= w; // NEW
      height ||= h; // NEW
    }; // NEW
    try { // NEW
      if (data.length >= 33 && ascii(0, 8) === '\x89PNG\r\n\x1a\n' && ascii(12, 4) === 'IHDR') { // NEW
        mime = 'image/png'; // NEW
        width = view.getUint32(16); // NEW
        height = view.getUint32(20); // NEW
        let frames = 1, // NEW
          controls = 0; // NEW
        for (let offset = 8; offset + 12 <= data.length;) { // NEW
          const size = view.getUint32(offset), // NEW
            kind = ascii(offset + 4, 4); // NEW
          if (offset + size + 12 > data.length) fail('INVALID_IMAGE', 'Truncated PNG image.'); // NEW
          if (kind === 'acTL') { // NEW
            if (size !== 8) fail('INVALID_IMAGE', 'Invalid animated PNG control.'); // NEW
            frames = view.getUint32(offset + 8); // NEW
          } // NEW
          if (kind === 'fcTL') { // NEW
            if (size !== 26) fail('INVALID_IMAGE', 'Invalid animated PNG frame.'); // NEW
            const w = view.getUint32(offset + 12), h = view.getUint32(offset + 16); // NEW
            if (!w || !h || view.getUint32(offset + 20) + w > width || view.getUint32(offset + 24) + h > height) fail('INVALID_IMAGE', 'Animated PNG frame is outside its canvas.'); // NEW
            controls++; // NEW
          } // NEW
          offset += size + 12; // NEW
        } // NEW
        if (controls && controls !== frames) fail('INVALID_IMAGE', 'Animated PNG frame count mismatch.'); // NEW
        if (!frames || frames > LIMITS.pixels) fail('IMAGE_LIMIT', 'Invalid image frame count.'); // NEW
        frame(width, height); // NEW
        if (width * height * frames > LIMITS.pixels) fail('IMAGE_LIMIT', 'Animated image exceeds its pixel limit.'); // NEW
      } else if (data.length >= 13 && /^GIF8[79]a$/.test(ascii(0, 6))) { // NEW
        mime = 'image/gif'; // NEW
        width = view.getUint16(6, true); // NEW
        height = view.getUint16(8, true); // NEW
        if (!width || !height) fail('INVALID_IMAGE', 'Invalid GIF canvas.'); // NEW
        if (width * height > LIMITS.pixels) fail('IMAGE_LIMIT', 'Image exceeds its pixel limit.'); // NEW
        let offset = 13 + (data[10] & 128 ? 3 * (1 << (data[10] & 7) + 1) : 0); // NEW
        const blocks = () => { // NEW
          while (offset < data.length) { // NEW
            const size = data[offset++]; // NEW
            if (!size) return; // NEW
            offset += size; // NEW
            if (offset > data.length) fail('INVALID_IMAGE', 'Truncated GIF image.'); // NEW
          } // NEW
          fail('INVALID_IMAGE', 'Truncated GIF image.'); // NEW
        }; // NEW
        while (offset < data.length) { // NEW
          const kind = data[offset++]; // NEW
          if (kind === 59) break; // NEW
          if (kind === 33) { // NEW
            offset++; // NEW
            blocks(); // NEW
          } else if (kind === 44) { // NEW
            const w = view.getUint16(offset + 4, true), h = view.getUint16(offset + 6, true); // NEW
            if (view.getUint16(offset, true) + w > width || view.getUint16(offset + 2, true) + h > height) fail('INVALID_IMAGE', 'GIF frame is outside its canvas.'); // NEW
            frame(w, h); // NEW
            const flags = data[offset + 8]; // NEW
            offset += 9 + (flags & 128 ? 3 * (1 << (flags & 7) + 1) : 0); // NEW
            offset++; // NEW
            blocks(); // NEW
          } else fail('INVALID_IMAGE', 'Invalid GIF image.'); // NEW
        } // NEW
        if (!pixels) fail('INVALID_IMAGE', 'GIF has no image frames.'); // NEW
      } else if (data.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') { // NEW
        mime = 'image/webp'; // NEW
        const u24 = offset => data[offset] + data[offset + 1] * 256 + data[offset + 2] * 65536; // NEW
        let animated = false; // NEW
        for (let offset = 12; offset + 8 <= data.length;) { // NEW
          const kind = ascii(offset, 4), // NEW
            size = view.getUint32(offset + 4, true), // NEW
            start = offset + 8; // NEW
          if (start + size > data.length) fail('INVALID_IMAGE', 'Truncated WebP image.'); // NEW
          if (kind === 'VP8X' && size >= 10) { // NEW
            width = u24(start + 4) + 1; // NEW
            height = u24(start + 7) + 1; // NEW
          } // NEW
          if (kind === 'ANMF' && size >= 16) { // NEW
            animated = true; // NEW
            const w = u24(start + 6) + 1, h = u24(start + 9) + 1; // NEW
            if (!width || !height || u24(start) * 2 + w > width || u24(start + 3) * 2 + h > height) fail('INVALID_IMAGE', 'WebP frame is outside its canvas.'); // NEW
            frame(w, h); // NEW
          } // NEW
          if (kind === 'VP8L' && size >= 5 && data[start] === 47) { // NEW
            width ||= 1 + data[start + 1] + ((data[start + 2] & 63) << 8); // NEW
            height ||= 1 + (data[start + 2] >> 6) + (data[start + 3] << 2) + ((data[start + 4] & 15) << 10); // NEW
          } // NEW
          if (kind === 'VP8 ' && size >= 10 && ascii(start + 3, 3) === '\x9d\x01\x2a') { // NEW
            width ||= view.getUint16(start + 6, true) & 16383; // NEW
            height ||= view.getUint16(start + 8, true) & 16383; // NEW
          } // NEW
          offset = start + size + (size & 1); // NEW
        } // NEW
        if (!animated) frame(width, height); // NEW
      } else if (data.length >= 4 && data[0] === 255 && data[1] === 216) { // NEW
        mime = 'image/jpeg'; // NEW
        for (let offset = 2; offset + 4 <= data.length;) { // NEW
          if (data[offset++] !== 255) fail('INVALID_IMAGE', 'Invalid JPEG marker.'); // NEW
          while (data[offset] === 255) offset++; // NEW
          const kind = data[offset++]; // NEW
          if (kind === 217 || kind === 218) break; // NEW
          if (kind === 1 || kind >= 208 && kind <= 215) continue; // NEW
          const size = view.getUint16(offset); // NEW
          if (size < 2 || offset + size > data.length) fail('INVALID_IMAGE', 'Truncated JPEG image.'); // NEW
          if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(kind)) { // NEW
            frame(view.getUint16(offset + 5), view.getUint16(offset + 3)); // NEW
            break; // NEW
          } // NEW
          offset += size; // NEW
        } // NEW
        if (!pixels) fail('INVALID_IMAGE', 'JPEG dimensions are missing.'); // NEW
      } else fail('INVALID_IMAGE', 'Unsupported raster image.'); // NEW
    } catch (error) { // NEW
      if (error.code) throw error; // NEW
      fail('INVALID_IMAGE', 'Invalid image header.'); // NEW
    } // NEW
    if (width * height * frameCount > LIMITS.pixels) fail('IMAGE_LIMIT', 'Image canvas and frames exceed their pixel limit.'); // NEW
    return { // NEW
      mime, // NEW
      width, // NEW
      height // NEW
    }; // NEW
  } // NEW
  /** Only this historical host declaration is removed, before parsing a disposable image copy. */ // NEW
  const legacySvgDeclaration = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">'; // NEW
  function embeddedSvg(xml, originalUri) { // NEW
    const projected = xml.startsWith(legacySvgDeclaration) ? xml.slice(legacySvgDeclaration.length) : xml; // NEW
    textLimit(projected, LIMITS.svg); xmlText(projected); // NEW: declarations elsewhere, entity subsets and other doctypes remain forbidden.
    validateSvg(new root.DOMParser().parseFromString(projected, 'image/svg+xml').documentElement); // NEW
    return projected === xml && originalUri ? originalUri : 'data:image/svg+xml;base64,' + root.btoa(root.unescape(encodeURIComponent(projected))); // NEW: preserve safe source encoding; normalized UTF-8 stays within the embedded byte budget.
  } // NEW
  /** Decode only declared SVG encodings; metadata never grants trust to the resulting markup. */ // NEW
  function decodeSvgUri(text) { // NEW
    const comma = text.indexOf(','); // NEW
    if (comma < 0 || comma > 256) fail('INVALID_IMAGE', 'Invalid SVG data URI header.'); // NEW
    const tokens = text.slice(0, comma).split(';'); // NEW
    if (tokens.shift().toLowerCase() !== 'data:image/svg+xml') fail('INVALID_IMAGE', 'Unsupported SVG media type.'); // NEW
    let charset = false, base64 = false; // NEW
    for (let index = 0; index < tokens.length; index++) { // NEW
      const token = tokens[index].trim().toLowerCase(); // NEW
      if (token === 'base64' && !base64 && index === tokens.length - 1) base64 = true; // NEW
      else if (!charset && !base64 && /^(?:utf8|charset=utf-?8)$/.test(token)) charset = true; // NEW
      else fail('INVALID_IMAGE', 'Unsupported or conflicting SVG encoding.'); // NEW
    } // NEW
    const maximum = base64 ? 4 * Math.ceil(LIMITS.svg / 3) : 3 * LIMITS.svg; // NEW
    if (text.length - comma - 1 > maximum) fail('INPUT_LIMIT', 'Encoded SVG exceeds its byte limit.'); // NEW
    const body = text.slice(comma + 1), xml = base64 ? decodeURIComponent(root.escape(root.atob(body))) : decodeURIComponent(body); // NEW: decode once, without falling back to another interpretation.
    return textLimit(xml, LIMITS.svg); // NEW: charge decoded UTF-8 before native parsing, including any declaration.
  } // NEW
  function imageSource(value) { // NEW
    const text = String(value || '').trim(); // NEW
    if (/^assets\/[a-f0-9]{16}(?:\.[a-z0-9_-]+)?$/i.test(text)) { if (!assetBase) { missingManagedImage = true; if (assetContextResolved) blocked('ASSET_UNAVAILABLE'); return null; } return new URL(text, assetBase).href; } // NEW
    if (/^trellis-asset:\/\/[a-f0-9]+\/assets\/[a-f0-9]{16}(?:\.[a-z0-9_-]+)?$/i.test(text)) return text; // NEW
    if (/^(?:images|img|stencils|styles)\//.test(text) && !/(?:\\|(?:^|\/)\.\.|[?#]|%)/.test(text)) return text; // NEW
    if (!/^data:/i.test(text)) try { // CHANGE: inline data reaches its bounds/decoder before the general URL resolver allocates a URL.
      const url = new URL(text, root.document?.baseURI); // NEW
      if (url.protocol === 'file:' && ['images/', 'img/', 'styles/', 'stencils/'].some(folder => url.href.startsWith(new URL(folder, root.document.baseURI).href))) return url.href; // NEW
    } catch (_) {} // NEW
    if (imageCache.has(text)) { const cached = imageCache.get(text); if (!cached.safe) blocked(cached.reason); return cached.safe; } // NEW: cached rejection must still report on a newly opened document.
    let safe = null, reason = 'IMAGE_REJECTED'; // NEW
    if (text.length <= Math.ceil(LIMITS.raster * 4 / 3) + 256 && /^data:image\/(?:png|jpeg|gif|webp)(?:;base64)?,/i.test(text)) { // NEW
      try { // NEW
        const data = Uint8Array.from(root.atob(text.slice(text.indexOf(',') + 1)), char => char.charCodeAt(0)); // NEW
        const info = rasterInfo(data); // NEW
        safe = 'data:' + info.mime + ';base64,' + text.slice(text.indexOf(',') + 1); // NEW
      } catch (error) { reason = error.code || 'IMAGE_REJECTED'; } // NEW
    } else if (/^data:image\/svg\+xml(?:[;,]|$)/i.test(text)) { // CHANGE: shared decoding also covers the navigator's UTF-8 SVG icons.
      try { // NEW
        safe = embeddedSvg(decodeSvgUri(text), text); // CHANGE: all accepted URI forms still pass the same static-SVG validator.
      } catch (error) { reason = error.code || 'IMAGE_REJECTED'; } // NEW
    } // NEW
    if (text.length < 65536) { // NEW
      imageCache.set(text, { safe, reason }); // NEW
      while (imageCache.size > 64) imageCache.delete(imageCache.keys().next().value); // NEW
    } // NEW
    if (!safe) blocked(reason); // NEW
    return safe; // NEW
  } // NEW
  /** Static SVG only: no executable elements, event attributes, remote URLs or CSS imports. */
  function validateSvgReferences(node) { // NEW
    const elements = [node, ...Array.from(node.getElementsByTagName('*'))], // NEW
      ids = new Map(), // NEW
      edges = new Map(), // NEW
      sizes = new Map(), // NEW
      active = new Set(); // NEW
    for (const element of elements) { // NEW
      const id = element.getAttribute('id'); // NEW
      if (id) { // NEW
        if (ids.has(id)) fail('INVALID_IMAGE', 'SVG identifiers must be unique.'); // NEW
        ids.set(id, element); // NEW
      } // NEW
    } // NEW
    for (const element of elements) { // NEW
      const links = Array.from(element.childNodes).filter(child => child.nodeType === 1); // NEW
      for (const attr of Array.from(element.attributes || [])) { // NEW
        const reference = /(?:^#|url\(\s*#)([A-Za-z0-9_.:-]+)/.exec(attr.value); // NEW
        if (reference && (/(?:href|src)$/i.test(attr.name) || /url\(/i.test(attr.value))) { // NEW
          const target = ids.get(reference[1]); // NEW
          if (!target) fail('INVALID_IMAGE', 'SVG reference is missing.'); // NEW
          links.push(target); // NEW
        } // NEW
      } // NEW
      edges.set(element, links); // NEW
    } // NEW
    const stack = [[node, false, 1]]; // NEW
    while (stack.length) { // NEW
      const [element, exit, depth] = stack.pop(); // NEW
      if (exit) { // NEW
        let size = 1; // NEW
        for (const child of edges.get(element)) size += sizes.get(child); // NEW
        if (size > 1000000) fail('IMAGE_LIMIT', 'SVG reference expansion exceeds its limit.'); // NEW
        sizes.set(element, size); // NEW
        active.delete(element); // NEW
        continue; // NEW
      } // NEW
      if (active.has(element) || depth > LIMITS.depth) fail('INVALID_IMAGE', 'SVG references contain a cycle or excessive depth.'); // NEW
      if (sizes.has(element)) continue; // NEW
      active.add(element); // NEW
      stack.push([element, true, depth]); // NEW
      for (const child of edges.get(element)) stack.push([child, false, depth + 1]); // NEW
    } // NEW
  } // NEW
  function validateSvg(node) { // NEW
    validateNode(node, false); // NEW
    if (node.localName !== 'svg') fail('INVALID_IMAGE', 'Invalid SVG image.'); // NEW
    const allowed = new Set(['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'use', 'symbol', 'marker']); // NEW
    for (const element of [node, ...Array.from(node.getElementsByTagName('*'))]) { // NEW
      if (!allowed.has(element.localName)) fail('INVALID_IMAGE', 'Active SVG content is not supported.'); // NEW
      for (const attr of Array.from(element.attributes || [])) { // NEW
        if (/^on/i.test(attr.name) || /(?:href|src)$/i.test(attr.name) && !/^#[A-Za-z0-9_.:-]+$/.test(attr.value) || /@import|expression\s*\(|javascript:|data:|https?:|file:|\/\/|var\s*\(|\\/i.test(attr.value) && !/^xmlns(?::|$)/.test(attr.name) || /url\s*\(/i.test(attr.value) && !/^(?:[^;]*:\s*)?url\(\s*#[A-Za-z0-9_.:-]+\s*\)\s*;?$/.test(attr.value)) fail('INVALID_IMAGE', 'SVG contains an unsafe dependency.'); // NEW
      } // NEW
    } // NEW
    validateSvgReferences(node); // NEW
    return node; // NEW
  } // NEW
  /** Clean the disposable visual DOM after font/image processing, preserving inert embedded source metadata. */ // NEW
  function cleanExport(node) { // NEW
    for (const element of [node, ...Array.from(node.getElementsByTagName('*'))]) { // NEW
      if (/^(?:script|style|link|meta|iframe|object|embed|audio|video|source|form|input|button|animate|animateMotion|animateTransform|set)$/i.test(element.localName)) { element.remove(); continue; } // NEW
      for (const attr of Array.from(element.attributes || [])) { // NEW
        const name = attr.name.toLowerCase(); // NEW
        if (/^on/.test(name) || ['srcset', 'background', 'poster'].includes(name)) element.removeAttribute(attr.name); // NEW
        else if (['src', 'href', 'xlink:href'].includes(name)) { // NEW
          if (/^(?:image|img)$/i.test(element.localName)) element.setAttribute(attr.name, imageSource(attr.value) || placeholder); // NEW
          else if (element.localName.toLowerCase() === 'a') { const safe = link(attr.value); if (safe) element.setAttribute(attr.name, safe); else element.removeAttribute(attr.name); } // NEW
          else if (!/^#[A-Za-z0-9_.:-]+$/.test(attr.value)) element.removeAttribute(attr.name); // NEW
        } else if (name !== 'content' && /url\s*\(/i.test(attr.value) && !/^url\(\s*['"]?#[A-Za-z0-9_.:-]+['"]?\s*\)$/.test(attr.value) && name !== 'style') element.removeAttribute(attr.name); // NEW
      } // NEW
      if (element.style) for (const property of Array.from(element.style)) { const value = element.style.getPropertyValue(property); if (/expression\s*\(|@import|\\|javascript:/i.test(value) || /url\s*\(/i.test(value) && !/^url\(\s*['"]?#[A-Za-z0-9_.:-]+['"]?\s*\)$/.test(value)) element.style.removeProperty(property); } // NEW
    } // NEW
    return node; // NEW
  } // NEW
  function richText(value) { // NEW
    const text = displayInput(value); if (text === null) return 'Content unavailable'; // NEW
    if (!root.DOMPurify) return root.document.createTextNode(text).textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); // NEW
    const html = root.DOMPurify.sanitize(text, { // NEW
      ALLOWED_TAGS: tags, // NEW
      ALLOWED_ATTR: ['style', 'href', 'src', 'alt', 'title', 'face', 'color', 'size', 'start', 'type', 'colspan', 'rowspan', 'width', 'height'], // NEW
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|callto|file|trellis-asset|data):|#|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i, // NEW: each surviving href/src is restricted again below before live insertion.
      ALLOW_DATA_ATTR: false, // NEW
      RETURN_DOM_FRAGMENT: true // NEW
    }); // NEW
    for (const element of html.querySelectorAll('*')) { // NEW
      if (element.hasAttribute('style')) for (const name of Array.from(element.style)) { // NEW
        const value = element.style.getPropertyValue(name); // NEW
        if (!styles.has(name) || /url\s*\(|expression\s*\(|var\s*\(|@import|\\/i.test(value)) element.style.removeProperty(name); // NEW
      } // NEW
      if (element.hasAttribute('href')) { // NEW
        const safe = link(element.getAttribute('href')); // NEW
        if (safe) { // NEW
          element.setAttribute('href', safe); // NEW
          element.setAttribute('rel', 'noopener noreferrer'); // NEW
        } else element.removeAttribute('href'); // NEW
      } // NEW
      if (element.tagName === 'IMG') element.setAttribute('src', imageSource(element.getAttribute('src')) || placeholder); // NEW
    } // NEW
    const template = root.document.createElement('template'); // NEW
    template.content.appendChild(html); // NEW
    return template.innerHTML; // NEW
  } // NEW
  const rejectionCodes = new Set(['CONTENT_BLOCKED', 'IMAGE_REJECTED', 'INVALID_XML', 'INVALID_IMAGE', 'IMAGE_LIMIT', 'INPUT_LIMIT', 'DEPTH_LIMIT', 'ASSET_UNAVAILABLE', 'REQUEST_BLOCKED', 'IMAGE_LOAD_FAILED']), rejections = new Set(); // NEW: fixed vocabulary bounds diagnostics and excludes source data.
  let warned = false, noticeGeneration = 0; // NEW
  function resetDocument() { // NEW
    warned = false; // NEW
    rejections.clear(); // NEW
    noticeGeneration++; // NEW
    assetBase = null; assetContextResolved = false; missingManagedImage = false; // NEW
    for (const notice of root.document?.querySelectorAll('[data-trellis-content-notice]') || []) notice.remove(); // NEW
  } // NEW
  function blocked(code = 'CONTENT_BLOCKED') { // NEW
    const reason = rejectionCodes.has(code) ? code : 'CONTENT_BLOCKED'; rejections.add(reason); // NEW
    if (warned || !root.document) return; // NEW
    warned = true; // NEW
    const generation = noticeGeneration; // NEW
    root.setTimeout(() => { // NEW
      if (!root.document.body || generation !== noticeGeneration) return; // NEW
      const notice = root.document.createElement('div'); // NEW
      notice.dataset.trellisContentNotice = '1'; // NEW
      notice.dataset.trellisContentReason = reason; // NEW
      notice.setAttribute('role', 'status'); // NEW
      notice.textContent = 'Remote or unsafe content was blocked. Import images as local garden assets to display them.'; // NEW
      notice.style.cssText = 'position:fixed;bottom:8px;left:8px;max-width:440px;padding:8px;background:#fff3cd;color:#332600;border:1px solid #927000;z-index:10000;font:12px Arial'; // NEW
      notice.onclick = () => notice.remove(); // NEW
      root.document.body.appendChild(notice); // NEW
    }, 0); // NEW
  } // NEW
  /** Keep host loading animation outside SVG; document SVG animation stays disabled. */ // NEW
  function installStatusSpinner() { // NEW
    if (!root.Editor?.tailSpin) return; // NEW
    const image = embeddedSvg('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="#808080" stroke-width="2" stroke-dasharray="28 10"/></svg>'); // NEW
    root.Editor.tailSpin = image; // NEW
    const style = root.document.createElement('style'); // NEW
    style.textContent = '@keyframes trellis-status-spin{to{transform:rotate(360deg)}}img[src="' + image + '"]{animation:trellis-status-spin .9s linear infinite}@media(prefers-reduced-motion:reduce){img[src="' + image + '"]{animation:none}}'; // NEW
    root.document.head.appendChild(style); // NEW
  } // NEW
  /** Install once after host classes exist, before App.main opens the initial document. */
  function install() { // NEW
    if (!root.Graph || root.Graph.__trellisContentPolicy) return; // NEW
    root.Graph.__trellisContentPolicy = true; // NEW
    installStatusSpinner(); // NEW
    root.document.addEventListener('securitypolicyviolation', event => { if (/^(?:https?:|wss?:|file:|trellis-asset:)/i.test(event.blockedURI || '')) blocked('REQUEST_BLOCKED'); }); // NEW
    root.document.addEventListener('error', event => { // NEW
      const image = event.target; if (!/^(?:img|image)$/i.test(image?.localName || '')) return; // NEW
      if (image.closest('[contenteditable="true"]')) return; // NEW: asynchronous display fallback must not create an authored edit.
      const attr = image.localName.toLowerCase() === 'img' ? 'src' : image.hasAttribute('href') ? 'href' : 'xlink:href', value = image.getAttribute(attr); // NEW
      if (value !== placeholder && /^(?:data:|trellis-asset:|https?:)/i.test(value || '')) { image.setAttribute(attr, placeholder); blocked('IMAGE_LOAD_FAILED'); } // NEW
    }, true); // NEW
    root.Graph.sanitizeHtml = richText; // NEW
    root.Graph.sanitizeLink = link; // NEW
    const setStatus = root.Editor?.prototype.setStatus; if (setStatus) root.Editor.prototype.setStatus = function (value) { const args = Array.from(arguments); if (typeof value === 'string') args[0] = richText(value); return setStatus.apply(this, args); }; // NEW: status messages are another live HTML consumer.
    const getCurrentValue = root.mxCellEditor?.prototype.getCurrentValue; // NEW
    if (getCurrentValue) root.mxCellEditor.prototype.getCurrentValue = function (state) { // NEW
      const value = getCurrentValue.apply(this, arguments); // NEW
      if (!assetBase || typeof value !== 'string' || String(state?.style?.html) !== '1' || !value.includes(assetBase)) return value; // NEW
      const template = root.document.createElement('template'); template.innerHTML = value; // NEW
      for (const image of template.content.querySelectorAll('img[src]')) { const src = image.getAttribute('src'); if (src.startsWith(assetBase) && /^assets\/[a-f0-9]{16}(?:\.[a-z0-9_-]+)?$/.test(src.slice(assetBase.length))) image.attributes.getNamedItem('src').value = src.slice(assetBase.length); } // NEW: restore canonical references only when the user commits a real edit.
      return template.innerHTML; // NEW
    }; // NEW
    const getSvg = root.Graph.prototype.getSvg; if (getSvg) root.Graph.prototype.getSvg = function () { return cleanExport(getSvg.apply(this, arguments)); }; // NEW
    const initMath = root.Editor?.initMath; // NEW
    if (initMath) root.Editor.initMath = function () { // NEW
      root.DRAW_MATH_URL = 'math4/es5'; // NEW
      const result = initMath.call(this, 'math4/es5/startup.js'); // NEW
      if (root.MathJax && typeof root.MathJax.typeset !== 'function') { // NEW
        root.MathJax.output = { ...root.MathJax.output, font: 'mathjax-tex' }; // NEW
        const loader = root.MathJax.loader ||= {}; loader.paths = { ...loader.paths, fonts: 'math4/es5/fonts', 'mathjax-tex': 'math4/es5/fonts/mathjax-tex-font' }; // NEW
      } // NEW
      return result; // NEW
    }; // NEW
    const source = Object.getOwnPropertyDescriptor(root.HTMLImageElement.prototype, 'src'); // NEW
    Object.defineProperty(root.HTMLImageElement.prototype, 'src', { // NEW
      ...source, // NEW
      set(value) { // NEW
        const safe = imageSource(value) || placeholder; // NEW
        if (/^trellis-asset:/.test(safe)) this.crossOrigin = 'anonymous'; // NEW
        source.set.call(this, safe); // NEW
      } // NEW
    }); // NEW
    const attribute = root.Element.prototype.setAttribute; // NEW
    root.Element.prototype.setAttribute = function (name, value) { // NEW
      if (this.tagName === 'IMG' && name.toLowerCase() === 'src') { // NEW
        value = imageSource(value) || placeholder; // NEW
        if (/^trellis-asset:/.test(value)) attribute.call(this, 'crossorigin', 'anonymous'); // NEW
      } // NEW
      if (this.tagName === 'IMG' && name.toLowerCase() === 'srcset') return; // NEW
      return attribute.call(this, name, value); // NEW
    }; // NEW
    const decompress = root.Graph.decompress; // NEW
    if (decompress) root.Graph.decompress = function (data, inflate, checked, maximum = LIMITS.diagram) { // NEW
      if (!data || !root.pako?.Inflate) return decompress.apply(this, arguments); // NEW
      textLimit(data); // NEW
      const chunks = [], // NEW
        decoder = new root.pako.Inflate({ // NEW
          raw: !inflate, // NEW
          to: 'string', // NEW
          chunkSize: 65536 // NEW
        }); // NEW
      let size = 0; // NEW
      decoder.onData = chunk => { // NEW
        size += bytes(chunk); // NEW
        if (size > Math.min(maximum, LIMITS.diagram) * 3) fail('INPUT_LIMIT', 'Decompressed content exceeds its byte limit.'); // NEW
        chunks.push(chunk); // NEW
      }; // NEW
      decoder.push(Uint8Array.from(root.atob(data), char => char.charCodeAt(0)), true); // NEW
      if (decoder.err) fail('INVALID_XML', 'Compressed document could not be decoded.'); // NEW
      const xml = decodeURIComponent(chunks.join('')); // NEW
      textLimit(xml, Math.min(maximum, LIMITS.diagram)); // NEW
      return checked ? xml : root.Graph.zapGremlins(xml); // NEW
    }; // NEW
    const convertImage = root.Editor?.prototype.convertImageToDataUri; // NEW
    if (convertImage) root.Editor.prototype.convertImageToDataUri = function (url) { // NEW
      const args = Array.from(arguments); // NEW
      args[0] = imageSource(url) || placeholder; // NEW
      if (/^trellis-asset:/.test(args[0])) args[4] = true; // NEW
      return convertImage.apply(this, args); // NEW
    }; // NEW
    const image = root.Graph.prototype.getImage; // NEW
    if (image) root.Graph.prototype.getImage = function () { // NEW
      const value = image.apply(this, arguments); // NEW
      return value ? imageSource(value) || placeholder : value; // NEW
    }; // NEW
    for (const Canvas of [root.mxSvgCanvas2D, root.mxHtmlCanvas2D, root.mxXmlCanvas2D]) if (Canvas?.prototype.image) { // NEW
      const image = Canvas.prototype.image; // NEW
      Canvas.prototype.image = function (x, y, width, height, src) { // NEW
        const args = Array.from(arguments); // NEW
        args[4] = imageSource(src) || placeholder; // NEW
        return image.apply(this, args); // NEW
      }; // NEW
    } // NEW
    for (const name of ['decode', 'decodeCell']) { // NEW
      const original = root.mxCodec.prototype[name]; // NEW
      root.mxCodec.prototype[name] = function (node) { // NEW
        if (node?.nodeType === 1) { // NEW
          if (node.nodeName === 'mxGraphModel') validateModel(node);else validateNode(node); // NEW
        } // NEW
        return original.apply(this, arguments); // NEW
      }; // NEW
    } // NEW
    if (root.mxStencil) root.mxStencil.allowEval = false; // NEW
    if (root.mxStencilRegistry) root.mxStencilRegistry.allowEval = false; // NEW
    if (root.mxGraphView) root.mxGraphView.prototype.allowEval = false; // NEW
    root.mxObjectCodec.allowEval = false; // NEW
    root.mxObjectCodec.prototype.processInclude = function (_decoder, node) { // NEW
      if (node.nodeName === 'include') fail('UNSAFE_CODEC', 'Document includes are disabled.'); // NEW
      return false; // NEW
    }; // NEW
    const parse = root.mxUtils.parseXml; // NEW
    root.mxUtils.parseXml = function (xml) { // NEW
      xmlText(xml); // NEW
      const doc = parse.apply(this, arguments); // NEW
      validateNode(doc.documentElement, false); // NEW
      return doc; // NEW
    }; // NEW
    /** Validate every page before a host routine can clear or partially replace its current file. */
    function documentInput(value, level = 0) { // NEW
      if (value == null || value === '') return; textLimit(value); if (!/^\s*</.test(value)) fail('INVALID_XML', 'Invalid document XML.'); // NEW
      if (level > LIMITS.depth) fail('DEPTH_LIMIT', 'Embedded document nesting exceeds its limit.'); // NEW
      const doc = root.mxUtils.parseXml(value), // NEW
        outer = doc.documentElement; // NEW
      let total = 0; // NEW
      const accept = model => { // NEW
        validateModel(model); // NEW
        total += bytes(new root.XMLSerializer().serializeToString(model)); // NEW
        if (total > LIMITS.diagram) fail('INPUT_LIMIT', 'Decoded document exceeds its total byte limit.'); // NEW
      }; // NEW
      if (outer.nodeName === 'mxGraphModel') accept(outer);else if (outer.nodeName === 'mxfile') { // NEW
        const pages = Array.from(outer.getElementsByTagName('diagram')), // NEW
          ids = pages.map(page => page.getAttribute('id')); // NEW
        if (!pages.length) fail('INVALID_MODEL', 'Document needs at least one page.'); validatePageIds(ids); // NEW
        for (const page of pages) { // NEW
          const model = Array.from(page.childNodes).find(node => node.nodeName === 'mxGraphModel'); // NEW
          accept(model || root.mxUtils.parseXml(root.Graph.decompress(page.textContent.trim(), null, null, LIMITS.diagram - total)).documentElement); // NEW
        } // NEW
      } // NEW
      if (outer.nodeName !== 'mxGraphModel' && outer.nodeName !== 'mxfile') { // NEW
        if (!root.Editor?.extractGraphModel) fail('INVALID_MODEL', 'Unsupported document root.'); // NEW
        for (const element of [outer, ...Array.from(outer.getElementsByTagName('div'))]) if (element.hasAttribute('data-mxgraph')) json(element.getAttribute('data-mxgraph'), LIMITS.diagram); // NEW
        const extracted = root.Editor.extractGraphModel(outer, true); // NEW: pure host extraction precedes page clearing for SVG/HTML copies.
        if (!extracted || extracted === outer) fail('INVALID_MODEL', 'Document does not contain a supported garden.'); // NEW
        documentInput(new root.XMLSerializer().serializeToString(extracted), level + 1); // NEW
      } // NEW
    } // NEW
    for (const name of ['setFileData', 'replaceFileData', 'getPagesForXml']) { // NEW
      const original = root.EditorUi?.prototype[name]; // NEW
      if (original) root.EditorUi.prototype[name] = function (xml) { // NEW
        documentInput(this.validateFileData ? this.validateFileData(xml) : xml); // NEW
        return original.apply(this, arguments); // NEW
      }; // NEW
    } // NEW
  } // NEW
  root.TrellisContentPolicy = Object.freeze({ // NEW
    REVISION, // NEW
    LIMITS, // NEW
    fail, // NEW
    bytes, // NEW
    textLimit, // NEW
    xmlText, // NEW
    json, // NEW
    jsonValue, // NEW
    validateNode, // NEW
    validateModel, // NEW
    isSafeIdentifier, // NEW
    validatePageIds, // NEW
    validateSvg, // NEW
    rasterInfo, // NEW
    plainText, // NEW
    richText, // NEW
    cleanExport, // NEW
    imageSource, // NEW
    setAssetBase, // NEW
    resetDocument, // NEW
    link, // NEW
    placeholder, // NEW
    diagnostics: () => Array.from(rejections, code => ({ code })), // NEW: copied, bounded reason codes only; no source strings or URLs.
    blocked, // NEW
    install // NEW
  }); // NEW
})(typeof window !== 'undefined' ? window : globalThis); // NEW
