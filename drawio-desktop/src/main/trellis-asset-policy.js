/** Verified bytes, window-bound image capabilities, and save-only attachments. */
import path from 'node:path'; // NEW
import crypto from 'node:crypto'; // NEW
import { policy, LIMITS, readBounded, fail } from './trellis-input-policy.js'; // NEW
import { parseXml } from './trellis-share-protocol.js'; // NEW
/** Read once and return the same bytes that were hashed and inspected. */
export async function readVerifiedAsset(filename, image = false) { // NEW
  const name = path.basename(filename), maximum = image ? path.extname(name) === '.svg' ? LIMITS.svg : LIMITS.raster : LIMITS.attachment; // NEW
  const bytes = await readBounded(filename, maximum, null); // NEW: enforce the image boundary before hashing or parsing its bytes.
  const expected = /^([a-f0-9]{16})(?:\.[a-z0-9_-]+)?$/.exec(name); // NEW
  if (!expected || crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16) !== expected[1]) fail('ASSET_HASH', 'Shared asset failed content verification.'); // NEW
  if (!image) return { // NEW
    bytes, // NEW
    filename: name // NEW
  }; // NEW
  let mime; // NEW
  if (/^(?:\s*<\?xml[^>]*\?>)?\s*<svg[\s>]/i.test(bytes.subarray(0, 512).toString())) { // NEW
    if (bytes.length > LIMITS.svg) fail('IMAGE_LIMIT', 'SVG exceeds its byte limit.'); // NEW
    policy.validateSvg(parseXml(bytes.toString('utf8')).documentElement); // NEW
    mime = 'image/svg+xml'; // NEW
  } else mime = policy.rasterInfo(bytes).mime; // NEW
  const expectedMime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jpe': 'image/jpeg', '.jfif': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }[path.extname(name)]; // NEW
  if (expectedMime !== mime) fail('INVALID_IMAGE', 'Image filename and detected format do not match.'); // NEW
  return { // NEW
    bytes, // NEW
    mime, // NEW
    filename: name // NEW
  }; // NEW
} // NEW
/** Tokens grant only image reads and are additionally checked against the requesting webContents. */
export function createAssetBroker({ // NEW
  readImage, // NEW
  currentContext // NEW
}) { // NEW
  const tokens = new Map(), // NEW
    windows = new Map(); // NEW
  function revoke(callerId) { // NEW
    const token = windows.get(callerId); // NEW
    if (token) tokens.delete(token); // NEW
    windows.delete(callerId); // NEW
  } // NEW
  function baseUrl(callerId, shareId) { // NEW
    const context = currentContext(callerId), // NEW
      prior = tokens.get(windows.get(callerId)); // NEW
    if (!context) fail('ASSET_CONTEXT', 'No active garden asset context.'); // NEW
    if (prior && prior.context === context && prior.shareId === shareId) return 'trellis-asset://' + windows.get(callerId) + '/'; // NEW
    revoke(callerId); // NEW
    const token = crypto.randomBytes(24).toString('hex'); // NEW
    tokens.set(token, { // NEW
      callerId, // NEW
      shareId, // NEW
      context // NEW
    }); // NEW
    windows.set(callerId, token); // NEW
    return 'trellis-asset://' + token + '/'; // NEW
  } // NEW
  function lookup(reference, callerId) { // NEW
    const url = new URL(reference), // NEW
      entry = tokens.get(url.hostname); // NEW
    if (url.protocol !== 'trellis-asset:' || url.search || url.hash || !/^\/assets\/[a-f0-9]{16}(?:\.[a-z0-9_-]+)?$/.test(url.pathname) || !entry || callerId !== undefined && entry.callerId !== callerId || currentContext(entry.callerId) !== entry.context) fail('ASSET_CONTEXT', 'Image capability is unavailable.'); // NEW
    return { // NEW
      entry, // NEW
      relativePath: url.pathname.slice(1) // NEW
    }; // NEW
  } // NEW
  function authorize(callerId, reference, resourceType) { // NEW
    try { // NEW
      if (resourceType !== 'image' || !Number.isInteger(callerId)) return false; // NEW
      lookup(reference, callerId); // NEW
      return true; // NEW
    } catch (_) { // NEW
      return false; // NEW
    } // NEW
  } // NEW
  async function response(request) { // NEW
    try { // NEW
      if (request.method && request.method !== 'GET') return new Response(null, { // NEW
        status: 405 // NEW
      }); // NEW
      const { // NEW
          entry, // NEW
          relativePath // NEW
        } = lookup(request.url), // NEW
        image = await readImage(entry.callerId, { // NEW
          shareId: entry.shareId, // NEW
          relativePath // NEW
        }); // NEW
      lookup(request.url); // NEW
      return new Response(new Uint8Array(image.bytes), { // NEW
        headers: { // NEW
          'Content-Type': image.mime, // NEW
          'X-Content-Type-Options': 'nosniff', // NEW
          'Access-Control-Allow-Origin': '*', // NEW
          'Cache-Control': 'no-store', // NEW
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" // NEW
        } // NEW
      }); // NEW
    } catch (_) { // NEW
      return new Response(null, { // NEW
        status: 403 // NEW
      }); // NEW
    } // NEW
  } // NEW
  return { // NEW
    baseUrl, // NEW
    revoke, // NEW
    authorize, // NEW
    response // NEW
  }; // NEW
} // NEW
/** The picker is the only source of the destination; this module has no shell dependency. */
export async function saveReceivedAsset({ // NEW
  read, // NEW
  choose, // NEW
  write, // NEW
  input // NEW
}) { // NEW
  const asset = await read(input), // NEW
    selected = await choose({ // NEW
      title: 'Save attachment', // NEW
      defaultPath: asset.filename.replace(/[^A-Za-z0-9_.-]/g, '_') // NEW
    }); // NEW
  if (selected.canceled || !selected.filePath) return { // NEW
    ok: true, // NEW
    canceled: true // NEW
  }; // NEW
  await write(selected.filePath, asset.bytes); // NEW
  return { // NEW
    ok: true // NEW
  }; // NEW
} // NEW
