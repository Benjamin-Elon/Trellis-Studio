/** Identity-scoped, read-only people counters. Tokens never enter synchronized metadata. */ // NEW
import crypto from 'node:crypto'; // NEW

const tokenSecret = crypto.randomBytes(32); // NEW: shared by both services for this process only.

/** Callers supply accepted members from a verified roster or a validated local diagram. */ // NEW
export function projectPeople(members, viewerIdentityId, telemetry, totalCount = members?.length ?? null) { // NEW
    const memberKeys = new Set(), onlineMemberKeys = new Set(), onlineUsers = new Set(), distinct = new Map(); // CHANGE
    for (const member of members || []) { const id = member.identityId || member.userId; if (!distinct.has(id)) distinct.set(id, { ...member, devices: [] }); distinct.get(id).devices.push(...(member.devices || [])); } // NEW
    let membershipComplete = Array.isArray(members), presenceComplete = Array.isArray(members) && distinct.size === totalCount; // CHANGE
    for (const member of distinct.values()) { // CHANGE
        const key = member.identityId ? crypto.createHmac('sha256', tokenSecret).update(JSON.stringify([viewerIdentityId, member.identityId])).digest('hex') : null; // NEW
        if (key) memberKeys.add(key); else membershipComplete = false; // NEW
        const devices = member.devices || [], known = telemetry?.available === true; // NEW
        const online = known && devices.some(device => device.deviceId === telemetry.deviceId || telemetry.connections?.[device.deviceId]?.connected === true); // CHANGE: pausing file transfer does not disconnect an approved device.
        const observed = known && devices.length > 0 && devices.every(device => device.deviceId === telemetry.deviceId || typeof telemetry.connections?.[device.deviceId]?.connected === 'boolean'); // NEW
        if (!online && !observed) presenceComplete = false; // NEW: absent telemetry never proves a member offline.
        if (online) { onlineUsers.add(member.identityId || member.userId); if (key) onlineMemberKeys.add(key); } // NEW
    } // NEW
    if (membershipComplete && memberKeys.size !== totalCount) membershipComplete = false; // NEW
    return { userCount: totalCount, onlineCount: presenceComplete || onlineUsers.size ? onlineUsers.size : null, memberKeys: [...memberKeys], onlineMemberKeys: [...onlineMemberKeys], membershipComplete, presenceComplete }; // NEW
} // NEW
