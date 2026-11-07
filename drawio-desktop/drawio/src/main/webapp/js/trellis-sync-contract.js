/** Shared wire contract. Loaded before plugins and imported unchanged by the main process. */ // NEW
(function (root) { // NEW
    'use strict'; // NEW
    const garden = 5, community = 2; // CHANGE
    const supportedGardens = Object.freeze([garden]); // CHANGE: protocol 5 is the only managed storage and sharing format.
    const capabilities = Object.freeze({ peerProposals: false, communities: false, takeover: false, backup: false, handoff: false }); // NEW: later production capabilities remain gated by milestone-one qualification.
    function gardenFolder(id, version = garden) { // CHANGE
        if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid sharing identity.'); // NEW
        if (!supportedGardens.includes(version)) throw new Error('Unsupported Trellis garden protocol. Only protocol 5 is supported.'); // CHANGE
        return 'trellis-v' + version + '-' + id; // CHANGE
    } // NEW
    function requireCapability(name) { // NEW
        if (capabilities[name] !== true) throw Object.assign(new Error('This synchronization capability is not available until coordinator qualification is complete: ' + name + '.'), { code: 'SYNC_CAPABILITY_UNAVAILABLE' }); // NEW
    } // NEW
    root.TrellisSyncContract = Object.freeze({ garden, supportedGardens, community, capabilities, gardenFolder, requireCapability }); // CHANGE
})(globalThis); // NEW
