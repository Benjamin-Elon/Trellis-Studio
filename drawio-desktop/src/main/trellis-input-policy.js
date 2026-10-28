/** Bounded, non-mutating readers shared by all received-data channels. */
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import '../../drawio/src/main/webapp/js/trellis-content-policy.js'; // NEW
export const policy = globalThis.TrellisContentPolicy; // NEW
export const { // NEW
  LIMITS, // NEW
  REVISION, // NEW
  json: parseJson, // NEW
  jsonValue: validateJson, // NEW
  textLimit, // NEW
  fail // NEW
} = policy; // NEW
/** Read through one open handle, limiting actual bytes even if a file grows after stat. */
export async function readBounded(filename, maximum = LIMITS.metadata, encoding = 'utf8', budget = null) { // NEW
  const file = await fs.open(filename, 'r'); // NEW
  try { // NEW
    const stat = await file.stat(); // NEW
    if (!stat.isFile() || stat.size > maximum) fail('INPUT_LIMIT', 'File exceeds its input limit.'); // NEW
    const blockSize = Math.max(65536, Math.min(1024 * 1024, stat.size + 1)); // NEW: reduce repeated filesystem calls without trusting stat as the byte boundary.
    const chunks = []; // NEW
    let bytes = 0; // NEW
    for (;;) { // NEW
      const capacity = Math.min(blockSize, maximum - bytes + 1, budget ? Math.max(1, budget.maximum - budget.used - (budget.pending || 0) + 1) : Infinity), buffer = Buffer.allocUnsafe(capacity); // NEW
      if (budget) budget.pending = (budget.pending || 0) + capacity; // NEW: account for concurrent reads before scheduling them.
      let bytesRead; // NEW
      try { ({ bytesRead } = await file.read(buffer, 0, buffer.length, null)); } finally { if (budget) budget.pending -= capacity; } // NEW
      if (!bytesRead) break; // NEW
      bytes += bytesRead; // NEW
      if (budget) { // NEW
        budget.used += bytesRead; // NEW
        if (budget.used > budget.maximum) fail('REPLAY_LIMIT', 'Received input exceeds its combined byte limit.'); // NEW
      } // NEW
      if (bytes > maximum) fail('INPUT_LIMIT', 'File exceeds its input limit.'); // NEW
      chunks.push(buffer.subarray(0, bytesRead)); // NEW
    } // NEW
    const result = Buffer.concat(chunks, bytes); // NEW
    return encoding ? result.toString(encoding) : result; // NEW
  } finally { // NEW
    await file.close(); // NEW
  } // NEW
} // NEW
export async function readJson(filename, maximum = LIMITS.metadata, budget = null) { // NEW
  return parseJson(await readBounded(filename, maximum, 'utf8', budget), maximum); // NEW
} // NEW
/** Bound directory enumeration and total observed bytes before collecting received records. */
export async function listBounded(directory, options = {}) { // NEW
  const names = [], // NEW
    entries = await fs.opendir(directory); // NEW
  let bytes = 0; // NEW
  for await (const entry of entries) { // NEW
    if (names.length >= LIMITS.records) fail('REPLAY_LIMIT', 'Received directory exceeds its record limit.'); // NEW
    names.push(options.withFileTypes ? entry : entry.name); // NEW
    if (entry.isFile() || entry.isSymbolicLink()) { // NEW
      const stat = await fs.stat(path.join(directory, entry.name)); // NEW
      if (stat.isFile()) bytes += stat.size; // NEW
      if (bytes > LIMITS.replay) fail('REPLAY_LIMIT', 'Received directory exceeds its combined byte limit.'); // NEW
    } // NEW
  } // NEW
  return names; // NEW
} // NEW
/** Stable, payload-free diagnostics are safe to cross the renderer bridge. */
export function diagnostic(error, recordId) { // NEW
  const known = /^(?:INPUT_LIMIT|DEPTH_LIMIT|INVALID_(?:XML|JSON|IMAGE|SCHEMA|REFERENCE|MODEL|NUMBER|KEY|STRUCTURE)|PARENT_CYCLE|UNSAFE_CODEC|IMAGE_LIMIT|ASSET_(?:HASH|CONTEXT)|REPLAY_(?:LIMIT|TIMEOUT)|ERR_WORKER_OUT_OF_MEMORY)$/.test(error?.code || ''); // NEW
  return { // NEW
    code: known ? error.code : 'INVALID_INPUT', // NEW
    reason: known ? String(error.message).slice(0, 240) : 'Input could not be verified or processed.', // NEW
    ...(recordId && /^[A-Za-z0-9_.-]{1,180}$/.test(recordId) ? { // NEW
      recordId // NEW
    } : {}) // NEW
  }; // NEW
} // NEW
