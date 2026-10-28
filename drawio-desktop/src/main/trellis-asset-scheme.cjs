/** Register before any asynchronous main-process dependency can reach app readiness. */ // NEW
const { protocol } = require('electron'); // NEW
protocol.registerSchemesAsPrivileged([{ scheme: 'trellis-asset', privileges: { standard: true, secure: true, corsEnabled: true } }]); // NEW
