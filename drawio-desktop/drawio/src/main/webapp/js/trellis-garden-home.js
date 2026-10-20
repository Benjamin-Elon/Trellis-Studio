/** Desktop identity/library presentation; all storage stays behind narrow bridges. // NEW */
(function(root) {
    'use strict';
    function element(tag, text, className) {
        const node = document.createElement(tag);
        if (text != null) node.textContent = text;
        if (className) node.className = className;
        return node;
    }
    function button(text, action) {
        const node = element('button', text, 'geBtn'); node.type = 'button';
        node.addEventListener('click', action); return node;
    }
    function input(label, type = 'text') {
        const wrap = element('label', null, 'trellis-home-field'), control = element('input');
        control.type = type; control.setAttribute('aria-label', label);
        wrap.append(element('span', label), control); return { wrap, control };
    }
    function request(payload) {
        return new Promise((resolve, reject) => root.electron.request(payload, resolve, (message, error) => reject(error || new Error(message))));
    }
    async function chooseJson() {
        const paths = await request({ action: 'showOpenDialog', properties: ['openFile'], filters: [{ name: 'Trellis setup / field packages', extensions: ['json'] }] });
        if (!paths?.length) return null;
        return JSON.parse(await request({ action: 'readFile', filename: paths[0], encoding: 'utf8' }));
    }
    async function saveJson(value, name) {
        const filename = await request({ action: 'showSaveDialog', defaultPath: name, filters: [{ name: 'Trellis package', extensions: ['json'] }] });
        if (filename) await request({ action: 'writeFile', path: filename, data: JSON.stringify(value, null, 2), enc: 'utf8' });
        return !!filename;
    }
    /** Confirm only when a navigation actually replaces the current document. */
    function mayReplace(ui) {
        const file = ui.getCurrentFile();
        if (!file || !file.isModified()) return Promise.resolve(true);
        return new Promise(resolve => ui.confirm(mxResources.get('allChangesLost'), () => resolve(false), () => resolve(true), mxResources.get('cancel'), mxResources.get('discardChanges')));
    }
    /** The argument loader creates blank files on ENOENT; never use it here. */
    async function openPath(ui, filename, options = {}) { // CHANGE
        if (options.isActive && !options.isActive()) return false; // NEW
        if (!(options.replacementApproved && options.previousFile === ui.getCurrentFile()) && !await mayReplace(ui)) return false; // CHANGE
        let opened = false; // NEW
        await new Promise((resolve, reject) => ui.readGraphFile((entry, data, stat, name, modified) => {
            if (options.isActive && !options.isActive()) { resolve(); return; } // NEW: a closed/replaced browser cannot navigate on a late read result.
            try {
                if (!data) throw new Error('The garden file is empty.');
                const parsed = mxUtils.parseXml(data);
                if (!parsed.documentElement || !['mxfile', 'mxGraphModel'].includes(parsed.documentElement.nodeName) || parsed.getElementsByTagName('parsererror').length) throw new Error('The garden file is not valid diagram XML.');
                const pages = parsed.documentElement.nodeName === 'mxfile' ? Array.from(parsed.getElementsByTagName('diagram')) : [parsed.documentElement]; // NEW
                if (!pages.length) throw new Error('The garden has no diagram pages.'); // NEW
                for (const page of pages) { // NEW: validate every compressed page before the current document is closed.
                    const model = page.nodeName === 'diagram' ? root.Editor?.parseDiagramNode(page, true) : page; // NEW
                    if (!model || model.nodeName !== 'mxGraphModel' || !model.getElementsByTagName('root').length) throw new Error('The garden contains an invalid diagram page.'); // NEW
                    if (root.mxCodec && root.mxGraphModel) new root.mxCodec(model.ownerDocument).decode(model, new root.mxGraphModel()); // NEW
                } // NEW
                const file = new LocalFile(ui, data, name || filename.replace(/^.*[\\/]/, ''));
                file.fileObject = entry; file.stat = stat; file.setModified(!!modified);
                ui.hideDialog();
                Promise.resolve(ui.fileLoaded(file)).then(() => { opened = true; resolve(); }, reject); // CHANGE
            } catch (error) { reject(error); }
        }, error => { if (options.isActive && !options.isActive()) resolve(); else reject(error); }, filename)); // CHANGE
        return opened; // CHANGE
    }
    function install(ui) {
        if (ui.__trellisGardenHome || !root.trellisIdentity) return ui.__trellisGardenHome;
        const state = ui.__trellisGardenHome = { panel: null, session: null, mode: 'idle', opening: false, search: '', reminder: null, persistenceWarning: null, renderVersion: 0, splashStatuses: new Set(), projectsVersion: 0, referenceVersion: 0, focus: 'open' }; // CHANGE
        root.TrellisFieldRuntime?.install(ui); // NEW: install once; commands/plugins are resolved when used.
        const originalSplash = ui.showSplash.bind(ui); // NEW
        ui.showSplash = function() { // NEW: closing Home must preserve an already-open editor and its draft.
            if (!ui.getCurrentFile() || !root.SplashDialog) return originalSplash.apply(ui, arguments); // NEW
            const splash = new root.SplashDialog(ui); // NEW
            ui.showDialog(splash.container, 700, 630, true, true); // NEW
        }; // NEW
        ui.pickFile = () => showProjects(ui, { focus: 'open' }); // CHANGE: ordinary Open always reaches the library, including an empty library.
        const home = ui.actions.addAction('trellisHome', () => ui.showSplash(true)); home.label = 'Trellis Home';
        const projects = ui.actions.addAction('trellisGardenProjects', () => showProjects(ui)); projects.label = 'Garden Projects'; // NEW
        const add = ui.actions.addAction('trellisAddToGardenLibrary', () => importCurrent(ui).catch(error => ui.handleError(error))); add.label = 'Add current project to Garden Projects'; // CHANGE
        if (ui.menus?.get('file')) {
            const menu = ui.menus.get('file'), original = menu.funct;
            menu.funct = function(menuRoot, parent) { original.apply(this, arguments); ui.menus.addMenuItems(menuRoot, ['-', 'trellisHome', 'trellisAddToGardenLibrary'], parent); };
        }
        root.trellisIdentity.onStatus(async value => { // CHANGE: status updates refresh rows without replacing identity forms.
            const changed = JSON.stringify(value.session) !== JSON.stringify(state.session); // NEW
            if (!value.session) state.persistenceWarning = null; // NEW: a new session must not inherit an old persistence notice.
            if (state.session && !value.session && root.Trellis?.users?.getCurrentUser()?.portableIdentityId === state.session.identityId) root.Trellis.users.logout(); // NEW: background revocation ends the linked session while preserving the editor's unsaved document.
            if (changed && !value.session) { state.mode = 'idle'; state.reminder = null; } // CHANGE
            state.session = value.session; state.sessionVersion = (state.sessionVersion || 0) + 1; updateSplashStatuses(state); // CHANGE
            if (changed) { state.libraryProjects = []; state.libraryIdentityId = value.session?.identityId; } // NEW
            if (changed && state.mode === 'idle' && state.panel?.isConnected) await renderIdentity(ui, state).catch(error => { state.projectsStatus.textContent = error.message; }); // CHANGE
            if (state.projectsRoot?.isConnected) refreshProjects(ui, state); // NEW
        });
        root.trellisIdentity.onLocked(() => {
            const wasProjects = !!state.projectsRoot?.isConnected; // NEW
            state.reminder = null; state.persistenceWarning = null; state.session = null; state.mode = 'idle'; updateSplashStatuses(state); // CHANGE
            if (root.Trellis?.users) root.Trellis.users.logout();
            if (wasProjects) ui.hideDialog(); // NEW
            Promise.resolve(ui.fileLoaded(null)).then(() => wasProjects ? showProjects(ui) : ui.showSplash(true)).catch(error => ui.handleError(error)); // CHANGE
        });
        root.trellisShare?.onStatus?.(() => { if (state.projectsRoot?.isConnected) refreshProjects(ui, state); }); // NEW: legacy sharing transports also refresh the project browser.
        root.trellisGardenLibrary.onNaming?.(async message => { // NEW
            const release = () => { const held = state.namingMove; if (!held) return; held.file.__trellisNamingMove = null; held.resolve(); state.namingMove = null; }; // NEW
            if (message.phase === 'cancel') { release(); return {}; } // NEW
            const file = ui.getCurrentFile(), canonical = value => String(value || '').replace(/\\/g, '/').toLowerCase(); // NEW
            const metadata = ui.editor?.graph?.getModel?.().getCell?.('1')?.value; // NEW
            const diagramId = metadata?.getAttribute?.('trellis_users_diagram_id') || metadata?.getAttribute?.('trellis_history_id'); // NEW
            const previousHandle = diagramId === message.diagramId && (message.previousPaths || []).some(previous => canonical(previous) === canonical(file?.fileObject?.path)); // NEW
            if (!file?.fileObject || canonical(file.fileObject.path) !== canonical(message.oldPath) && !previousHandle) throw new Error('The open project changed before its filename could update.'); // CHANGE: retry missed commit notifications using both the historic path and stable document identity.
            if (message.phase === 'prepare') { // NEW
                if (state.retirement || root.__trellisClosing || file.savingFile || file.__trellisCollaborativeSaving) throw new Error('Filename update pending: wait for this project to finish saving.'); // NEW
                if (state.namingMove) throw new Error('Another filename update is in progress.'); // NEW
                const held = state.namingMove = { file }; file.__trellisNamingMove = new Promise(resolve => { held.resolve = resolve; }); // NEW
                return {}; // NEW
            } // NEW
            if (message.phase !== 'commit' || state.namingMove?.file !== file) throw new Error('The filename update was not prepared.'); // NEW
            try { // NEW
                const oldPath = file.fileObject.path, recent = ui.getRecent?.(); // NEW
                file.fileObject.path = message.path; file.fileObject.name = message.filename; file.title = message.filename; file.__trellisDisplayName = message.displayName; // NEW
                const draft = new Map(message.drafts || []).get(file.fileObject.draftFileName); if (draft) file.fileObject.draftFileName = draft; // NEW
                if (Array.isArray(recent)) root.localStorage.setItem('.recent', JSON.stringify(recent.filter(entry => entry.id !== oldPath || entry.mode != null))); // NEW
                file.stat = await request({ action: 'fileStat', file: message.path }); // NEW
                await ui.watchFile?.(file); file.addToRecent?.(); file.descriptorChanged?.(); // NEW
                root.dispatchEvent(new root.CustomEvent('trellisProjectNamed', { detail: message })); // NEW
                return {}; // NEW
            } finally { release(); } // NEW
        }); // NEW
        root.trellisGardenLibrary.onRetiring?.(async message => { // NEW
            const release = () => { // NEW
                const preparation = state.retirement; if (!preparation) return; // NEW
                preparation.model?.removeListener(preparation.changed); ui.editor?.graph?.setEnabled?.(preparation.enabled); root.__trellisClosing = preparation.closing; state.retirement = null; // NEW
            }; // NEW
            if (message.phase === 'cancel') { release(); return {}; } // NEW
            const file = ui.getCurrentFile(), filename = file?.fileObject?.path; // NEW
            const canonical = value => String(value || '').replace(/\\/g, '/').toLowerCase(); // NEW
            if (!filename || canonical(filename) !== canonical(message.path)) return {}; // NEW
            if (message.phase === 'prepare') { // NEW
                if (file.savingFile || file.__trellisNamingMove) throw new Error('Wait for this project to finish saving or renaming before deleting or leaving.'); // CHANGE // NEW
                release(); const graph = ui.editor?.graph, model = graph?.getModel(); // NEW
                const preparation = state.retirement = { file, model, dirty: false, enabled: graph?.isEnabled?.() ?? true, closing: root.__trellisClosing }; // NEW
                preparation.changed = () => { preparation.dirty = true; }; model?.addListener('change', preparation.changed); // NEW
                root.__trellisClosing = true; graph?.setEnabled?.(false); // NEW
                return { modified: file.isModified(), xml: file.isModified() ? ui.getFileData() : null }; // NEW
            } // NEW
            if (message.phase === 'commit') { // NEW
                if (!state.retirement || state.retirement.file !== file || state.retirement.dirty || file.savingFile) throw new Error('The project changed during retirement. Its files were preserved; try again.'); // NEW
                await ui.fileLoaded(null); release(); return {}; // NEW
            } // NEW
            throw new Error('Unsupported project retirement phase.'); // NEW
        }); // NEW
        /** Observe completed saves without changing file save implementations or summarizing drafts. */ // NEW
        function watchSavedFile() { // NEW
            const file = ui.getCurrentFile(); if (file === state.savedFile) return; // NEW
            state.savedFile?.removeListener?.(state.onSavedContent); state.savedFile = file; // NEW
            state.onSavedContent = () => { if (state.projectsRoot?.isConnected) refreshProjects(ui, state); }; // NEW
            file?.addListener?.('contentChanged', state.onSavedContent); // NEW
            if (file?.fileObject) root.trellisGardenLibrary.list().then(result => { const project = result.gardens.find(project => project.path === file.fileObject.path); if (project?.displayName && ui.getCurrentFile() === file) { file.__trellisDisplayName = project.displayName; file.descriptorChanged?.(); } }).catch(() => {}); // NEW: restore display text when reopening an already-named file.
        } // NEW
        ui.editor?.addListener?.('fileLoaded', watchSavedFile); watchSavedFile(); // NEW
        return state;
    }
    /** Import proves diagram access before saving linkage and relocating the file. */
    async function importCurrent(ui) {
        const users = root.Trellis?.users, file = ui.getCurrentFile(), session = await root.trellisIdentity.getSession();
        if (!session || !users || !file?.fileObject?.path) throw new Error('Log in to an identity and open the diagram before adding it to Garden library.');
        if (!users.isEnabled()) {
            if (users.listUsers().length) throw new Error('Enable the existing diagram users before linking this garden.');
            const result = users.enableUsers(session.username, root.crypto.randomUUID());
            if (!result.ok) throw new Error(result.reason);
        }
        const linked = await users.linkPortableIdentity();
        if (!linked.ok) { users.showAuthDialog({ blocking: false, message: linked.reason + ' Then choose File → Add current garden to Garden library.' }); return; }
        await new Promise((resolve, reject) => file.save(false, resolve, reject));
        const result = await root.trellisGardenLibrary.importCurrent({ path: file.fileObject.path, diagramId: linked.diagramId, userId: linked.user.id });
        if (result.path !== file.fileObject.path) await openPath(ui, result.path);
        ui.showSplash(true);
    }
    async function importGarden(ui) {
        const paths = await request({ action: 'showOpenDialog', properties: ['openFile'], filters: [{ name: 'Garden diagram', extensions: ['drawio'] }] });
        if (!paths?.length || !await openPath(ui, paths[0])) return;
        // Plugin loading and portable-session restoration can finish after fileLoaded.
        for (let i = 0; i < 40 && !root.Trellis?.users; i++) await new Promise(resolve => setTimeout(resolve, 100));
        await importCurrent(ui);
    }
    /** Wait for a selected download without replacing the editor until a local file exists. */ // NEW
    async function downloadAndOpen(ui, diagramId, state) { // NEW
        ui.hideDialog(); // CHANGE: replace the library rather than leaving it underneath a successful download.
        let canceled = false; // NEW
        const panel = element('div', null, 'trellis-home-open'), status = element('p', 'Waiting for an approved peer to deliver this garden.'); // NEW
        panel.append(element('h3', 'Download garden project'), status, button('Cancel', () => ui.hideDialog(true))); // CHANGE
        ui.showDialog(panel, 520, 200, true, true, cancel => { canceled = true; state.opening = false; if (cancel) root.setTimeout(() => showProjects(ui), 0); }); state.opening = true; // CHANGE
        try { // NEW
            await root.trellisGardenLibrary.download({ diagramId }); // NEW
            while (!canceled) { // NEW
                const selected = (await root.trellisGardenLibrary.list()).gardens.find(garden => garden.diagramId === diagramId); // NEW
                if (!selected) throw new Error('This garden is no longer in the active library.'); // NEW
                if (canceled) return; // NEW
                if (selected.available) { if (await openPath(ui, selected.path, { isActive: () => !canceled })) { if (selected.starterPending) await initializeProject(ui, false); return; } if (canceled) return; canceled = true; state.opening = false; ui.hideDialog(); showProjects(ui); return; } // CHANGE: canceled downloads cannot navigate on a late file read.
                status.textContent = selected.reason || 'Waiting for an approved peer. You may cancel and open it later.'; // NEW
                await new Promise(resolve => setTimeout(resolve, 2000)); // NEW
            } // NEW
        } catch (error) { // NEW
            if (!canceled) { status.textContent = error.message; panel.append(button('Retry', () => downloadAndOpen(ui, diagramId, state))); } // NEW
        } // NEW
    } // NEW
    /** One project dialog owns identity controls and both lists; refreshing never rebuilds its forms. */ // NEW
    function showProjects(ui, options = {}) { // NEW
        const state = install(ui); if (!state || state.projectsRoot?.isConnected) return; // NEW
        const splashVisible = !!document.querySelector('.trellis-splash-root'), fromSplash = splashVisible || !ui.getCurrentFile(); // CHANGE
        if (splashVisible) ui.hideDialog(); // CHANGE
        state.focus = options.focus || 'open'; state.mode = 'idle'; state.opening = true; // NEW
        const panel = element('section', null, 'trellis-projects-root'); panel.setAttribute('aria-label', 'Garden Projects'); state.view = 'active'; // CHANGE
        const heading = element('h2', 'Garden Projects'); // NEW
        const identity = element('section', null, 'trellis-home-panel'); identity.setAttribute('aria-label', 'Identity'); // NEW
        const reference = element('div', null, 'trellis-projects-reference'); // NEW
        const search = input('Search garden projects'); search.control.value = state.search; // NEW
        const status = element('div', null, 'trellis-home-muted'); status.setAttribute('aria-live', 'polite'); // NEW
        panel.append(heading, identity, reference, search.wrap, status); // NEW
        const navigation = element('div', null, 'trellis-home-row'), activeTab = button('Projects', () => switchProjectView('active')), trashTab = button('Trash', () => switchProjectView('trash')); // NEW
        function switchProjectView(view) { state.view = view; activeTab.setAttribute('aria-pressed', String(view === 'active')); trashTab.setAttribute('aria-pressed', String(view === 'trash')); state.actionPanel?.remove(); return refreshProjects(ui, state); } // CHANGE
        state.setProjectView = switchProjectView; // NEW
        activeTab.setAttribute('aria-pressed', 'true'); trashTab.setAttribute('aria-pressed', 'false'); navigation.append(activeTab, trashTab); heading.after(navigation); state.trashTab = trashTab; state.searchControl = search.control; // NEW
        state.projectsRoot = panel; state.panel = identity; state.referenceHost = reference; state.projectsStatus = status; // NEW
        state.referenceKey = null; // NEW
        state.libraryProjects = []; state.localProjects = []; state.creationButtons = []; // NEW
        for (const kind of ['shared', 'private']) { // NEW
            const section = element('section', null, 'trellis-projects-section'), title = element('h3', kind === 'shared' ? 'Shared garden projects' : 'Private garden projects'); // NEW
            title.tabIndex = -1; // NEW
            const create = button(kind === 'shared' ? 'Create New Shared Garden Project' : 'Create New Private Garden Project', () => showCreationForm(ui, state, section, kind)); // NEW
            create.disabled = true; state.creationButtons.push(create); // NEW
            const rows = element('div', null, 'trellis-projects-rows'); section.append(title, create, rows); panel.append(section); // NEW
            state[kind + 'Rows'] = rows; // NEW
        } // NEW
        const trashSection = element('section', null, 'trellis-projects-section'); trashSection.hidden = true; trashSection.append(element('h3', 'Trash'), element('p', 'Projects stay here until you delete them permanently. Paired devices apply changes when they reconnect.', 'trellis-home-muted')); // NEW
        state.trashRows = element('div'); trashSection.append(state.trashRows); panel.append(trashSection); state.trashSection = trashSection; // NEW
        const folder = element('div', null, 'trellis-home-muted'); state.folderLabel = folder; // NEW
        const footer = element('div', null, 'trellis-home-row'); // NEW
        footer.append(button('Change folder…', async () => { try { const result = await root.trellisGardenLibrary.selectLocalFolder(); if (result.ok) await refreshProjects(ui, state); } catch (error) { status.textContent = error.message; } }), button('Browse files…', () => browseLocalFiles(ui, state)), button('Refresh', () => refreshProjects(ui, state)), button('Close', () => ui.hideDialog(true))); // NEW
        panel.append(folder, footer); // NEW
        ui.showDialog(panel, Math.max(240, Math.min(760, (root.innerWidth || 1000) - 40)), Math.max(180, Math.min(710, (root.innerHeight || 900) - 70)), true, true, cancel => { // NEW
            state.opening = false; state.projectsVersion++; // NEW
            if (state.panel === identity) state.panel = null; // NEW
            if (cancel && fromSplash) root.setTimeout(() => ui.showSplash(true), 0); // NEW
        }, true); // NEW
        ui.dialog?.container?.classList.add('trellis-projects-dialog'); // NEW
        search.control.addEventListener('input', () => { state.search = search.control.value; drawProjects(ui, state); }); // NEW
        renderIdentity(ui, state).catch(error => { status.textContent = error.message; refreshProjects(ui, state); }); // NEW
    } // NEW
    function updateSplashStatuses(state) { // NEW
        for (const node of state.splashStatuses) { // NEW
            if (!node.isConnected && node.__trellisWasConnected) { state.splashStatuses.delete(node); continue; } // CHANGE: constructor-time splash nodes are still detached.
            node.__trellisWasConnected = node.__trellisWasConnected || node.isConnected; // NEW
            node.textContent = state.session ? 'Logged in as ' + state.session.username : 'Not logged in'; // NEW
        } // NEW
    } // NEW
    async function browseLocalFiles(ui, state) { // NEW
        try { // NEW
            const paths = await request({ action: 'showOpenDialog', properties: ['openFile'], filters: [{ name: 'Garden project', extensions: ['drawio'] }] }); // NEW
            if (paths?.length) await openPath(ui, paths[0]); // NEW
        } catch (error) { state.projectsStatus.textContent = error.message; } // NEW
    } // NEW
    /** Seed only this newly created project, through the same module mechanics as New Diagram. */ // NEW
    async function initializeProject(ui, shared) { // NEW
        const graph = ui.editor.graph, file = ui.getCurrentFile(); // CHANGE
        const ready = () => graph.__trellisModules && graph.__trellisTaskManager && graph.__trellisRoadmapManager && root.Trellis?.users && (!root.trellisShare || root.Trellis?.sharing) && (!shared || ui.actions.get('trellisShareGardenProject')); // CHANGE
        for (let attempt = 0; attempt < 100 && !ready(); attempt++) { if (file !== ui.getCurrentFile()) return false; await new Promise(resolve => root.setTimeout(resolve, 100)); } // CHANGE
        const users = root.Trellis?.users; await users?.restorePortableLogin(); // NEW
        if (file !== ui.getCurrentFile()) return false; // NEW: startup may finish after the user opens another document.
        if (!ready() || !users?.isLoggedIn()) throw new Error('The project was created. Retry after the garden tools finish loading.'); // CHANGE
        await root.Trellis?.sharing?.refresh?.(); // NEW: v2 starter edits wait for the signed baseline and save hooks.
        if (file !== ui.getCurrentFile()) return false; // NEW
        const parent = graph.getDefaultParent(), children = graph.model.getChildren(parent) || []; // NEW
        const garden = children.find(cell => cell.value?.getAttribute?.('garden_module') === '1') || (!children.length ? graph.__trellisModules.createModuleAtPoint({ x: 30, y: 40 }, 'garden') : null); // NEW
        if (!garden) throw new Error('The project was created, but its starter garden could not be initialized.'); // NEW
        graph.setSelectionCell(garden); // NEW
        await new Promise((resolve, reject) => file.save(false, resolve, reject)); // CHANGE
        if (file !== ui.getCurrentFile()) return false; // NEW
        try { await root.trellisGardenLibrary.completeStarter({ path: file.fileObject.path }); } // NEW: commit completion before later intentional deletion can make the diagram empty again.
        catch (error) { if (file !== ui.getCurrentFile()) return false; throw error; } // NEW
        if (file !== ui.getCurrentFile()) return false; // NEW
        if (shared) { // NEW
            const action = ui.actions.get('trellisShareGardenProject'); // NEW
            if (!action) throw new Error('The project was created. Use the garden Share button to invite collaborators.'); // NEW
            await action.funct(); // NEW
        } // NEW
        return true; // NEW
    } // NEW
    /** Cancellation precedes creation; retries reuse the exact project already created. */ // NEW
    function showCreationForm(ui, state, section, kind) { // NEW
        if (!state.session || state.creating) return; // NEW
        state.creationForm?.remove(); // NEW
        const form = element('form', null, 'trellis-home-form'), name = input('Project name'), status = element('div', null, 'trellis-home-muted'); // NEW
        name.control.required = true; name.control.maxLength = 240; // CHANGE: the shared validator counts up to 120 Unicode code points rather than UTF-16 units.
        const submit = element('button', 'Create project', 'geBtn'); submit.type = 'submit'; // NEW
        form.append(name.wrap, submit, button('Cancel', () => form.remove()), status); section.insertBefore(form, section.children[2]); state.creationForm = form; // NEW
        let created = null; // NEW
        form.addEventListener('submit', async event => { // NEW
            event.preventDefault(); if (state.creating || !name.control.value.trim()) return; // NEW
            state.creating = true; submit.disabled = true; // NEW
            try { // NEW
                const previousFile = ui.getCurrentFile(); // NEW
                if (!await mayReplace(ui)) return; // NEW
                if (!form.isConnected) return; // NEW
                if (!created) created = await root.trellisGardenLibrary.create({ name: name.control.value }); // CHANGE
                if (!form.isConnected) return; // NEW
                if (await openPath(ui, created.path, { replacementApproved: true, previousFile, isActive: () => form.isConnected })) await initializeProject(ui, kind === 'shared'); // CHANGE
            } catch (error) { // NEW
                status.textContent = error.message; // NEW
                if (created) { // NEW
                    submit.textContent = 'Retry opening created project'; name.control.disabled = true; // NEW
                    if (!form.isConnected) { // NEW
                        showCreationRecovery(ui, created, kind, error); // CHANGE
                    } // NEW
                } // NEW
            } finally { state.creating = false; submit.disabled = false; } // NEW
        }); // NEW
        name.control.focus(); // NEW
    } // NEW
    /** A failed opening/setup step keeps a concrete retry target without another create call. */ // NEW
    function showCreationRecovery(ui, project, kind, error) { // NEW
        const panel = element('div', null, 'trellis-home-open'), status = element('p', error.message); // NEW
        panel.append(element('h3', project.entry?.name || 'Created garden project'), status, button('Retry opening created project', async () => { // NEW
            try { if (await openPath(ui, project.path)) await initializeProject(ui, kind === 'shared'); } // NEW
            catch (failure) { if (panel.isConnected) status.textContent = failure.message; else showCreationRecovery(ui, project, kind, failure); } // NEW
        }), button('Garden Projects', () => { ui.hideDialog(); showProjects(ui); }), button('Close', () => ui.hideDialog())); // NEW
        ui.showDialog(panel, 500, 240, true, true); // NEW
    } // NEW
    /** Identity-local profile controls remain independent of transport-driven row refreshes. */ // NEW
    async function renderReferenceCity(ui, state) { // NEW
        const host = state.referenceHost, session = state.session, identityId = session?.identityId || null; // NEW
        if (!host?.isConnected || host.contains(document.activeElement) || state.referenceSaving) return; // NEW
        const version = ++state.referenceVersion; // NEW
        if (!session) { state.referenceKey = null; host.replaceChildren(element('span', 'Log in to choose your reference city.', 'trellis-home-muted')); return; } // CHANGE
        try { // NEW
            const [catalog, reference] = await Promise.all([root.trellisGardenLibrary.cities(), root.trellisGardenLibrary.getReferenceCity()]); // NEW
            if (!host.isConnected || version !== state.referenceVersion || identityId !== state.session?.identityId) return; // NEW
            const key = identityId + JSON.stringify([catalog.cities, reference.city]); // NEW
            if (key === state.referenceKey) return; state.referenceKey = key; // NEW
            const field = input('Distance from'), select = element('select'); select.setAttribute('aria-label', 'Reference city'); // NEW
            const empty = element('option', 'Choose reference city'); empty.value = ''; select.append(empty); // NEW
            for (const city of catalog.cities) { const option = element('option', [city.name, city.region, city.country].filter(Boolean).join(', ')); option.value = city.cityId; select.append(option); } // NEW
            if (reference.city && !catalog.cities.some(city => city.cityId === reference.city.cityId)) { const option = element('option', reference.city.name + ' (saved)'); option.value = reference.city.cityId; select.append(option); } // NEW
            select.value = reference.city?.cityId || ''; field.control.replaceWith(select); host.replaceChildren(field.wrap); // NEW
            if (!catalog.cities.length) host.append(element('span', 'No city coordinates are available in the city catalog.', 'trellis-home-muted')); // NEW
            select.addEventListener('change', async () => { // NEW
                select.disabled = true; state.referenceSaving = true; // CHANGE
                try { const result = await root.trellisGardenLibrary.setReferenceCity({ cityId: select.value || null }); reference.city = result.city; state.referenceKey = null; await refreshProjects(ui, state); } // CHANGE
                catch (error) { select.value = reference.city?.cityId || ''; state.projectsStatus.textContent = error.message; } // NEW
                finally { select.disabled = false; state.referenceSaving = false; } // CHANGE
            }); // NEW
        } catch (error) { if (host.isConnected && version === state.referenceVersion) host.replaceChildren(element('span', 'Reference city unavailable: ' + error.message, 'trellis-home-muted')); } // NEW
    } // NEW
    /** Refresh independent sources separately so one unavailable library cannot hide local files. */ // NEW
    async function refreshProjects(ui, state) { // NEW
        const panel = state.projectsRoot; if (!panel?.isConnected) return; // NEW
        if (panel.__refreshing) { panel.__refreshAgain = true; return; } // NEW
        panel.__refreshing = true; // NEW
        renderReferenceCity(ui, state); // NEW
        const version = state.projectsVersion, identityId = state.session?.identityId; // NEW
        try { // NEW
            const trashResult = (await Promise.allSettled([root.trellisGardenLibrary.listTrash?.() || Promise.resolve({ gardens: [] })]))[0]; // NEW: finish recoverable moves before scanning standalone files.
            const results = await Promise.allSettled([identityId ? root.trellisGardenLibrary.list() : Promise.resolve({ gardens: [] }), root.trellisGardenLibrary.listLocal()]); results.push(trashResult); // CHANGE
            if (!panel.isConnected || version !== state.projectsVersion || identityId !== state.session?.identityId) return; // NEW
            const errors = []; // NEW
            if (results[0].status === 'fulfilled') { state.libraryProjects = results[0].value.gardens; errors.push(...(results[0].value.errors || [])); } // CHANGE
            else errors.push('Identity library: ' + results[0].reason.message); // NEW
            if (results[1].status === 'fulfilled') { state.localProjects = results[1].value.gardens; state.folderLabel.textContent = 'Local projects folder: ' + results[1].value.folder; } // NEW
            else errors.push('Local folder: ' + results[1].reason.message); // NEW
            if (results[2].status === 'fulfilled') { state.trashedProjects = results[2].value.gardens; errors.push(...(results[2].value.errors || [])); } else errors.push('Trash: ' + results[2].reason.message); // NEW
            state.projectsStatus.textContent = errors.join(' · '); // NEW
            state.creationButtons.forEach(button => { button.disabled = !state.session; }); // NEW
            drawProjects(ui, state); // NEW
            if (!panel.__focused) { // NEW
                panel.__focused = true; // NEW
                const target = state.focus === 'create' && state.session ? state.creationButtons[0] : state.sharedRows.querySelector('button') || state.privateRows.querySelector('button') || state.privateRows.previousElementSibling.previousElementSibling; // NEW
                target?.focus({ preventScroll: true }); // NEW
            } // NEW
        } finally { // NEW
            panel.__refreshing = false; // NEW
            if (panel.__refreshAgain && panel.isConnected) { panel.__refreshAgain = false; refreshProjects(ui, state); } // NEW
        } // NEW
    } // NEW
    function distanceBand(distance) { return !Number.isFinite(distance) ? 4 : distance < 25 ? 0 : distance < 100 ? 1 : distance < 500 ? 2 : 3; } // NEW
    /** Preserve expanded row details and keyboard focus while updating only the lists. */ // NEW
    function drawProjects(ui, state) { // NEW
        const panel = state.projectsRoot; if (!panel?.isConnected) return; // NEW
        const scroll = panel.scrollTop, focused = document.activeElement?.getAttribute('data-project-focus'); // NEW
        state.sharedRows.parentNode.hidden = state.privateRows.parentNode.hidden = state.view === 'trash'; state.trashSection.hidden = state.view !== 'trash'; // NEW
        state.trashRows.replaceChildren(); // NEW
        for (const project of (state.trashedProjects || []).filter(p => p.name.toLowerCase().includes(state.search.toLowerCase()))) state.trashRows.append(trashRow(ui, state, project)); // NEW
        if (!state.trashRows.children.length) state.trashRows.append(element('p', state.search ? 'No matching projects in Trash.' : 'Trash is empty.', 'trellis-home-muted')); // NEW
        const expanded = new Set([...panel.querySelectorAll('details[open]')].map(node => node.getAttribute('data-project-details'))); // NEW
        const pathKey = filename => /^[a-z]:/i.test(filename || '') || /Win/i.test(root.navigator?.platform || '') ? (filename || '').toLowerCase() : filename; // NEW
        const knownPaths = new Set(state.libraryProjects.map(project => pathKey(project.path)).filter(Boolean)); // NEW
        const knownIds = new Set(state.libraryProjects.map(project => project.diagramId).filter(Boolean)); // NEW
        const projects = [...state.libraryProjects, ...state.localProjects.filter(project => !knownPaths.has(pathKey(project.path)) && !(project.diagramId && knownIds.has(project.diagramId)))].filter(project => project.name.toLowerCase().includes(state.search.toLowerCase())); // CHANGE
        const shared = projects.filter(project => project.classification === 'shared' || project.shared), privateProjects = projects.filter(project => !(project.classification === 'shared' || project.shared)); // NEW
        state.sharedRows.replaceChildren(); state.privateRows.replaceChildren(); // NEW
        const bands = ['Under 25 km', '25–100 km', '100–500 km', '500+ km', 'Unknown distance']; // NEW
        shared.sort((a, b) => distanceBand(a.distanceKm) - distanceBand(b.distanceKm) || (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.name.localeCompare(b.name)); // NEW
        let band = -1; // NEW
        for (const project of shared) { const next = distanceBand(project.distanceKm); if (next !== band) { state.sharedRows.append(element('h4', bands[next])); band = next; } state.sharedRows.append(projectRow(ui, state, project)); } // NEW
        privateProjects.sort((a, b) => a.name.localeCompare(b.name)); privateProjects.forEach(project => state.privateRows.append(projectRow(ui, state, project))); // NEW
        if (!shared.length) state.sharedRows.append(element('p', state.session ? 'No shared garden projects.' : 'Log in to see shared garden projects.', 'trellis-home-muted')); // NEW
        if (!privateProjects.length) state.privateRows.append(element('p', state.search ? 'No matching private projects.' : 'No private projects in your library or local folder.', 'trellis-home-muted')); // NEW
        for (const node of panel.querySelectorAll('details')) node.open = expanded.has(node.getAttribute('data-project-details')); // NEW
        if (focused) ([...panel.querySelectorAll('[data-project-focus]')].find(node => node.getAttribute('data-project-focus') === focused) || (state.view === 'trash' ? state.trashTab : state.searchControl))?.focus({ preventScroll: true }); // CHANGE
        panel.scrollTop = scroll; // NEW
    } // NEW
    /** Use the application name dialog so desktop Rename does not depend on browser prompt. */ // NEW
    function renameProject(ui, state, project) { // NEW
        const dialog = new root.FilenameDialog(ui, project.projectName || project.name, 'Rename', async name => { // CHANGE
            try { // CHANGE
                if (ui.getCurrentFile()?.fileObject?.path === project.path) await root.Trellis?.sharing?.settleObjectEdits?.({ release: true }); // NEW
                await root.trellisGardenLibrary.rename({ diagramId: project.diagramId, name }); await refreshProjects(ui, state); // CHANGE
            } // NEW
            catch (error) { ui.handleError(error); } // NEW
        }, 'Project name', name => !!name.trim()); // NEW
        const control = dialog.container.querySelector('input'), preview = element('p', '', 'trellis-home-muted'); // NEW
        if (control && root.TrellisProjectNaming) { control.maxLength = 240; const update = () => { preview.textContent = 'Filename: ' + root.TrellisProjectNaming.filename(control.value, project.suffix || ''); }; control.addEventListener('input', update); update(); dialog.container.append(preview); } // CHANGE
        ui.showDialog(dialog.container, Math.min(420, (root.innerWidth || 1000) - 40), 180, true, true); // CHANGE: show the converted filename before applying a shared-name change.
        dialog.init(); // NEW
    } // NEW
    /** Keep the shared prefix read-only while editing only this identity's suffix. */ // NEW
    function editSuffix(ui, state, project) { // NEW
        const { panel, close } = projectActionPanel(state, 'Edit my suffix'), field = input('My suffix'); field.control.value = project.suffix || ''; field.control.maxLength = 160; // NEW
        const prefix = element('p', 'Project: ' + project.projectName), preview = element('p', '', 'trellis-home-muted'), error = element('p', '', 'trellis-home-muted'); error.setAttribute('aria-live', 'polite'); // NEW
        const update = () => { preview.textContent = 'Filename: ' + (root.TrellisProjectNaming?.filename(project.projectName, field.control.value) || project.projectName + (field.control.value ? ' - ' + field.control.value : '') + '.drawio'); }; // CHANGE
        field.control.addEventListener('input', update); update(); // NEW
        const save = button('Save suffix', async () => { // NEW
            save.disabled = true; // NEW
            try { await root.trellisGardenLibrary.setSuffix({ diagramId: project.diagramId, suffix: field.control.value }); close(); await refreshProjects(ui, state); } // NEW
            catch (failure) { error.textContent = failure.message; save.disabled = false; } // NEW
        }); // NEW
        panel.append(prefix, field.wrap, preview, error, save, button('Cancel', close)); field.control.focus(); // NEW
    } // NEW
    /** Keep confirmations in the existing dialog so cancelling preserves the list and its focus. */ // NEW
    function projectActionPanel(state, title) { // NEW
        state.actionPanel?.remove(); const previousFocus = document.activeElement; // NEW
        const panel = element('section', null, 'trellis-project-action'); panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', title); // NEW
        const heading = element('h3', title); heading.tabIndex = -1; panel.append(heading); state.projectsStatus.after(panel); state.actionPanel = panel; heading.focus(); // NEW
        const close = () => { panel.remove(); if (state.actionPanel === panel) state.actionPanel = null; if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); }; // NEW
        return { panel, close }; // NEW
    } // NEW
    function lifecycleInput(project) { return { source: project.source, diagramId: project.diagramId, path: project.path, trashId: project.trashId }; } // NEW
    async function showProjectRemoval(ui, state, project) { // NEW
        const identityId = state.session?.identityId, { panel, close } = projectActionPanel(state, 'Project actions: ' + project.name); // NEW
        const status = element('p', 'Checking project membership…', 'trellis-home-muted'); status.setAttribute('aria-live', 'polite'); panel.append(status); // NEW
        try { // NEW
            const eligibility = project.source === 'local' ? { canDelete: true } : project.departing ? { canLeave: true, successors: [] } : await root.trellisGardenLibrary.actions({ diagramId: project.diagramId }); // NEW
            if (!panel.isConnected || identityId !== state.session?.identityId) return; // NEW
            const deleting = eligibility.canDelete, label = deleting ? 'Delete project' : project.departing ? 'Check departure' : 'Leave project'; // NEW
            panel.firstChild.textContent = label + ': ' + project.name; // NEW
            status.textContent = deleting ? project.source === 'local' ? 'Move this local file to Trellis Trash on this device? Neighboring files and assets will stay in place.' : 'Move this project to Trash across your paired devices? You can restore it until you delete it permanently. Pending invitations will be cancelled when a project copy is reachable; restoring will require fresh invitations.' : project.departing ? 'Departure is waiting for a connected member to acknowledge. Keep Trellis running to finish.' : 'Leave this project across your paired devices? Other members keep the project. Your access and managed downloads will be removed after acknowledgement. Rejoining requires a new invitation.'; // NEW
            let successor; // NEW
            if (eligibility.requiresSuccessor || eligibility.requiresCoordinator) { // NEW
                const field = input(eligibility.requiresSuccessor ? 'New administrator' : 'New coordinator'), select = element('select'); select.setAttribute('aria-label', eligibility.requiresSuccessor ? 'New administrator' : 'New coordinator'); // NEW
                const empty = element('option', 'Choose a connected member'); empty.value = ''; select.append(empty); // NEW
                for (const user of eligibility.successors || []) { const option = element('option', user.name); option.value = user.id; select.append(option); } // NEW
                field.control.replaceWith(select); panel.append(field.wrap); successor = select; // NEW
            } // NEW
            const allowed = deleting || eligibility.canLeave; // NEW
            if (!allowed) panel.append(element('p', eligibility.reason || 'Project membership could not be verified. Download the project and try again.', 'trellis-home-muted')); // NEW
            const controls = element('div', null, 'trellis-home-row'), error = element('p', '', 'trellis-home-muted'); error.setAttribute('aria-live', 'polite'); // NEW
            const current = ui.getCurrentFile(), sameFile = current?.fileObject?.path && current.fileObject.path === project.path, dirty = sameFile && current.isModified(); // NEW
            async function perform(save) { // NEW
                if (!panel.isConnected || identityId !== state.session?.identityId) return; // NEW
                if (successor && !successor.value) { error.textContent = 'Choose a currently connected member.'; successor.focus(); return; } // NEW
                controls.querySelectorAll('button').forEach(control => { control.disabled = true; }); // NEW
                try { // NEW
                    if (save && ui.getCurrentFile() === current && current.isModified()) await new Promise((resolve, reject) => current.save(false, resolve, reject)); // NEW
                    if (identityId !== state.session?.identityId) throw new Error('The active identity changed.'); // NEW
                    const payload = { ...lifecycleInput(project), confirm: true, successorUserId: successor?.value }; // NEW
                    const result = deleting ? await root.trellisGardenLibrary.trash(payload) : await root.trellisGardenLibrary.leave(payload); // NEW
                    if (result.complete !== false && sameFile && ui.getCurrentFile() === current) await ui.fileLoaded(null); // NEW
                    close(); if (!state.projectsRoot?.isConnected) showProjects(ui, { focus: 'open' }); else await refreshProjects(ui, state); // CHANGE: closing the current file may dismiss its project dialog.
                    if (result.complete === false) state.projectsStatus.textContent = result.reason; // NEW
                } catch (failure) { error.textContent = failure.message; controls.querySelectorAll('button').forEach(control => { control.disabled = false; }); } // NEW
            } // NEW
            if (allowed) { // NEW
                if (dirty) controls.append(button('Save and ' + (deleting ? 'delete' : 'leave'), () => perform(true)), button('Discard changes and ' + (deleting ? 'delete' : 'leave'), () => perform(false))); // NEW
                else controls.append(button(label, () => perform(false))); // NEW
            } // NEW
            controls.append(button('Cancel', close)); panel.append(error, controls); // NEW
        } catch (error) { status.textContent = error.message; panel.append(button('Cancel', close)); } // NEW
    } // NEW
    function trashRow(ui, state, project) { // NEW
        const row = element('div', null, 'trellis-home-garden'), info = element('div'), controls = element('div', null, 'trellis-project-controls'); // NEW
        info.append(element('strong', project.name), element('span', project.source === 'local' ? 'Local file · Trash on this device' : 'Trash · Your paired devices', 'trellis-home-muted')); // NEW
        if (project.reason) info.append(element('span', project.reason, 'trellis-home-muted')); // NEW
        const restore = button(project.restoring ? 'Retry restore' : 'Restore', async () => { // CHANGE
            async function run(filename) { // NEW
                try { await root.trellisGardenLibrary.restore({ ...lifecycleInput(project), filename }); await refreshProjects(ui, state); } // NEW
                catch (error) { state.projectsStatus.textContent = error.message; } // NEW
            } // NEW
            if (project.source === 'local') { // NEW
                const { panel, close } = projectActionPanel(state, 'Restore ' + project.name), filename = input('Filename'); filename.control.value = (project.restorePath || project.originalPath || project.name + '.drawio').replace(/^.*[\\/]/, ''); // CHANGE
                panel.append(filename.wrap, button('Restore', async () => { const value = filename.control.value; try { await root.trellisGardenLibrary.restore({ ...lifecycleInput(project), filename: value }); close(); await refreshProjects(ui, state); } catch (error) { state.projectsStatus.textContent = error.message; } }), button('Cancel', close)); filename.control.focus(); // NEW
            } else await run(); // NEW
        }); // NEW
        restore.disabled = !!project.purging; // NEW
        restore.setAttribute('data-project-focus', project.trashId + ':restore'); // NEW
        const purge = button(project.purging ? 'Retry permanent deletion…' : 'Delete permanently…', () => { // CHANGE
            const { panel, close } = projectActionPanel(state, 'Delete permanently: ' + project.name); // NEW
            panel.append(element('p', project.source === 'local' ? 'Permanently delete this retained local file? It cannot be restored from Trellis Trash.' : 'Permanently delete retained copies across your paired devices as they reconnect? This cannot be restored from Trellis Trash. Disconnected and exported copies cannot be guaranteed erased.')); // NEW
            panel.append(button('Delete permanently', async () => { try { await root.trellisGardenLibrary.purge({ ...lifecycleInput(project), confirm: true }); close(); await refreshProjects(ui, state); } catch (error) { state.projectsStatus.textContent = error.message; } }), button('Cancel', close)); // NEW
        }); // NEW
        purge.disabled = !!project.restoring || /Membership changed/.test(project.reason || ''); // NEW
        purge.setAttribute('data-project-focus', project.trashId + ':purge'); controls.append(restore, purge); // CHANGE
        if (project.source === 'library' && /Membership changed/.test(project.reason || '')) controls.append(button('Restore and leave…', async () => { // NEW
            try { // NEW
                await root.trellisGardenLibrary.restore(lifecycleInput(project)); await state.setProjectView('active'); // NEW
                const restored = (await root.trellisGardenLibrary.list()).gardens.find(p => p.diagramId === project.diagramId); // NEW
                if (restored) await showProjectRemoval(ui, state, restored); // NEW
            } catch (error) { state.projectsStatus.textContent = error.message; } // NEW
        })); // NEW
        row.append(info, controls); return row; // NEW
    } // NEW
    function projectRow(ui, state, project) { // NEW
        const row = element('div', null, 'trellis-home-garden'), info = element('div'), controls = element('div', null, 'trellis-project-controls'); // CHANGE
        const key = project.diagramId || project.path; // NEW
        info.append(element('strong', project.name), element('span', project.departing ? 'Leaving… Waiting for acknowledgement' : project.source === 'local' ? 'Local file' : project.available ? 'Downloaded' : 'Not downloaded', 'trellis-home-muted')); // CHANGE
        if (!project.available && project.reason) info.append(element('span', project.reason, 'trellis-home-muted')); // NEW
        if (project.shared || project.classification === 'shared') info.append(element('span', (project.userCount == null ? 'Users: Unknown' : project.userCount + ' users') + ' · ' + (project.seeds == null ? 'Seeds: Unknown' : project.seeds + ' seeds') + (Number.isFinite(project.distanceKm) ? ' · ' + Math.round(project.distanceKm) + ' km average' : ''), 'trellis-home-muted')); // NEW
        if (project.metadataStale) info.append(element('span', 'Last-known project details' + (project.summaryUpdatedAt ? ' · ' + new Date(project.summaryUpdatedAt).toLocaleString() : ''), 'trellis-home-muted')); // NEW
        if (project.metadataError) info.append(element('span', project.metadataError, 'trellis-home-muted')); // NEW
        if (project.requiresNamingUpgrade) info.append(element('span', 'Upgrade collaboration in Sharing to enable shared names and personal suffixes.', 'trellis-home-muted')); // NEW
        if (project.filenamePending || project.namingError) info.append(element('span', project.namingError || 'Filename update pending.', 'trellis-home-muted')); // NEW
        if (project.summary?.pendingInvitationCount) info.append(element('span', 'Invitation pending', 'trellis-home-muted')); // NEW
        const locations = element('details'); locations.setAttribute('data-project-details', key + ':locations'); // NEW
        locations.append(element('summary', 'Locations (' + (project.moduleCities || []).length + ' garden modules)'), element('span', (project.moduleCities || []).map(city => city.name).join(', ') || 'No resolved city coordinates', 'trellis-home-muted')); info.append(locations); // NEW
        const open = button(project.conflicts?.length ? 'Review conflict' : project.available ? 'Open' : 'Download & open', async () => { // CHANGE
            const browser = state.projectsRoot, identityId = state.session?.identityId; // NEW
            try { // NEW
                if (project.available) { // CHANGE
                    if (await openPath(ui, project.path, { isActive: () => browser.isConnected && identityId === state.session?.identityId })) { // NEW
                        if (project.starterPending) await initializeProject(ui, false); // NEW
                        if (project.conflicts?.length) await root.Trellis?.sharing?.showSharingDialog?.(); // NEW
                    } // NEW
                } // NEW
                else await downloadAndOpen(ui, project.diagramId, state); // NEW
            } catch (error) { if (state.projectsStatus?.isConnected) state.projectsStatus.textContent = error.message; else ui.handleError(error); } // NEW
        }); // NEW
        open.setAttribute('data-project-focus', key + ':open'); open.disabled = !!project.departing || !project.available && project.source === 'local'; controls.append(open); // CHANGE
        const more = element('details', null, 'trellis-project-menu'); more.setAttribute('data-project-details', key + ':more'); // CHANGE
        const summary = element('summary', '⋯'); summary.setAttribute('aria-label', 'Actions for ' + project.name); summary.setAttribute('data-project-focus', key + ':menu'); more.append(summary); // CHANGE
        const menu = element('div', null, 'trellis-project-menu-items'); more.append(menu); // NEW
        more.addEventListener('toggle', () => { if (more.open && more.isConnected) { for (const other of state.projectsRoot.querySelectorAll('.trellis-project-menu[open]')) if (other !== more) other.open = false; menu.scrollIntoView?.({ block: 'nearest' }); } }); // NEW
        more.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); more.open = false; summary.focus({ preventScroll: true }); } }); // NEW
        menu.addEventListener('click', event => { if (event.target.closest('button')) more.open = false; }); // NEW
        if (project.source !== 'local') { // CHANGE
            if (project.canRename) menu.append(button('Rename', () => renameProject(ui, state, project))); // CHANGE
            if (project.canEditSuffix) menu.append(button('Edit my suffix', () => editSuffix(ui, state, project))); // NEW
            menu.append(button('Duplicate', async () => { try { await root.trellisGardenLibrary.duplicate({ diagramId: project.diagramId }); await refreshProjects(ui, state); } catch (error) { state.projectsStatus.textContent = error.message; } })); // CHANGE
        } // CHANGE
        const remove = button(project.departing ? 'Check departure…' : project.source === 'local' || project.userCount === 1 ? 'Delete project…' : 'Leave project…', () => showProjectRemoval(ui, state, project)); // CHANGE
        remove.setAttribute('data-project-focus', key + ':remove'); menu.append(remove); controls.append(more); // CHANGE
        menu.querySelectorAll('button').forEach(control => { if (project.departing && control !== remove) control.disabled = true; }); // NEW
        row.append(info, controls); return row; // NEW
    } // NEW
    async function renderIdentity(ui, state) {
        const panel = state.panel; if (!panel) return;
        const version = ++state.renderVersion, mode = state.mode; // NEW: guard responses that arrive after another render or form navigation.
        const data = await root.trellisIdentity.list();
        if (!panel.isConnected || panel !== state.panel || version !== state.renderVersion || mode !== state.mode) return; // CHANGE: do not erase fields while a user types or update a detached Home panel.
        state.session = data.session; updateSplashStatuses(state); panel.replaceChildren(); // CHANGE
        const status = element('div', null, 'trellis-home-muted'); status.setAttribute('aria-live', 'polite');
        const row = element('div', null, 'trellis-home-row'); panel.append(row, status);
        if (state.session && state.persistenceWarning) { const notice = element('p', state.persistenceWarning, 'trellis-home-muted'); notice.setAttribute('role', 'status'); panel.append(notice); } // NEW: separate from password-conflict and copy-reminder messages.
        function perform(action) { return async () => { try { await action(); } catch (error) { status.textContent = error.message; } }; }
        function back() { state.mode = 'idle'; state.reminder = null; renderIdentity(ui, state).catch(error => { status.textContent = error.message; }); }
        function reminder() { // CHANGE: render into the current panel after creation or password changes.
            status.append(element('span', 'Keep a record of your password. '), button('Copy login reminder', perform(async () => {
                const session = await root.trellisIdentity.getSession();
                await request({ action: 'clipboardAction', method: 'writeText', data: 'Username: ' + session.username + '\nPassword: ' + state.reminder + '\nDate: ' + new Date().toISOString() }); // CHANGE: copy only the requested login details.
                state.reminder = null; status.textContent = 'Login reminder copied. Paste it into your own secure record.';
            })));
        }
        function form(title, fields, submit, label) {
            state.mode = title; row.replaceChildren(element('strong', title));
            const body = element('form', null, 'trellis-home-form'); panel.append(body);
            for (const field of fields) body.append(field.wrap);
            const run = perform(submit), go = button(label, event => { event.preventDefault(); run(); });
            body.append(go, button('Cancel', back)); body.addEventListener('submit', event => { event.preventDefault(); run(); }); fields[0]?.control.focus();
        }
        /** Use the existing field layout and native checkbox keyboard/label behavior. */ // NEW
        function keepLoggedInField() { // NEW
            const field = input('Keep me logged in on this device', 'checkbox'); field.control.checked = true; // NEW
            field.wrap.prepend(field.control); return field; // NEW
        } // NEW
        if (state.session) {
            row.append(element('strong', 'Logged in as ' + state.session.username), button('Log out', perform(async () => { await root.trellisIdentity.lock(); })), button('Identity settings', () => {
                state.mode = 'settings'; row.replaceChildren(element('strong', 'Identity settings'), button('Back', back));
                panel.append(button('Change password', () => {
                    const current = input('Current password', 'password'), next = input('New password', 'password');
                    form('Change password', [current, next], async () => { const password = next.control.value; const result = await root.trellisIdentity.changePassword({ currentPassword: current.control.value, password, resolveConflict: !!state.session.passwordConflict }); state.persistenceWarning = result?.persistenceWarning || null; current.control.value = ''; next.control.value = ''; state.mode = 'idle'; state.reminder = password; await renderIdentity(ui, state); }, state.session.passwordConflict ? 'Resolve password conflict' : 'Change password'); // CHANGE: retain a persistence failure notice after a local password change.
                }));
                panel.append(button('Approve a device request', perform(async () => { const requestFile = await chooseJson(); if (!requestFile) return; const result = await root.trellisIdentity.approvePairRequest({ request: requestFile }); await saveJson(result.setup, 'trellis-device-setup.json'); status.textContent = 'Send the setup package to the requesting device.'; })));
                panel.append(button('Manage devices', perform(async () => {
                    const devices = await root.trellisIdentity.getDevices();
                    for (const device of devices) {
                        const item = element('div', null, 'trellis-home-row');
                        item.append(element('span', device.name + ' · ' + device.kind), button('Remove device', perform(async () => { if (confirm('Remove this device from future identity synchronization? Downloaded files cannot be erased remotely.')) { await root.trellisIdentity.removeDevice({ deviceId: device.id }); back(); } })));
                        panel.append(item);
                    }
                })));
            }));
            if (state.session.passwordConflict) status.textContent = 'Password changes conflict. Resolve them in Identity settings before pairing or changing the library.';
        } else {
            row.append(button('Log in', () => {
                if (!data.identities.length) { status.textContent = 'Create an identity or connect an existing one first.'; return; }
                const choice = { wrap: element('label', null, 'trellis-home-field'), control: element('select') }; choice.wrap.append(element('span', 'Identity'), choice.control);
                for (const identity of data.identities) { const option = element('option', identity.username + ' · ' + identity.id.slice(0, 8)); option.value = identity.id; option.disabled = !!identity.error || identity.revoked; choice.control.append(option); }
                const password = input('Password', 'password');
                const keep = keepLoggedInField(); // NEW
                form('Log in', [choice, password, keep], async () => { const result = await root.trellisIdentity.unlock({ identityId: choice.control.value, password: password.control.value, keepLoggedIn: keep.control.checked }); state.persistenceWarning = result?.persistenceWarning || null; password.control.value = ''; back(); }, 'Log in'); // CHANGE
            }));
            row.append(button('Create identity', () => {
                const username = input('Username'), password = input('Password', 'password');
                const keep = keepLoggedInField(); // NEW
                form('Create identity', [username, password, keep], async () => { const value = password.control.value; const result = await root.trellisIdentity.create({ username: username.control.value, password: value, keepLoggedIn: keep.control.checked }); state.persistenceWarning = result?.persistenceWarning || null; password.control.value = ''; state.mode = 'idle'; state.reminder = value; await renderIdentity(ui, state); }, 'Create identity'); // CHANGE
            }));
            row.append(button('Connect existing identity', () => {
                state.mode = 'connect'; row.replaceChildren(element('strong', 'Connect existing identity'), button('Back', back));
                panel.append(element('p', 'Export a request, approve it on an existing device, then import the returned setup package with the identity password.'));
                panel.append(button('Export device request', perform(async () => { const result = await root.trellisIdentity.createPairRequest({ deviceName: 'Desktop' }); await saveJson(result.request, 'trellis-device-request.json'); status.textContent = 'Send the request to an existing device for approval.'; })));
                const password = input('Identity password', 'password'); // CHANGE: fields belong directly to the setup-import form.
                const keep = keepLoggedInField(); // NEW
                const connect = element('form', null, 'trellis-home-form'); panel.append(connect); connect.append(password.wrap, keep.wrap); // NEW: Enter uses the same import flow as the button.
                const importApproved = perform(async () => { const setup = await chooseJson(); if (!setup) return; const result = await root.trellisIdentity.importSetup({ setup, password: password.control.value }); const unlocked = await root.trellisIdentity.unlock({ identityId: result.identityId, password: password.control.value, keepLoggedIn: keep.control.checked }); state.persistenceWarning = unlocked?.persistenceWarning || null; password.control.value = ''; back(); }); // CHANGE
                connect.append(button('Import approved setup', event => { event.preventDefault(); importApproved(); })); connect.addEventListener('submit', event => { event.preventDefault(); importApproved(); }); // NEW
            }));
            row.append(element('span', 'Local projects are available below.', 'trellis-home-muted')); // CHANGE
        }
        if (state.libraryIdentityId !== state.session?.identityId) { state.libraryProjects = []; state.libraryIdentityId = state.session?.identityId; } // NEW
        refreshProjects(ui, state); // CHANGE
        if (state.session && state.reminder) reminder(); // NEW: background status refreshes retain the explicit copy action.
    }
    /** Splash retains its actions and displays identity status; forms belong to Garden Projects. */ // NEW
    function attachSplash(splash, ui) { // NEW
        if (!root.trellisIdentity || !splash.isTrellisLicenseWizardComplete?.()) return; // NEW
        const state = install(ui), center = splash.container.querySelector('.trellis-splash-center'); // NEW
        if (!center) return; // NEW
        let status = center.querySelector('.trellis-splash-login-status'); // NEW
        if (!status) { // NEW
            status = element('div', null, 'trellis-splash-login-status'); status.setAttribute('aria-live', 'polite'); // NEW
            const license = center.querySelector('.trellis-license-contact-panel') || center.querySelector('.trellis-saved-license-card'); // NEW
            if (license) license.after(status); else center.append(status); // NEW
            state.splashStatuses.add(status); // NEW
            const version = state.sessionVersion || 0; // CHANGE
            root.trellisIdentity.getSession().then(session => { if (version !== (state.sessionVersion || 0) || !status.isConnected) return; state.session = session; updateSplashStatuses(state); }).catch(() => { status.textContent = 'Login status unavailable'; }); // CHANGE
        } // NEW
        updateSplashStatuses(state); // NEW
        splash.container.classList.add('trellis-splash-project-launcher'); // NEW
        for (const action of splash.container.querySelectorAll('.trellis-splash-actions button')) { // NEW
            const focus = action.textContent.includes('Create New Garden') ? 'create' : action.textContent.includes('Open Existing Garden') ? 'open' : null; // NEW
            if (!focus || action.hasAttribute('data-project-launcher')) continue; // NEW
            action.setAttribute('data-project-launcher', focus); // NEW
            const text = [...action.childNodes].find(node => node.nodeType === 3); // NEW
            if (text) text.textContent = focus === 'create' ? 'Create New Garden Project' : 'Open Existing Garden Project'; // NEW
            action.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); showProjects(ui, { focus }); }, true); // NEW
        } // NEW
    } // NEW
    root.TrellisGardenHome = { attachSplash, install, openPath, importCurrent, saveJson, chooseJson, showProjects, distanceBand }; // CHANGE
})(window);
