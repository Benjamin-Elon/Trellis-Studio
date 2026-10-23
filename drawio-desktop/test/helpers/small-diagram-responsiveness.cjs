/** Opt-in production responsiveness checks. All source overrides, credentials and diagrams belong to this test profile. */ // CHANGE
const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const crypto = require('node:crypto'); // CHANGE
const os = require('node:os'); // CHANGE
const { Session } = require('node:inspector'); // CHANGE
const { spawnSync } = require('node:child_process'); // CHANGE
const { pathToFileURL } = require('node:url'); // CHANGE
const { resourceTracker } = require('./responsiveness-sources.cjs'); // CHANGE

module.exports = function responsivenessBenchmark({ project, session }) { // CHANGE
    const baseline = process.argv.includes('--baseline'), profiling = process.argv.includes('--profile'); // CHANGE
    const mode = process.env.TRELLIS_RESPONSIVENESS_MODE || 'private'; // CHANGE
    const records = Number(process.env.TRELLIS_JOURNAL_RECORDS || 0), samples = Number(process.env.TRELLIS_RESPONSIVENESS_SAMPLES || 30); // CHANGE
    const idleMs = Number(process.env.TRELLIS_RESPONSIVENESS_IDLE_MS || 60000), runNumber = Number(process.env.TRELLIS_RESPONSIVENESS_RUN || 1); // CHANGE
    if (!['local', 'private', 'shared'].includes(mode) || ![0, 1000].includes(records) || !Number.isInteger(samples) || samples < 1 || !Number.isFinite(idleMs) || idleMs < 0) throw Error('Invalid responsiveness benchmark configuration.'); // CHANGE
    const output = process.env.TRELLIS_RESPONSIVENESS_OUTPUT || path.join(project, '.test-artifacts/responsiveness'); // CHANGE
    const sourceRoot = process.env.TRELLIS_RESPONSIVENESS_SOURCE_ROOT; // CHANGE
    const label = process.env.TRELLIS_RESPONSIVENESS_LABEL || `${baseline ? 'before' : 'after'}-${mode}-${records}-run${runNumber}${profiling ? '-profile' : ''}-${Date.now()}`; // CHANGE
    const timings = {}, services = [], injected = path.join(output, 'injected', label); // CHANGE
    const resources = resourceTracker(), helperRoot = __dirname; // CHANGE
    fs.mkdirSync(injected, { recursive: true }); // CHANGE
    const observe = (phase, elapsed) => { const stat = timings[phase] ||= { count: 0, totalMs: 0, maxMs: 0 }; stat.count++; stat.totalMs += elapsed; stat.maxMs = Math.max(stat.maxMs, elapsed); }; // CHANGE
    globalThis.__trellisBenchmarkServices = services; // CHANGE
    globalThis.__trellisBenchmarkSync = (phase, operation) => { const start = performance.now(); try { return operation(); } finally { observe(phase, performance.now() - start); } }; // CHANGE
    globalThis.__trellisBenchmarkAsync = async (phase, operation) => { const start = performance.now(); try { return await operation(); } finally { observe(phase, performance.now() - start); } }; // CHANGE
    function install() { // CHANGE
        const main = path.join(project, 'src/main'), stagedMain = path.join(injected, 'main'); // CHANGE
        fs.cpSync(sourceRoot ? path.join(sourceRoot, 'main') : main, stagedMain, { recursive: true }); // CHANGE: isolate baseline modules without changing Electron's native module loader.
        for (const name of fs.readdirSync(stagedMain).filter(name => name.endsWith('.js'))) { // CHANGE
            const target = path.join(stagedMain, name), source = fs.readFileSync(target, 'utf8'); // CHANGE
            fs.writeFileSync(target, source.replace(/(['"])(\.\.\/\.\.\/drawio\/[^'"]+)\1/g, (_match, _quote, relative) => { const resolved = path.resolve(main, relative), browser = path.join(project, 'drawio/src/main/webapp/js'); return JSON.stringify(pathToFileURL(sourceRoot && resolved.startsWith(browser + path.sep) ? path.join(sourceRoot, 'browser-js', path.relative(browser, resolved)) : resolved).href); })); // CHANGE: freeze shared browser protocols with the matching main-process snapshot.
        } // CHANGE
        const entry = path.join(stagedMain, 'electron.js'); // CHANGE
        fs.writeFileSync(entry, fs.readFileSync(entry, 'utf8').replace('const __dirname = path.dirname(url.fileURLToPath(import.meta.url));', `const __dirname = ${JSON.stringify(main)};`).replaceAll('`${__dirname}/electron-preload.js`', JSON.stringify(path.join(stagedMain, 'electron-preload.js')))); // CHANGE: preload is frozen while asset locations retain their production paths.
        for (const basename of ['trellis-syncthing-service.js', 'trellis-collaboration-store.js']) { // CHANGE
            let source = fs.readFileSync(path.join(stagedMain, basename), 'utf8'); // CHANGE: retain frozen shared imports when adding timing observers.
            if (basename === 'trellis-syncthing-service.js') { // CHANGE
                source = source.replace('export function createSyncthingService(options)', 'function benchmarkServiceFactory(options)'); // CHANGE
                source += '\nexport function createSyncthingService(options) { const service = benchmarkServiceFactory(options); globalThis.__trellisBenchmarkServices.push({ service, options }); return service; }\n'; // CHANGE
            } else { // CHANGE
                source = source.replace('function serialized(operation) { const next = queue.then(operation);', "function serialized(operation) { const queued = performance.now(); const next = queue.then(() => { globalThis.__trellisBenchmarkQueueWait(performance.now() - queued); return operation(); });"); // CHANGE
                for (const name of ['read', 'materialize', 'action', 'preserve']) { // CHANGE
                    source = source.replace(`async function ${name}(`, `async function benchmark_${name}(`); // CHANGE
                    const insertion = `async function ${name}(...args) { return globalThis.__trellisBenchmarkAsync('${name}', () => benchmark_${name}(...args)); }\n`; // CHANGE
                    source = source.replace('    const directory =', insertion + '    const directory ='); // CHANGE
                } // CHANGE
                source = source.replace('import { replay,', 'import { replay as benchmarkReplay,').replace('signRecord, verifyRecord,', 'signRecord, verifyRecord as benchmarkVerify,'); // CHANGE
                source += "\nfunction replay(...args) { return globalThis.__trellisBenchmarkSync('replay', () => benchmarkReplay(...args)); }\nfunction verifyRecord(...args) { return globalThis.__trellisBenchmarkSync('verify', () => benchmarkVerify(...args)); }\n"; // CHANGE
            } // CHANGE
            fs.writeFileSync(path.join(stagedMain, basename), source); // CHANGE
        } // CHANGE
        globalThis.__trellisBenchmarkQueueWait = elapsed => observe('queueWait', elapsed); // CHANGE
        const historyFile = path.join(stagedMain, 'trellis-history-service.js'); // CHANGE
        // History functions close over the service database; observers must live inside that factory. // CHANGE
        let historySource = fs.readFileSync(historyFile, 'utf8'); // CHANGE
        for (const name of ['record', 'readRevision']) historySource = historySource.replace(`function ${name}(`, `function benchmark_${name}(`).replace('    let db =', `    function ${name}(...args) { return globalThis.__trellisBenchmarkSync('history.${name}', () => benchmark_${name}(...args)); }\n    let db =`); // CHANGE
        fs.writeFileSync(historyFile, historySource); // CHANGE
        const plugins = path.join(project, 'drawio/src/main/webapp/plugins/garden_planner_plugins'); // CHANGE
        const redirects = new Map(); // CHANGE
        const pluginSources = sourceRoot ? path.join(sourceRoot, 'plugins') : plugins; // CHANGE
        for (const name of fs.readdirSync(pluginSources).filter(name => name.endsWith('.js'))) { // CHANGE
            let source = fs.readFileSync(path.join(pluginSources, name), 'utf8'); // CHANGE
            if (name === 'Trellis_Syncthing.js') source = source.replace('const result = await bridge.collaborationAction({ shareId, ...input });', 'const result = await bridge.collaborationAction({ shareId, ...input }); window.__trellisBenchmarkReceived?.(input, result);'); // CHANGE
            if (name === 'Trellis_Syncthing.js') source = source.replace('const operation = async () => {', "const requestedAt = performance.now(); window.__trellisBenchmarkStage?.('save.requested'); const operation = async () => { window.__trellisBenchmarkStage?.('save.started', performance.now() - requestedAt);").replace('await acquisitionPromise; if (file() !== current', "window.__trellisBenchmarkStage?.('save.awaitClaim'); await acquisitionPromise; window.__trellisBenchmarkStage?.('save.claimReady'); if (file() !== current").replace("try { result = await coordinate({ kind: 'save'", "try { window.__trellisBenchmarkStage?.('save.journal'); result = await coordinate({ kind: 'save'").replace("const stat = await request('fileStat'", "window.__trellisBenchmarkStage?.('save.stat'); const stat = await request('fileStat'").replace('return new Promise((resolve, reject) => current.fileSaved', "window.__trellisBenchmarkStage?.('save.notifications'); return new Promise((resolve, reject) => current.fileSaved").replace('if (success) success(); resolve();', "window.__trellisBenchmarkStage?.('save.completed'); if (success) success(); resolve();"); // CHANGE: diagnostics are confined to injected copies.
            const target = path.join(injected, name); fs.writeFileSync(target, source); redirects.set(pathToFileURL(path.join(plugins, name)).href, pathToFileURL(target).href); // CHANGE
        } // CHANGE
        if (sourceRoot) { // CHANGE
            const scripts = path.join(project, 'drawio/src/main/webapp/js'); // CHANGE
            function redirectScripts(directory, relative = '') { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const name = path.join(relative, entry.name); if (entry.isDirectory()) redirectScripts(path.join(directory, entry.name), name); else redirects.set(pathToFileURL(path.join(scripts, name)).href, pathToFileURL(path.join(sourceRoot, 'browser-js', name)).href); } } // CHANGE
            redirectScripts(path.join(sourceRoot, 'browser-js')); redirects.set(pathToFileURL(path.join(project, 'drawio/src/main/webapp/mxgraph/mxClient.js')).href, pathToFileURL(path.join(sourceRoot, 'mxClient.js')).href); // CHANGE
        } // CHANGE
        session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'file://*/*'] }, (details, callback) => { // CHANGE
            const redirectURL = redirects.get(details.url.split('?')[0]); // CHANGE
            resources.observe(redirectURL || details.url); // CHANGE
            callback(redirectURL ? { redirectURL } : { cancel: /^https?:/.test(details.url) }); // CHANGE
        }); // CHANGE
    } // CHANGE

    async function run({ win, run: evaluate, profile, until }) { // CHANGE
        const renderer = source => evaluate('(async () => {\n' + (source.trimStart().startsWith('(async') ? 'return ' : '') + source + '\n})()'); // CHANGE: await nested fixture setup as well as asynchronous statements.
        const report = { label, mode, records, samples, idleMs, profiling, sourceRoot, complete: false, accepted: false, main: timings, environment: { cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), electron: process.versions.electron, node: process.versions.node, rendering: 'software' } }; // CHANGE
        const filename = path.join(output, label + '.json'); // CHANGE
        const persist = () => fs.writeFileSync(filename, JSON.stringify(report, null, 2)); // CHANGE
        let profileTimer, mainInspector; // CHANGE
        const inspect = (method) => new Promise((resolve, reject) => mainInspector.post(method, (error, value) => error ? reject(error) : resolve(value))); // CHANGE
        persist(); // CHANGE
        try { // CHANGE
            await renderer(`window.benchmarkErrors = []; const originalLogError = EditorUi.logError; EditorUi.logError = function (...args) { for (const value of args) if (value?.stack) { benchmarkErrors.push(value.stack); console.error('BENCHMARK_ERROR:', value.stack); } return originalLogError.apply(this, args); };`); // CHANGE: native save failures cannot masquerade as successful benchmark samples.
            const localPath = path.join(profile, 'documents', 'Responsiveness.drawio'); // CHANGE
            await renderer(`(async () => { // CHANGE
                const ui = smokeUi, graph = ui.editor.graph, id = crypto.randomUUID(), identity = await trellisIdentity.getSession(); // CHANGE
                window.graph = graph; window.undo = ui.editor.undoManager; window.clusters = graph.__trellisModules.clusters; // CHANGE
                const doc = mxUtils.parseXml('<mxGraphModel><root><mxCell id="0"/><object id="1"><mxCell parent="0"/></object></root></mxGraphModel>'), node = doc.getElementsByTagName('object')[0]; // CHANGE
                node.setAttribute('trellis_history_id', id); node.setAttribute('trellis_users_diagram_id', id); // CHANGE
                node.setAttribute('trellis_project_name', 'Responsiveness'); // CHANGE: use an already named project rather than benchmarking asynchronous first-name setup.
                const users = [{ id: 'benchmark-owner', name: 'Benchmark owner', email: 'owner@example.test', portableIdentityId: identity.identityId, admin: true, disabled: false }]; // CHANGE
                if (${JSON.stringify(mode)} === 'shared') users.push({ id: 'benchmark-peer', name: 'Benchmark peer', email: 'peer@example.test', admin: true }); // CHANGE: private fixtures remain private to one identity.
                node.setAttribute('trellis_users_json', JSON.stringify({ schemaVersion: 1, usersEnabled: true, users, pendingUsers: [], invites: [] })); // CHANGE
                const local = new LocalFile(ui, mxUtils.getXml(doc), 'Responsiveness.drawio'); local.fileObject = { path: ${JSON.stringify(localPath)}, name: 'Responsiveness.drawio', type: 'utf-8' }; // CHANGE
                await ui.fileLoaded(local); await Trellis.sharing.refresh(); await Trellis.users.restorePortableLogin(); // CHANGE
                window.frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); // CHANGE
                window.valueDocument = mxUtils.createXmlDocument(); window.value = attrs => { const node = valueDocument.createElement('object'); for (const [key, text] of Object.entries(attrs)) node.setAttribute(key, String(text)); return node; }; // CHANGE
                window.write = (cell, attrs) => { const node = cell.value.cloneNode(true); for (const [key, text] of Object.entries(attrs)) node.setAttribute(key, String(text)); graph.model.setValue(cell, node); }; // CHANGE
            })()`); // CHANGE
            await until(() => renderer('return !!smokeUi.getCurrentFile() && !!Trellis.users.getCurrentUser()'), 'responsiveness source'); // CHANGE
            console.log('CLUSTER_STAGE: responsiveness fixture'); // CHANGE
            await renderer(fs.readFileSync(path.join(helperRoot, 'module-cluster-fixture.js'), 'utf8')); // CHANGE
            await renderer(`(async () => { // CHANGE
                window.clusterLayerMetadata = graph.getDefaultParent().value.cloneNode(true); window.clusterRootMetadata = graph.model.getRoot().value?.cloneNode?.(true) || null; // CHANGE
                const fixture = new mxGraphModel(makeFixture(50)), target = new mxCell(value({ label: 'Benchmark label', trellis_owner_user_id: Trellis.users.getCurrentUser().id }), new mxGeometry(500, 50, 100, 40), 'rounded=1;html=1;'); target.id = 'benchmark-edit'; target.vertex = true; fixture.add(fixture.getRoot().getChildAt(0), target); // CHANGE
                const incoming = new mxCell(value({ label: 'Incoming label', trellis_owner_user_id: ${JSON.stringify(mode === 'shared' ? 'benchmark-peer' : 'benchmark-owner')} }), new mxGeometry(620, 50, 100, 40), 'rounded=1;html=1;'); incoming.id = 'benchmark-incoming'; incoming.vertex = true; fixture.add(fixture.getRoot().getChildAt(0), incoming); // CHANGE
                const xml = '<mxfile><diagram id="benchmark-page" name="Benchmark">' + mxUtils.getXml(new mxCodec().encode(fixture)) + '</diagram></mxfile>'; // CHANGE
                const local = new LocalFile(smokeUi, xml, 'Responsiveness.drawio'); local.fileObject = { path: ${JSON.stringify(localPath)}, name: 'Responsiveness.drawio', type: 'utf-8' }; // CHANGE
                await smokeUi.fileLoaded(local); await Trellis.sharing.refresh(); await Trellis.users.restorePortableLogin(); // CHANGE
                await new Promise((resolve, reject) => local.save(false, resolve, reject)); await frames(); // CHANGE
                window.benchmarkContext = Trellis.sharing.context(); // CHANGE
            })()`); // CHANGE
            console.log('CLUSTER_STAGE: responsiveness transport ' + mode); // CHANGE
            if (mode === 'private') await renderer(`const imported = await trellisGardenLibrary.importCurrent({ path: benchmarkContext.diagramPath, diagramId: benchmarkContext.diagramId, userId: benchmarkContext.userId }); await TrellisGardenHome.openPath(smokeUi, imported.path);`); // CHANGE
            if (mode === 'shared') await renderer(`smokeUi.confirm = (_message, accept) => accept(); await Trellis.sharing.ensureManaged();`); // CHANGE
            await renderer('await Trellis.sharing.refresh(); await Trellis.users.restorePortableLogin(); smokeUi.hideDialog(true, true);'); // CHANGE
            const info = await renderer('return Trellis.sharing.getInfo()'); // CHANGE
            let transport, descriptor, peer; // CHANGE
            const { signRecord, encodeBlock, decodeBlock, inspectDiagram, parseXml } = await import(pathToFileURL(path.join(injected, 'main/trellis-share-protocol.js'))); // CHANGE
            const { diffObjects } = await import(pathToFileURL(path.join(injected, 'main/trellis-collaboration-protocol.js'))); // CHANGE
            if (mode !== 'local') { // CHANGE
                for (const entry of services) { const canvases = await entry.service.listCanvases(); if (canvases.some(canvas => canvas.shareId === info.shareId)) { transport = entry; break; } } // CHANGE
                if (!transport) throw Error('Managed fixture did not select a production transport.'); // CHANGE
                descriptor = await transport.service.libraryDescriptor(info.shareId); // CHANGE
                transport.service.setContext('benchmark-admin', { diagramPath: info.diagramPath, diagramId: info.diagramId, userId: 'benchmark-owner' }); // CHANGE
                console.log('CLUSTER_STAGE: responsiveness peer approval'); // CHANGE
                const peerHome = path.join(profile, 'benchmark-peer'), executable = path.join(transport.options.binaryRoot, process.platform + '-' + process.arch, process.platform === 'win32' ? 'syncthing.exe' : 'syncthing'); // CHANGE
                const generated = spawnSync(executable, ['generate', '--home=' + peerHome], { windowsHide: true, timeout: 15000, encoding: 'utf8' }); // CHANGE
                if (generated.status !== 0) throw Error('Benchmark peer identity generation failed: ' + (generated.error?.message || generated.stderr)); // CHANGE
                const peerId = parseXml(fs.readFileSync(path.join(peerHome, 'config.xml'), 'utf8')).getElementsByTagName('device')[0].getAttribute('id'), pair = crypto.generateKeyPairSync('ed25519'); // CHANGE
                peer = { deviceId: peerId, userId: mode === 'private' ? 'benchmark-owner' : 'benchmark-peer', sessionId: 'benchmark-remote', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) }; // CHANGE
                const invitation = decodeBlock('INVITE', (await transport.service.createDeviceInvite('benchmark-admin', { shareId: info.shareId, userId: peer.userId })).block); // CHANGE
                await transport.service.requestMembership('benchmark-admin', { shareId: info.shareId, operation: 'approve', reply: encodeBlock('REPLY', { schema: 2, protocolVersion: 2, shareId: info.shareId, diagramId: info.diagramId, deviceId: peer.deviceId, publicKey: peer.publicKey, inviteId: invitation.inviteId, userId: peer.userId, email: invitation.email, expiresAt: invitation.expiresAt, codeHash: null, deviceSetup: invitation.deviceSetup }) }); // CHANGE
                descriptor = await transport.service.libraryDescriptor(info.shareId); if (!descriptor.members.some(member => member.deviceId === peer.deviceId)) throw Error('The production transport did not approve the benchmark peer.'); // CHANGE
                report.memberCount = descriptor.members.length; report.delivery = 'Approved peer signed journal records; network transfer latency excluded.'; // CHANGE
                if (records) { // CHANGE
                    const directory = path.join(info.folderPath, '.trellis/collaboration-v2/records'); fs.mkdirSync(directory, { recursive: true }); // CHANGE
                    const existing = fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')).payload); // CHANGE
                    const referenced = new Set(existing.flatMap(record => record.parents)); let parents = existing.filter(record => !referenced.has(record.id)).map(record => record.id), clock = Math.max(0, ...existing.map(record => record.clock)); // CHANGE
                    for (let i = 0; i < records; i++) { const id = crypto.randomUUID(), record = { schema: 2, id, shareId: info.shareId, diagramId: info.diagramId, deviceId: peer.deviceId, userId: peer.userId, sessionId: 'benchmark-history', kind: 'view', clock: ++clock, parents, targets: [], at: Date.now() - records + i }; fs.writeFileSync(path.join(directory, id + '.json'), JSON.stringify(signRecord(record, peer.privateKey))); parents = [id]; } // CHANGE
                } // CHANGE
            } // CHANGE
            await renderer(fs.readFileSync(path.join(helperRoot, 'small-diagram-responsiveness-renderer.js'), 'utf8')); // CHANGE
            await renderer(`window.benchmarkProfiling = ${profiling};`); // CHANGE
            if (profiling) { // CHANGE
                mainInspector = new Session(); mainInspector.connect(); await inspect('Profiler.enable'); await inspect('Profiler.start'); // CHANGE: separate main-process diagnostics from unprofiled latency collection.
                win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('Profiler.enable'); await win.webContents.debugger.sendCommand('Profiler.start'); // CHANGE
                let busy = false, checkpoint = 0; // CHANGE
                profileTimer = setInterval(async () => { if (busy) return; busy = true; try { const { profile: cpu } = await win.webContents.debugger.sendCommand('Profiler.stop'); fs.writeFileSync(path.join(output, label + '-checkpoint' + (++checkpoint) + '.cpuprofile'), JSON.stringify(cpu)); await win.webContents.debugger.sendCommand('Profiler.start'); } catch (error) { console.error('Benchmark profiler:', error.message); } finally { busy = false; } }, 30000); // CHANGE
            } // CHANGE
            for (const key of Object.keys(timings)) delete timings[key]; // CHANGE
            report.interactions = await renderer(`return await benchmarkInteractions(${samples})`); persist(); // CHANGE
            if (transport) { // CHANGE
                report.remoteMs = []; // CHANGE
                for (let i = 0; i < samples; i++) { // CHANGE
                    const label = 'Remote benchmark ' + i; // CHANGE
                    await renderer(`benchmarkRemoteLabel = ${JSON.stringify(label)}; benchmarkReceivedAt = null; benchmarkVisibleAt = null; graph.scrollCellToVisible(graph.model.getCell('benchmark-incoming')); await frames();`); // CHANGE
                    const snapshot = await transport.service.collaborationAction('benchmark-admin', { shareId: info.shareId, kind: 'get' }); // CHANGE
                    const diagram = inspectDiagram(snapshot.xml), cell = diagram.cells.find(cell => cell.id === 'benchmark-incoming'); cell.node.setAttribute('label', label); // CHANGE
                    const delta = diffObjects(snapshot.xml, diagram.document.serialize()), directory = path.join(info.folderPath, '.trellis/collaboration-v2/records'); // CHANGE
                    const known = fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')).payload), referenced = new Set(known.flatMap(record => record.parents)); // CHANGE
                    let parents = known.filter(record => !referenced.has(record.id)).map(record => record.id), clock = Math.max(0, ...known.map(record => record.clock)); const at = Date.now(), claimId = crypto.randomUUID(); // CHANGE
                    for (const [offset, kind] of ['claim', 'edit', 'release'].entries()) { const id = offset ? crypto.randomUUID() : claimId, record = { schema: 2, id, shareId: info.shareId, diagramId: info.diagramId, deviceId: peer.deviceId, userId: peer.userId, sessionId: peer.sessionId, kind, clock: ++clock, parents, at: at + offset, targets: delta.targets, ...(kind === 'edit' ? { changes: delta.changes, claimIds: [claimId] } : {}) }; fs.writeFileSync(path.join(directory, id + '.json'), JSON.stringify(signRecord(record, peer.privateKey)), { flag: 'wx' }); parents = [id]; } // CHANGE
                    await transport.service.poll(); // CHANGE: deliver through the same signed-record verification and materialization as Syncthing.
                    report.remoteMs.push(await renderer(`return await benchmarkIncoming(${JSON.stringify(label)})`)); persist(); // CHANGE
                } // CHANGE
            } // CHANGE
            report.idle = await renderer(`return await benchmarkIdle(${idleMs})`); // CHANGE
            report.renderer = await renderer('return benchmarkTimings'); // CHANGE
            report.errors = await renderer('return benchmarkErrors'); if (report.errors.length) throw Error('Native renderer errors invalidate these measurements.'); // CHANGE
            resources.verify(); report.resources = Object.fromEntries(resources.files); report.complete = true; // CHANGE
            const p95 = values => values.slice().sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1]; // CHANGE
            report.remoteP95 = report.remoteMs?.length ? p95(report.remoteMs) : null; // CHANGE
            report.accepted = !profiling && samples >= 30 && idleMs >= 60000 && ['selectionP95', 'typingP95', 'movementP95'].every(key => report.interactions[key] <= 100) && (mode === 'local' || report.remoteP95 <= 300); // CHANGE
            if (profiling) { const { profile: cpuProfile } = await win.webContents.debugger.sendCommand('Profiler.stop'); fs.writeFileSync(path.join(output, label + '.cpuprofile'), JSON.stringify(cpuProfile)); } // CHANGE
            persist(); console.log('RESPONSIVENESS_RESULT:', JSON.stringify(report)); // CHANGE
            if (!report.accepted && !profiling) throw Error('Responsiveness acceptance failed; see ' + filename); // CHANGE
        } catch (error) { report.error = error.stack; try { report.partialInteractions = await renderer('return window.benchmarkPartialInteractions || null'); report.renderer = await renderer('return window.benchmarkTimings || null'); report.errors = await renderer('return window.benchmarkErrors || []'); } catch (_) { /* The renderer may already have exited. */ } persist(); throw error; } // CHANGE
        finally { clearInterval(profileTimer); if (mainInspector) { try { const { profile: cpu } = await inspect('Profiler.stop'); fs.writeFileSync(path.join(output, label + '-main.cpuprofile'), JSON.stringify(cpu)); } finally { mainInspector.disconnect(); } } } // CHANGE
    } // CHANGE
    return { install, run, entry: path.join(injected, 'main/electron.js') }; // CHANGE
}; // CHANGE
