/** Desktop identity/library presentation; all storage stays behind narrow bridges. // NEW */
(function(root) {
    'use strict';
    const PROJECT_FOLD_STORAGE_PREFIX = 'trellis.gardenProjects.folds.v1.'; // NEW: device-local preferences, separated by identity and signed-out use.
    function element(tag, text, className) {
        const node = document.createElement(tag);
        if (text != null) node.textContent = text;
        if (className) node.className = className;
        return node;
    }
    function button(text, action, variant = 'neutral', options) { // CHANGE: every library action declares its semantic intent.
        const node = element('button', text, 'geBtn'); node.type = 'button';
        root.Trellis?.ui?.applyButtonStyle?.(node, variant, options); // CHANGE: retain the host button fallback during early startup.
        if (action) node.addEventListener('click', action); return node; // CHANGE: submit buttons use their form's handler.
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
        initializeProjectSnapshots(state); state.projectFoldPreferences = new Map(); // NEW: retain usable preferences even when local storage is unavailable.
        // Dialog snapshots change only through initial reads or explicit actions. // CHANGE
        root.TrellisFieldRuntime?.install(ui); // NEW: install once; commands/plugins are resolved when used.
        const originalSplash = ui.showSplash.bind(ui); // NEW
        ui.showSplash = function() { // CHANGE: entering Home retires the current document only after a confirmed save.
            if (state.homeTransition) return state.homeTransition; // NEW: repeated requests share one transition.
            if (root.urlParams?.noFileMenu === '1') return; // NEW: preserve the host's no-file-menu guard.
            if (!ui.getCurrentFile()) { // NEW
                if (ui.dialog?.container?.querySelector('.trellis-splash-root')) return; // NEW
                return originalSplash.apply(ui, arguments); // NEW
            } // NEW
            const args = arguments; // NEW
            state.homeTransition = returnHome(ui, state, () => originalSplash.apply(ui, args)).finally(() => { // NEW
                state.homeTransition = null; watchSavedFile(); // NEW: detach saved-content monitoring from a retired document.
            }); // NEW
            return state.homeTransition; // NEW
        }; // NEW
        ui.pickFile = () => showProjects(ui, { focus: 'open' }); // CHANGE: ordinary Open always reaches the library, including an empty library.
        const home = ui.actions.addAction('trellisHome', () => ui.showSplash(true)); home.label = 'Trellis Home';
        const projects = ui.actions.addAction('trellisGardenProjects', () => showProjects(ui)); projects.label = 'Garden Projects'; // NEW
        const add = ui.actions.addAction('trellisAddToGardenLibrary', () => importCurrent(ui).catch(error => ui.handleError(error))); add.label = 'Add current project to Garden Projects'; // CHANGE
        if (ui.menus?.get('file')) {
            const menu = ui.menus.get('file'), original = menu.funct;
            menu.funct = function(menuRoot, parent) { original.apply(this, arguments); ui.menus.addMenuItems(menuRoot, ['-', 'trellisHome', 'trellisAddToGardenLibrary'], parent); };
        }
        root.trellisIdentity.onStatus(async value => { // CHANGE: identity invalidation switches snapshots without refreshing cached metadata.
            const changed = JSON.stringify(value.session) !== JSON.stringify(state.session); // NEW
            if (!value.session) state.persistenceWarning = null; // NEW: a new session must not inherit an old persistence notice.
            if (state.session && !value.session && root.Trellis?.users?.getCurrentUser()?.portableIdentityId === state.session.identityId) root.Trellis.users.logout(); // NEW: background revocation ends the linked session while preserving the editor's unsaved document.
            if (changed && !value.session) { state.mode = 'idle'; state.reminder = null; } // CHANGE
            if (projectLoginKey(state.session) !== projectLoginKey(value.session)) { activateProjectSnapshot(state, value.session); // CHANGE
                 state.confirmation?.invalidate(); state.mode = 'idle'; state.showIdentity = false; state.referenceKey = null; drawProjects(ui, state); } // CHANGE
            state.session = value.session; state.sessionVersion = (state.sessionVersion || 0) + 1; updateSplashStatuses(state); // CHANGE
            updateProjectSections(state); // NEW: identity changes reset temporary search folds before asynchronous refreshes.
            if (changed) state.libraryIdentityId = value.session?.identityId; // NEW
            if (changed && state.mode === 'idle' && state.panel?.isConnected) await renderIdentity(ui, state).catch(error => { state.projectsStatus.textContent = error.message; }); // CHANGE
            if (changed && state.projectsRoot?.isConnected) refreshProjects(ui, state, { reopen: true }); // CHANGE
        });
        root.trellisIdentity.onLocked(() => {
            state.confirmation?.invalidate(); // CHANGE: retire the prompt before closing its underlying library.
            const wasProjects = !!state.projectsRoot?.isConnected; // NEW
            activateProjectSnapshot(state, null); state.reminder = null; state.persistenceWarning = null; state.session = null; state.mode = 'idle'; updateSplashStatuses(state); // CHANGE
            if (root.Trellis?.users) root.Trellis.users.logout();
            if (wasProjects) ui.hideDialog(); // NEW
            Promise.resolve(ui.fileLoaded(null)).then(() => wasProjects ? showProjects(ui) : ui.showSplash(true)).catch(error => ui.handleError(error)); // CHANGE
        });
        // Transport status remains independent of display snapshots. // CHANGE
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
                await ui.fileLoaded(null, !!state.confirmation?.busy); release(); return {}; // CHANGE: an active lifecycle prompt keeps its library instead of opening a splash above it.
            } // NEW
            throw new Error('Unsupported project retirement phase.'); // NEW
        }); // NEW
        /** Observe completed saves without changing file save implementations or summarizing drafts. */ // NEW
        function watchSavedFile() { // NEW
            const file = ui.getCurrentFile(); if (file === state.savedFile) return; // NEW
            if (!state.confirmation?.busy) state.confirmation?.invalidate(); // CHANGE: a changed editor invalidates an unsubmitted confirmation.
            state.savedFile = file; // CHANGE: saved-content notifications do not invalidate display snapshots.
            if (file?.fileObject) root.trellisGardenLibrary.list().then(result => { const project = result.gardens.find(project => project.path === file.fileObject.path); if (project?.displayName && ui.getCurrentFile() === file) { file.__trellisDisplayName = project.displayName; file.descriptorChanged?.(); } }).catch(() => {}); // NEW: restore display text when reopening an already-named file.
        } // NEW
        ui.editor?.addListener?.('fileLoaded', watchSavedFile); watchSavedFile(); // NEW
        return state;
    }
    /** Save through the current file's hooks, then use normal lifecycle cleanup without opening a second splash. */ // NEW
    async function returnHome(ui, state, showSplash) { // NEW
        const file = ui.getCurrentFile(), graph = ui.editor?.graph; // NEW
        const busy = () => file.savingFile || file.__trellisCollaborativeSaving || file.__trellisNamingMove || state.namingMove || state.retirement || root.__trellisClosing; // NEW
        try { // NEW
            if (busy()) throw new Error('Wait for saving, renaming, or project retirement to finish, then try Home again.'); // NEW
            if (graph?.isEditing()) graph.stopEditing(); // NEW: commit the active label before determining whether a save is needed.
            await graph?.__trellisReferences?.flushDrafts(); // NEW
            if (ui.getCurrentFile() !== file) return; // NEW: reference persistence may outlive this document.
            if (busy()) throw new Error('Wait for saving, renaming, or project retirement to finish, then try Home again.'); // NEW
            if (file.isModified()) { // NEW: unchanged files, including untouched blanks, need no write or location prompt.
                const saved = await new Promise((resolve, reject) => { // NEW
                    file.save(false, () => resolve(true), // NEW
                        error => reject(error || new Error('The diagram could not be saved. Resolve any save conflict and try Home again.')), // NEW
                        null, null, () => resolve(false)); // NEW
                }); // NEW
                if (!saved) return; // NEW: native save cancellation is quiet and leaves the recovery draft intact.
            } // NEW
            if (ui.getCurrentFile() !== file) return; // NEW: a late save must never close a replacement document.
            if (graph?.isEditing()) graph.stopEditing(); // NEW: edits begun while saving must also be accounted for.
            if (file.isModified() || busy()) throw new Error('The diagram changed or another operation started while returning Home. Try Home again.'); // NEW
            await ui.fileLoaded(null, true); // NEW: close all pages, watchers, and undo history through the existing lifecycle.
            if (!ui.getCurrentFile()) showSplash(); // NEW
        } catch (error) { ui.handleError(error); } // NEW: failed saves preserve the open document and allow another attempt.
    } // NEW
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
        panel.append(element('h3', 'Download garden project'), status, button('Cancel', () => ui.hideDialog(true), 'close')); // CHANGE
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
            if (!canceled) { status.textContent = error.message; panel.append(button('Retry', () => downloadAndOpen(ui, diagramId, state), 'neutral')); } // CHANGE
        } // NEW
    } // NEW
    /** Load identity-local folds and apply search overrides without changing saved preferences. */ // NEW
    function updateProjectSections(state) { // NEW
        const scope = state.session?.identityId ? 'identity:' + state.session.identityId : 'signed-out'; // NEW
        if (!state.projectFoldPreferences.has(scope)) { // NEW
            let saved; // NEW
            try { saved = JSON.parse(root.localStorage.getItem(PROJECT_FOLD_STORAGE_PREFIX + scope)); } catch (_) { /* NEW: corrupt or inaccessible storage defaults to expanded. */ } // NEW
            state.projectFoldPreferences.set(scope, { shared: saved?.shared === true, private: saved?.private === true, communities: typeof saved?.communities === 'boolean' ? saved.communities : saved?.shared === true, details: saved?.details && typeof saved.details === 'object' ? saved.details : {} }); // CHANGE
        } // NEW
        const searching = !!state.search; // NEW
        if (scope !== state.projectFoldScope || searching !== state.projectFoldSearching) { // NEW
            state.projectSearchFolds = searching ? { shared: false, private: false, communities: false, details: {} } : null; // CHANGE
            state.projectFoldScope = scope; state.projectFoldSearching = searching; // NEW
        } // NEW
        const folds = state.projectSearchFolds || state.projectFoldPreferences.get(scope); // NEW
        for (const kind of ['communities', 'shared', 'private']) { // CHANGE
            const rows = state[kind + 'Rows'], toggle = state.projectSectionToggles?.[kind]; // NEW
            if (!rows || !toggle) continue; // NEW
            const collapsed = folds[kind], action = (collapsed ? 'Expand ' : 'Collapse ') + state.projectSectionLabels[kind]; // NEW
            if (collapsed && rows.parentNode.contains(document.activeElement) && document.activeElement !== toggle) toggle.focus({ preventScroll: true }); // CHANGE
            for (const child of rows.parentNode.children) if (child !== toggle.parentNode) child.hidden = collapsed; // CHANGE
            toggle.textContent = collapsed ? '+' : '−'; // CHANGE
            toggle.setAttribute('aria-expanded', String(!collapsed)); toggle.setAttribute('aria-label', action); toggle.title = action; // NEW
        } // NEW
    } // NEW
    /** Search folds last only for that search; ordinary folds are saved for the current identity. */ // NEW
    function toggleProjectSection(state, kind) { // NEW
        updateProjectSections(state); // NEW
        const saved = state.projectFoldPreferences.get(state.projectFoldScope), folds = state.projectSearchFolds || saved; // NEW
        folds[kind] = !folds[kind]; // NEW
        if (!state.projectSearchFolds) { // NEW
            try { root.localStorage.setItem(PROJECT_FOLD_STORAGE_PREFIX + state.projectFoldScope, JSON.stringify(saved)); } catch (_) { /* NEW: in-memory folding still works when persistence fails. */ } // NEW
        } // NEW
        updateProjectSections(state); // NEW
    } // NEW
    /** Persist deliberate folds; search overrides remain temporary. */ // NEW
    function foldedGroup(state, key, title, defaultOpen = false) { // NEW
        const group = element('details', null, 'trellis-project-group'), summary = element('summary', title); // NEW
        group.setAttribute('data-project-details', key); summary.setAttribute('data-project-focus', key); group.append(summary); // NEW
        const folds = state.projectSearchFolds || state.projectFoldPreferences.get(state.projectFoldScope); // NEW
        group.open = typeof folds.details[key] === 'boolean' ? folds.details[key] : !!state.search || defaultOpen; // CHANGE
        summary.addEventListener('click', event => { // NEW
            event.preventDefault(); group.open = !group.open; // NEW
            const current = state.projectSearchFolds || state.projectFoldPreferences.get(state.projectFoldScope); current.details[key] = group.open; // NEW
            if (!state.projectSearchFolds) try { root.localStorage.setItem(PROJECT_FOLD_STORAGE_PREFIX + state.projectFoldScope, JSON.stringify(current)); } catch (_) { /* NEW: retain in-memory choices. */ } // NEW
        }); // NEW
        return group; // NEW
    } // NEW
    /** Host dialogs consume events, so outside dismissal and Escape run in capture. */ // NEW
    function installProjectPopovers(panel) { // NEW
        const selector = 'details[data-project-popover][open]'; // NEW
        function outside(event) { for (const popover of panel.querySelectorAll(selector)) if (!popover.contains(event.target)) popover.open = false; } // NEW
        function escape(event) { // NEW
            if (event.key !== 'Escape' || !panel.contains(document.activeElement)) return; // NEW
            const opened = [...panel.querySelectorAll(selector)].at(-1); // NEW
            if (opened) { event.preventDefault(); event.stopImmediatePropagation(); opened.open = false; opened.querySelector('summary').focus({ preventScroll: true }); } // NEW
        } // NEW
        function toggled(event) { if (event.target.matches?.(selector)) for (const other of panel.querySelectorAll(selector)) if (other !== event.target) other.open = false; } // NEW
        document.addEventListener('pointerdown', outside, true); document.addEventListener('click', outside, true); document.addEventListener('focusin', outside, true); document.addEventListener('keydown', escape, true); panel.addEventListener('toggle', toggled, true); // CHANGE
        return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('click', outside, true); document.removeEventListener('focusin', outside, true); document.removeEventListener('keydown', escape, true); panel.removeEventListener('toggle', toggled, true); }; // CHANGE
    } // NEW
    /** Only portable-identity tokens can establish distinct people across gardens. */ // NEW
    function peopleText(projects, aggregate = false, includeOnline = true) { // NEW
        const keys = new Set(), onlineKeys = new Set(); let membersComplete = true, presenceComplete = true; // NEW
        for (const project of projects) { // NEW
            for (const key of project.people?.memberKeys || []) keys.add(key); for (const key of project.people?.onlineMemberKeys || []) onlineKeys.add(key); // NEW
            membersComplete = membersComplete && project.people?.membershipComplete === true; presenceComplete = presenceComplete && project.people?.presenceComplete === true; // NEW
        } // NEW
        const single = projects.length === 1 ? projects[0] : null, people = single?.people; // CHANGE: one project's verified total needs no cross-project identity mapping.
        const total = single ? people?.userCount ?? single.userCount : membersComplete ? keys.size : null, online = single ? people?.onlineCount : onlineKeys.size; // NEW
        const complete = single ? people?.presenceComplete : presenceComplete && membersComplete; // NEW
        const onlineText = complete ? (online ?? 0) + ' online' : online > 0 ? 'at least ' + online + ' online' : 'online unknown'; // NEW
        const totalText = total != null ? total + (total === 1 ? ' user' : ' users') : keys.size ? 'at least ' + keys.size + (keys.size === 1 ? ' user' : ' users') + ' (total unknown)' : 'users unknown'; // CHANGE
        return includeOnline ? onlineText + ' / ' + totalText : totalText; // CHANGE: discovery never claims current presence. // NEW
    } // NEW
    /** Totals cover all visible gardens; presence explicitly covers accessible gardens only. */ // NEW
    function communityPeopleText(gardens) { // NEW
        const projects = gardens.map(garden => garden.project || garden), accessible = gardens.filter(garden => garden.joined).map(garden => garden.project || garden); // NEW
        return peopleText(projects, true, false) + (accessible.length ? ' · ' + peopleText(accessible, true).split(' / ')[0] + ' in accessible gardens' : ''); // NEW
    } // NEW
    function entityCount(shown, total, noun) { return (shown === total ? shown : shown + ' of ' + total) + ' ' + (shown === total && total === 1 ? { projects: 'project', communities: 'community' }[noun] || noun : noun); } // CHANGE
    function sectionCount(state, kind, shown, total, noun, projects) { state.projectSectionCounts[kind].textContent = entityCount(shown, total, noun) + (projects ? ' · ' + (kind === 'communities' ? communityPeopleText(projects) : peopleText(projects, true)) : ''); } // CHANGE
    function matchesRadius(state, project) { // NEW
        if (!state.referenceCity || state.maxDistanceKm == null) return true; // NEW
        if (!Number.isFinite(project.distanceKm)) { state.unknownDistanceIds.add(project.diagramId || project.path); return false; } // NEW
        return project.distanceKm <= state.maxDistanceKm; // NEW
    } // NEW
    function compareGardens(state, a, b) { return (state.referenceCity ? (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) : 0) || a.name.localeCompare(b.name); } // NEW
    /** One project dialog owns identity controls and all lists; refreshes preserve forms. */ // CHANGE
    /** Named guide requests reveal existing controls without rebuilding forms or changing saved folds. */ // NEW
    function applyProjectHighlight(state, options) {
        if (options?.highlight) { // NEW
            const previous = state.quickstartHighlight;
            if (previous?.diagramId === options.diagramId && previous?.target === options.highlight) { previous.path = options.communityPath || 'choose'; } // NEW: keep the pending read's request identity when the user changes paths.
            else state.quickstartHighlight = { target: options.highlight, diagramId: options.diagramId, path: options.communityPath || 'choose', identityId: state.session?.identityId || null };
        } // NEW
        const request = state.quickstartHighlight, panel = state.projectsRoot;
        if (!request || !panel?.isConnected) return;
        if (state.session && request.diagramId && !request.readStarted) { // NEW: a newly created project's cached row may predate its saved ownership metadata.
            request.readStarted = true; request.loading = true;
            refreshProjects(state.quickstartUi, state, { diagramId: request.diagramId }).finally(() => { if (state.quickstartHighlight === request && panel.isConnected) { request.loading = false; applyProjectHighlight(state); } });
        }
        for (const select of panel.querySelectorAll('select[data-quickstart-project]')) { // NEW
            const project = state.libraryProjects.find(row => row.diagramId === select.dataset.quickstartProject && row.available && row.canRename);
            const placeholder = select.querySelector('[data-quickstart-pending]');
            if (placeholder && project) { placeholder.disabled = false; placeholder.textContent = project.name; placeholder.removeAttribute('data-quickstart-pending'); }
            const submit = select.closest('form')?.querySelector('button[type="submit"]');
            if (submit && placeholder?.disabled) { submit.disabled = true; submit.dataset.quickstartDisabled = 'true'; if (!request.loading) state.projectsStatus.textContent = 'This project is not available for community sharing yet. Close Garden Projects, check your connection and administrator access, and retry from the guide. You can also skip this optional step.'; } // NEW
            else if (submit?.dataset.quickstartDisabled) { submit.disabled = false; delete submit.dataset.quickstartDisabled; }
        }
        panel.dataset.quickstartSurface = 'projects'; panel.dataset.quickstartIntent = request.target; // NEW
        for (const node of panel.querySelectorAll('[data-trellis-quickstart="community-sharing"]')) node.removeAttribute('data-trellis-quickstart'); // NEW
        let node;
        if (request.target === 'community-sharing') {
            const rows = state.communitiesRows;
            if (!rows) { state.projectsStatus.textContent = 'Community sharing is unavailable in this build. Close Garden Projects and skip community sharing for now.'; return; }
            rows.hidden = false; rows.style.display = ''; // NEW: temporary reveal; saved folds remain untouched.
            const create = state.creationButtons.find(control => control.dataset.quickstartProjectKind === 'communities');
            if (create) create.hidden = false;
            node = request.loading ? state.communityQuickstartTitle : request.path === 'create' ? create : request.path === 'existing' ? [...rows.querySelectorAll('[data-quickstart-community-add]')].find(control => !control.closest('details:not([open])')) || rows.querySelector('details > summary') : state.communityQuickstartTitle;
            if (!node) { node = create; state.projectsStatus.textContent = state.sectionLoads?.communities?.loading ? 'Communities are loading. Wait for this section, or use its Reload control if loading fails.' : state.search || state.maxDistanceKm != null ? 'Filters may hide the community. Clear the search or distance filter to reveal it, or create a community.' : 'No existing community is available here. Create a community with this project, or skip community sharing for now.'; } // NEW
            if (!state.session) state.projectsStatus.textContent = 'Log in using the account control above to share this project with a community.';
        } else if (request.target === 'create-project') node = state.creationButtons.find(control => control.dataset.quickstartProjectKind === 'private');
        if (node) { node.setAttribute('data-trellis-quickstart', request.target); node.scrollIntoView?.({ block: 'nearest' }); }
    }

    function showProjects(ui, options = {}) { // NEW
        const state = install(ui); if (!state) return; state.quickstartUi = ui; // NEW
        if (state.projectsRoot?.isConnected) { applyProjectHighlight(state, options); return; } // NEW: retain focused fields and private drafts. // NEW
        const splashVisible = !!document.querySelector('.trellis-splash-root'), fromSplash = splashVisible || !ui.getCurrentFile(); // CHANGE
        if (splashVisible) ui.hideDialog(); // CHANGE
        state.focus = options.focus || 'open'; state.mode = 'idle'; state.opening = true; // NEW
        const panel = element('section', null, 'trellis-projects-root'); panel.setAttribute('aria-label', 'Garden Projects'); state.view = 'active'; // CHANGE
        const header = element('header', null, 'trellis-projects-header'), top = element('div', null, 'trellis-projects-top'), heading = element('h2', 'Garden Projects'), account = element('div', null, 'trellis-projects-account'), body = element('div', null, 'trellis-projects-body'); // CHANGE
        top.append(heading, account); header.append(top); panel.append(header, body); state.projectsBody = body; state.accountHost = account; // CHANGE
        const identity = element('section', null, 'trellis-home-panel'); identity.setAttribute('aria-label', 'Identity'); identity.hidden = true; identity.addEventListener('click', () => { identity.hidden = false; }, true); // CHANGE
        const reference = element('div', null, 'trellis-projects-reference'); // NEW
        const search = input('Search garden projects'); search.control.value = state.search; // NEW
        const status = element('div', null, 'trellis-home-muted'); status.setAttribute('aria-live', 'polite'); // NEW
        const distanceNotice = element('p', null, 'trellis-home-muted'); distanceNotice.setAttribute('aria-live', 'polite'); // CHANGE
        body.append(identity, reference, search.wrap, status, distanceNotice); state.distanceNotice = distanceNotice; // CHANGE
        const navigation = element('div', null, 'trellis-home-row'), activeTab = button('Projects', () => switchProjectView('active'), 'open'), trashTab = button('Trash', () => switchProjectView('trash'), 'open'); // CHANGE
        function switchProjectView(view) { state.view = view; updateNavigation(); state.actionPanel?.remove(); return drawProjects(ui, state); } // CHANGE
        function updateNavigation() { for (const [control, view] of [[activeTab, 'active'], [trashTab, 'trash']]) { const active = state.view === view; control.setAttribute('aria-pressed', String(active)); root.Trellis?.ui?.applyButtonStyle?.(control, 'open', { active }); } } // CHANGE
        state.setProjectView = switchProjectView; // NEW
        activeTab.setAttribute('aria-pressed', 'true'); trashTab.setAttribute('aria-pressed', 'false'); navigation.append(activeTab, trashTab); header.append(navigation); state.trashTab = trashTab; state.searchControl = search.control; // CHANGE
        updateNavigation(); // CHANGE
        state.projectsRoot = panel; state.panel = identity; state.referenceHost = reference; state.projectsStatus = status; // NEW
        state.referenceKey = null; // NEW
        state.libraryProjects ||= []; state.localProjects ||= []; state.creationButtons = []; state.renderedRows = {}; state.projectRowNodes = new Map(); state.sectionLoads ||= {}; state.projectLoadHeaders = {}; // CHANGE
        state.projectSectionToggles = {}; state.projectSectionLabels = {}; state.projectSectionCounts = {}; // CHANGE
        for (const kind of root.trellisGardenCommunities ? ['communities', 'shared', 'private'] : ['shared', 'private']) { // CHANGE
            const label = kind === 'communities' ? 'Garden communities' : kind === 'shared' ? 'Shared garden projects' : 'Private garden projects'; // CHANGE
            const section = element('section', null, 'trellis-projects-section'), title = element('h3', null, 'trellis-projects-heading'); // CHANGE
            const toggle = button('−', () => toggleProjectSection(state, kind)); toggle.classList.add('trellis-projects-toggle'); // NEW
            toggle.setAttribute('aria-controls', 'trellis-projects-' + kind + '-rows'); // NEW
            const counts = element('span', '', 'trellis-projects-count'); title.append(element('span', label, 'trellis-projects-title'), counts, toggle); state.projectSectionCounts[kind] = counts; installLoadHeader(ui, state, kind, title); // CHANGE
            state.projectSectionToggles[kind] = toggle; state.projectSectionLabels[kind] = label; // NEW
            title.tabIndex = -1; // NEW
            const create = button(kind === 'communities' ? 'Create Garden Community' : kind === 'shared' ? 'Create New Shared Garden Project' : 'Create New Private Garden Project', () => kind === 'communities' ? showCommunityCreation(ui, state) : showCreationForm(ui, state, section, kind), 'add'); // CHANGE
            create.dataset.quickstartProjectKind = kind; if (kind === 'communities') state.communityQuickstartTitle = title; // NEW
            create.disabled = true; state.creationButtons.push(create); // NEW
            const rows = element('div', null, 'trellis-projects-rows'); section.append(title, create, rows); body.append(section); // CHANGE
            rows.id = 'trellis-projects-' + kind + '-rows'; // NEW
            state[kind + 'Rows'] = rows; // NEW
        } // NEW
        updateProjectSections(state); // NEW: apply saved folds before the dialog becomes visible.
        if (root.trellisGardenCommunities) { const requests = element('section', null, 'trellis-projects-section'); const title = element('h3', 'Access requests'); installLoadHeader(ui, state, 'requests', title); requests.append(title); state.communityRequestRows = element('div'); requests.append(state.communityRequestRows); body.append(requests); } // CHANGE
        const trashSection = element('section', null, 'trellis-projects-section'); trashSection.hidden = true; trashSection.append(element('h3', 'Trash'), element('p', 'Projects stay here until you delete them permanently. Paired devices apply changes when they reconnect.', 'trellis-home-muted')); // NEW
        installLoadHeader(ui, state, 'trash', trashSection.querySelector('h3')); state.trashRows = element('div'); trashSection.append(state.trashRows); body.append(trashSection); state.trashSection = trashSection; // CHANGE
        const folder = element('div', null, 'trellis-home-muted'); state.folderLabel = folder; // NEW
        const footer = element('div', null, 'trellis-home-row'); // NEW
        footer.append(button('Change folder…', async () => { try { const result = await root.trellisGardenLibrary.selectLocalFolder(); if (result.ok) await refreshProjects(ui, state, { only: ['local'] }); } catch (error) { status.textContent = error.message; } }, 'neutral'), button('Browse files…', () => browseLocalFiles(ui, state), 'open'), button('Close', () => ui.hideDialog(true), 'close')); // CHANGE
        panel.dataset.quickstartSurface = 'projects'; // NEW
        body.append(folder, footer); const removePopoverListeners = installProjectPopovers(panel); // CHANGE
        ui.showDialog(panel, Math.max(240, Math.min(760, (root.innerWidth || 1000) - 40)), Math.max(180, Math.min(710, (root.innerHeight || 900) - 70)), true, true, cancel => { // NEW
            state.confirmation?.invalidate(); // CHANGE: late membership callbacks cannot outlive the library.
            state.quickstartHighlight = null; // NEW: highlight intent cannot leak to a later dialog.
            removePopoverListeners(); state.opening = false; state.projectsVersion++; // CHANGE: pending reads own cache state, never detached UI.
            if (state.panel === identity) state.panel = null; // NEW
            if (cancel && fromSplash) root.setTimeout(() => { if (!ui.getCurrentFile()) ui.showSplash(true); }, 0); // CHANGE: library cancellation must not close a document opened before the deferred return.
        }, true); // NEW
        applyProjectHighlight(state, options); // NEW
        ui.dialog?.container?.classList.add('trellis-projects-dialog'); // NEW
        search.control.addEventListener('input', () => { state.search = search.control.value; drawProjects(ui, state); }); // NEW
        drawProjects(ui, state); updateLoadHeaders(state); // NEW: cached rows appear before any asynchronous read.
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
        const submit = button('Create project', null, 'add'); submit.type = 'submit'; // CHANGE: retain native form submission and the shared add style.
        form.append(name.wrap, submit, button('Cancel', () => form.remove(), 'close'), status); section.insertBefore(form, section.children[2]); state.creationForm = form; // CHANGE
        let created = null; // NEW
        form.addEventListener('submit', async event => { // NEW
            event.preventDefault(); if (state.creating || !name.control.value.trim()) return; // NEW
            state.creating = true; submit.disabled = true; // NEW
            try { // NEW
                const previousFile = ui.getCurrentFile(); // NEW
                if (!await mayReplace(ui)) return; // NEW
                if (!form.isConnected) return; // NEW
                if (!created) { const cache = state.projectSnapshot, login = projectLoginKey(state.session); created = await root.trellisGardenLibrary.create({ name: name.control.value }); if (cache === state.projectSnapshot && login === projectLoginKey(state.session) && created.entry) { cache.revision = (cache.revision || 0) + 1; cache.rowVersions ||= new Map(); cache.rowVersions.set(created.entry.diagramId, cache.revision); cache.libraryProjects = [...cache.libraryProjects.filter(project => project.diagramId !== created.entry.diagramId), { ...created.entry, path: created.path, source: 'library', available: true, classification: kind }]; } } // CHANGE: a completed create remains immediately visible even if its form closed or an older read finishes later.
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
        }, 'open'), button('Garden Projects', () => { ui.hideDialog(); showProjects(ui); }, 'open'), button('Close', () => ui.hideDialog(), 'close')); // CHANGE
        ui.showDialog(panel, 500, 240, true, true); // NEW
    } // NEW
    /** Background refreshes never rebuild a focused filter or an open city picker. */ // CHANGE
    async function renderReferenceCity(ui, state) { // CHANGE
        const host = state.referenceHost, identityId = state.session?.identityId; // CHANGE
        if (!host?.isConnected) return; // CHANGE
        if (state.referenceOwner === identityId && (host.contains(document.activeElement) || state.referenceSaving || host.querySelector('[data-project-popover][open]'))) return; // NEW
        state.referenceOwner = identityId; // NEW: a prior identity's focused controls cannot delay replacement.
        const version = ++state.referenceVersion; // CHANGE
        if (!identityId) { state.referenceCity = null; state.referenceKey = null; host.replaceChildren(element('span', 'Log in to choose your city.', 'trellis-home-muted')); return; } // CHANGE
        try { // CHANGE
            const cache = state.projectSnapshot, login = projectLoginKey(state.session); cache.referenceTask ||= cache.referenceData ? Promise.resolve(cache.referenceData) : Promise.all([root.trellisGardenLibrary.cities(), root.trellisGardenLibrary.getReferenceCity()]); const [catalog, reference] = await cache.referenceTask; if (login !== projectLoginKey(state.session)) return; cache.referenceData = [catalog, reference]; // CHANGE
            if (!host.isConnected || version !== state.referenceVersion || identityId !== state.session?.identityId) return; // CHANGE
            const key = identityId + JSON.stringify([catalog.cities, reference.city]); // CHANGE
            if (key === state.referenceKey) return; state.referenceKey = key; state.referenceCity = reference.city; // CHANGE
            if (state.radiusIdentity !== identityId) { // CHANGE
                let saved; try { saved = root.localStorage.getItem('trellis.gardenProjects.radius.v1.' + identityId); } catch (_) { /* Storage is optional. */ } // CHANGE
                const value = saved == null || !saved.trim() ? null : Number(saved); // CHANGE
                state.maxDistanceKm = value != null && Number.isFinite(value) && value >= 0 ? value : null; state.radiusIdentity = identityId; // CHANGE
            } // CHANGE
            const field = element('div', null, 'trellis-home-field'), picker = element('details', null, 'trellis-city-picker'), summary = element('summary'); // CHANGE
            picker.setAttribute('data-project-popover', 'city'); summary.setAttribute('aria-label', 'Your city'); root.Trellis?.ui?.applyButtonStyle?.(summary, 'neutral'); // CHANGE
            const cityLabel = city => city ? [city.name, city.region, city.country].filter(Boolean).join(', ') : 'Choose your city'; summary.textContent = cityLabel(reference.city); // CHANGE
            const popup = element('div', null, 'trellis-city-popup'), search = input('Search cities'), tree = element('div', null, 'trellis-city-tree'); // CHANGE
            popup.setAttribute('role', 'group'); popup.setAttribute('aria-label', 'Choose your city'); popup.append(search.wrap, tree); picker.append(summary, popup); field.append(element('span', 'Your city'), picker); // CHANGE
            const radius = input('Max distance (km)', 'number'), error = element('span', '', 'trellis-home-muted'); // CHANGE
            radius.control.min = '0'; radius.control.step = 'any'; radius.control.placeholder = 'Unlimited'; radius.control.value = state.maxDistanceKm ?? ''; radius.control.disabled = !reference.city; error.setAttribute('aria-live', 'polite'); host.replaceChildren(field, radius.wrap, error); // CHANGE
            const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); // CHANGE
            async function choose(cityId) { // CHANGE
                if (state.referenceSaving || identityId !== state.session?.identityId) return; // NEW
                state.referenceSaving = true; popup.querySelectorAll('button').forEach(control => { control.disabled = true; }); // CHANGE
                try { // CHANGE
                    const result = await root.trellisGardenLibrary.setReferenceCity({ cityId }); // CHANGE
                    if (!host.isConnected || identityId !== state.session?.identityId) return; // CHANGE
                    state.referenceCity = result.city; state.referenceData = [catalog, { city: result.city }]; state.projectSnapshot.referenceTask = null; state.referenceKey = null; picker.open = false; summary.textContent = cityLabel(result.city); radius.control.disabled = !result.city; summary.focus({ preventScroll: true }); await refreshProjects(ui, state, { only: ['library', 'accessible'] }); // CHANGE
                } catch (failure) { if (identityId === state.session?.identityId) error.textContent = failure.message; } // CHANGE
                finally { state.referenceSaving = false; popup.querySelectorAll('button').forEach(control => { control.disabled = false; }); } // CHANGE
            } // CHANGE
            const cities = [...catalog.cities]; if (reference.city && !cities.some(city => city.cityId === reference.city.cityId)) cities.push(reference.city); // CHANGE
            function drawCities() { // CHANGE
                const opened = new Set([...tree.querySelectorAll('details[open]')].map(node => node.dataset.cityGroup)), query = normalize(search.control.value).trim(), countries = new Map(); tree.replaceChildren(); // CHANGE
                for (const city of cities.filter(city => normalize([city.name, city.region, city.country].join(' ')).includes(query)).sort((a, b) => [a.country, a.region, a.name].join().localeCompare([b.country, b.region, b.name].join()))) { // CHANGE
                    const country = city.country || 'Unknown country', region = city.region || 'Other regions'; if (!countries.has(country)) countries.set(country, new Map()); const regions = countries.get(country); if (!regions.has(region)) regions.set(region, []); regions.get(region).push(city); // CHANGE
                } // CHANGE
                function lazyGroup(label, key, open, populate) { // CHANGE
                    const group = element('details'); group.dataset.cityGroup = key; group.open = open; group.append(element('summary', label)); let built = false; // CHANGE
                    function build() { if (group.open && !built) { built = true; populate(group); } } // CHANGE
                    group.addEventListener('toggle', build); build(); return group; // CHANGE
                } // CHANGE
                for (const [country, regions] of countries) { // CHANGE
                    const countryOpen = !!query || opened.has(country) || reference.city?.country === country; // CHANGE
                    tree.append(lazyGroup(country, country, countryOpen, group => { // CHANGE
                        for (const [region, matches] of regions) { // CHANGE
                            const groupKey = JSON.stringify([country, region]), regionOpen = !!query || opened.has(groupKey) || reference.city?.country === country && reference.city?.region === region; // CHANGE
                            group.append(lazyGroup(region, groupKey, regionOpen, children => { // CHANGE
                                for (const city of matches) { const control = button(city.name, () => choose(city.cityId)); control.setAttribute('aria-label', cityLabel(city)); control.setAttribute('aria-pressed', String(city.cityId === state.referenceCity?.cityId)); children.append(control); } // CHANGE
                            })); // CHANGE
                        } // CHANGE
                    })); // CHANGE
                } // CHANGE
                if (!countries.size) tree.append(element('p', cities.length ? 'No matching cities.' : 'No city coordinates are available in the city catalog.', 'trellis-home-muted')); // CHANGE
            } // CHANGE
            popup.append(button('Clear city', () => choose(null), 'neutral')); search.control.addEventListener('input', drawCities); picker.addEventListener('toggle', () => { if (picker.open) search.control.focus({ preventScroll: true }); }); // CHANGE
            popup.addEventListener('keydown', event => { // CHANGE
                if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return; // CHANGE
                const controls = [...tree.querySelectorAll('button')].filter(control => !control.closest('details:not([open])')); if (!controls.length) return; // CHANGE
                event.preventDefault(); const index = controls.indexOf(document.activeElement); controls[(index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length].focus(); // CHANGE
            }); // CHANGE
            radius.control.addEventListener('input', () => { // CHANGE
                if (identityId !== state.session?.identityId) return; // NEW
                const text = radius.control.value.trim(), value = text ? Number(text) : null; // CHANGE
                if (radius.control.validity.badInput || value != null && (!Number.isFinite(value) || value < 0)) { error.textContent = 'Enter a finite distance of zero or more kilometers.'; radius.control.setAttribute('aria-invalid', 'true'); return; } // CHANGE
                error.textContent = ''; radius.control.removeAttribute('aria-invalid'); state.maxDistanceKm = value; // CHANGE
                try { root.localStorage.setItem('trellis.gardenProjects.radius.v1.' + identityId, value == null ? '' : String(value)); } catch (_) { /* Filtering still works in memory. */ } drawProjects(ui, state); // CHANGE
            }); // CHANGE
            drawCities(); drawProjects(ui, state); // CHANGE
        } catch (error) { if (host.isConnected && version === state.referenceVersion) host.replaceChildren(element('span', 'Your city unavailable: ' + error.message, 'trellis-home-muted')); } // CHANGE
    } // CHANGE
    /** Public snapshots belong to this renderer window, keyed by portable identity, never login credentials. */ // CHANGE
    function projectLoginKey(session) { return session ? session.identityId + ':' + session.generation : ''; } // CHANGE
    function projectPathKey(filename) { const normalized = String(filename || '').replace(/\\/g, '/'); return /^[a-z]:/i.test(normalized) || /Win/i.test(root.navigator?.platform || '') ? normalized.toLowerCase() : normalized; } // CHANGE
    const snapshotDefaults = () => ({ libraryProjects: [], localProjects: [], communities: [], communityRequests: [], trashedProjects: [], sectionLoads: {}, referenceCity: null, referenceData: null, localFolder: '', communityUnknownDistanceIds: [] }); // CHANGE
    function initializeProjectSnapshots(state) { // CHANGE
        state.projectSnapshots = new Map(); state.projectSnapshotKey = 'signed-out'; state.projectSnapshot = { ...snapshotDefaults(), reads: new Map() }; state.projectSnapshots.set('signed-out', state.projectSnapshot); // CHANGE
        root.addEventListener('unload', () => { state.projectSnapshots.clear(); state.projectRowNodes?.clear(); state.projectSnapshot = snapshotDefaults(); }); // CHANGE: no snapshot outlives its renderer window.
        for (const key of Object.keys(snapshotDefaults())) Object.defineProperty(state, key, { get: () => state.projectSnapshot[key], set: value => { state.projectSnapshot[key] = value; } }); // CHANGE: presentation aliases contain no DOM or form state.
    } // CHANGE
    function activateProjectSnapshot(state, session) { // CHANGE
        if (state.projectSnapshotKey === (session?.identityId || 'signed-out') && projectLoginKey(state.session) === projectLoginKey(session)) return; // CHANGE: duplicate lock/status notifications reuse the same pending entry.
        if (state.quickstartHighlight?.identityId && state.quickstartHighlight.identityId !== session?.identityId) state.quickstartHighlight = null; // NEW
        else if (state.quickstartHighlight && session?.identityId) state.quickstartHighlight.identityId = session.identityId; // NEW: initial asynchronous identity restoration retains the caller's request.
        state.editPrompt?.(); state.editPrompt = null; state.creationForm?.remove(); state.actionPanel?.remove(); state.communityDraft = null; state.referenceVersion++; // CHANGE: identity changes retire drafts and pending reference UI work.
        for (const load of Object.values(state.projectSnapshot.sectionLoads)) if (load.loading) { load.loading = false; load.attempted = load.updatedAt != null; load.task = null; } state.projectSnapshot.edits?.clear(); // CHANGE: obsolete generations may not publish; successful snapshots remain reusable.
        const key = session?.identityId || 'signed-out'; // CHANGE
        if (!state.projectSnapshots.has(key)) state.projectSnapshots.set(key, { ...snapshotDefaults(), reads: new Map() }); // CHANGE
        state.projectSnapshotKey = key; state.projectSnapshot = state.projectSnapshots.get(key); state.projectSnapshot.reads.clear(); if (!state.referenceData) state.projectSnapshot.referenceTask = null; state.renderedRows = {}; state.projectRowNodes = new Map(); state.referenceKey = null; state.projectsVersion++; // CHANGE
    } // CHANGE
    /** Header controls and static timestamps are independent of folds and row rendering. */ // CHANGE
    function installLoadHeader(ui, state, kind, title) { // CHANGE
        const status = element('span', '', 'trellis-projects-loading'), updated = element('time', '', 'trellis-projects-updated'), reload = button('Reload', () => refreshProjects(ui, state, { section: kind }), 'neutral'); // CHANGE
        status.setAttribute('aria-live', 'polite'); status.setAttribute('data-project-loading', kind); reload.setAttribute('aria-label', 'Reload ' + ({ communities: 'garden communities', shared: 'shared projects', private: 'private projects', requests: 'access requests', trash: 'Trash' })[kind]); // CHANGE
        for (const node of [status, updated, reload]) title.insertBefore(node, title.querySelector('.trellis-projects-toggle')); state.projectLoadHeaders[kind] = { title, status, updated, reload }; // CHANGE
    } // CHANGE
    function updateLoadHeaders(state) { // CHANGE
        for (const [kind, header] of Object.entries(state.projectLoadHeaders || {})) { // CHANGE
            const load = state.sectionLoads[kind] || {}, busy = !!load.loading || [...(state.projectSnapshot.edits?.values() || [])].some(edit => edit.section === kind); // CHANGE
            header.title.setAttribute('aria-busy', String(busy)); header.reload.disabled = busy; header.status.textContent = busy ? 'Loading…' : load.error ? 'Reload failed: ' + load.error : ''; header.status.classList.toggle('is-loading', busy); // CHANGE
            const date = load.updatedAt == null ? null : new Date(load.updatedAt), fullTime = date ? date.toLocaleString() : ''; header.updated.textContent = date ? 'Updated at ' + date.toLocaleTimeString() : ''; header.updated.setAttribute('aria-label', date ? 'Updated at ' + fullTime : 'Not loaded'); header.updated.setAttribute('aria-description', fullTime); header.updated.title = fullTime; if (date) header.updated.dateTime = date.toISOString(); else header.updated.removeAttribute('datetime'); // CHANGE
        } // CHANGE
        if (state.folderLabel) state.folderLabel.textContent = 'Local projects folder: ' + state.localFolder; // CHANGE
        if (state.projectsStatus) state.projectsStatus.textContent = state.communityNotice || ''; // CHANGE: errors stay in their own section.
    } // CHANGE
    /** Merge selected categories and transfers; unrelated rows keep their displayed snapshot. */ // CHANGE
    function publishProjectRows(cache, gardens, section, diagramId, revision = cache.revision || 0) { // CHANGE
        const assigned = new Set(cache.communities.flatMap(community => community.gardens.map(garden => garden.diagramId))); // CHANGE
        const category = garden => assigned.has(garden.diagramId) ? 'communities' : garden.classification === 'shared' || garden.shared ? 'shared' : 'private'; // CHANGE
        const old = new Map(cache.libraryProjects.map(garden => [garden.diagramId || projectPathKey(garden.path), garden])), fresh = new Map(gardens.map(garden => [garden.diagramId || projectPathKey(garden.path), garden])), published = new Set(); // CHANGE
        for (const [id, garden] of old) { if ((cache.rowVersions?.get(id) || 0) > revision) continue; const next = fresh.get(id); if (diagramId ? garden.diagramId === diagramId : category(garden) === section || next && category(next) !== category(garden)) old.delete(id); } // CHANGE
        for (const [id, garden] of fresh) { if ((cache.rowVersions?.get(id) || 0) > revision) continue; const previous = cache.libraryProjects.find(row => (row.diagramId || projectPathKey(row.path)) === id); if (diagramId ? garden.diagramId === diagramId : category(garden) === section || !previous && category(garden) === 'communities' || previous && category(previous) !== category(garden)) { old.set(id, garden); published.add(garden.diagramId); } } // CHANGE
        cache.libraryProjects = [...old.values()]; cache.trashedProjects = cache.trashedProjects.filter(garden => !garden.diagramId || !published.has(garden.diagramId)); // CHANGE: an authoritative active row transfers out of cached Trash.
    } // CHANGE
    /** A retained dialog gets one initial focus, including when reopening from fresh cached rows. */ // NEW
    function focusProjectRows(state) { // NEW
        const panel = state.projectsRoot; if (panel.__focused || state.confirmation) return; // CHANGE
        const visible = [state.communitiesRows, state.sharedRows, state.privateRows].filter(Boolean).flatMap(rows => [...rows.querySelectorAll('button:not(:disabled)')]).find(control => !control.closest('[hidden]') && !control.closest('details:not([open])')); // NEW
        if (!visible && state.focus !== 'create' && Object.values(state.sectionLoads).some(load => load.loading)) return; panel.__focused = true; // CHANGE
        ((state.focus === 'create' && state.session ? state.creationButtons.find(control => !control.disabled && !control.closest('[hidden]')) : visible) || state.projectSectionToggles.communities || state.projectSectionToggles.shared)?.focus({ preventScroll: true }); // CHANGE
    } // NEW
    /** Initial loads are shared by reopened dialogs. Only an explicit action starts subsequent reads. */ // CHANGE
    async function refreshProjects(ui, state, options = {}) { // CHANGE
        if (!state.projectsRoot?.isConnected) return; // CHANGE
        const cache = state.projectSnapshot, login = projectLoginKey(state.session), identityId = state.session?.identityId; // CHANGE
        const valid = () => cache === state.projectSnapshot && login === projectLoginKey(state.session); // CHANGE
        const render = () => { if (valid() && state.projectsRoot?.isConnected) { drawProjects(ui, state); updateLoadHeaders(state); focusProjectRows(state); } }; // CHANGE
        if (options.only?.includes('local')) cache.reads.delete('local'); if (options.only?.includes('trash')) cache.reads.delete('trash'); // CHANGE: post-mutation reads cannot reuse observations from before that mutation.
        if (state.projectsRoot?.isConnected) { state.creationButtons.forEach(control => { control.disabled = !state.session; }); if (!options.reopen && (['shared', 'communities'].includes(options.section) || options.only?.includes('library')) && !cache.referenceData) cache.referenceTask = null; if (!state.referenceKey) renderReferenceCity(ui, state); } // CHANGE: a failed city read retries only with a relevant explicit reload.
        function read(key, action) { // CHANGE: coalesce backend work without linking section publication.
            if (!cache.reads.has(key)) { const started = root.performance.now(), task = Promise.resolve().then(action).finally(() => { root.TrellisGardenHomeTiming?.({ phase: 'read:' + key, milliseconds: root.performance.now() - started }); if (cache.reads.get(key) === task) cache.reads.delete(key); }); cache.reads.set(key, task); } return cache.reads.get(key); // CHANGE
        } // CHANGE
        const library = () => read('library:' + (options.diagramId || ''), () => identityId ? root.trellisGardenLibrary.list(options.diagramId ? { diagramId: options.diagramId } : undefined) : { gardens: [] }); // CHANGE
        const trash = () => read('trash', () => root.trellisGardenLibrary.listTrash?.() || { gardens: [] }); // CHANGE
        async function trashTransfers() { // CHANGE: distinguish restored managed gardens from purged records with targeted reads.
            const result = await trash(); if (!valid()) return result; const key = garden => garden.trashId || garden.diagramId || projectPathKey(garden.originalPath || garden.path), retained = new Set(result.gardens.map(key)), removed = cache.trashedProjects.filter(garden => !retained.has(key(garden))); // CHANGE
            const managed = removed.filter(garden => garden.source !== 'local' && garden.diagramId), local = removed.filter(garden => garden.source === 'local'); // CHANGE
            const restored = await Promise.all(managed.map(garden => read('restored:' + garden.diagramId, () => root.trellisGardenLibrary.list({ diagramId: garden.diagramId })))); const standalone = local.length ? await read('local', () => root.trellisGardenLibrary.listLocal()) : null; // CHANGE: the Trash read has completed recovery before this standalone scan.
            return { ...result, restored: restored.flatMap(value => value.gardens), standalone, removedLocal: local, errors: [...(result.errors || []), ...restored.flatMap(value => value.errors || []), ...(standalone?.errors || [])] }; // CHANGE
        } // CHANGE
        async function editProject() { // CHANGE: publish a targeted local edit independently of an older section read.
            cache.revision = (cache.revision || 0) + 1; cache.rowVersions ||= new Map(); cache.rowVersions.set(options.diagramId, cache.revision); cache.edits ||= new Map(); // CHANGE
            const row = cache.libraryProjects.find(garden => garden.diagramId === options.diagramId), section = cache.communities.some(community => community.gardens.some(garden => garden.diagramId === options.diagramId)) ? 'communities' : row?.classification === 'shared' || row?.shared ? 'shared' : 'private', edit = { section, revision: cache.revision }; cache.edits.set(options.diagramId, edit); if (state.projectsRoot?.isConnected) updateLoadHeaders(state); // CHANGE
            try { const result = await read('edit:' + options.diagramId + ':' + edit.revision, () => root.trellisGardenLibrary.list({ diagramId: options.diagramId })); if (!valid() || cache.edits.get(options.diagramId) !== edit) return; if (result.errors?.length) throw new Error(result.errors.join(' · ')); publishProjectRows(cache, result.gardens, section, options.diagramId, edit.revision); } // CHANGE
            catch (error) { if (valid()) { cache.sectionLoads[section] ||= {}; cache.sectionLoads[section].error = error.message; } } // CHANGE
            finally { if (valid() && cache.edits.get(options.diagramId) === edit) { cache.edits.delete(options.diagramId); render(); } } // CHANGE
        } // CHANGE
        async function load(kind) { // CHANGE
            const previous = cache.sectionLoads[kind] || {}; if (previous.loading && !options.only) return previous.task; if (options.reopen && previous.attempted) return; // CHANGE
            const load = cache.sectionLoads[kind] = { ...previous, attempted: true, loading: true, error: '' }, started = root.performance.now(), revision = cache.revision || 0; if (state.projectsRoot?.isConnected) updateLoadHeaders(state); // CHANGE
            const task = (async () => { // CHANGE
                try { // CHANGE
                    let result, local, communityProjects; // CHANGE
                    if (kind === 'shared' || kind === 'private') { // CHANGE
                        const localRead = kind === 'private' && (!options.only || options.only.includes('local')) ? read('local', async () => { await trash(); return root.trellisGardenLibrary.listLocal(); }) : null; // CHANGE: recover Trash before scanning standalone paths, including files with embedded garden identities.
                        const managedRead = options.only && !options.only.includes('library') ? Promise.resolve({ gardens: cache.libraryProjects }) : library(); if (kind === 'private' && !previous.attempted) managedRead.then(value => { if (valid() && cache.sectionLoads[kind] === load && !value.errors?.length) { publishProjectRows(cache, value.gardens, kind, options.diagramId, revision); render(); } }, () => {}); // CHANGE: managed rows do not wait for local recovery.
                        const [managed, standalone] = await Promise.allSettled([managedRead, localRead]); // CHANGE: a failed identity listing must not hide initial standalone browsing.
                        if (!valid() || cache.sectionLoads[kind] !== load) return; // CHANGE
                        if (!previous.attempted && standalone.status === 'fulfilled' && standalone.value && !standalone.value.errors?.length) { cache.localProjects = standalone.value.gardens; cache.localFolder = standalone.value.folder || ''; render(); } // CHANGE
                        if (managed.status === 'rejected') throw managed.reason; if (standalone.status === 'rejected') throw standalone.reason; result = managed.value; local = standalone.value; // CHANGE
                    } else if (kind === 'communities') { const reads = await Promise.all([identityId && root.trellisGardenCommunities ? read('communities', () => root.trellisGardenCommunities.list()) : { communities: [] }, !options.reopen && identityId ? library() : null]); result = reads[0]; communityProjects = reads[1]; } // CHANGE: explicit community reloads resolve accessible descriptors and necessary transfers together.
                    else if (kind === 'requests') result = identityId && root.trellisGardenCommunities ? await root.trellisGardenCommunities.listRequests() : { requests: [] }; // CHANGE
                    else result = await trashTransfers(); // CHANGE
                    if (!valid() || cache.sectionLoads[kind] !== load) return; // CHANGE
                    if (result.errors?.length || local?.errors?.length || communityProjects?.errors?.length) throw new Error([...(result.errors || []), ...(local?.errors || []), ...(communityProjects?.errors || [])].join(' · ')); // CHANGE
                    if (kind === 'shared' || kind === 'private') { publishProjectRows(cache, result.gardens, kind, options.diagramId, revision); if (local) { cache.localProjects = local.gardens; cache.localFolder = local.folder || ''; const paths = new Set(local.gardens.map(garden => projectPathKey(garden.path))); cache.trashedProjects = cache.trashedProjects.filter(garden => garden.source !== 'local' || !paths.has(projectPathKey(garden.originalPath || garden.restorePath))); } } // CHANGE
                    else if (kind === 'communities') { // CHANGE
                        const before = new Set(cache.communities.flatMap(community => community.gardens.map(garden => garden.diagramId))); cache.communities = result.communities; // CHANGE
                        const after = new Set(cache.communities.flatMap(community => community.gardens.map(garden => garden.diagramId))); // CHANGE
                        if (communityProjects) { const affected = new Set([...before, ...after].filter(id => (cache.rowVersions?.get(id) || 0) <= revision)); cache.libraryProjects = [...cache.libraryProjects.filter(row => !affected.has(row.diagramId)), ...communityProjects.gardens.filter(row => affected.has(row.diagramId))]; } // CHANGE: publish transfers without refreshing unrelated metadata or overwriting newer local edits.
                        for (const community of cache.communities) for (const garden of community.gardens) if (garden.joined && (cache.rowVersions?.get(garden.diagramId) || 0) <= revision) { const { name, people, distanceKm, moduleCities, gardenModuleCount, locationsComplete } = garden; cache.libraryProjects = cache.libraryProjects.map(row => row.diagramId === garden.diagramId ? { ...row, name, people, distanceKm, moduleCities, gardenModuleCount, locationsComplete } : row); } // CHANGE: community proof fields do not become project membership or action state.
                    } else if (kind === 'requests') cache.communityRequests = result.requests; else { // CHANGE
                        cache.trashedProjects = result.gardens; const ids = new Set(result.gardens.map(garden => garden.diagramId).filter(Boolean)), paths = new Set(result.gardens.map(garden => projectPathKey(garden.originalPath || garden.restorePath || garden.path)).filter(Boolean)); // CHANGE
                        cache.libraryProjects = cache.libraryProjects.filter(garden => !ids.has(garden.diagramId)); cache.localProjects = cache.localProjects.filter(garden => !ids.has(garden.diagramId) && !paths.has(projectPathKey(garden.path))); cache.communities = cache.communities.map(community => ({ ...community, gardens: community.gardens.filter(garden => !ids.has(garden.diagramId)) })).filter(community => community.gardens.length); // CHANGE
                        for (const garden of result.restored) publishProjectRows(cache, [garden], 'trash', garden.diagramId, revision); // CHANGE
                        if (result.standalone) { const known = new Set(cache.localProjects.map(garden => projectPathKey(garden.path))), affected = new Set(result.removedLocal.map(garden => projectPathKey(garden.originalPath || garden.restorePath))); cache.localProjects = [...cache.localProjects.filter(garden => !affected.has(projectPathKey(garden.path))), ...result.standalone.gardens.filter(garden => affected.has(projectPathKey(garden.path)) || !known.has(projectPathKey(garden.path)))]; } // CHANGE
                    } // CHANGE
                    load.updatedAt = Date.now(); // CHANGE
                } catch (error) { if (valid() && cache.sectionLoads[kind] === load) load.error = error.message; } // CHANGE
                finally { if (valid() && cache.sectionLoads[kind] === load) { load.loading = false; load.task = null; root.TrellisGardenHomeTiming?.({ phase: kind, milliseconds: root.performance.now() - started }); render(); } } // CHANGE
            })(); load.task = task; return task; // CHANGE
        } // CHANGE
        const targeted = options.diagramId && options.only?.includes('library'), sources = targeted ? options.only.filter(source => source !== 'library') : options.only; // CHANGE
        const sections = options.section ? [options.section] : sources ? [...new Set(sources.flatMap(source => ({ library: ['shared', 'private'], local: ['private'], trash: ['trash'], requests: ['requests'], accessible: ['communities'], discovery: ['communities'] })[source] || []))] : ['communities', 'shared', 'private', 'requests', 'trash']; // CHANGE
        await Promise.allSettled([...sections.map(load), ...(targeted ? [editProject()] : [])]); render(); // CHANGE
    } // CHANGE
    function distanceBand(distance) { return !Number.isFinite(distance) ? 4 : distance < 25 ? 0 : distance < 100 ? 1 : distance < 500 ? 2 : 3; } // CHANGE: retain the existing exported utility for compatibility.
    /** Render only changed sections, preserving row identity during unrelated source completions. */ // CHANGE
    function drawProjects(ui, state) { // CHANGE
        const panel = state.projectsRoot; if (!panel?.isConnected) return; // CHANGE
        const started = root.performance.now(), scroller = state.projectsBody, scroll = scroller.scrollTop, focused = document.activeElement?.getAttribute('data-project-focus'); // CHANGE
        updateProjectSections(state); state.unknownDistanceIds = new Set(); // CHANGE
        const expanded = new Set([...panel.querySelectorAll('details[data-project-details][open]')].map(node => node.getAttribute('data-project-details'))); // CHANGE
        const pathKey = projectPathKey; // CHANGE
        const knownPaths = new Set(state.libraryProjects.map(project => pathKey(project.path)).filter(Boolean)), knownIds = new Set(state.libraryProjects.map(project => project.diagramId).filter(Boolean)); // CHANGE
        const allProjects = [...state.libraryProjects, ...state.localProjects.filter(project => !knownPaths.has(pathKey(project.path)) && !(project.diagramId && knownIds.has(project.diagramId)))]; // CHANGE
        const assigned = new Set((state.communities || []).flatMap(c => c.gardens.map(g => g.diagramId))), query = state.search.toLowerCase(); // CHANGE
        const unassigned = allProjects.filter(project => !assigned.has(project.diagramId)), allShared = unassigned.filter(project => project.classification === 'shared' || project.shared), allPrivate = unassigned.filter(project => !(project.classification === 'shared' || project.shared)); // CHANGE
        const shared = allShared.filter(project => project.name.toLowerCase().includes(query) && matchesRadius(state, project)), privateProjects = allPrivate.filter(project => project.name.toLowerCase().includes(query)); // CHANGE
        function changed(kind, value) { // NEW
            const token = JSON.stringify([state.view, query, projectLoginKey(state.session), state.referenceCity, state.maxDistanceKm, value]); // NEW
            if (state.renderedRows[kind] === token) return false; state.renderedRows[kind] = token; return true; // NEW
        } // NEW
        for (const kind of ['communities', 'shared', 'private']) if (state[kind + 'Rows']) state[kind + 'Rows'].parentNode.hidden = state.view === 'trash'; // CHANGE
        state.trashSection.hidden = state.view !== 'trash'; // CHANGE
        if (changed('trash', state.trashedProjects)) { // NEW
            state.trashRows.replaceChildren(); for (const project of (state.trashedProjects || []).filter(project => project.name.toLowerCase().includes(query))) state.trashRows.append(trashRow(ui, state, project)); // CHANGE
            if (!state.trashRows.children.length) state.trashRows.append(element('p', query ? 'No matching projects in Trash.' : 'Trash is empty.', 'trellis-home-muted')); // CHANGE
        } // NEW
        if (changed('shared', allShared)) { // NEW
            state.sharedRows.replaceChildren(); shared.sort((a, b) => compareGardens(state, a, b)).forEach(project => state.sharedRows.append(projectRow(ui, state, project))); // CHANGE
            if (!shared.length) state.sharedRows.append(element('p', state.session ? 'No matching shared garden projects.' : 'Log in to see shared garden projects.', 'trellis-home-muted')); // CHANGE
            sectionCount(state, 'shared', shared.length, allShared.length, 'projects', shared); // CHANGE
        } // NEW
        if (changed('private', allPrivate)) { // NEW
            state.privateRows.replaceChildren(); privateProjects.sort((a, b) => a.name.localeCompare(b.name)).forEach(project => state.privateRows.append(projectRow(ui, state, project))); // CHANGE
            if (!privateProjects.length) state.privateRows.append(element('p', query ? 'No matching private projects.' : 'No private projects in your library or local folder.', 'trellis-home-muted')); // CHANGE
            sectionCount(state, 'private', privateProjects.length, allPrivate.length, 'projects'); // CHANGE
        } // NEW
        if (state.communitiesRows && changed('communities', [state.communities, allProjects.filter(project => assigned.has(project.diagramId)), state.communityRequests])) { // CHANGE
            const projectUnknown = state.unknownDistanceIds; state.unknownDistanceIds = new Set(); // NEW
            state.communitiesRows.replaceChildren(); drawCommunityGroups(ui, state, allProjects); state.communityUnknownDistanceIds = [...state.unknownDistanceIds]; state.unknownDistanceIds = projectUnknown; // NEW
        } // NEW
        for (const id of state.communityUnknownDistanceIds || []) state.unknownDistanceIds.add(id); // NEW: unchanged community DOM retains its radius-filter contribution.
        if (changed('requests', state.communityRequests)) drawCommunityRequests(ui, state); // NEW
        const unknown = state.unknownDistanceIds.size; state.distanceNotice.textContent = unknown ? unknown + (unknown === 1 ? ' shared garden hidden because its distance is unknown.' : ' shared gardens hidden because their distance is unknown.') : ''; state.distanceNotice.hidden = state.view === 'trash' || !unknown; // CHANGE
        for (const node of panel.querySelectorAll('details[data-project-details]:not(.trellis-project-group)')) node.open = expanded.has(node.getAttribute('data-project-details')); // CHANGE
        if (focused) ([...panel.querySelectorAll('[data-project-focus]')].find(node => node.getAttribute('data-project-focus') === focused && !node.closest('[hidden]') && !(node.parentElement?.closest('details:not([open])') && node.tagName !== 'SUMMARY')) || (state.view === 'trash' ? state.trashTab : state.searchControl))?.focus({ preventScroll: true }); // CHANGE
        scroller.scrollTop = scroll; applyProjectHighlight(state); // NEW
        root.TrellisGardenHomeTiming?.({ phase: 'render', milliseconds: root.performance.now() - started }); // NEW
    } // CHANGE
    /** Forms remain outside refreshed rows so synchronization cannot erase typing. */ // NEW
    function communityForm(ui, state, title, fields, submitLabel, action, variant = 'add', reloadSection = 'communities') { // CHANGE: destructive community decisions supply their semantic style explicitly.
        const cache = state.projectSnapshot, login = projectLoginKey(state.session), valid = () => cache === state.projectSnapshot && login === projectLoginKey(state.session); // CHANGE
        const { panel, close } = projectActionPanel(state, title), form = element('form', null, 'trellis-home-form'), status = element('p', '', 'trellis-home-muted'), submit = button(submitLabel, null, variant); // CHANGE
        status.setAttribute('aria-live', 'polite'); submit.type = 'submit'; form.append(...fields, status, submit, button('Cancel', close, 'close')); panel.append(form); // CHANGE
        form.addEventListener('submit', async event => { event.preventDefault(); if (submit.disabled || !valid() || !panel.isConnected) return; submit.disabled = true; try { const result = await action(); if (!valid()) return; close(); state.communityNotice = result?.status === 'waiting' || result?.status === 'queued' ? result.reason || 'Queued. Waiting for peers to connect.' : result?.status === 'pending' ? 'Garden admission is waiting for community approval.' : ''; await refreshProjects(ui, state, { section: reloadSection }); } catch (error) { if (valid()) { status.textContent = error.message; submit.disabled = false; } } }); // CHANGE
        applyProjectHighlight(state); // NEW: disable submission while its explicit current-project choice is unavailable.
        form.querySelector('input,select,textarea')?.focus(); return form; // NEW
    } // NEW
    function descriptionField(label, value = '') { const field = input(label); field.control.value = value; field.control.maxLength = 1000; return field; } // NEW
    function roleField(value = 'gardener') { const select = element('select'); select.setAttribute('aria-label', 'Access role'); for (const role of ['visitor', 'gardener', 'coordinator']) { const option = element('option', role[0].toUpperCase() + role.slice(1)); option.value = role; select.append(option); } select.value = value; return select; } // NEW
    function gardenSelector(state, omit = new Set()) { // NEW
        const select = element('select'); select.setAttribute('aria-label', 'Garden project'); // NEW
        for (const project of state.libraryProjects.filter(p => p.available && p.canRename && !omit.has(p.diagramId))) { const option = element('option', project.name); option.value = project.diagramId; select.append(option); } // NEW
        return select; // NEW
    } // NEW
    /** A guide never silently substitutes a new garden for its still-loading current project. */ // NEW
    function preselectQuickstartProject(state, select) {
        const diagramId = state.quickstartHighlight?.diagramId;
        if (!diagramId) return;
        if (![...select.options].some(option => option.value === diagramId)) { const option = element('option', 'Current project — waiting for project access'); option.value = diagramId; option.disabled = true; option.dataset.quickstartPending = ''; select.append(option); }
        select.value = diagramId; select.dataset.quickstartProject = diagramId;
    }
    function showCommunityCreation(ui, state) { // NEW
        const name = input('Community name'), description = descriptionField('Community description'), gardenDescription = descriptionField('Garden description'), assigned = new Set((state.communities || []).flatMap(c => c.gardens.map(g => g.diagramId))), garden = gardenSelector(state, assigned), fresh = element('option', 'Create a new first garden'), newName = input('New garden name'); // NEW
        preselectQuickstartProject(state, garden); // NEW
        const quickstartToken = ui.editor?.graph?.__trellisQuickstart?.capture(); // NEW
        const draft = state.communityDraft || {}; name.control.value = draft.name || ''; description.control.value = draft.description || ''; gardenDescription.control.value = draft.gardenDescription || ''; newName.control.value = draft.newGardenName || ''; // NEW
        name.control.required = true; name.control.maxLength = 120; fresh.value = '__new'; garden.append(fresh); newName.wrap.hidden = garden.value !== '__new'; garden.addEventListener('change', () => { newName.wrap.hidden = garden.value !== '__new'; }); // NEW
        let created = draft.created || null; if (created) { garden.value = '__new'; newName.wrap.hidden = false; } // CHANGE: retry the exact retained first garden after an interrupted navigation/setup.
        communityForm(ui, state, 'Create Garden Community', [name.wrap, description.wrap, garden, newName.wrap, gardenDescription.wrap], 'Create community', async () => { // NEW
            Object.assign(draft, { name: name.control.value, description: description.control.value, gardenDescription: gardenDescription.control.value, newGardenName: newName.control.value }); state.communityDraft = draft; // NEW
            try { // NEW
            let diagramId = garden.value; // NEW
            if (diagramId === '__new') { // NEW
                if (!newName.control.value.trim()) throw new Error('Enter a name for the first garden.'); // NEW
                if (!created) { created = await root.trellisGardenLibrary.create({ name: newName.control.value.trim() }); draft.created = created; } // CHANGE
                if (!await openPath(ui, created.path)) throw new Error('Open the new garden to finish its starter setup.'); // NEW
                if (!await initializeProject(ui, false)) throw new Error('Finish the new garden setup before creating its community.'); // NEW
                diagramId = created.entry.diagramId; // NEW
            } // NEW
            const result = await root.trellisGardenCommunities.create({ name: name.control.value, description: description.control.value, gardenDescription: gardenDescription.control.value, diagramId });
            if (diagramId === quickstartToken?.diagramId) ui.editor.graph.__trellisQuickstart?.record('community', quickstartToken); // NEW // NEW
            state.communityDraft = null; if (!state.projectsRoot?.isConnected) showProjects(ui); return result; // CHANGE
            } catch (error) { if (!state.projectsRoot?.isConnected) { state.communityNotice = error.message; showProjects(ui); showCommunityCreation(ui, state); } throw error; } // NEW
        }); // NEW
    } // NEW
    function requestCommunityGarden(ui, state, community, garden) { // NEW
        const role = roleField(), note = descriptionField('Optional note'); note.control.maxLength = 4000; // NEW
        communityForm(ui, state, 'Request access to ' + garden.name, [element('p', garden.description), role, note.wrap], 'Send request', () => root.trellisGardenCommunities.requestAccess({ communityId: community.id, diagramId: garden.diagramId, preset: role.value, note: note.control.value }), 'add', 'requests'); // CHANGE
    } // NEW
    function manageCommunity(ui, state, community) { // NEW
        const name = input('Community name'), description = descriptionField('Community description', community.description); name.control.value = community.name; name.control.required = true; name.control.maxLength = 120; // NEW
        const identities = element('fieldset'); identities.append(element('legend', 'Community administrators')); // NEW
        for (const identityId of community.memberIds || []) { const label = element('label'), control = element('input'); control.type = 'checkbox'; control.value = identityId; control.checked = community.administrators.includes(identityId); label.append(control, document.createTextNode(identityId === state.session.identityId ? 'You' : identityId)); identities.append(label); } // NEW
        communityForm(ui, state, 'Manage ' + community.name, [name.wrap, description.wrap, identities], 'Save community', async () => { await root.trellisGardenCommunities.update({ communityId: community.id, name: name.control.value, description: description.control.value }); await root.trellisGardenCommunities.setAdministrators({ communityId: community.id, identityIds: [...identities.querySelectorAll('input:checked')].map(c => c.value) }); }); // NEW
    } // NEW
    function addCommunityGarden(ui, state, community) { // NEW
        const assigned = new Set((state.communities || []).flatMap(c => c.gardens.map(g => g.diagramId))), garden = gardenSelector(state, assigned), description = descriptionField('Garden description'); // NEW
        preselectQuickstartProject(state, garden); // NEW
        const quickstartToken = ui.editor?.graph?.__trellisQuickstart?.capture(); // NEW
        communityForm(ui, state, 'Add garden to ' + community.name, [garden, description.wrap], 'Request admission', async () => { // NEW
            if (!garden.value) throw new Error('Download a garden you administer that is not already in a community.');
            const diagramId = garden.value, result = await root.trellisGardenCommunities.addGarden({ communityId: community.id, diagramId, description: description.control.value });
            if (diagramId === quickstartToken?.diagramId) ui.editor.graph.__trellisQuickstart?.record('community', quickstartToken); // NEW
            return result;
        });
    } // NEW
    function drawCommunityGroups(ui, state, projects) { // NEW
        const search = state.search.toLowerCase(), visibleGardens = []; let shown = 0; // NEW
        for (const community of state.communities || []) { // NEW
            const matchesCommunity = (community.name + ' ' + community.description).toLowerCase().includes(search); // CHANGE
            const gardens = community.gardens.map(g => ({ ...g, project: projects.find(p => p.diagramId === g.diagramId) })).filter(g => (matchesCommunity || (g.name + ' ' + g.description + ' ' + (g.project?.name || '')).toLowerCase().includes(search)) && matchesRadius(state, g.project || g)); // CHANGE // NEW
            if (!gardens.length && (search || state.referenceCity && state.maxDistanceKm != null)) continue; shown++; visibleGardens.push(...gardens); // NEW
            const group = foldedGroup(state, 'community:' + community.id, community.name + ' · ' + entityCount(gardens.length, community.gardens.length, 'projects') + ' · ' + communityPeopleText(gardens)); // NEW
            if (community.description) group.append(element('p', community.description)); // NEW
            if (community.administrators?.length) group.append(element('p', 'Community administrators: ' + community.administrators.map(id => id === state.session?.identityId ? 'You' : id).join(', '), 'trellis-home-muted')); // NEW
            if (community.automaticSuccessor) group.append(element('p', 'An administrator was selected automatically because no previous administrator remains eligible.', 'trellis-home-muted')); // NEW
            const addGarden = button('Add garden', () => addCommunityGarden(ui, state, community), 'add'); addGarden.dataset.quickstartCommunityAdd = ''; group.append(addGarden); // NEW
            group.addEventListener('toggle', () => applyProjectHighlight(state)); // CHANGE
            if (community.canAdminister) group.append(button('Manage community', () => manageCommunity(ui, state, community), 'neutral')); // CHANGE
            for (const admission of community.admissions || []) { // NEW
                const row = element('div', 'Garden admission: ' + admission.name); // NEW
                for (const approved of [true, false]) row.append(button(approved ? 'Admit garden' : 'Decline garden', () => communityForm(ui, state, approved ? 'Admit garden' : 'Decline garden', [element('p', admission.name + ' — ' + (admission.description || ''))], approved ? 'Admit' : 'Decline', () => root.trellisGardenCommunities.decideAdmission({ communityId: community.id, admissionId: admission.id, approved }), approved ? 'add' : 'danger'), approved ? 'add' : 'danger')); group.append(row); // CHANGE
            } // NEW
            for (const joined of [true, false]) { // CHANGE
                const members = gardens.filter(g => g.joined === joined), total = community.gardens.filter(g => g.joined === joined).length; // CHANGE
                if (!members.length && (search || state.referenceCity && state.maxDistanceKm != null)) continue; // CHANGE
                const membershipGroup = foldedGroup(state, 'community:' + community.id + (joined ? ':joined' : ':not-joined'), (joined ? 'Joined gardens' : 'Not joined gardens') + ' · ' + entityCount(members.length, total, 'projects') + ' · ' + peopleText(members.map(g => g.project || g), true, joined && members.length > 0), joined); // CHANGE
                for (const garden of members.sort((a, b) => compareGardens(state, a.project || a, b.project || b))) { // NEW
                    const nodeKey = 'community:' + community.id + ':' + garden.diagramId, token = JSON.stringify([garden, community.canAdminister, state.communityRequests.filter(request => request.diagramId === garden.diagramId)]), cached = state.projectRowNodes.get(nodeKey); if (cached?.token === token) { membershipGroup.append(cached.row); continue; } // CHANGE: unrelated community updates preserve garden controls.
                    const project = projects.find(p => p.diagramId === garden.diagramId), row = garden.joined && project ? projectRow(ui, state, project, token) : element('div', null, 'trellis-project-row'); // CHANGE
                    if (!garden.joined || !project) row.append(element('strong', garden.name), element('span', peopleText([garden], false, garden.joined) + (Number.isFinite(garden.distanceKm) ? ' · ' + Math.round(garden.distanceKm) + ' km nearest' : ''), 'trellis-home-muted')); // NEW
                    if (garden.description) row.append(element('p', garden.description)); // NEW
                    if (!garden.joined) { const request = (state.communityRequests || []).find(r => r.diagramId === garden.diagramId && r.requesterIdentityId === state.session?.identityId && ['queued', 'waiting', 'pending'].includes(r.status)); if (request) row.append(element('span', 'Access request ' + request.status, 'trellis-home-muted')); else row.append(button('Request access', () => requestCommunityGarden(ui, state, community, garden), 'add')); } // CHANGE: a completed earlier request does not prevent requesting fresh access after revocation.
                    if (garden.canAdminister) row.append(button('Edit description', () => { const field = descriptionField('Garden description', garden.description); communityForm(ui, state, 'Edit garden description', [field.wrap], 'Save description', () => root.trellisGardenCommunities.describeGarden({ communityId: community.id, diagramId: garden.diagramId, description: field.control.value })); }, 'neutral')); // CHANGE
                    if (garden.canAdminister || community.canAdminister) row.append(button('Detach garden', () => communityForm(ui, state, 'Detach garden', [element('p', 'Remove ' + garden.name + ' from this community? Existing garden access is preserved.')], 'Detach garden', () => root.trellisGardenCommunities.detachGarden({ communityId: community.id, diagramId: garden.diagramId }), 'danger'), 'danger')); // CHANGE
                    for (const action of row.querySelectorAll('button')) if (!action.hasAttribute('data-project-focus')) action.setAttribute('data-project-focus', 'community:' + community.id + ':' + garden.diagramId + ':' + action.textContent); // NEW
                    state.projectRowNodes.set(nodeKey, { token, row }); membershipGroup.append(row); // CHANGE
                } // NEW
                group.append(membershipGroup); // CHANGE
            } // CHANGE
            group.querySelector('summary').setAttribute('data-project-focus', 'community:' + community.id); // NEW
            for (const action of group.querySelectorAll(':scope > button')) action.setAttribute('data-project-focus', 'community:' + community.id + ':' + action.textContent); // NEW
            state.communitiesRows.append(group); // NEW
        } // NEW
        sectionCount(state, 'communities', shown, (state.communities || []).length, 'communities', visibleGardens); // CHANGE
        if (!shown) state.communitiesRows.append(element('p', state.session ? 'No matching garden communities.' : 'Log in to see garden communities.', 'trellis-home-muted')); // CHANGE
    } // NEW
    function drawCommunityRequests(ui, state) { // NEW
        const host = state.communityRequestRows; if (!host) return; host.parentNode.hidden = state.view === 'trash'; host.replaceChildren(); // NEW
        for (const request of state.communityRequests || []) { // NEW
            const nodeKey = 'request:' + request.id, token = JSON.stringify(request), cached = state.projectRowNodes.get(nodeKey); if (cached?.token === token) { host.append(cached.row); continue; } // CHANGE: preserve unchanged request rows within a reloaded section.
            const row = element('div', null, 'trellis-project-row'); row.append(element('strong', request.gardenName), element('p', request.requesterName + ' — ' + request.status), element('p', request.note || 'No note.')); if (request.decisionNote) row.append(element('p', request.decisionNote)); // NEW
            if (request.canDecide) row.append(button('Review request', () => { // NEW
                const role = roleField(request.preset), note = descriptionField('Optional response'), scopes = element('fieldset'); scopes.append(element('legend', 'Editing scopes')); // NEW
                for (const scope of request.scopes) { const label = element('label'), control = element('input'); control.type = 'checkbox'; control.dataset.scopeId = scope.id; control.dataset.pageId = scope.pageId; label.append(control, document.createTextNode(scope.label)); scopes.append(label); } // NEW
                const form = communityForm(ui, state, 'Review access request', [element('p', request.requesterName + ': ' + request.note), role, scopes, note.wrap], 'Approve access', () => root.trellisGardenCommunities.decideAccess({ requestId: request.id, approved: true, preset: role.value, scopes: [...scopes.querySelectorAll('input:checked')].map(c => ({ id: c.dataset.scopeId, pageId: c.dataset.pageId })), note: note.control.value }), 'add', 'requests'); // CHANGE
                form.append(button('Deny access', async event => { event.currentTarget.disabled = true; try { await root.trellisGardenCommunities.decideAccess({ requestId: request.id, approved: false, note: note.control.value }); state.actionPanel?.remove(); await refreshProjects(ui, state, { section: 'requests' }); } catch (error) { form.querySelector('[aria-live]').textContent = error.message; event.currentTarget.disabled = false; } }, 'danger')); // CHANGE
            }, 'open')); for (const action of row.querySelectorAll('button')) action.setAttribute('data-project-focus', 'request:' + request.id + ':' + action.textContent); state.projectRowNodes.set(nodeKey, { token, row }); host.append(row); // CHANGE
        } // NEW
        if (!host.children.length) host.append(element('p', state.session ? 'No access requests.' : 'Log in to review access requests.', 'trellis-home-muted')); // NEW
    } // NEW
    /** Use the application name dialog so desktop Rename does not depend on browser prompt. */ // NEW
    function renameProject(ui, state, project) { // NEW
        const login = projectLoginKey(state.session); // CHANGE
        const dialog = new root.FilenameDialog(ui, project.projectName || project.name, 'Rename', async name => { // CHANGE
            try { // CHANGE
                if (login !== projectLoginKey(state.session)) return; // CHANGE: a stale editor cannot act under another login.
                if (ui.getCurrentFile()?.fileObject?.path === project.path) await root.Trellis?.sharing?.settleObjectEdits?.({ release: true }); // NEW
                if (login !== projectLoginKey(state.session)) return; await root.trellisGardenLibrary.rename({ diagramId: project.diagramId, name }); if (login === projectLoginKey(state.session)) await refreshProjects(ui, state, { only: ['library'], diagramId: project.diagramId }); // CHANGE
            } // NEW
            catch (error) { ui.handleError(error); } // NEW
        }, 'Project name', name => !!name.trim()); // NEW
        const control = dialog.container.querySelector('input'), preview = element('p', '', 'trellis-home-muted'); // NEW
        if (control && root.TrellisProjectNaming) { control.maxLength = 240; const update = () => { preview.textContent = 'Filename: ' + root.TrellisProjectNaming.filename(control.value, project.suffix || ''); }; control.addEventListener('input', update); update(); dialog.container.append(preview); } // CHANGE
        state.editPrompt = () => { if (ui.dialog?.container?.firstChild === dialog.container || ui.dialog?.container === dialog.container) ui.hideDialog(); }; // CHANGE
        ui.showDialog(dialog.container, Math.min(420, (root.innerWidth || 1000) - 40), 180, true, true); // CHANGE: show the converted filename before applying a shared-name change.
        for (const control of dialog.container.querySelectorAll('button')) root.Trellis?.ui?.applyButtonStyle?.(control, control.textContent === 'Rename' ? 'add' : 'close'); // CHANGE: style the host dialog's submit and cancel buttons too.
        dialog.init(); // NEW
    } // NEW
    /** Keep the shared prefix read-only while editing only this identity's suffix. */ // NEW
    function editSuffix(ui, state, project) { // NEW
        const login = projectLoginKey(state.session); // CHANGE
        const { panel, close } = projectActionPanel(state, 'Edit my suffix'), field = input('My suffix'); field.control.value = project.suffix || ''; field.control.maxLength = 160; // NEW
        const prefix = element('p', 'Project: ' + project.projectName), preview = element('p', '', 'trellis-home-muted'), error = element('p', '', 'trellis-home-muted'); error.setAttribute('aria-live', 'polite'); // NEW
        const update = () => { preview.textContent = 'Filename: ' + (root.TrellisProjectNaming?.filename(project.projectName, field.control.value) || project.projectName + (field.control.value ? ' - ' + field.control.value : '') + '.drawio'); }; // CHANGE
        field.control.addEventListener('input', update); update(); // NEW
        const save = button('Save suffix', async () => { // NEW
            if (!panel.isConnected || login !== projectLoginKey(state.session)) return; save.disabled = true; // CHANGE
            try { await root.trellisGardenLibrary.setSuffix({ diagramId: project.diagramId, suffix: field.control.value }); if (login !== projectLoginKey(state.session)) return; close(); await refreshProjects(ui, state, { only: ['library'], diagramId: project.diagramId }); } // CHANGE
            catch (failure) { error.textContent = failure.message; save.disabled = false; } // NEW
        }, 'add'); // CHANGE
        panel.append(prefix, field.wrap, preview, error, save, button('Cancel', close, 'close')); field.control.focus(); // CHANGE
    } // NEW
    /** Non-lifecycle forms stay outside refreshed rows so typing survives availability updates. */ // CHANGE
    function projectActionPanel(state, title) { // NEW
        state.actionPanel?.remove(); const previousFocus = document.activeElement; // NEW
        const panel = element('section', null, 'trellis-project-action'); panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', title); // NEW
        const heading = element('h3', title); heading.tabIndex = -1; panel.append(heading); state.projectsStatus.after(panel); state.actionPanel = panel; heading.focus(); // NEW
        const close = () => { panel.remove(); if (state.actionPanel === panel) state.actionPanel = null; if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); }; // NEW
        return { panel, close }; // NEW
    } // NEW
    function lifecycleInput(project) { return { source: project.source, diagramId: project.diagramId, path: project.path, trashId: project.trashId }; } // NEW
    /** Stack lifecycle prompts above the live library, owning focus, cancellation, and one pending mutation. */ // CHANGE
    /** Apply local edit results without making unrelated sources reload before an explicit reload. */ // NEW
    async function refreshProjectMutation(ui, state, focusKey, result, membership) { // NEW
        const affected = [...state.libraryProjects, ...state.localProjects, ...(state.trashedProjects || [])].find(project => [project.diagramId, project.trashId, project.path].some(key => key && focusKey.startsWith(key + ':'))); // NEW
        if (membership) { // NEW
            if (affected && result?.complete === false) { affected.departing = true; affected.reason = result.reason; drawProjects(ui, state); } // NEW: show the pending local action without changing confirmed membership.
            else if (affected && result?.complete === true) { state.libraryProjects = state.libraryProjects.filter(project => project.diagramId !== affected.diagramId); state.localProjects = state.localProjects.filter(project => project.diagramId !== affected.diagramId && projectPathKey(project.path) !== projectPathKey(affected.path)); state.communities = state.communities.map(community => ({ ...community, gardens: community.gardens.map(garden => garden.diagramId === affected.diagramId ? { ...garden, joined: false, canAdminister: false } : garden) })); drawProjects(ui, state); } // CHANGE: confirmed local departures take effect immediately.
            return; // NEW
        } // NEW
        await refreshProjects(ui, state, { only: affected?.source === 'local' ? ['trash', 'local'] : ['trash', 'library'], diagramId: affected?.diagramId }); // NEW
    } // NEW
    function projectConfirmation(ui, state, title, focusKey) { // CHANGE
        state.confirmation?.invalidate(); // CHANGE
        const library = state.projectsRoot, identityId = state.session?.identityId, previousFocus = document.activeElement; // CHANGE
        const origin = focusKey || previousFocus?.getAttribute('data-project-focus'); // CHANGE
        const panel = element('section', null, 'trellis-project-confirmation'), heading = element('h3', title); // CHANGE
        const id = 'trellis-project-confirmation-' + (state.confirmationSequence = (state.confirmationSequence || 0) + 1); // CHANGE
        const description = element('p', '', 'trellis-home-muted'), error = element('p', '', 'trellis-home-muted'), controls = element('div', null, 'trellis-home-row'); // CHANGE
        heading.id = id; description.id = id + '-description'; panel.tabIndex = -1; // CHANGE
        panel.setAttribute('role', 'alertdialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', heading.id); panel.setAttribute('aria-describedby', description.id); // CHANGE
        error.setAttribute('aria-live', 'polite'); description.setAttribute('aria-live', 'polite'); // CHANGE
        let closed = false, invalidated = false, disabled = new Map(); // CHANGE
        const prompt = { panel, heading, description, error, controls, busy: false, isActive, close, invalidate, run }; // CHANGE
        const cancel = button('Cancel', close, 'close'); controls.append(cancel); panel.append(heading, description, error, controls); // CHANGE
        function isActive() { return !closed && !invalidated && panel.isConnected && library.isConnected && state.projectsRoot === library && identityId === state.session?.identityId; } // CHANGE
        function close() { if (!prompt.busy && ui.dialog?.container?.firstChild === panel) ui.hideDialog(true, false, panel); } // CHANGE
        function invalidate() { invalidated = true; prompt.busy = false; close(); } // CHANGE
        function restoreFocus() { // CHANGE
            if (!library.isConnected || state.confirmation || ui.dialog?.container?.firstChild !== library) return; // CHANGE
            const target = origin && [...library.querySelectorAll('[data-project-focus]')].find(node => node.getAttribute('data-project-focus') === origin); // CHANGE
            (target || (!origin && previousFocus?.isConnected && previousFocus) || state.searchControl)?.focus({ preventScroll: true }); // CHANGE: a removed originating row returns focus to search.
        } // CHANGE
        function setBusy(busy) { // CHANGE
            prompt.busy = busy; panel.setAttribute('aria-busy', String(busy)); // CHANGE
            if (busy) { disabled = new Map([...panel.querySelectorAll('button,input,select')].map(node => [node, node.disabled])); disabled.forEach((_value, node) => { node.disabled = true; }); panel.focus({ preventScroll: true }); } // CHANGE
            else { disabled.forEach((value, node) => { node.disabled = value; }); disabled.clear(); cancel.focus({ preventScroll: true }); } // CHANGE
        } // CHANGE
        /** Save failures and bridge errors stay in the same prompt; stale completions never navigate. */ // CHANGE
        async function run(action) { // CHANGE
            if (!isActive() || prompt.busy) return; // CHANGE
            error.textContent = ''; setBusy(true); // CHANGE
            try { // CHANGE
                const result = await action(); // CHANGE
                if (!isActive()) return; // CHANGE
                setBusy(false); close(); await refreshProjectMutation(ui, state, focusKey, result, /^(Leave project|Check departure)/.test(heading.textContent)); // CHANGE
                if (result?.complete === false) state.projectsStatus.textContent = result.reason; // CHANGE
            } catch (failure) { if (isActive()) { error.textContent = failure.message; setBusy(false); } } // CHANGE
        } // CHANGE
        function keydown(event) { // CHANGE
            if (ui.dialog?.container?.firstChild !== panel) return; // CHANGE
            if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); } // CHANGE
            else if (event.key === 'Tab') { // CHANGE
                const focusable = [...panel.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(node => !node.disabled && !node.hidden); // CHANGE
                const index = focusable.indexOf(document.activeElement), next = event.shiftKey ? index <= 0 ? focusable.length - 1 : index - 1 : (index + 1) % focusable.length; // CHANGE
                event.preventDefault(); event.stopImmediatePropagation(); (focusable[next] || panel).focus(); // CHANGE
            } // CHANGE
        } // CHANGE
        function containFocus(event) { if (isActive() && ui.dialog?.container?.firstChild === panel && !panel.contains(event.target)) (prompt.busy ? panel : cancel).focus({ preventScroll: true }); } // CHANGE
        state.confirmation = prompt; // CHANGE
        ui.showDialog(panel, Math.max(180, Math.min(520, (root.innerWidth || 1000) - 100)), Math.max(120, Math.min(360, (root.innerHeight || 900) - 100)), true, true, () => { // CHANGE
            if (prompt.busy && !invalidated) return false; // CHANGE
            closed = true; if (state.confirmation === prompt) state.confirmation = null; // CHANGE
            document.removeEventListener('keydown', keydown, true); document.removeEventListener('focusin', containFocus, true); // CHANGE
            library.inert = wasInert; root.setTimeout(restoreFocus, 0); // CHANGE
        }, true, false, null, true); // CHANGE: ignore backdrop clicks while retaining the host's close control.
        const wasInert = !!library.inert; library.inert = true; // CHANGE
        ui.dialog?.container?.classList.add('trellis-project-confirmation-dialog'); // CHANGE
        document.addEventListener('keydown', keydown, true); document.addEventListener('focusin', containFocus, true); cancel.focus({ preventScroll: true }); // CHANGE
        return prompt; // CHANGE
    } // CHANGE
    async function showProjectRemoval(ui, state, project) { // NEW
        const key = project.diagramId || project.path; // CHANGE
        const prompt = projectConfirmation(ui, state, 'Project actions: ' + project.name, key + ':menu'), { panel, heading, description: status, error, controls } = prompt; // CHANGE
        status.textContent = 'Checking project membership…'; // CHANGE
        try { // NEW
            const eligibility = project.source === 'local' ? { canDelete: true } : project.departing ? { canLeave: true, successors: [] } : await root.trellisGardenLibrary.actions({ diagramId: project.diagramId }); // NEW
            if (!prompt.isActive()) return; // CHANGE
            const deleting = eligibility.canDelete, label = deleting ? 'Move to Trash' : project.departing ? 'Check departure' : 'Leave project'; // CHANGE
            heading.textContent = label + ': ' + project.name; // CHANGE
            status.textContent = deleting ? project.source === 'local' ? 'Move this local file to Trellis Trash on this device? Neighboring files and assets will stay in place.' : 'Move this project to Trash across your paired devices? You can restore it until you delete it permanently. Pending invitations will be cancelled when a project copy is reachable; restoring will require fresh invitations.' : project.departing ? 'Departure is waiting for a connected member to acknowledge. Keep Trellis running to finish.' : 'Leave this project across your paired devices? Other members keep the project. Your access and managed downloads will be removed after acknowledgement. Rejoining requires a new invitation.'; // NEW
            let successor; // NEW
            if (eligibility.requiresSuccessor || eligibility.requiresCoordinator) { // NEW
                const field = input(eligibility.requiresSuccessor ? 'New administrator' : 'New coordinator'), select = element('select'); select.setAttribute('aria-label', eligibility.requiresSuccessor ? 'New administrator' : 'New coordinator'); // NEW
                const empty = element('option', 'Choose a connected member'); empty.value = ''; select.append(empty); // NEW
                for (const user of eligibility.successors || []) { const option = element('option', user.name); option.value = user.id; select.append(option); } // NEW
                field.control.replaceWith(select); controls.before(field.wrap); successor = select; // CHANGE
            } // NEW
            const allowed = deleting || eligibility.canLeave; // NEW
            if (!allowed) error.textContent = eligibility.reason || 'Project membership could not be verified. Download the project and try again.'; // CHANGE
            const current = ui.getCurrentFile(), sameFile = current?.fileObject?.path && current.fileObject.path === project.path, dirty = sameFile && current.isModified(); // NEW
            async function perform(save) { // NEW
                if (!prompt.isActive() || prompt.busy) return; // CHANGE
                if (successor && !successor.value) { error.textContent = 'Choose a currently connected member.'; successor.focus(); return; } // NEW
                await prompt.run(async () => { // CHANGE
                    if (save && ui.getCurrentFile() === current && current.isModified()) await new Promise((resolve, reject) => current.save(false, resolve, reject)); // NEW
                    if (!prompt.isActive()) return; // CHANGE: a save may resolve after the prompt's authority was invalidated.
                    if (ui.getCurrentFile() !== current) { prompt.invalidate(); return; } // CHANGE: saving cannot authorize retirement after another document opens.
                    const payload = { ...lifecycleInput(project), confirm: true, successorUserId: successor?.value }; // NEW
                    const result = deleting ? await root.trellisGardenLibrary.trash(payload) : await root.trellisGardenLibrary.leave(payload); // NEW
                    if (!prompt.isActive()) return result; // CHANGE: an old identity's completion must not close the current editor.
                    if (result.complete !== false && sameFile && ui.getCurrentFile() === current) await ui.fileLoaded(null, true); // CHANGE: retain the mounted library when this prompt closes its editor.
                    return result; // CHANGE
                }); // CHANGE
            } // NEW
            if (allowed) { // NEW
                if (dirty) controls.prepend(button('Save and ' + (deleting ? 'move to Trash' : 'leave'), () => perform(true), 'danger'), button('Discard changes and ' + (deleting ? 'move to Trash' : 'leave'), () => perform(false), 'danger')); // CHANGE
                else controls.prepend(button(label, () => perform(false), project.departing ? 'neutral' : 'danger')); // CHANGE
            } // NEW
        } catch (failure) { if (prompt.isActive()) error.textContent = failure.message; } // CHANGE
    } // NEW
    function trashRow(ui, state, project) { // NEW
        const nodeKey = 'trash:' + (project.trashId || project.diagramId || project.path), token = JSON.stringify(project), cached = state.projectRowNodes.get(nodeKey); if (cached?.token === token) return cached.row; // CHANGE: keep unchanged Trash controls throughout section reloads.
        const row = element('div', null, 'trellis-home-garden'), info = element('div'), controls = element('div', null, 'trellis-project-controls'); // NEW
        info.append(element('strong', project.name), element('span', project.source === 'local' ? 'Local file · Trash on this device' : 'Trash · Your paired devices', 'trellis-home-muted')); // NEW
        if (project.reason) info.append(element('span', project.reason, 'trellis-home-muted')); // NEW
        const restore = button(project.restoring ? 'Retry restore' : 'Restore', async () => { // CHANGE
            async function run(filename) { // NEW
                try { await root.trellisGardenLibrary.restore({ ...lifecycleInput(project), filename }); await refreshProjects(ui, state, { only: ['trash', 'library'], diagramId: project.diagramId }); } // NEW
                catch (error) { state.projectsStatus.textContent = error.message; } // NEW
            } // NEW
            if (project.source === 'local') { // NEW
                const { panel, close } = projectActionPanel(state, 'Restore ' + project.name), filename = input('Filename'); filename.control.value = (project.restorePath || project.originalPath || project.name + '.drawio').replace(/^.*[\\/]/, ''); // CHANGE
                panel.append(filename.wrap, button('Restore', async () => { const value = filename.control.value; try { await root.trellisGardenLibrary.restore({ ...lifecycleInput(project), filename: value }); close(); await refreshProjects(ui, state, { only: ['trash', 'local'] }); } catch (error) { state.projectsStatus.textContent = error.message; } }, 'add'), button('Cancel', close, 'close')); filename.control.focus(); // CHANGE
            } else await run(); // NEW
        }, 'add'); // CHANGE
        restore.disabled = !!project.purging; // NEW
        restore.setAttribute('data-project-focus', project.trashId + ':restore'); // NEW
        const purge = button(project.purging ? 'Retry permanent deletion…' : 'Delete permanently…', () => { // CHANGE
            const prompt = projectConfirmation(ui, state, 'Delete permanently: ' + project.name, project.trashId + ':purge'); // CHANGE
            prompt.description.textContent = project.source === 'local' ? 'Permanently delete this retained local file? It cannot be restored from Trellis Trash.' : 'Permanently delete retained copies across your paired devices as they reconnect? This cannot be restored from Trellis Trash. Disconnected and exported copies cannot be guaranteed erased.'; // CHANGE
            prompt.controls.prepend(button('Delete permanently', () => prompt.run(() => root.trellisGardenLibrary.purge({ ...lifecycleInput(project), confirm: true })), 'danger')); // CHANGE
        }, 'danger'); // CHANGE
        purge.disabled = !!project.restoring || /Membership changed/.test(project.reason || ''); // NEW
        purge.setAttribute('data-project-focus', project.trashId + ':purge'); controls.append(restore, purge); // CHANGE
        if (project.source === 'library' && /Membership changed/.test(project.reason || '')) controls.append(button('Restore and leave…', async () => { // NEW
            try { // NEW
                await root.trellisGardenLibrary.restore(lifecycleInput(project)); await refreshProjects(ui, state, { only: project.source === 'local' ? ['trash', 'local'] : ['trash', 'library'], diagramId: project.diagramId }); await state.setProjectView('active'); // NEW
                const restored = (await root.trellisGardenLibrary.list()).gardens.find(p => p.diagramId === project.diagramId); // NEW
                if (restored) await showProjectRemoval(ui, state, restored); // NEW
            } catch (error) { state.projectsStatus.textContent = error.message; } // NEW
        }, 'add')); // CHANGE
        row.append(info, controls); state.projectRowNodes.set(nodeKey, { token, row }); return row; // CHANGE
    } // NEW
    function projectRow(ui, state, project, context = '') { // CHANGE
        const token = JSON.stringify([projectLoginKey(state.session), project, context]), nodeKey = project.diagramId || projectPathKey(project.path), cached = state.projectRowNodes.get(nodeKey); if (cached?.token === token) return cached.row; // CHANGE: contextual controls rebuild only when their garden data changes.
        const row = element('div', null, 'trellis-home-garden'), info = element('div'), controls = element('div', null, 'trellis-project-controls'); // CHANGE
        const key = project.diagramId || project.path; // NEW
        info.append(element('strong', project.name), element('span', project.localOnly ? 'Local only · Sharing off' : project.departing ? 'Leaving… Waiting for acknowledgement' : project.source === 'local' ? 'Local file' : project.available ? 'Downloaded' : 'Not downloaded', 'trellis-home-muted')); // CHANGE
        if (!project.available && project.reason) info.append(element('span', project.reason, 'trellis-home-muted')); // NEW
        if (!project.localOnly && (project.shared || project.classification === 'shared')) info.append(element('span', peopleText([project]) + ' · ' + (project.seeds == null ? 'Seeds: Unknown' : project.seeds + ' seeds') + (Number.isFinite(project.distanceKm) ? ' · ' + Math.round(project.distanceKm) + ' km nearest' : ''), 'trellis-home-muted')); // CHANGE
        if (project.metadataStale) info.append(element('span', 'Last-known project details' + (project.summaryUpdatedAt ? ' · ' + new Date(project.summaryUpdatedAt).toLocaleString() : ''), 'trellis-home-muted')); // NEW
        if (project.metadataError) info.append(element('span', project.metadataError, 'trellis-home-muted')); // NEW
        if (project.filenamePending || project.namingError) info.append(element('span', project.namingError || 'Filename update pending.', 'trellis-home-muted')); // NEW
        if (project.summary?.pendingInvitationCount) info.append(element('span', 'Invitation pending', 'trellis-home-muted')); // NEW
        const locations = element('details'); locations.setAttribute('data-project-details', key + ':locations'); // NEW
        locations.append(element('summary', 'Locations (' + (project.moduleCities || []).length + ' garden modules)'), element('span', (project.moduleCities || []).map(city => city.name).join(', ') || 'No resolved city coordinates', 'trellis-home-muted')); info.append(locations); // NEW
        const open = button(project.available ? 'Open' : 'Download & open', async () => { // CHANGE
            const browser = state.projectsRoot, identityId = state.session?.identityId; // NEW
            try { // NEW
                if (project.available) { // CHANGE
                    if (await openPath(ui, project.path, { isActive: () => browser.isConnected && identityId === state.session?.identityId })) { // NEW
                        if (project.starterPending) await initializeProject(ui, false); // NEW
                    } // NEW
                } // NEW
                else await downloadAndOpen(ui, project.diagramId, state); // NEW
            } catch (error) { if (state.projectsStatus?.isConnected) state.projectsStatus.textContent = error.message; else ui.handleError(error); } // NEW
        }, 'open'); // CHANGE
        open.setAttribute('data-project-focus', key + ':open'); open.disabled = !!project.departing || !project.available && project.source === 'local'; controls.append(open); // CHANGE
        if (project.localOnly) { row.append(info, controls); state.projectRowNodes.set(nodeKey, { token, row }); return row; } // CHANGE
        const more = element('details', null, 'trellis-project-menu'); more.setAttribute('data-project-details', key + ':more'); more.setAttribute('data-project-popover', 'actions'); // CHANGE
        const summary = element('summary', '⋯'); summary.setAttribute('aria-label', 'Actions for ' + project.name); summary.setAttribute('data-project-focus', key + ':menu'); more.append(summary); // CHANGE
        root.Trellis?.ui?.applyButtonStyle?.(summary, 'neutral', { compact: true, padding: '5px 12px' }); // CHANGE: retain native disclosure semantics with the shared neutral treatment.
        const menu = element('div', null, 'trellis-project-menu-items'); more.append(menu); // NEW
        more.addEventListener('toggle', () => { if (more.open && more.isConnected) { for (const other of state.projectsRoot.querySelectorAll('.trellis-project-menu[open]')) if (other !== more) other.open = false; menu.scrollIntoView?.({ block: 'nearest' }); } }); // NEW
        more.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); more.open = false; summary.focus({ preventScroll: true }); } }); // NEW
        menu.addEventListener('click', event => { if (event.target.closest('button')) more.open = false; }); // NEW
        if (project.source !== 'local') { // CHANGE
            if (project.canRename) menu.append(button('Rename', () => renameProject(ui, state, project), 'neutral')); // CHANGE
            if (project.canEditSuffix) menu.append(button('Edit my suffix', () => editSuffix(ui, state, project), 'neutral')); // CHANGE
            menu.append(button('Duplicate', async () => { try { const result = await root.trellisGardenLibrary.duplicate({ diagramId: project.diagramId }); await refreshProjects(ui, state, { only: ['library'], diagramId: result?.entry?.diagramId }); } catch (error) { state.projectsStatus.textContent = error.message; } }, 'add')); // CHANGE
        } // CHANGE
        const remove = button(project.departing ? 'Check departure…' : project.source === 'local' || project.userCount === 1 ? 'Move to Trash…' : 'Leave project…', () => showProjectRemoval(ui, state, project), project.departing ? 'neutral' : 'danger'); // CHANGE
        remove.setAttribute('data-project-focus', key + ':remove'); menu.append(remove); controls.append(more); // CHANGE
        menu.querySelectorAll('button').forEach(control => { if (project.departing && control !== remove) control.disabled = true; }); // NEW
        row.append(info, controls); state.projectRowNodes.set(nodeKey, { token, row }); return row; // CHANGE
    } // NEW
    async function renderIdentity(ui, state) {
        const panel = state.panel; if (!panel) return;
        const version = ++state.renderVersion, mode = state.mode; // NEW: guard responses that arrive after another render or form navigation.
        const data = await root.trellisIdentity.list();
        if (!panel.isConnected || panel !== state.panel || version !== state.renderVersion || mode !== state.mode) return; // CHANGE: do not erase fields while a user types or update a detached Home panel.
        if (projectLoginKey(state.session) !== projectLoginKey(data.session) || state.projectSnapshotKey !== (data.session?.identityId || 'signed-out')) { activateProjectSnapshot(state, data.session); state.referenceKey = null; } // CHANGE
        state.session = data.session; updateSplashStatuses(state); panel.replaceChildren(); // CHANGE
        updateProjectSections(state); // NEW: login forms can change identities without a separate status event.
        const status = element('div', null, 'trellis-home-muted'); status.setAttribute('aria-live', 'polite');
        const row = element('div', null, 'trellis-home-row'); panel.append(row, status);
        if (state.session && state.persistenceWarning) { const notice = element('p', state.persistenceWarning, 'trellis-home-muted'); notice.setAttribute('role', 'status'); panel.append(notice); } // NEW: separate from password-conflict and copy-reminder messages.
        function perform(action) { return async () => { try { await action(); } catch (error) { status.textContent = error.message; } }; }
        function back() { state.mode = 'idle'; state.showIdentity = false; state.reminder = null; renderIdentity(ui, state).catch(error => { status.textContent = error.message; }); } // CHANGE
        function reminder() { // CHANGE: render into the current panel after creation or password changes.
            status.append(element('span', 'Keep a record of your password. '), button('Copy login reminder', perform(async () => {
                const session = await root.trellisIdentity.getSession();
                await request({ action: 'clipboardAction', method: 'writeText', data: 'Username: ' + session.username + '\nPassword: ' + state.reminder + '\nDate: ' + new Date().toISOString() }); // CHANGE: copy only the requested login details.
                state.reminder = null; status.textContent = 'Login reminder copied. Paste it into your own secure record.';
            }), 'neutral')); // CHANGE: use the shared semantic button contract.
        }
        function form(title, fields, submit, label) {
            state.mode = title; row.replaceChildren(element('strong', title));
            const body = element('form', null, 'trellis-home-form'); panel.append(body);
            for (const field of fields) body.append(field.wrap);
            const run = perform(submit), go = button(label, event => { event.preventDefault(); run(); }, label === 'Log in' ? 'open' : 'add'); // CHANGE: use the shared semantic button contract.
            body.append(go, button('Cancel', back, 'close')); body.addEventListener('submit', event => { event.preventDefault(); run(); }); fields[0]?.control.focus(); // CHANGE: use the shared semantic button contract.
        }
        /** Use the existing field layout and native checkbox keyboard/label behavior. */ // NEW
        function keepLoggedInField() { // NEW
            const field = input('Keep me logged in on this device', 'checkbox'); field.control.checked = true; // NEW
            field.wrap.prepend(field.control); return field; // NEW
        } // NEW
        if (state.session) {
            row.append(element('strong', 'Logged in as ' + state.session.username), button('Log out', perform(async () => { await root.trellisIdentity.lock(); }), 'close'), button('Identity settings', () => { // CHANGE: use the shared semantic button contract.
                state.mode = 'settings'; row.replaceChildren(element('strong', 'Identity settings'), button('Back', back, 'close')); // CHANGE: use the shared semantic button contract.
                panel.append(button('Change password', () => {
                    const current = input('Current password', 'password'), next = input('New password', 'password');
                    form('Change password', [current, next], async () => { const password = next.control.value; const result = await root.trellisIdentity.changePassword({ currentPassword: current.control.value, password, resolveConflict: !!state.session.passwordConflict }); state.persistenceWarning = result?.persistenceWarning || null; current.control.value = ''; next.control.value = ''; state.mode = 'idle'; state.reminder = password; await renderIdentity(ui, state); }, state.session.passwordConflict ? 'Resolve password conflict' : 'Change password'); // CHANGE: retain a persistence failure notice after a local password change.
                }, 'neutral')); // CHANGE: use the shared semantic button contract.
                panel.append(button('Approve a device request', perform(async () => { const requestFile = await chooseJson(); if (!requestFile) return; const result = await root.trellisIdentity.approvePairRequest({ request: requestFile }); await saveJson(result.setup, 'trellis-device-setup.json'); status.textContent = 'Send the setup package to the requesting device.'; }), 'add')); // CHANGE: use the shared semantic button contract.
                panel.append(button('Manage devices', perform(async () => {
                    const devices = await root.trellisIdentity.getDevices();
                    for (const device of devices) {
                        const item = element('div', null, 'trellis-home-row');
                        item.append(element('span', device.name + ' · ' + device.kind), button('Remove device', perform(async () => { if (confirm('Remove this device from future identity synchronization? Downloaded files cannot be erased remotely.')) { await root.trellisIdentity.removeDevice({ deviceId: device.id }); back(); } }), 'danger')); // CHANGE: use the shared semantic button contract.
                        panel.append(item);
                    }
                }), 'open')); // CHANGE: use the shared semantic button contract.
            }, 'open')); // CHANGE: use the shared semantic button contract.
            if (state.session.passwordConflict) status.textContent = 'Password changes conflict. Resolve them in Identity settings before pairing or changing the library.';
        } else {
            row.append(button('Log in', () => {
                if (!data.identities.length) { status.textContent = 'Create an identity or connect an existing one first.'; return; }
                const choice = { wrap: element('label', null, 'trellis-home-field'), control: element('select') }; choice.wrap.append(element('span', 'Identity'), choice.control);
                for (const identity of data.identities) { const option = element('option', identity.username + ' · ' + identity.id.slice(0, 8)); option.value = identity.id; option.disabled = !!identity.error || identity.revoked; choice.control.append(option); }
                const password = input('Password', 'password');
                const keep = keepLoggedInField(); // NEW
                form('Log in', [choice, password, keep], async () => { const result = await root.trellisIdentity.unlock({ identityId: choice.control.value, password: password.control.value, keepLoggedIn: keep.control.checked }); state.persistenceWarning = result?.persistenceWarning || null; password.control.value = ''; back(); }, 'Log in'); // CHANGE
            }, 'open')); // CHANGE: use the shared semantic button contract.
            row.append(button('Create identity', () => {
                const username = input('Username'), password = input('Password', 'password');
                const keep = keepLoggedInField(); // NEW
                form('Create identity', [username, password, keep], async () => { const value = password.control.value; const result = await root.trellisIdentity.create({ username: username.control.value, password: value, keepLoggedIn: keep.control.checked }); state.persistenceWarning = result?.persistenceWarning || null; password.control.value = ''; state.mode = 'idle'; state.reminder = value; await renderIdentity(ui, state); }, 'Create identity'); // CHANGE
            }, 'add')); // CHANGE: use the shared semantic button contract.
            row.append(button('Connect existing identity', () => {
                state.mode = 'connect'; row.replaceChildren(element('strong', 'Connect existing identity'), button('Back', back, 'close')); // CHANGE: use the shared semantic button contract.
                panel.append(element('p', 'Export a request, approve it on an existing device, then import the returned setup package with the identity password.'));
                panel.append(button('Export device request', perform(async () => { const result = await root.trellisIdentity.createPairRequest({ deviceName: 'Desktop' }); await saveJson(result.request, 'trellis-device-request.json'); status.textContent = 'Send the request to an existing device for approval.'; }), 'neutral')); // CHANGE: use the shared semantic button contract.
                const password = input('Identity password', 'password'); // CHANGE: fields belong directly to the setup-import form.
                const keep = keepLoggedInField(); // NEW
                const connect = element('form', null, 'trellis-home-form'); panel.append(connect); connect.append(password.wrap, keep.wrap); // NEW: Enter uses the same import flow as the button.
                const importApproved = perform(async () => { const setup = await chooseJson(); if (!setup) return; const result = await root.trellisIdentity.importSetup({ setup, password: password.control.value }); const unlocked = await root.trellisIdentity.unlock({ identityId: result.identityId, password: password.control.value, keepLoggedIn: keep.control.checked }); state.persistenceWarning = unlocked?.persistenceWarning || null; password.control.value = ''; back(); }); // CHANGE
                connect.append(button('Import approved setup', event => { event.preventDefault(); importApproved(); }, 'add')); connect.addEventListener('submit', event => { event.preventDefault(); importApproved(); }); // CHANGE
            }, 'open')); // CHANGE: use the shared semantic button contract.
            row.append(element('span', 'Local projects are available below.', 'trellis-home-muted')); // CHANGE
        }
        if (state.accountHost) { // NEW
            state.accountHost.replaceChildren(); // NEW
            if (state.session) { // NEW
                const account = element('details', null, 'trellis-account-menu'), summary = element('summary', state.session.username), menu = element('div', null, 'trellis-project-menu-items'); // NEW
                account.setAttribute('data-project-popover', 'account'); summary.setAttribute('aria-label', 'Account: ' + state.session.username); root.Trellis?.ui?.applyButtonStyle?.(summary, 'neutral'); // NEW
                menu.append(...row.querySelectorAll('button')); row.replaceChildren(); account.append(summary, menu); state.accountHost.append(account); // NEW
                menu.addEventListener('click', event => { if (event.target.closest('button')) { account.open = false; panel.hidden = false; } }); // NEW
            } else state.accountHost.append(button('Login', () => { state.showIdentity = true; panel.hidden = false; if (data.identities.length) [...row.querySelectorAll('button')].find(control => control.textContent === 'Log in')?.click(); else row.querySelector('button')?.focus(); }, 'open')); // NEW
            panel.hidden = !state.showIdentity && state.mode === 'idle' && !state.reminder && !state.persistenceWarning && !state.session?.passwordConflict; // NEW
        } // NEW
        state.libraryIdentityId = state.session?.identityId; // CHANGE
        refreshProjects(ui, state, { reopen: true }); // CHANGE
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
