/** Domain tests exercise the same incremental validator as coordinator acceptance. */ // NEW
import { applyCurrentEvent } from '../../src/main/trellis-current-state.js'; // NEW
export function transactCurrent(xml, proposals) { // NEW
    let state = { xml, sequence: 0, attribution: {}, objectVersions: {}, holds: [], presence: [], reservations: [] }; // NEW
    const accepted = [], rejected = []; // NEW
    for (const proposal of proposals) { // NEW
        try { state = applyCurrentEvent(state, proposal); state.sequence++; if (['edit', 'save'].includes(proposal.kind)) accepted.push(proposal.id); } // NEW
        catch (error) { rejected.push({ id: proposal.id, reason: error.message }); } // NEW
    } // NEW
    return { ...state, accepted, rejected }; // NEW
} // NEW
