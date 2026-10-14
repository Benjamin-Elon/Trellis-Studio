/** Read-only project metadata, city resolution, and geographic grouping. */ // NEW
import { inspectDiagram, hasCanvasAccess } from './trellis-share-protocol.js'; // NEW

/** Reject missing/invalid coordinates rather than treating them as zero. */ // NEW
export function cityRecord(row) { // NEW
    const coordinate = value => typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN; // CHANGE
    const latitude = coordinate(row?.latitude), longitude = coordinate(row?.longitude); // CHANGE
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return null; // NEW
    return { cityId: String(row.city_id ?? row.cityId ?? ''), name: String(row.city_name ?? row.name ?? ''), country: String(row.country_name ?? row.country ?? ''), region: String(row.region_name ?? row.region ?? ''), latitude, longitude }; // NEW
} // NEW

/** Average great-circle distances per module, preserving repeated-city weighting. */ // NEW
export function averageDistance(origin, cities) { // NEW
    const start = cityRecord(origin), destinations = (cities || []).map(cityRecord).filter(Boolean); // NEW
    if (!start || !destinations.length) return null; // NEW
    const radians = degrees => degrees * Math.PI / 180; // NEW
    const distances = destinations.map(city => { // NEW
        const latitude = radians(city.latitude - start.latitude), longitude = radians(city.longitude - start.longitude); // NEW
        const a = Math.sin(latitude / 2) ** 2 + Math.cos(radians(start.latitude)) * Math.cos(radians(city.latitude)) * Math.sin(longitude / 2) ** 2; // NEW
        return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a)))); // NEW
    }); // NEW
    return distances.reduce((sum, distance) => sum + distance, 0) / distances.length; // NEW
} // NEW

/** All pages share one validated user store; only joined users with access count. */ // NEW
export function projectSummary(xml, cities, sharingConfigured, now = Date.now(), actorUserId) { // CHANGE
    const diagram = inspectDiagram(xml); // NEW
    const identityNode = diagram.cells.find(cell => cell.node.hasAttribute('trellis_users_diagram_id')) || diagram.cells.find(cell => cell.parentId === '0' && cell.node.hasAttribute('trellis_history_id')); // NEW
    const diagramId = identityNode?.node.getAttribute('trellis_users_diagram_id') || identityNode?.node.getAttribute('trellis_history_id') || null; // NEW
    const users = new Set((diagram.store.users || []).filter(user => !user.disabled && hasCanvasAccess(diagram, user.id, now)).map(user => user.id)); // NEW
    const modules = diagram.cells.filter(cell => cell.node.getAttribute('garden_module') === '1'); // NEW
    const moduleCities = []; // NEW
    for (const module of modules) { // NEW
        const id = module.node.getAttribute('city_id'), name = module.node.getAttribute('city_name'); // NEW
        const matches = id ? cities.filter(city => String(city.cityId) === id) : name ? cities.filter(city => city.name === name) : []; // NEW
        if (matches.length === 1) moduleCities.push(matches[0]); // NEW
    } // NEW
    return { diagramId, userCount: users.size, classification: sharingConfigured && users.size >= 2 ? 'shared' : 'private', accessible: !actorUserId || users.has(actorUserId), moduleCities, gardenModuleCount: modules.length, pendingInvitationCount: (diagram.store.invites || []).filter(invite => invite.status === 'pending' && invite.expiresAt > now).length, updatedAt: now }; // CHANGE
} // NEW
