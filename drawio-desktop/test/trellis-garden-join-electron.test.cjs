/** Two production apps exercise native approval, download, guided acceptance, and process restart. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs/promises'); // NEW
const path = require('node:path'); // NEW
const os = require('node:os'); // NEW
const { spawn } = require('node:child_process'); // NEW
const project = path.resolve(__dirname, '..'); // NEW
test('two desktops join from Home, resume approval across restart, and reopen through portable identity', { skip: process.env.TRELLIS_GARDEN_JOIN_ELECTRON_TEST !== '1', timeout: 360000 }, async t => { // NEW
    const profiles = [], clients = []; let disposing = false; // CHANGE
    t.after(async () => { // NEW
        disposing = true; // NEW: a timed-out command cannot launch another fixture after cleanup begins.
        const stopped = await Promise.allSettled(clients.map(client => client.stop())); // CHANGE: attempt every isolated app's shutdown.
        for (const profile of profiles) { // CHANGE
            assert.equal(path.dirname(profile), os.tmpdir()); assert.ok(path.basename(profile).startsWith('trellis-garden-join-electron-')); // CHANGE
            const artifacts = path.join(project, '.test-artifacts/garden-join', path.basename(profile)); await fs.mkdir(artifacts, { recursive: true }); // CHANGE
            for (const file of ['driver-stage.log', 'driver-stderr.log']) await fs.copyFile(path.join(profile, file), path.join(artifacts, file)).catch(() => {}); // CHANGE
            if (stopped.some(result => result.status === 'rejected')) { t.diagnostic('Preserved join profile after unconfirmed shutdown: ' + profile); continue; } // CHANGE
            const diagnostics = await fs.readFile(path.join(profile, 'driver-stderr.log'), 'utf8').catch(() => ''); // CHANGE
            if (/did not exit after forced termination/.test(diagnostics)) { t.diagnostic('Preserved join profile after daemon exit failure: ' + profile); continue; } // CHANGE
            await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); // CHANGE
        } // CHANGE
        const failures = stopped.filter(result => result.status === 'rejected'); if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Join app cleanup failed'); // CHANGE
    }); // NEW
    async function start(profile) { // NEW
        if (disposing || t.signal.aborted) throw new Error('Join test has ended.'); // NEW
        if (!profile) { profile = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-garden-join-electron-')); profiles.push(profile); } // NEW
        const env = { ...process.env, TRELLIS_JOIN_TEST_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE; // NEW
        const child = spawn(require('electron'), [path.join(__dirname, 'helpers/garden-join-production-electron.cjs')], { cwd: project, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); // NEW
        let counter = 0, buffer = '', output = '', exited = false, exitResult; const waiting = new Map(); // CHANGE
        function wait(id, timeout = 100000) { return new Promise((resolve, reject) => { const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Electron command timed out: ' + id + '\n' + output.slice(-5000))); }, timeout); waiting.set(id, { resolve, reject, timer }); }); } // NEW
        const loaded = wait('ready'); child.stdout.on('data', chunk => { buffer += chunk; let end; while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line.startsWith('JOIN_RPC:')) { output += line + '\n'; continue; } const message = JSON.parse(line.slice(9)), pending = waiting.get(message.id); if (pending) { waiting.delete(message.id); clearTimeout(pending.timer); message.error ? pending.reject(new Error(message.error + '\n' + output.slice(-3000))) : pending.resolve(message.result); } } }); // NEW
        child.stderr.on('data', chunk => { output += chunk; require('node:fs').appendFileSync(path.join(profile, 'driver-stderr.log'), chunk); }); const exit = new Promise(resolve => child.once('exit', (code, signal) => { exited = true; exitResult = { code, signal }; for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('Electron exited ' + code + '\n' + output.slice(-5000))); } waiting.clear(); resolve(); })); // CHANGE
        const send = command => { const id = ++counter, result = wait(id, 60000), filename = path.join(profile, 'driver-command.json'); fs.writeFile(filename + '.tmp', JSON.stringify({ id, ...command })).then(() => fs.rename(filename + '.tmp', filename)).catch(error => { const pending = waiting.get(id); if (pending) { clearTimeout(pending.timer); waiting.delete(id); pending.reject(error); } }); return result; }; // CHANGE
        const client = { profile, eval: code => send({ code }), native: peer => send({ kind: 'native', peer }), capture: () => send({ kind: 'capture' }), async stop() { // CHANGE
            let force, bound, forced = false; // CHANGE
            try { // CHANGE
                if (!exited) { // CHANGE
                    force = setTimeout(() => { forced = true; t.diagnostic('Join app forced termination: ' + JSON.stringify({ at: Date.now(), pid: child.pid, accepted: child.kill() })); }, 15000); // CHANGE
                    void send({ kind: 'quit' }).catch(() => {}); // CHANGE
                    await Promise.race([exit, new Promise((_, reject) => { bound = setTimeout(() => reject(new Error('Owned join app did not exit: ' + child.pid)), 18000); })]); // CHANGE
                } // CHANGE
                if (forced || exitResult?.code !== 0 || exitResult?.signal) throw new Error('Join app shutdown failed: ' + JSON.stringify({ forced, ...exitResult }) + '\n' + output.slice(-5000)); // CHANGE
            } finally { clearTimeout(force); clearTimeout(bound); } // CHANGE
        } }; clients.push(client); await loaded; return client; // CHANGE
    } // NEW
    async function until(client, expression, label, peers) { // NEW
        const deadline = Date.now() + 70000; // NEW
        while (Date.now() < deadline) { if (await client.eval(expression)) return; if (label === 'linked library completion' && await client.eval("!![...joinTestUi.__trellisGardenHome.projectsRoot.querySelectorAll('button')].find(b=>b.textContent==='Retry finishing join')")) break; if (label === 'ready Open project' && await client.eval("!joinTestUi.__trellisGardenHome.projectsRoot.isConnected")) break; if (peers) { const [left, right] = peers; try { const a = await left.native(), b = await right.native(); await left.native(b); await right.native(a); } catch (_) {} } await new Promise(resolve => setTimeout(resolve, 400)); } // CHANGE
        throw new Error(label + ' timed out: ' + await client.eval("JSON.stringify({connected:joinTestUi.__trellisGardenHome?.projectsRoot?.isConnected,session:joinTestUi.__trellisGardenHome?.session,guide:joinTestUi.__trellisGardenHome?.projectsRoot?.textContent || document.body.textContent.slice(-3000),messages:window.joinMessages,context:Trellis.sharing?.context(),userId:Trellis.users?.getCurrentUser()?.id})")); // CHANGE
    } // NEW
    const owner = await start(); let member = await start(); // NEW
    await owner.eval("trellisIdentity.create({username:'Join Owner',password:'join-test-password',keepLoggedIn:true})"); // NEW
    await member.eval("trellisIdentity.create({username:'Join Member',password:'join-test-password',keepLoggedIn:true})"); // NEW
    await owner.eval("(async()=>{ window.testGarden = await trellisGardenLibrary.create({name:'Join integration garden'}); await TrellisGardenHome.openPath(joinTestUi,testGarden.path); })()"); // NEW
    await until(owner, "!!joinTestUi.editor.graph.__trellisModules && !!Trellis.users?.isLoggedIn() && !!Trellis.sharing", 'owner project tools'); // NEW
    await owner.eval("(async()=>{ await Trellis.sharing.refresh(); const garden=joinTestUi.editor.graph.__trellisModules.createModuleAtPoint({x:30,y:40},'garden'); window.testScope=garden.id; await new Promise((resolve,reject)=>joinTestUi.getCurrentFile().save(false,resolve,reject)); })()"); // NEW
    const invitation = await owner.eval("(async()=>{ window.testInvite=Trellis.users.createPendingInvite({email:'member@example.org',scopeCellIds:[testScope],preset:'visitor'}); if(!testInvite.ok)throw Error(testInvite.reason); await new Promise((resolve,reject)=>joinTestUi.getCurrentFile().save(false,resolve,reject)); return (await Trellis.sharing.prepareInvite(testInvite)).body; })()"); // NEW
    assert.match(invitation, /BEGIN TRELLIS INVITE/); // NEW
    await member.eval("(async()=>{await joinTestUi.showSplash(true); joinTestUi.dialog.container.querySelector('[data-join-project]').click()})()"); // CHANGE
    await member.eval(`(()=>{const root=joinTestUi.__trellisGardenHome.projectsRoot,text=root.querySelector('.trellis-join-guide textarea');text.value=${JSON.stringify(invitation)};text.dispatchEvent(new Event('input'));[...root.querySelectorAll('button')].find(b=>b.textContent==='Continue').click();})()`); // NEW
    await until(member, "!![...joinTestUi.__trellisGardenHome.projectsRoot.querySelectorAll('button')].find(b=>b.textContent==='Join project'&&!b.disabled)", 'invitation preview'); // NEW
    await member.eval("[...joinTestUi.__trellisGardenHome.projectsRoot.querySelectorAll('button')].find(b=>b.textContent==='Join project').click()"); // NEW
    await until(member, "joinTestUi.__trellisGardenHome.projectsRoot.textContent.includes('Waiting for approval')", 'pending join'); // NEW
    const request = await member.eval('trellisGardenJoin.list().then(result=>result.requests[0])'); const profile = member.profile; await member.stop(); member = await start(profile); // NEW
    await member.eval("joinTestUi.dialog.container.querySelector('[data-join-project]').click()"); await until(member, "joinTestUi.__trellisGardenHome.projectsRoot.isConnected && joinTestUi.__trellisGardenHome.accountHost.textContent.includes('Join Member') && joinTestUi.__trellisGardenHome.projectsRoot.textContent.includes('Pending invitations')", 'resumed pending invitation'); // CHANGE
    const resumed = await member.eval(`trellisGardenJoin.resume({id:${JSON.stringify(request.id)}})`); assert.equal(resumed.state, 'waiting'); // NEW
    const shareId = await owner.eval('testGarden.entry.shareId'); await owner.eval(`trellisShare.requestMembership({shareId:${JSON.stringify(shareId)},operation:'approve',reply:${JSON.stringify(resumed.reply)}})`); // NEW
    await until(member, "trellisGardenJoin.list().then(result=>result.requests[0]?.state==='ready')", 'approved download', [owner, member]); // NEW
    await until(member, "!![...joinTestUi.__trellisGardenHome.projectsRoot.querySelectorAll('button')].find(b=>b.textContent==='Resume invitation')", 'pending invitation controls'); // NEW
    await member.eval("[...joinTestUi.__trellisGardenHome.projectsRoot.querySelectorAll('button')].find(b=>b.textContent==='Resume invitation').click()"); // NEW
    await until(member, "!![...joinTestUi.__trellisGardenHome.projectsRoot.querySelectorAll('button')].find(b=>b.textContent==='Open project')", 'ready Open project'); // NEW
    await member.eval("[...joinTestUi.__trellisGardenHome.projectsRoot.querySelectorAll('button')].find(b=>b.textContent==='Open project').scrollIntoView({block:'center'})"); // NEW
    const screenshot = await member.capture(), artifacts = path.join(project, '.test-artifacts'); await fs.mkdir(artifacts, { recursive: true }); await fs.copyFile(screenshot, path.join(artifacts, 'garden-join-ready.png')); // NEW
    await member.eval("(()=>{window.joinMessages=[]; const report=joinTestUi.editor.setStatus.bind(joinTestUi.editor); joinTestUi.editor.setStatus=function(message){joinMessages.push(String(message));return report.apply(this,arguments)}; [...joinTestUi.__trellisGardenHome.projectsRoot.querySelectorAll('button')].find(b=>b.textContent==='Open project').click()})()"); // CHANGE
    await until(member, "trellisGardenJoin.list().then(result=>result.requests.length===0)", 'linked library completion', [owner, member]); // NEW
    assert.equal(await member.eval('Trellis.users.getCurrentUser().portableIdentityId===joinTestUi.__trellisGardenHome.session.identityId'), true); // NEW
    assert.equal((await member.eval('trellisGardenLibrary.list().then(result=>result.gardens)')).length, 1); // NEW
    assert.equal(await member.eval("!!document.querySelector('.trellis-users-auth-overlay')"), false); // NEW
    await member.stop(); member = await start(profile); const reopened = await member.eval('trellisGardenLibrary.list().then(result=>result.gardens[0])'); // NEW
    await member.eval(`TrellisGardenHome.openPath(joinTestUi,${JSON.stringify(reopened.path)})`); await until(member, '!!Trellis.users?.isLoggedIn()', 'identity-based reopen'); // NEW
    assert.equal(await member.eval('Trellis.users.listUsers().filter(user=>user.email===\'member@example.org\').length'), 1); // NEW
    t.diagnostic('Production main/preload/Home/Users, real two-peer approval/download, interrupted join restart, one collaborator, library entry, and identity-based reopen passed.'); // NEW
}); // NEW
