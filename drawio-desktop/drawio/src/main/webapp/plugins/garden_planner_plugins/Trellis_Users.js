/**
 * Draw.io Plugin: Trellis Users
 *
 * Low-security, diagram-local identity and permission workflow for Trellis.
 * This is not tamper-proof security; it is UI policy, attribution, and
 * accidental-edit prevention stored with the diagram XML.
 */
Draw.loadPlugin(function (ui) {
    const graph = ui && ui.editor && ui.editor.graph;
    if (!graph || graph.__trellisUsersInstalled) return;
    graph.__trellisUsersInstalled = true;

    const model = graph.getModel();

    const ATTR_STORE = "trellis_users_json";
    const ATTR_OWNER = "trellis_owner_user_id";
    const ATTR_ACCESS_USERS = "trellis_access_user_ids_json";
    const ATTR_ACCESS_GRANTS = "trellis_access_grants_json"; // NEW
    const ATTR_ACCESS_OPEN = "trellis_access_open";
    const ATTR_ROLE_USER = "trellis_role_user_id"; // NEW
    const ATTR_CREATED_BY = "createdByUserId";
    const ATTR_EDITED_BY = "lastEditedByUserId";
    const ATTR_ACTOR_NAME = "trellis_actor_name";
    const ATTR_ACTOR_ROLE = "trellis_actor_role";
    const ATTR_REMEMBER_DIAGRAM_ID = "trellis_users_diagram_id"; // NEW
    const ATTR_HISTORY_ID = "trellis_history_id"; // NEW

    const PROTECTED_ATTRS = new Set([ATTR_STORE, ATTR_OWNER, ATTR_ACCESS_USERS, ATTR_ACCESS_GRANTS, ATTR_ACCESS_OPEN, ATTR_ROLE_USER]); // CHANGE
    const ACCESS_PRESETS = ["viewer", "grower", "task", "manager"]; // NEW
    const CAP_CREATE_PLANTINGS = "create_plantings"; // NEW
    const CAP_MANAGE_OWN_PLANTINGS = "manage_own_plantings"; // NEW
    const CAP_MOVE_TASKS = "move_tasks"; // NEW
    const CAP_EDIT_TASK_DETAILS = "edit_task_details"; // NEW
    const CAP_MANAGE_SCOPE_CONTENT = "manage_scope_content"; // NEW
    const CAP_MANAGE_ACCESS = "manage_access"; // NEW
    const DOMAIN_CAPABILITIES = [CAP_CREATE_PLANTINGS, CAP_MANAGE_OWN_PLANTINGS, CAP_MOVE_TASKS, CAP_EDIT_TASK_DETAILS, CAP_MANAGE_SCOPE_CONTENT, CAP_MANAGE_ACCESS]; // NEW
    const PRESET_CAPABILITIES = { // NEW
        viewer: [], // NEW
        grower: [CAP_CREATE_PLANTINGS, CAP_MANAGE_OWN_PLANTINGS], // NEW
        task: [CAP_MOVE_TASKS, CAP_EDIT_TASK_DETAILS], // NEW
        manager: [CAP_CREATE_PLANTINGS, CAP_MANAGE_OWN_PLANTINGS, CAP_MOVE_TASKS, CAP_EDIT_TASK_DETAILS, CAP_MANAGE_SCOPE_CONTENT, CAP_MANAGE_ACCESS] // NEW
    }; // NEW
    const TASK_DETAIL_ATTRS = new Set(["label", "title", "notes", "card_note", "start", "end", "due", "assigned_day", "task_estimated_hours", "scheduler_dates_locked"]); // NEW
    const TASK_ASSIGNMENT_ATTRS = new Set(["task_assignee_role_ids_json"]); // NEW
    const USER_ID_PREFIX = "user_";
    const PIN_SALT_PREFIX = "salt_";
    const DIAGRAM_ID_PREFIX = "diagram_users_"; // NEW
    const INVITE_ID_PREFIX = "invite_"; // NEW
    const INVITE_CODE_SALT_PREFIX = "invite_salt_"; // NEW
    const INVITE_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000; // NEW
    const REMEMBER_STORAGE_PREFIX = "trellis_users_remembered_login_v1:"; // NEW
    const USERS_UI_LAYER_Z = 2000000000; // NEW
    const AUTH_OVERLAY_Z = 2147483000; // NEW
    const INTERNAL_FLAG = "__trellisUsersInternalChange";
    const REJECT_FLAG = "__trellisUsersRejecting";

    let currentUserId = "";
    let panel = null;
    let statusNode = null;
    let peopleFilterNode = null; // NEW
    let peopleSearchInput = null; // NEW
    let peopleTypeFilterSelect = null; // NEW
    let loginNameInput = null;
    let loginPinInput = null;
    let rosterNode = null;
    let accessNode = null;
    let resetPinUserId = ""; // NEW
    let peopleSearchText = ""; // NEW
    let peopleTypeFilter = "all"; // NEW
    let authOverlay = null; // NEW
    let authStatusNode = null; // NEW
    let toolbarButton = null; // NEW
    let accountMenu = null; // NEW
    let accountMenuOutsideHandler = null; // NEW
    let accountMenuKeyHandler = null; // NEW
    let graphAuthBlocked = false; // NEW
    let graphXmlLoading = 0; // NEW
    let selectionListenerInstalled = false;

    function nowMs() {
        return Date.now();
    }

    function metadataCell() {
        return (graph.getDefaultParent && graph.getDefaultParent()) || model.getRoot();
    }

    function ensureXmlValue(cell) {
        if (!cell) return null;
        const value = cell.value;
        if (value && typeof value === "object" && value.nodeType === 1) return value;
        const doc = mxUtils.createXmlDocument();
        const obj = doc.createElement("object");
        if (value != null && value !== "") obj.setAttribute("label", String(value));
        model.setValue(cell, obj);
        return obj;
    }

    function getAttr(cell, key) {
        return cell && typeof cell.getAttribute === "function" ? cell.getAttribute(key) : null;
    }

    function setAttr(cell, key, value) {
        if (!cell || !key) return;
        const node = ensureXmlValue(cell);
        if (!node) return;
        if (value == null || value === "") node.removeAttribute(key);
        else node.setAttribute(key, String(value));
        if (model && typeof model.setValue === "function") model.setValue(cell, node);
    }

    function parseJson(text, fallback) {
        try { return JSON.parse(text); } catch (e) { return fallback; }
    }

    function normalizeUser(user) {
        const source = user || {};
        const id = String(source.id || "").trim();
        const name = String(source.name || "").trim();
        if (!id || !name) return null;
        return {
            id,
            name,
            email: normalizeEmail(source.email || ""), // NEW
            pinSalt: String(source.pinSalt || ""),
            pinHash: String(source.pinHash || ""),
            admin: !!source.admin,
            disabled: !!source.disabled,
            createdAt: Number(source.createdAt) || nowMs()
        };
    }

    function normalizePendingUser(user) { // NEW
        const source = user || {}; // NEW
        const id = String(source.id || "").trim(); // NEW
        const email = normalizeEmail(source.email || ""); // NEW
        if (!id || !email) return null; // NEW
        return { // NEW
            id, // NEW
            email, // NEW
            invitedBy: String(source.invitedBy || ""), // NEW
            invitedAt: Number(source.invitedAt) || nowMs(), // NEW
            disabled: !!source.disabled // NEW
        }; // NEW
    } // NEW

    function normalizeInvite(invite) { // NEW
        const source = invite || {}; // NEW
        const id = String(source.id || "").trim(); // NEW
        const pendingUserId = String(source.pendingUserId || "").trim(); // NEW
        const email = normalizeEmail(source.email || ""); // NEW
        if (!id || !pendingUserId || !email) return null; // NEW
        return { // NEW
            id, // NEW
            pendingUserId, // NEW
            email, // NEW
            codeSalt: String(source.codeSalt || ""), // NEW
            codeHash: String(source.codeHash || ""), // NEW
            scopeCellIds: Array.isArray(source.scopeCellIds) ? Array.from(new Set(source.scopeCellIds.map(String).filter(Boolean))).sort() : [], // NEW
            scopeLabels: Array.isArray(source.scopeLabels) ? source.scopeLabels.map(String).filter(Boolean) : [], // NEW
            preset: normalizePreset(source.preset), // NEW
            capabilities: normalizeCapabilities(source.capabilities, source.preset), // NEW
            createdBy: String(source.createdBy || ""), // NEW
            createdAt: Number(source.createdAt) || nowMs(), // NEW
            expiresAt: Number(source.expiresAt) || (nowMs() + INVITE_EXPIRY_MS), // NEW
            status: String(source.status || "pending") // NEW
        }; // NEW
    } // NEW

    function normalizeStore(raw) {
        const source = raw && typeof raw === "object" ? raw : {};
        const users = Array.isArray(source.users) ? source.users.map(normalizeUser).filter(Boolean) : [];
        const pendingUsers = Array.isArray(source.pendingUsers) ? source.pendingUsers.map(normalizePendingUser).filter(Boolean) : []; // NEW
        const invites = Array.isArray(source.invites) ? source.invites.map(normalizeInvite).filter(Boolean) : []; // NEW
        return { schemaVersion: 1, usersEnabled: source.usersEnabled === true || source.usersEnabled === "1", users, pendingUsers, invites }; // CHANGE
    }

    function readStore() {
        return normalizeStore(parseJson(getAttr(metadataCell(), ATTR_STORE), null));
    }

    function writeStore(store) {
        graph[INTERNAL_FLAG] = true;
        model.beginUpdate();
        try {
            const normalized = normalizeStore(store);
            setAttr(metadataCell(), ATTR_STORE, JSON.stringify(normalized));
        } finally {
            model.endUpdate();
            graph[INTERNAL_FLAG] = false;
        }
        updateToolbarButton(); // NEW
        refreshPanel();
    }

    function stableHash(text) {
        let h = 2166136261;
        const s = String(text == null ? "" : text);
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
        }
        return (h >>> 0).toString(16);
    }

    function makeId(prefix) {
        return prefix + nowMs().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
    }

    function hashPin(pin, salt) {
        return stableHash(String(salt || "") + "::" + String(pin || ""));
    }

    function normalizeEmail(email) { // NEW
        return String(email || "").trim().toLowerCase(); // NEW
    } // NEW

    function validEmail(email) { // NEW
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email)); // NEW
    } // NEW

    function makeInviteCode() { // NEW
        return Math.random().toString(36).slice(2, 6).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase(); // NEW
    } // NEW

    function hashInviteCode(code, salt) { // NEW
        return stableHash(String(salt || "") + "::invite::" + String(code || "").trim().toUpperCase()); // NEW
    } // NEW

    function userById(id) {
        return readStore().users.find(function (user) { return user.id === id && !user.disabled; }) || null;
    }

    function storedUserById(id) { // NEW
        return readStore().users.find(function (user) { return user.id === id; }) || null; // NEW
    } // NEW

    function userByName(name) {
        const key = String(name || "").trim().toLowerCase();
        if (!key) return null;
        return readStore().users.find(function (user) { return !user.disabled && user.name.toLowerCase() === key; }) || null;
    }

    function publicUser(user) {
        if (!user) return null;
        return { id: user.id, name: user.name, email: user.email || "", admin: !!user.admin, disabled: !!user.disabled }; // CHANGE
    }

    function listUsers() {
        return readStore().users.map(publicUser);
    }

    function publicInvite(invite) { // NEW
        if (!invite) return null; // NEW
        const expired = invite.status === "pending" && nowMs() > Number(invite.expiresAt || 0); // NEW
        return { // NEW
            id: invite.id, // NEW
            email: invite.email, // NEW
            pendingUserId: invite.pendingUserId, // NEW
            scopeCellIds: (invite.scopeCellIds || []).slice(), // NEW
            scopeLabels: (invite.scopeLabels || []).slice(), // NEW
            preset: normalizePreset(invite.preset), // NEW
            capabilities: normalizeCapabilities(invite.capabilities, invite.preset), // NEW
            createdBy: invite.createdBy || "", // NEW
            createdAt: invite.createdAt || 0, // NEW
            expiresAt: invite.expiresAt || 0, // NEW
            status: expired ? "expired" : invite.status // NEW
        }; // NEW
    } // NEW

    function normalizePreset(value) { // NEW
        const preset = String(value || "viewer").trim().toLowerCase(); // NEW
        return ACCESS_PRESETS.indexOf(preset) >= 0 ? preset : "viewer"; // NEW
    } // NEW

    function normalizeCapabilities(capabilities, preset) { // NEW
        const base = Array.isArray(capabilities) ? capabilities : PRESET_CAPABILITIES[normalizePreset(preset)]; // NEW
        const allowed = new Set(DOMAIN_CAPABILITIES); // NEW
        return Array.from(new Set((base || []).map(String).filter(function (capability) { return allowed.has(capability); }))).sort(); // NEW
    } // NEW

    function normalizeGrant(grant) { // NEW
        const source = grant || {}; // NEW
        const userId = String(source.userId || source.id || "").trim(); // NEW
        if (!userId) return null; // NEW
        const preset = normalizePreset(source.preset); // NEW
        return { userId, preset, capabilities: normalizeCapabilities(source.capabilities, preset) }; // NEW
    } // NEW

    function grantsFromAttr(cell) { // NEW
        const parsed = parseJson(getAttr(cell, ATTR_ACCESS_GRANTS), []); // NEW
        if (!Array.isArray(parsed)) return []; // NEW
        const byUserId = new Map(); // NEW
        parsed.map(normalizeGrant).filter(Boolean).forEach(function (grant) { byUserId.set(grant.userId, grant); }); // NEW
        return Array.from(byUserId.values()).sort(function (left, right) { return left.userId.localeCompare(right.userId); }); // NEW
    } // NEW

    function setGrantsAttr(cell, grants) { // NEW
        const normalized = (grants || []).map(normalizeGrant).filter(Boolean).sort(function (left, right) { return left.userId.localeCompare(right.userId); }); // NEW
        setAttr(cell, ATTR_ACCESS_GRANTS, normalized.length ? JSON.stringify(normalized) : ""); // NEW
    } // NEW

    function publicGrant(grant) { // NEW
        const normalized = normalizeGrant(grant); // NEW
        return normalized ? { userId: normalized.userId, preset: normalized.preset, capabilities: normalized.capabilities.slice() } : null; // NEW
    } // NEW

    function getScopeGrants(cell) { // NEW
        return grantsFromAttr(cell).map(publicGrant).filter(Boolean); // NEW
    } // NEW

    function storedOrPendingUserById(id) { // NEW
        const store = readStore(); // NEW
        return store.users.find(function (user) { return user.id === id && !user.disabled; }) || store.pendingUsers.find(function (user) { return user.id === id && !user.disabled; }) || null; // NEW
    } // NEW

    function listPendingInvites() { // NEW
        const store = expireInvites(readStore()); // NEW
        return store.invites.filter(function (invite) { return invite.status === "pending" && canManageInvite(invite); }).map(publicInvite); // CHANGE
    } // NEW

    function localStore() { // NEW
        try { return window && window.localStorage ? window.localStorage : null; } catch (e) { return null; } // NEW
    } // NEW

    function usersDebugEnabled() { // NEW
        const store = localStore(); // NEW
        const win = typeof window !== "undefined" ? window : null; // NEW
        return !!(win && win.__TRELLIS_USERS_DEBUG__ === true) || !!(store && store.getItem("trellis_users_debug") === "1"); // NEW
    } // NEW

    function consoleGroup(label, payload, body) { // NEW
        if (!usersDebugEnabled() || typeof console === "undefined") return; // NEW
        try { // NEW
            if (console.groupCollapsed) console.groupCollapsed(label, payload || ""); // NEW
            else if (console.log) console.log(label, payload || ""); // NEW
            if (body) body(); // NEW
        } catch (e) { // NEW
            try { if (console.log) console.log("[TrellisUsers] debug logging failed", e); } catch (_) { } // NEW
        } finally { // NEW
            try { if (console.groupEnd) console.groupEnd(); } catch (_) { } // NEW
        } // NEW
    } // NEW

    function debugFlagSnapshot() { // NEW
        const store = localStore(); // NEW
        const win = typeof window !== "undefined" ? window : null; // NEW
        return { // NEW
            storage: { // NEW
                trellis_users_debug: store ? store.getItem("trellis_users_debug") : null, // NEW
                trellis_bed_fit_debug: store ? store.getItem("trellis_bed_fit_debug") : null // NEW
            }, // NEW
            windowFlags: { // NEW
                users: !!(win && win.__TRELLIS_USERS_DEBUG__ === true), // NEW
                bedFit: !!(win && win.__TRELLIS_BED_FIT_DEBUG__ === true) // NEW
            } // NEW
        }; // NEW
    } // NEW

    function usersDebugStatus() { // NEW
        const win = typeof window !== "undefined" ? window : null; // NEW
        const user = currentUser(); // NEW
        const flags = debugFlagSnapshot(); // NEW
        return { // NEW
            plugin: "Trellis_Users.js", // NEW
            loaded: true, // NEW
            debugEnabled: usersDebugEnabled(), // NEW
            url: win && win.location ? String(win.location.href || "") : "", // NEW
            origin: win && win.location ? String(win.location.origin || "") : "", // NEW
            storage: flags.storage, // NEW
            windowFlags: flags.windowFlags, // NEW
            usersApiPresent: !!(win && win.Trellis && win.Trellis.users), // NEW
            loggedIn: isLoggedIn(), // NEW
            currentUser: user ? { id: user.id, name: user.name, email: user.email, admin: !!user.admin } : null // NEW
        }; // NEW
    } // NEW

    function debugProbeSnapshot() { // NEW
        const win = typeof window !== "undefined" ? window : null; // NEW
        const debug = win && win.Trellis && win.Trellis.debug; // NEW
        const flags = debugFlagSnapshot(); // NEW
        return { // NEW
            url: win && win.location ? String(win.location.href || "") : "", // NEW
            origin: win && win.location ? String(win.location.origin || "") : "", // NEW
            usersPluginLoaded: !!(win && win.__TRELLIS_USERS_PLUGIN_LOADED), // NEW
            bedFitPluginLoaded: !!(win && win.__TRELLIS_BED_FIT_PLUGIN_LOADED), // NEW
            storage: flags.storage, // NEW
            windowFlags: flags.windowFlags, // NEW
            usersApiPresent: !!(win && win.Trellis && win.Trellis.users), // NEW
            tilerFitApiPresent: !!(win && win.USL && win.USL.tiler && typeof win.USL.tiler.retileAndFitToContainingBed === "function"), // NEW
            usersStatus: debug && typeof debug.usersStatus === "function" ? debug.usersStatus() : null, // NEW
            bedFitStatus: debug && typeof debug.bedFitStatus === "function" ? debug.bedFitStatus() : null // NEW
        }; // NEW
    } // NEW

    function debugProbe() { // NEW
        const snapshot = debugProbeSnapshot(); // NEW
        if (typeof console !== "undefined") { // NEW
            try { // NEW
                if (console.groupCollapsed) console.groupCollapsed("[TrellisDebug] probe"); // NEW
                else if (console.log) console.log("[TrellisDebug] probe"); // NEW
                if (console.log) console.log(snapshot); // NEW
            } finally { // NEW
                try { if (console.groupEnd) console.groupEnd(); } catch (_) { } // NEW
            } // NEW
        } // NEW
        return snapshot; // NEW
    } // NEW

    function installTrellisDebugSurface() { // NEW
        const win = typeof window !== "undefined" ? window : null; // NEW
        if (!win) return null; // NEW
        win.Trellis = win.Trellis || {}; // NEW
        const debug = win.Trellis.debug = win.Trellis.debug || {}; // NEW
        win.__TRELLIS_USERS_PLUGIN_LOADED = true; // NEW
        debug.usersStatus = usersDebugStatus; // NEW
        debug.enable = function () { // NEW
            const store = localStore(); // NEW
            win.__TRELLIS_USERS_DEBUG__ = true; // NEW
            win.__TRELLIS_BED_FIT_DEBUG__ = true; // NEW
            if (store) { store.setItem("trellis_users_debug", "1"); store.setItem("trellis_bed_fit_debug", "1"); } // NEW
            return debugProbeSnapshot(); // NEW
        }; // NEW
        debug.disable = function () { // NEW
            const store = localStore(); // NEW
            win.__TRELLIS_USERS_DEBUG__ = false; // NEW
            win.__TRELLIS_BED_FIT_DEBUG__ = false; // NEW
            if (store) { store.removeItem("trellis_users_debug"); store.removeItem("trellis_bed_fit_debug"); } // NEW
            return debugProbeSnapshot(); // NEW
        }; // NEW
        debug.probe = debugProbe; // NEW
        return debug; // NEW
    } // NEW

    function getDiagramLoginKey(create) { // NEW
        const cell = metadataCell(); // NEW
        let key = getAttr(cell, ATTR_REMEMBER_DIAGRAM_ID); // NEW
        if (!key && !create) key = getAttr(cell, ATTR_HISTORY_ID); // NEW
        if (!key && create) { // NEW
            key = makeId(DIAGRAM_ID_PREFIX); // NEW
            setAttr(cell, ATTR_REMEMBER_DIAGRAM_ID, key); // NEW
        } // NEW
        return key || ""; // NEW
    } // NEW

    function rememberStorageKey(create) { // NEW
        const diagramKey = getDiagramLoginKey(create); // NEW
        return diagramKey ? REMEMBER_STORAGE_PREFIX + diagramKey : ""; // NEW
    } // NEW

    function rememberLogin(userId, enabled) { // NEW
        const storage = localStore(); // NEW
        if (!storage) return { ok: false, reason: "Local login memory is unavailable." }; // NEW
        const key = rememberStorageKey(!!enabled); // NEW
        if (!key) return { ok: false, reason: "Diagram login identity is unavailable." }; // NEW
        if (enabled && userById(userId)) storage.setItem(key, String(userId)); // NEW
        else storage.removeItem(key); // NEW
        return { ok: true }; // NEW
    } // NEW

    function forgetRememberedLogin() { // NEW
        const storage = localStore(); // NEW
        const key = rememberStorageKey(false); // NEW
        if (storage && key) storage.removeItem(key); // NEW
        return { ok: true }; // NEW
    } // NEW

    function restoreRememberedLogin() { // NEW
        if (!isEnabled()) return { ok: false, reason: "Users are not enabled." }; // NEW
        const storage = localStore(); // NEW
        const key = rememberStorageKey(false); // NEW
        const rememberedId = storage && key ? storage.getItem(key) : ""; // NEW
        const user = rememberedId ? userById(rememberedId) : null; // NEW
        if (!user) { // NEW
            currentUserId = ""; // NEW
            if (storage && key && rememberedId) storage.removeItem(key); // NEW
            return { ok: false, reason: "No remembered active user for this diagram." }; // NEW
        } // NEW
        currentUserId = user.id; // NEW
        updateToolbarButton(); // NEW
        return { ok: true, user: publicUser(user) }; // NEW
    } // NEW

    function isEnabled() { // NEW
        return !!readStore().usersEnabled; // NEW
    } // NEW

    function currentUser() {
        return userById(currentUserId);
    }

    function isLoggedIn() {
        return !!currentUser();
    }

    function isAdmin() {
        const user = currentUser();
        return !!(user && user.admin);
    }

    function canBootstrapAdmin() {
        const store = readStore(); // CHANGE
        return store.usersEnabled && store.users.length === 0; // CHANGE
    }

    function activeAdmins(store) { // NEW
        return (store || readStore()).users.filter(function (user) { return user.admin && !user.disabled; }); // NEW
    } // NEW

    function expireInvites(store) { // NEW
        const source = normalizeStore(store); // NEW
        let changed = false; // NEW
        source.invites.forEach(function (invite) { // NEW
            if (invite.status === "pending" && nowMs() > invite.expiresAt) { // NEW
                invite.status = "expired"; // NEW
                removeGrantsForUser(invite.pendingUserId, invite.scopeCellIds); // NEW
                changed = true; // NEW
            } // NEW
        }); // NEW
        if (changed) writeStore(source); // NEW
        return source; // NEW
    } // NEW

    function emailExists(store, email) { // NEW
        const clean = normalizeEmail(email); // NEW
        return store.users.some(function (user) { return normalizeEmail(user.email) === clean; }) || // NEW
            store.pendingUsers.some(function (user) { return normalizeEmail(user.email) === clean; }) || // NEW
            store.invites.some(function (invite) { return invite.status === "pending" && normalizeEmail(invite.email) === clean; }); // NEW
    } // NEW

    function createUser(name, pin, admin) {
        const cleanName = String(name || "").trim();
        const cleanPin = String(pin || "");
        if (!cleanName || !cleanPin) return { ok: false, reason: "Enter a name and PIN." };
        const store = readStore();
        if (!store.usersEnabled) return { ok: false, reason: "Enable users before adding accounts." }; // NEW
        const bootstrap = store.users.length === 0;
        if (!bootstrap && !isAdmin()) return { ok: false, reason: "Only admins can create users." };
        if (store.users.some(function (user) { return user.name.toLowerCase() === cleanName.toLowerCase(); })) { // CHANGE
            return { ok: false, reason: "A user with that name already exists." };
        }
        const salt = makeId(PIN_SALT_PREFIX);
        const user = {
            id: makeId(USER_ID_PREFIX),
            name: cleanName,
            pinSalt: salt,
            pinHash: hashPin(cleanPin, salt),
            admin: bootstrap ? true : !!admin,
            disabled: false,
            createdAt: nowMs()
        };
        store.users.push(user);
        writeStore(store);
        return { ok: true, user: publicUser(user) };
    }

    function enableUsers(name, pin) { // NEW
        const store = readStore(); // NEW
        if (store.usersEnabled) return { ok: true, enabled: true }; // NEW
        const cleanName = String(name || "").trim(); // NEW
        const cleanPin = String(pin || ""); // NEW
        if (!cleanName || !cleanPin) return { ok: false, reason: "Enter a name and PIN to create the first admin." }; // NEW
        const salt = makeId(PIN_SALT_PREFIX); // NEW
        const user = { id: makeId(USER_ID_PREFIX), name: cleanName, pinSalt: salt, pinHash: hashPin(cleanPin, salt), admin: true, disabled: false, createdAt: nowMs() }; // NEW
        store.usersEnabled = true; // NEW
        store.users = [user]; // NEW
        currentUserId = user.id; // NEW
        writeStore(store); // NEW
        showStatus("Users enabled. Created first admin: " + user.name); // NEW
        closeAuthOverlay(true); // NEW
        updateToolbarButton(); // NEW
        return { ok: true, user: publicUser(user) }; // NEW
    } // NEW

    function login(name, pin) {
        if (!isEnabled()) return { ok: false, reason: "Users are not enabled for this diagram." }; // NEW
        if (canBootstrapAdmin()) {
            const created = createUser(name, pin, true);
            if (!created.ok) return created;
            currentUserId = created.user.id;
            showStatus("Created first admin: " + created.user.name);
            closeAuthOverlay(true); // NEW
            refreshPanel();
            updateToolbarButton(); // NEW
            return { ok: true, user: created.user };
        }
        const user = userByName(name);
        if (!user || user.pinHash !== hashPin(pin, user.pinSalt)) return { ok: false, reason: "Unknown user or incorrect PIN." };
        currentUserId = user.id;
        showStatus("Logged in as " + user.name);
        closeAuthOverlay(true); // NEW
        refreshPanel();
        updateToolbarButton(); // NEW
        return { ok: true, user: publicUser(user) };
    }

    function resetUserPin(userId, pin) { // NEW
        if (!isAdmin()) return { ok: false, reason: "Only admins can reset PINs." }; // NEW
        const cleanPin = String(pin || ""); // NEW
        if (!cleanPin) return { ok: false, reason: "Enter a new PIN." }; // NEW
        const store = readStore(); // NEW
        const user = store.users.find(function (entry) { return entry.id === userId; }); // NEW
        if (!user) return { ok: false, reason: "Unknown user." }; // NEW
        const salt = makeId(PIN_SALT_PREFIX); // NEW
        user.pinSalt = salt; // NEW
        user.pinHash = hashPin(cleanPin, salt); // NEW
        writeStore(store); // NEW
        return { ok: true }; // NEW
    } // NEW

    function setUserAdmin(userId, admin) { // NEW
        if (!isAdmin()) return { ok: false, reason: "Only admins can change admin status." }; // NEW
        const store = readStore(); // NEW
        const user = store.users.find(function (entry) { return entry.id === userId; }); // NEW
        if (!user) return { ok: false, reason: "Unknown user." }; // NEW
        if (user.admin && !admin && activeAdmins(store).length <= 1) return { ok: false, reason: "At least one active admin is required." }; // NEW
        user.admin = !!admin; // NEW
        writeStore(store); // NEW
        return { ok: true }; // NEW
    } // NEW

    function setUserDisabled(userId, disabled) { // NEW
        if (!isAdmin()) return { ok: false, reason: "Only admins can disable users." }; // NEW
        const store = readStore(); // NEW
        const user = store.users.find(function (entry) { return entry.id === userId; }); // NEW
        if (!user) return { ok: false, reason: "Unknown user." }; // NEW
        if (user.admin && disabled && activeAdmins(store).length <= 1) return { ok: false, reason: "At least one active admin is required." }; // NEW
        user.disabled = !!disabled; // NEW
        if (user.id === currentUserId && user.disabled) { currentUserId = ""; forgetRememberedLogin(); } // CHANGE
        writeStore(store); // NEW
        return { ok: true }; // NEW
    } // NEW

    function logout() {
        currentUserId = "";
        forgetRememberedLogin(); // NEW
        closeAccountMenu(); // NEW
        showStatus("Logged out.");
        refreshPanel();
        updateToolbarButton(); // NEW
        applyAuthGateIfNeeded("Logged out."); // NEW
    }

    function userIdsFromAttr(cell) {
        const parsed = parseJson(getAttr(cell, ATTR_ACCESS_USERS), []);
        return Array.isArray(parsed) ? Array.from(new Set(parsed.map(String).filter(Boolean))).sort() : [];
    }

    function setUserIdsAttr(cell, ids) {
        const next = Array.from(new Set((ids || []).map(String).filter(Boolean))).sort();
        setAttr(cell, ATTR_ACCESS_USERS, next.length ? JSON.stringify(next) : "");
    }

    function traverseCells(cell, visit) { // NEW
        if (!cell || !visit) return; // NEW
        visit(cell); // NEW
        const count = model.getChildCount ? model.getChildCount(cell) : ((cell.children || []).length); // NEW
        for (let i = 0; i < count; i++) traverseCells(model.getChildAt ? model.getChildAt(cell, i) : cell.children[i], visit); // NEW
    } // NEW

    function getStyle(cell) { // NEW
        return cell && typeof cell.getStyle === "function" ? (cell.getStyle() || "") : ((cell && cell.style) || ""); // NEW
    } // NEW

    function styleFlag(cell, key) { // NEW
        return new RegExp("(?:^|;)" + key + "=1(?:;|$)").test(getStyle(cell)); // NEW
    } // NEW

    function isModuleCell(cell) { // NEW
        return !!cell && (styleFlag(cell, "module") || getAttr(cell, "garden_module") === "1" || getAttr(cell, "team_module") === "1"); // NEW
    } // NEW

    function isGardenBed(cell) { // NEW
        return !!cell && (getAttr(cell, "garden_bed") === "1" || getAttr(cell, "gardenBed") === "1" || getAttr(cell, "is_garden_bed") === "1"); // NEW
    } // NEW

    function isTilerGroup(cell) { // NEW
        return !!cell && (getAttr(cell, "tiler_group") === "1" || styleFlag(cell, "tiler_group")); // NEW
    } // NEW

    function isTaskBoard(cell) { // NEW
        const key = String(getAttr(cell, "board_key") || ""); // NEW
        return key === "KANBAN_BOARD" || key === "MAIN_KANBAN_BOARD"; // NEW
    } // NEW

    function isTaskCard(cell) { // NEW
        return !!cell && (getAttr(cell, "kanban_card") === "1" || styleFlag(cell, "kanban_card")); // NEW
    } // NEW

    function isRoleCard(cell) { // NEW
        return !!cell && styleFlag(cell, "role_card"); // NEW
    } // NEW

    function hasLink(cell, id) { // NEW
        const target = String(id || ""); // NEW
        if (!cell || !target) return false; // NEW
        return String(getAttr(cell, "linkedTo") || "").split(",").map(function (part) { return part.trim(); }).filter(Boolean).indexOf(target) >= 0; // NEW
    } // NEW

    function nearestAncestorMatching(cell, predicate) { // NEW
        let cursor = cell; // NEW
        while (cursor) { // NEW
            if (predicate(cursor)) return cursor; // NEW
            cursor = parentOf(cursor); // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function nearestPlanting(cell) { return nearestAncestorMatching(cell, isTilerGroup); } // NEW

    function nearestGardenBed(cell) { return nearestAncestorMatching(cell, isGardenBed); } // NEW

    function nearestTaskBoard(cell) { return nearestAncestorMatching(cell, isTaskBoard); } // NEW

    function directCapabilitiesForCell(cell, userId) { // NEW
        const caps = new Set(); // NEW
        let cursor = cell; // NEW
        while (cursor) { // NEW
            grantsFromAttr(cursor).forEach(function (grant) { // NEW
                if (grant.userId === userId) grant.capabilities.forEach(function (capability) { caps.add(capability); }); // NEW
            }); // NEW
            cursor = parentOf(cursor); // NEW
        } // NEW
        return caps; // NEW
    } // NEW

    function roleCardsForUser(userId) { // NEW
        const matches = []; // NEW
        const root = model.getRoot && model.getRoot(); // NEW
        traverseCells(root, function (cell) { if (isRoleCard(cell) && getAttr(cell, ATTR_ROLE_USER) === userId) matches.push(cell); }); // NEW
        return matches; // NEW
    } // NEW

    function roleLinkedBoardGrantsForUser(userId, targetCell) { // NEW
        const roleCards = roleCardsForUser(userId); // NEW
        if (roleCards.length !== 1) return []; // NEW
        const roleCard = roleCards[0]; // NEW
        const boards = []; // NEW
        const root = model.getRoot && model.getRoot(); // NEW
        traverseCells(root, function (cell) { // NEW
            if (isTaskBoard(cell) && hasLink(cell, roleCard.id || (roleCard.getId && roleCard.getId())) && hasLink(roleCard, cell.id || (cell.getId && cell.getId()))) boards.push(cell); // NEW
        }); // NEW
        if (!targetCell) return boards; // NEW
        return boards.filter(function (board) { // NEW
            let cursor = targetCell; // NEW
            while (cursor) { if (cursor === board) return true; cursor = parentOf(cursor); } // NEW
            return false; // NEW
        }); // NEW
    } // NEW

    function effectiveCapabilitiesForCell(cell, userId) { // NEW
        const user = userId ? userById(userId) : currentUser(); // NEW
        const caps = new Set(); // NEW
        if (!isEnabled()) DOMAIN_CAPABILITIES.forEach(function (capability) { caps.add(capability); }); // NEW
        if (user && user.admin) DOMAIN_CAPABILITIES.forEach(function (capability) { caps.add(capability); }); // NEW
        if (user && isOwnerOfNearestAccessScope(cell, user.id)) DOMAIN_CAPABILITIES.forEach(function (capability) { caps.add(capability); }); // CHANGE
        if (user) directCapabilitiesForCell(cell, user.id).forEach(function (capability) { caps.add(capability); }); // NEW
        if (user && roleLinkedBoardGrantsForUser(user.id, cell).length) PRESET_CAPABILITIES.task.forEach(function (capability) { caps.add(capability); }); // NEW
        return Array.from(caps).sort(); // NEW
    } // NEW

    function hasCapability(cell, capability) { // NEW
        const user = currentUser(); // NEW
        if (!isEnabled()) return true; // NEW
        if (!user || !cell) return false; // NEW
        if (user.admin || isOwnerOfNearestAccessScope(cell, user.id)) return true; // CHANGE
        return effectiveCapabilitiesForCell(cell, user.id).indexOf(capability) >= 0; // NEW
    } // NEW

    function grantUserToScopes(userId, scopeCellIds, grantOptions) { // CHANGE
        const source = grantOptions || {}; // NEW
        (scopeCellIds || []).forEach(function (cellId) { // NEW
            const cell = model.getCell && model.getCell(cellId); // NEW
            if (!cell) return; // NEW
            setScopeGrantInternal(cell, { userId, preset: source.preset || "viewer", capabilities: source.capabilities }); // CHANGE
        }); // NEW
    } // NEW

    function removeGrantsForUser(userId, scopeCellIds) { // NEW
        graph[INTERNAL_FLAG] = true; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            (scopeCellIds || []).forEach(function (cellId) { // NEW
                const cell = model.getCell && model.getCell(cellId); // NEW
                if (!cell) return; // NEW
                setGrantsAttr(cell, grantsFromAttr(cell).filter(function (grant) { return grant.userId !== userId; })); // CHANGE
            }); // NEW
        } finally { // NEW
            model.endUpdate(); // NEW
            graph[INTERNAL_FLAG] = false; // NEW
        } // NEW
    } // NEW

    function writeStoreAndGrant(store, userId, scopeCellIds, grantOptions) { // CHANGE
        graph[INTERNAL_FLAG] = true; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            grantUserToScopes(userId, scopeCellIds, grantOptions); // CHANGE
            setAttr(metadataCell(), ATTR_STORE, JSON.stringify(normalizeStore(store))); // NEW
        } finally { // NEW
            model.endUpdate(); // NEW
            graph[INTERNAL_FLAG] = false; // NEW
        } // NEW
        refreshPanel(); // NEW
    } // NEW

    function setScopeGrantInternal(cell, grant) { // NEW
        const normalized = normalizeGrant(grant); // NEW
        if (!cell || !normalized) return false; // NEW
        const grants = grantsFromAttr(cell).filter(function (entry) { return entry.userId !== normalized.userId; }); // NEW
        grants.push(normalized); // NEW
        setGrantsAttr(cell, grants); // NEW
        return true; // NEW
    } // NEW

    function setScopeGrant(cell, grant) { // NEW
        if (!cell || !canManageAccess(cell)) return { ok: false, reason: "You cannot manage access for this cell." }; // NEW
        const normalized = normalizeGrant(grant); // NEW
        if (!normalized || !storedOrPendingUserById(normalized.userId)) return { ok: false, reason: "Unknown user." }; // NEW
        graph[INTERNAL_FLAG] = true; // NEW
        model.beginUpdate(); // NEW
        try { setScopeGrantInternal(cell, normalized); } finally { model.endUpdate(); graph[INTERNAL_FLAG] = false; } // NEW
        refreshPanel(); // NEW
        return { ok: true, grant: publicGrant(normalized) }; // NEW
    } // NEW

    function removeScopeGrant(cell, userId) { // NEW
        if (!cell || !canManageAccess(cell)) return { ok: false, reason: "You cannot manage access for this cell." }; // NEW
        graph[INTERNAL_FLAG] = true; // NEW
        model.beginUpdate(); // NEW
        try { setGrantsAttr(cell, grantsFromAttr(cell).filter(function (grant) { return grant.userId !== userId; })); } finally { model.endUpdate(); graph[INTERNAL_FLAG] = false; } // NEW
        refreshPanel(); // NEW
        return { ok: true }; // NEW
    } // NEW

    function parentOf(cell) {
        return cell && model.getParent ? model.getParent(cell) : null;
    }

    function nearestOwnedAncestor(cell) {
        let cursor = cell;
        while (cursor) {
            const owner = getAttr(cursor, ATTR_OWNER);
            if (owner) return { cell: cursor, ownerUserId: owner };
            cursor = parentOf(cursor);
        }
        return null;
    }

    function nearestAccessGrant(cell, userId) {
        let cursor = cell;
        while (cursor) {
            const grant = userId ? grantsFromAttr(cursor).find(function (entry) { return entry.userId === userId; }) : null; // CHANGE
            if (grant) return { cell: cursor, grant }; // CHANGE
            cursor = parentOf(cursor);
        }
        return null;
    }

    function isOwnerOfNearestScope(cell, userId) {
        const owner = nearestOwnedAncestor(cell);
        return !!(owner && owner.ownerUserId === userId);
    }

    function isOwnerOfNearestAccessScope(cell, userId) { // NEW
        const owner = nearestOwnedAncestor(cell); // NEW
        return !!(owner && owner.ownerUserId === userId && !isTilerGroup(owner.cell)); // NEW
    } // NEW

    function canEditCell(cell) {
        if (!isEnabled()) return true; // NEW
        const user = currentUser();
        if (!user || !cell || cell === model.getRoot()) return false;
        if (user.admin) return true;
        if (isOwnerOfNearestScope(cell, user.id)) return true;
        if (isTaskCard(cell) || nearestTaskBoard(cell)) return hasCapability(cell, CAP_EDIT_TASK_DETAILS); // CHANGE
        const planting = nearestPlanting(cell); // NEW
        if (planting) return canManagePlanting(planting); // NEW
        return hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT); // CHANGE
    }

    function canAddCell(parent) {
        if (!isEnabled()) return true; // NEW
        const user = currentUser();
        if (!user) return false;
        if (user.admin) return true;
        if (!parent || parent === model.getRoot() || parent === graph.getDefaultParent()) return true;
        return isOwnerOfNearestScope(parent, user.id) || hasCapability(parent, CAP_MANAGE_SCOPE_CONTENT); // CHANGE
    }

    function canDeleteCell(cell) {
        if (!isEnabled()) return true; // NEW
        const user = currentUser();
        if (!user || !cell || cell === model.getRoot() || cell === graph.getDefaultParent()) return false;
        if (user.admin) return true;
        return isOwnerOfNearestScope(cell, user.id) || canManagePlanting(cell) || hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT); // CHANGE
    }

    function canDeleteFromPreviousParent(cell, previousParent) { // NEW
        if (!isEnabled()) return true; // NEW
        const user = currentUser(); // NEW
        if (!user || !cell || cell === model.getRoot() || cell === graph.getDefaultParent()) return false; // NEW
        if (user.admin) return true; // NEW
        if (isOwnerOfNearestScope(cell, user.id)) return true; // NEW
        if (canManagePlanting(cell)) return true; // NEW
        return !!(previousParent && isOwnerOfNearestScope(previousParent, user.id)); // NEW
    } // NEW

    function canMoveCell(cell) { // NEW
        if (!isEnabled()) return true; // NEW
        const user = currentUser(); // NEW
        if (!user || !cell || cell === model.getRoot() || cell === graph.getDefaultParent()) return false; // NEW
        if (user.admin) return true; // NEW
        if (isOwnerOfNearestScope(cell, user.id)) return true; // CHANGE
        if (isTaskCard(cell)) return canMoveTask(cell); // NEW
        if (nearestPlanting(cell)) return canManagePlanting(cell); // NEW
        return hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT); // CHANGE
    } // NEW

    function canCreatePlanting(parent) { // NEW
        if (!isEnabled()) return true; // NEW
        const user = currentUser(); // NEW
        if (!user || !parent) return false; // NEW
        if (user.admin || isOwnerOfNearestScope(parent, user.id)) return true; // NEW
        const bed = nearestGardenBed(parent); // NEW
        const scope = bed || parent; // NEW
        return hasCapability(scope, CAP_CREATE_PLANTINGS); // NEW
    } // NEW

    function canManagePlanting(cell) { // NEW
        if (!isEnabled()) return true; // NEW
        const user = currentUser(); // NEW
        const planting = nearestPlanting(cell); // NEW
        if (!user || !planting) return false; // NEW
        if (user.admin || isOwnerOfNearestScope(planting, user.id)) return true; // NEW
        return getAttr(planting, ATTR_OWNER) === user.id && hasCapability(planting, CAP_MANAGE_OWN_PLANTINGS); // NEW
    } // NEW

    function canMoveTask(cell) { // NEW
        if (!isEnabled()) return true; // NEW
        const board = nearestTaskBoard(cell); // NEW
        return !!board && hasCapability(board, CAP_MOVE_TASKS); // NEW
    } // NEW

    function canEditTaskDetails(cell) { // NEW
        if (!isEnabled()) return true; // NEW
        const board = nearestTaskBoard(cell); // NEW
        return !!board && hasCapability(board, CAP_EDIT_TASK_DETAILS); // NEW
    } // NEW

    function canManageAccess(cell) {
        if (!isEnabled()) return false; // NEW
        const user = currentUser();
        if (!user || !cell || cell === model.getRoot()) return false;
        if (user.admin) return true;
        return isOwnerOfNearestAccessScope(cell, user.id) || hasCapability(cell, CAP_MANAGE_ACCESS); // CHANGE
    }

    function canTransferOwnership(cell) { // NEW
        if (!isEnabled()) return false; // NEW
        const user = currentUser(); // NEW
        if (!user || !cell || cell === model.getRoot()) return false; // NEW
        return user.admin || isOwnerOfNearestAccessScope(cell, user.id); // NEW
    } // NEW

    function eligibleScopeType(cell) { // NEW
        if (!cell || cell === model.getRoot() || cell === graph.getDefaultParent()) return ""; // NEW
        if (isModuleCell(cell)) return "module"; // CHANGE
        if (isTaskBoard(cell)) return "task board"; // CHANGE
        if (isGardenBed(cell)) return "garden bed"; // CHANGE
        return ""; // NEW
    } // NEW

    function cellLabel(cell) { // NEW
        const label = getAttr(cell, "label"); // NEW
        if (label) return String(label); // NEW
        if (typeof cell.value === "string" && cell.value) return cell.value; // NEW
        return (eligibleScopeType(cell) || "scope") + " " + (cell && (cell.id || (cell.getId && cell.getId())) || ""); // NEW
    } // NEW

    function selectedCells() { // NEW
        return graph.getSelectionCells ? (graph.getSelectionCells() || []) : [selectedCell()].filter(Boolean); // NEW
    } // NEW

    function normalizeScopeCells(input) { // NEW
        const raw = Array.isArray(input) ? input : []; // NEW
        return raw.map(function (entry) { // NEW
            if (!entry) return null; // NEW
            if (typeof entry === "string") return model.getCell && model.getCell(entry); // NEW
            return entry; // NEW
        }).filter(Boolean); // NEW
    } // NEW

    function getEligibleShareScopes(cells) { // NEW
        const resolved = normalizeScopeCells(cells || selectedCells()); // NEW
        const seen = new Set(); // NEW
        const scopes = []; // NEW
        for (let i = 0; i < resolved.length; i++) { // NEW
            const cell = resolved[i]; // NEW
            const id = cell && (cell.id || (cell.getId && cell.getId())); // NEW
            const type = eligibleScopeType(cell); // NEW
            if (!id || !type) return { ok: false, reason: "Select only module(s), task board(s), or garden bed(s).", scopes: [] }; // NEW
            if (seen.has(id)) continue; // NEW
            seen.add(id); // NEW
            scopes.push({ id, type, label: cellLabel(cell), cell }); // NEW
        } // NEW
        if (!scopes.length) return { ok: false, reason: "Select at least one module, task board, or garden bed to share.", scopes: [] }; // NEW
        return { ok: true, scopes, cells: scopes.map(function (scope) { return scope.cell; }) }; // NEW
    } // NEW

    function canInviteScopes(cells) { // NEW
        if (!isEnabled()) return { ok: false, reason: "Enable users before sharing this garden canvas." }; // NEW
        if (!isLoggedIn()) return { ok: false, reason: "Log in before sharing this garden canvas." }; // NEW
        const eligible = getEligibleShareScopes(cells); // NEW
        if (!eligible.ok) return eligible; // NEW
        for (let i = 0; i < eligible.cells.length; i++) { // NEW
            if (!canManageAccess(eligible.cells[i])) return { ok: false, reason: "You can only share scopes you own or administer.", scopes: eligible.scopes }; // NEW
        } // NEW
        return eligible; // NEW
    } // NEW

    function getAccessSummary(cell) {
        const owner = nearestOwnedAncestor(cell);
        const grants = getScopeGrants(cell); // CHANGE
        const current = currentUser(); // NEW
        return {
            ownerUserId: owner && owner.ownerUserId || "",
            ownerCellId: owner && owner.cell && owner.cell.id || "",
            directOpen: getAttr(cell, ATTR_ACCESS_OPEN) === "1",
            directUserIds: grants.map(function (grant) { return grant.userId; }), // CHANGE
            directGrants: grants, // NEW
            roleDerivedTask: !!(current && roleLinkedBoardGrantsForUser(current.id, cell).length), // NEW
            effectiveCapabilities: current ? effectiveCapabilitiesForCell(cell, current.id) : [], // NEW
            effectiveOpen: !!nearestAccessGrant(cell, null),
            canEdit: canEditCell(cell),
            canAdd: canAddCell(cell),
            canDelete: canDeleteCell(cell),
            canManageAccess: canManageAccess(cell),
            canTransferOwnership: canTransferOwnership(cell) // NEW
        };
    }

    function withActorMetadata(metadata) {
        const user = currentUser();
        const base = Object.assign({}, metadata || {});
        if (!user) return base;
        base.actorUserId = user.id;
        base.actorName = user.name;
        base.actorRole = user.admin ? "admin" : "regular";
        return base;
    }

    function stampCreatedOwner(cell) {
        const user = currentUser();
        if (!cell || !user) return false;
        graph[INTERNAL_FLAG] = true;
        model.beginUpdate();
        try {
            if (!getAttr(cell, ATTR_OWNER)) setAttr(cell, ATTR_OWNER, user.id);
            if (!getAttr(cell, ATTR_CREATED_BY)) setAttr(cell, ATTR_CREATED_BY, user.id);
            setAttr(cell, ATTR_ACTOR_NAME, user.name);
            setAttr(cell, ATTR_ACTOR_ROLE, user.admin ? "admin" : "regular");
        } finally {
            model.endUpdate();
            graph[INTERNAL_FLAG] = false;
        }
        refreshPanel();
        return true;
    }

    function stampActorOnCell(cell, kind) {
        const user = currentUser();
        if (!cell || !user) return false;
        graph[INTERNAL_FLAG] = true;
        model.beginUpdate();
        try {
            if (kind === "created" && !getAttr(cell, ATTR_CREATED_BY)) setAttr(cell, ATTR_CREATED_BY, user.id);
            if (kind === "edited") setAttr(cell, ATTR_EDITED_BY, user.id);
            setAttr(cell, ATTR_ACTOR_NAME, user.name);
            setAttr(cell, ATTR_ACTOR_ROLE, user.admin ? "admin" : "regular");
        } finally {
            model.endUpdate();
            graph[INTERNAL_FLAG] = false;
        }
        return true;
    }

    function setAccess(cell, options) {
        if (!cell || !canManageAccess(cell)) return { ok: false, reason: "You cannot manage access for this cell." };
        const source = options || {};
        graph[INTERNAL_FLAG] = true;
        model.beginUpdate();
        try {
            setAttr(cell, ATTR_ACCESS_OPEN, ""); // CHANGE
            const grants = (source.userIds || []).filter(function (id) { return !!storedOrPendingUserById(id); }).map(function (userId) { return normalizeGrant({ userId, preset: source.preset || "viewer", capabilities: source.capabilities }); }); // CHANGE
            setGrantsAttr(cell, grants); // CHANGE
        } finally {
            model.endUpdate();
            graph[INTERNAL_FLAG] = false;
        }
        refreshPanel();
        return { ok: true };
    }

    function setOwner(cell, userId) {
        if (!cell || !canTransferOwnership(cell)) return { ok: false, reason: "You cannot change ownership for this cell." }; // CHANGE
        if (!userById(userId)) return { ok: false, reason: "Unknown owner." };
        graph[INTERNAL_FLAG] = true;
        model.beginUpdate();
        try { setAttr(cell, ATTR_OWNER, userId); } finally { model.endUpdate(); graph[INTERNAL_FLAG] = false; }
        refreshPanel();
        return { ok: true };
    }

    function getUserRoleCard(userId) { // NEW
        const matches = roleCardsForUser(String(userId || "")); // NEW
        if (matches.length !== 1) return null; // NEW
        const cell = matches[0]; // NEW
        return { id: cell.id || (cell.getId && cell.getId()) || "", cell, label: cellLabel(cell) }; // NEW
    } // NEW

    function listRoleCards() { // NEW
        const cards = []; // NEW
        traverseCells(model.getRoot && model.getRoot(), function (cell) { // NEW
            if (isRoleCard(cell)) cards.push({ id: cell.id || (cell.getId && cell.getId()) || "", cell, label: cellLabel(cell), userId: getAttr(cell, ATTR_ROLE_USER) || "" }); // NEW
        }); // NEW
        return cards.sort(function (left, right) { return left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id); }); // NEW
    } // NEW

    function setUserRoleCard(userId, roleCard) { // NEW
        const cleanUserId = String(userId || "").trim(); // NEW
        if (!roleCard || !isRoleCard(roleCard)) return { ok: false, reason: "Select a role card." }; // NEW
        if (!canTransferOwnership(roleCard)) return { ok: false, reason: "Only admins or owners can link users to role cards." }; // NEW
        if (cleanUserId && !userById(cleanUserId)) return { ok: false, reason: "Unknown user." }; // NEW
        graph[INTERNAL_FLAG] = true; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            traverseCells(model.getRoot && model.getRoot(), function (cell) { // NEW
                if (isRoleCard(cell) && cleanUserId && getAttr(cell, ATTR_ROLE_USER) === cleanUserId && cell !== roleCard) setAttr(cell, ATTR_ROLE_USER, ""); // NEW
            }); // NEW
            setAttr(roleCard, ATTR_ROLE_USER, cleanUserId); // NEW
        } finally { // NEW
            model.endUpdate(); // NEW
            graph[INTERNAL_FLAG] = false; // NEW
        } // NEW
        refreshPanel(); // NEW
        return { ok: true, roleCard: cleanUserId ? getUserRoleCard(cleanUserId) : null }; // NEW
    } // NEW

    function composeInviteEmail(invite, code, shareInfo) { // NEW
        const info = shareInfo || {}; // NEW
        const lines = [ // NEW
            "You have been invited to collaborate on a Trellis garden canvas.", // NEW
            "", // NEW
            "1. Add the sender in Syncthing using the device and folder details below.", // NEW
            "2. Wait for the sender to approve your Syncthing device/share.", // NEW
            "3. Open the synced diagram in Trellis Studio.", // NEW
            "4. In People & Access, choose Accept Invite and enter your email, invite code, display name, and PIN.", // CHANGE
            "", // NEW
            "Trellis invite code: " + code, // NEW
            "Invite expires: " + new Date(invite.expiresAt).toLocaleString(), // NEW
            "Recipient email: " + invite.email, // NEW
            "Shared scopes: " + ((invite.scopeLabels || []).join(", ") || "Selected scopes"), // NEW
            "", // NEW
            "Syncthing device ID: " + (info.deviceId || "(unavailable)"), // NEW
            "Syncthing folder ID: " + (info.folderId || "(unavailable)"), // NEW
            "Syncthing folder label: " + (info.folderLabel || "(unavailable)"), // NEW
            "Syncthing folder path: " + (info.folderPath || "(unavailable)"), // NEW
            "", // NEW
            "This is a low-security local workflow invite. Access can be revoked from the People & Access panel." // CHANGE
        ]; // NEW
        return { to: invite.email, subject: "Trellis garden canvas invite", body: lines.join("\n") }; // NEW
    } // NEW

    function createPendingInvite(options) { // NEW
        const source = options || {}; // NEW
        const email = normalizeEmail(source.email); // NEW
        if (!validEmail(email)) return { ok: false, reason: "Enter a complete recipient email address." }; // NEW
        const store = expireInvites(readStore()); // NEW
        if (!store.usersEnabled) return { ok: false, reason: "Enable users before sharing this garden canvas." }; // NEW
        const actor = currentUser(); // NEW
        if (!actor) return { ok: false, reason: "Log in before sharing this garden canvas." }; // NEW
        if (emailExists(store, email)) return { ok: false, reason: "That email is already invited or already belongs to a user." }; // NEW
        const scopeCheck = canInviteScopes(source.scopeCellIds || source.cells || []); // NEW
        if (!scopeCheck.ok) return { ok: false, reason: scopeCheck.reason }; // NEW
        const preset = normalizePreset(source.preset || "viewer"); // NEW
        const capabilities = normalizeCapabilities(source.capabilities, preset); // NEW
        const code = makeInviteCode(); // NEW
        const codeSalt = makeId(INVITE_CODE_SALT_PREFIX); // NEW
        const pendingUser = { id: makeId(USER_ID_PREFIX), email, invitedBy: actor.id, invitedAt: nowMs(), disabled: false }; // NEW
        const invite = { // NEW
            id: makeId(INVITE_ID_PREFIX), // NEW
            pendingUserId: pendingUser.id, // NEW
            email, // NEW
            codeSalt, // NEW
            codeHash: hashInviteCode(code, codeSalt), // NEW
            scopeCellIds: scopeCheck.scopes.map(function (scope) { return scope.id; }), // NEW
            scopeLabels: scopeCheck.scopes.map(function (scope) { return scope.label; }), // NEW
            preset, // NEW
            capabilities, // NEW
            createdBy: actor.id, // NEW
            createdAt: nowMs(), // NEW
            expiresAt: nowMs() + INVITE_EXPIRY_MS, // NEW
            status: "pending" // NEW
        }; // NEW
        store.pendingUsers.push(pendingUser); // NEW
        store.invites.push(invite); // NEW
        writeStoreAndGrant(store, pendingUser.id, invite.scopeCellIds, { preset, capabilities }); // CHANGE
        const emailDraft = composeInviteEmail(invite, code, source.shareInfo || {}); // NEW
        showStatus("Invite created for " + email + ". Review and send the email draft."); // NEW
        return { ok: true, invite: publicInvite(invite), code, emailDraft }; // NEW
    } // NEW

    function acceptInvite(options) { // NEW
        const source = options || {}; // NEW
        const email = normalizeEmail(source.email); // NEW
        const name = String(source.name || "").trim(); // NEW
        const pin = String(source.pin || ""); // NEW
        const code = String(source.code || "").trim().toUpperCase(); // NEW
        if (!validEmail(email) || !code || !name || !pin) return { ok: false, reason: "Enter email, invite code, display name, and PIN." }; // NEW
        const store = expireInvites(readStore()); // NEW
        const invite = store.invites.find(function (entry) { return entry.status === "pending" && normalizeEmail(entry.email) === email; }); // NEW
        if (!invite) return { ok: false, reason: "No active invite matches that email." }; // NEW
        if (nowMs() > invite.expiresAt) return { ok: false, reason: "That invite has expired." }; // NEW
        if (invite.codeHash !== hashInviteCode(code, invite.codeSalt)) return { ok: false, reason: "Invite code is incorrect." }; // NEW
        if (store.users.some(function (user) { return user.name.toLowerCase() === name.toLowerCase(); })) return { ok: false, reason: "A user with that name already exists." }; // NEW
        const pending = store.pendingUsers.find(function (entry) { return entry.id === invite.pendingUserId; }); // NEW
        if (!pending) return { ok: false, reason: "Invite user record is missing." }; // NEW
        const salt = makeId(PIN_SALT_PREFIX); // NEW
        const user = { id: pending.id, name, email, pinSalt: salt, pinHash: hashPin(pin, salt), admin: false, disabled: false, createdAt: nowMs() }; // NEW
        store.users.push(user); // NEW
        store.pendingUsers = store.pendingUsers.filter(function (entry) { return entry.id !== pending.id; }); // NEW
        invite.status = "accepted"; // NEW
        writeStore(store); // NEW
        currentUserId = user.id; // NEW
        showStatus("Invite accepted. Logged in as " + name + "."); // NEW
        closeAuthOverlay(true); // NEW
        refreshPanel(); // NEW
        updateToolbarButton(); // NEW
        return { ok: true, user: publicUser(user) }; // NEW
    } // NEW

    function canManageInvite(invite) { // NEW
        const actor = currentUser(); // NEW
        if (!actor || !invite) return false; // NEW
        if (actor.admin) return true; // NEW
        return (invite.scopeCellIds || []).every(function (cellId) { // NEW
            const cell = model.getCell && model.getCell(cellId); // NEW
            return !!cell && canManageAccess(cell); // NEW
        }); // NEW
    } // NEW

    function revokeInvite(inviteId) { // NEW
        const store = expireInvites(readStore()); // NEW
        const invite = store.invites.find(function (entry) { return entry.id === inviteId; }); // NEW
        if (!invite || invite.status !== "pending") return { ok: false, reason: "No pending invite was found." }; // NEW
        if (!canManageInvite(invite)) return { ok: false, reason: "You cannot revoke this invite." }; // NEW
        invite.status = "revoked"; // NEW
        store.pendingUsers = store.pendingUsers.filter(function (entry) { return entry.id !== invite.pendingUserId; }); // NEW
        removeGrantsForUser(invite.pendingUserId, invite.scopeCellIds); // NEW
        writeStore(store); // NEW
        showStatus("Invite revoked for " + invite.email + "."); // NEW
        return { ok: true }; // NEW
    } // NEW

    function resendInvite(inviteId, shareInfo) { // NEW
        const store = expireInvites(readStore()); // NEW
        const invite = store.invites.find(function (entry) { return entry.id === inviteId; }); // NEW
        if (!invite || invite.status !== "pending") return { ok: false, reason: "No pending invite was found." }; // NEW
        if (!canManageInvite(invite)) return { ok: false, reason: "You cannot resend this invite." }; // NEW
        const code = makeInviteCode(); // NEW
        invite.codeSalt = makeId(INVITE_CODE_SALT_PREFIX); // NEW
        invite.codeHash = hashInviteCode(code, invite.codeSalt); // NEW
        invite.expiresAt = nowMs() + INVITE_EXPIRY_MS; // NEW
        writeStore(store); // NEW
        return { ok: true, invite: publicInvite(invite), code, emailDraft: composeInviteEmail(invite, code, shareInfo || {}) }; // NEW
    } // NEW

    function valueAttrSnapshot(value) {
        const out = {};
        if (!value || typeof value !== "object" || value.nodeType !== 1 || !value.attributes) return out;
        for (let i = 0; i < value.attributes.length; i++) {
            const attr = value.attributes[i];
            if (attr && PROTECTED_ATTRS.has(attr.name)) out[attr.name] = attr.value;
        }
        return out;
    }

    function protectedAttrsChanged(change) {
        if (!change) return false;
        const directKey = String(change.key || change.attribute || change.name || ""); // NEW
        if (PROTECTED_ATTRS.has(directKey)) return true; // NEW
        const before = valueAttrSnapshot(change.previous);
        const after = valueAttrSnapshot(change.value || (change.cell && change.cell.value));
        for (const key of PROTECTED_ATTRS) if ((before[key] || "") !== (after[key] || "")) return true;
        return false;
    }

    function roleUserLinkChanged(change) { // NEW
        if (!change) return false; // NEW
        const directKey = String(change.key || change.attribute || change.name || ""); // NEW
        if (directKey === ATTR_ROLE_USER) return true; // NEW
        const before = allValueAttrSnapshot(change.previous); // NEW
        const after = allValueAttrSnapshot(change.value || (change.cell && change.cell.value)); // NEW
        return (before[ATTR_ROLE_USER] || "") !== (after[ATTR_ROLE_USER] || ""); // NEW
    } // NEW

    function allValueAttrSnapshot(value) { // NEW
        const out = {}; // NEW
        if (!value || typeof value !== "object" || value.nodeType !== 1 || !value.attributes) return out; // NEW
        for (let i = 0; i < value.attributes.length; i++) { // NEW
            const attr = value.attributes[i]; // NEW
            if (attr) out[attr.name] = attr.value; // NEW
        } // NEW
        return out; // NEW
    } // NEW

    function changedAttributeNames(change) { // NEW
        const direct = String(change && (change.key || change.attribute || change.name || "") || ""); // NEW
        if (direct) return [direct]; // NEW
        const names = new Set(); // NEW
        const before = allValueAttrSnapshot(change && change.previous); // NEW
        const after = allValueAttrSnapshot(change && (change.value || (change.cell && change.cell.value))); // NEW
        Object.keys(before).forEach(function (key) { if ((before[key] || "") !== (after[key] || "")) names.add(key); }); // NEW
        Object.keys(after).forEach(function (key) { if ((before[key] || "") !== (after[key] || "")) names.add(key); }); // NEW
        return Array.from(names); // NEW
    } // NEW

    function isTaskDetailOnlyChange(change) { // NEW
        const names = changedAttributeNames(change); // NEW
        if (!names.length) return true; // NEW
        return names.every(function (name) { return TASK_DETAIL_ATTRS.has(name) && !TASK_ASSIGNMENT_ATTRS.has(name); }); // NEW
    } // NEW

    function cellFromChange(change) {
        return change && (change.cell || change.child || change.terminal || null);
    }

    function currentParentOfChange(change) {
        const child = cellFromChange(change);
        return child ? parentOf(child) : null;
    }

    function previousParentOfChange(change) {
        return change && change.previous || null;
    }

    function debugCellId(cell) { // NEW
        return cell && (cell.id || (typeof cell.getId === "function" && cell.getId())) || null; // NEW
    } // NEW

    function debugGeometry(cell) { // NEW
        const g = cell && typeof cell.getGeometry === "function" ? cell.getGeometry() : null; // NEW
        return g ? { x: g.x, y: g.y, width: g.width, height: g.height } : null; // NEW
    } // NEW

    function debugCellRef(cell) { // NEW
        return cell ? { id: debugCellId(cell), label: getAttr(cell, "label") || "", valueName: cell.value && cell.value.nodeName || "", style: getStyle(cell) || "" } : null; // NEW
    } // NEW

    function debugCellSnapshot(cell) { // NEW
        if (!cell) return null; // NEW
        return { // NEW
            id: debugCellId(cell), // NEW
            label: getAttr(cell, "label") || "", // NEW
            valueName: cell.value && cell.value.nodeName || "", // NEW
            style: getStyle(cell) || "", // NEW
            geometry: debugGeometry(cell), // NEW
            attrs: { // NEW
                tiler_group: getAttr(cell, "tiler_group"), // NEW
                garden_bed: getAttr(cell, "garden_bed") || getAttr(cell, "gardenBed") || getAttr(cell, "is_garden_bed"), // NEW
                garden_module: getAttr(cell, "garden_module") || getAttr(cell, "team_module"), // NEW
                board_key: getAttr(cell, "board_key"), // NEW
                kanban_card: getAttr(cell, "kanban_card"), // NEW
                lane_key: getAttr(cell, "lane_key"), // NEW
                owner: getAttr(cell, ATTR_OWNER), // NEW
                roleUser: getAttr(cell, ATTR_ROLE_USER) // NEW
            }, // NEW
            classification: { // NEW
                module: isModuleCell(cell), // NEW
                gardenBed: isGardenBed(cell), // NEW
                tilerGroup: isTilerGroup(cell), // NEW
                taskBoard: isTaskBoard(cell), // NEW
                taskCard: isTaskCard(cell), // NEW
                roleCard: isRoleCard(cell), // NEW
                nearestPlanting: debugCellId(nearestPlanting(cell)), // NEW
                nearestGardenBed: debugCellId(nearestGardenBed(cell)), // NEW
                nearestTaskBoard: debugCellId(nearestTaskBoard(cell)) // NEW
            } // NEW
        }; // NEW
    } // NEW

    function debugOwnedScope(cell) { // NEW
        const owner = nearestOwnedAncestor(cell); // NEW
        return owner ? { cellId: debugCellId(owner.cell), ownerUserId: owner.ownerUserId, accessScope: !isTilerGroup(owner.cell) } : null; // NEW
    } // NEW

    function debugPermissionSnapshot(change) { // NEW
        const cell = cellFromChange(change); // NEW
        const currentParent = currentParentOfChange(change); // NEW
        const previousParent = previousParentOfChange(change); // NEW
        const user = currentUser(); // NEW
        return { // NEW
            enabled: isEnabled(), // NEW
            loggedIn: isLoggedIn(), // NEW
            currentUser: user ? { id: user.id, name: user.name, email: user.email, admin: !!user.admin } : null, // NEW
            change: { // NEW
                type: change && change.constructor && change.constructor.name || "", // NEW
                key: String(change && (change.key || change.attribute || change.name || "") || ""), // NEW
                changedAttrs: changedAttributeNames(change), // NEW
                previousParentId: debugCellId(previousParent), // NEW
                currentParentId: debugCellId(currentParent) // NEW
            }, // NEW
            cell: debugCellSnapshot(cell), // NEW
            currentParent: debugCellRef(currentParent), // NEW
            previousParent: debugCellRef(previousParent), // NEW
            nearestOwnedScope: debugOwnedScope(cell), // NEW
            effectiveCapabilities: cell && user ? effectiveCapabilitiesForCell(cell, user.id) : [], // NEW
            decisions: { // NEW
                canCreatePlantingAtCurrentParent: canCreatePlanting(currentParent), // NEW
                canManagePlanting: canManagePlanting(cell), // NEW
                canMoveCell: canMoveCell(cell), // NEW
                canEditCell: canEditCell(cell), // NEW
                canManageAccess: canManageAccess(cell), // NEW
                canTransferOwnership: canTransferOwnership(cell) // NEW
            } // NEW
        }; // NEW
    } // NEW

    function debugChangeSummary(change, index) { // NEW
        const cell = cellFromChange(change); // NEW
        return { // NEW
            index, // NEW
            type: change && change.constructor && change.constructor.name || "", // NEW
            cellId: debugCellId(cell), // NEW
            key: String(change && (change.key || change.attribute || change.name || "") || ""), // NEW
            changedAttrs: changedAttributeNames(change), // NEW
            currentParentId: debugCellId(currentParentOfChange(change)), // NEW
            previousParentId: debugCellId(previousParentOfChange(change)), // NEW
            classification: cell ? { module: isModuleCell(cell), gardenBed: isGardenBed(cell), tilerGroup: isTilerGroup(cell), taskBoard: isTaskBoard(cell), taskCard: isTaskCard(cell), roleCard: isRoleCard(cell), nearestPlanting: debugCellId(nearestPlanting(cell)) } : null // NEW
        }; // NEW
    } // NEW

    function logDeniedChange(change, index) { // NEW
        consoleGroup("[TrellisUsers] denied change", debugChangeSummary(change, index), function () { // NEW
            const detail = debugPermissionSnapshot(change); // NEW
            if (console.log) console.log(detail); // NEW
        }); // NEW
    } // NEW

    function logRejectedEdit(edit, reason) { // NEW
        const changes = edit && edit.changes || []; // NEW
        consoleGroup("[TrellisUsers] rejected edit", { reason: reason || "", changeCount: changes.length }, function () { // NEW
            const rows = changes.map(function (change, index) { return debugChangeSummary(change, index); }); // NEW
            if (console.table) console.table(rows); // NEW
            else if (console.log) console.log(rows); // NEW
        }); // NEW
    } // NEW

    function stampAllowedCreations(changes) { // NEW
        (changes || []).forEach(function (change) { // NEW
            const name = change && change.constructor && change.constructor.name; // NEW
            if (name !== "mxChildChange") return; // NEW
            const cell = cellFromChange(change); // NEW
            if (cell && currentParentOfChange(change) && !previousParentOfChange(change) && isTilerGroup(cell)) stampCreatedOwner(cell); // NEW
        }); // NEW
    } // NEW

    function changeAllowed(change) {
        const name = change && change.constructor && change.constructor.name;
        const cell = cellFromChange(change);
        if (!name || !cell) return true;
        if (roleUserLinkChanged(change)) return canTransferOwnership(cell); // NEW
        if (PROTECTED_ATTRS.has(String(change.key || "")) && !canManageAccess(cell)) return false;
        if (protectedAttrsChanged(change) && !canManageAccess(cell)) return false; // NEW
        if (name === "mxChildChange") {
            const currentParent = currentParentOfChange(change);
            const previousParent = previousParentOfChange(change);
            if (currentParent && !previousParent && isTilerGroup(cell)) return canCreatePlanting(currentParent); // NEW
            if (currentParent && previousParent && currentParent !== previousParent && isTaskCard(cell)) return canMoveTask(cell); // NEW
            if (currentParent && previousParent && currentParent === previousParent && isTaskCard(cell)) return canMoveTask(cell); // NEW
            if (currentParent && !canAddCell(currentParent)) return false;
            if (!currentParent && previousParent) return canDeleteFromPreviousParent(cell, previousParent); // CHANGE
            if (currentParent && previousParent && currentParent !== previousParent && !canDeleteFromPreviousParent(cell, previousParent)) return false; // CHANGE
            return !!currentParent;
        }
        if (name === "mxValueChange" && protectedAttrsChanged(change)) return canManageAccess(cell);
        if ((name === "mxCellAttributeChange" || name === "mxValueChange") && isTaskCard(cell)) { // NEW
            if (changedAttributeNames(change).some(function (attr) { return TASK_ASSIGNMENT_ATTRS.has(attr); })) return hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT); // NEW
            return isTaskDetailOnlyChange(change) ? canEditTaskDetails(cell) : hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT); // NEW
        } // NEW
        if (name === "mxCellAttributeChange") { // NEW
            if (nearestPlanting(cell)) return canManagePlanting(cell); // NEW
            return hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT); // NEW
        } // NEW
        if (name === "mxGeometryChange") return canMoveCell(cell); // NEW
        if (name === "mxStyleChange" || name === "mxValueChange" || name === "mxTerminalChange" || name === "mxCollapseChange" || name === "mxVisibleChange") { // CHANGE
            if (nearestPlanting(cell)) return canManagePlanting(cell); // NEW
            return canEditCell(cell);
        }
        return true;
    }

    function rejectEdit(edit, reason) {
        logRejectedEdit(edit, reason); // NEW
        if (edit) edit.__trellisUsersRejected = true; // NEW
        graph[REJECT_FLAG] = true;
        graph[INTERNAL_FLAG] = true;
        try {
            if (edit && typeof edit.undo === "function") edit.undo();
            else showStatus(reason || "Change rejected.");
        } finally {
            graph[INTERNAL_FLAG] = false;
            graph[REJECT_FLAG] = false;
        }
        showStatus(reason || "Change rejected.");
        if (graph.refresh) graph.refresh();
    }

    function inspectModelChange(_sender, evt) {
        if (!isEnabled()) return; // NEW
        if (graph[INTERNAL_FLAG] || graph[REJECT_FLAG]) return;
        if ((ui && ui.openingFile) || graphXmlLoading > 0) return; // NEW
        const edit = evt && evt.getProperty && evt.getProperty("edit");
        const changes = edit && edit.changes || [];
        if (!changes.length) return;
        if (!isLoggedIn()) { rejectEdit(edit, "Log in before editing this diagram."); return; }
        for (let i = 0; i < changes.length; i++) {
            if (!changeAllowed(changes[i])) {
                logDeniedChange(changes[i], i); // NEW
                rejectEdit(edit, "Change rejected by Trellis user permissions.");
                return;
            }
        }
        stampAllowedCreations(changes); // NEW
    }

    function makeButton(label, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.style.cssText = "padding:4px 8px;border:1px solid #9CA3AF;border-radius:4px;background:#fff;cursor:pointer;font:12px Arial,sans-serif;";
        button.addEventListener("click", function (evt) { if (evt) evt.stopPropagation(); onClick(evt); });
        return button;
    }

    function makeInput(type, placeholder) {
        const input = document.createElement("input");
        input.type = type;
        input.placeholder = placeholder || "";
        input.style.cssText = "box-sizing:border-box;width:100%;padding:4px 6px;border:1px solid #D1D5DB;border-radius:3px;font:12px Arial,sans-serif;";
        return input;
    }

    function selectedCell() {
        return graph.getSelectionCell ? graph.getSelectionCell() : ((graph.getSelectionCells && graph.getSelectionCells()[0]) || null);
    }

    function activePeopleSearch() { // NEW
        return String(peopleSearchText || "").trim().toLowerCase(); // NEW
    } // NEW

    function activePeopleTypeFilter() { // NEW
        return ["networked", "local"].indexOf(peopleTypeFilter) >= 0 ? peopleTypeFilter : "all"; // NEW
    } // NEW

    function userIsNetworked(user) { // NEW
        return !!normalizeEmail(user && user.email); // NEW
    } // NEW

    function userMatchesPeopleSearch(user) { // NEW
        const query = activePeopleSearch(); // NEW
        if (!query) return true; // NEW
        return String(user && user.name || "").toLowerCase().indexOf(query) >= 0 || normalizeEmail(user && user.email).indexOf(query) >= 0; // NEW
    } // NEW

    function userMatchesPeopleFilter(user) { // NEW
        const type = activePeopleTypeFilter(); // NEW
        if (type === "networked" && !userIsNetworked(user)) return false; // NEW
        if (type === "local" && userIsNetworked(user)) return false; // NEW
        return userMatchesPeopleSearch(user); // NEW
    } // NEW

    function inviteMatchesPeopleFilter(invite) { // NEW
        if (activePeopleTypeFilter() === "local") return false; // NEW
        const query = activePeopleSearch(); // NEW
        return !query || normalizeEmail(invite && invite.email).indexOf(query) >= 0; // NEW
    } // NEW

    function filteredEmptyText(label) { // NEW
        return activePeopleSearch() || activePeopleTypeFilter() !== "all" ? "No " + label.toLowerCase() + " match the current filter." : "None"; // NEW
    } // NEW

    function titleCaseScopeType(type) { // NEW
        return String(type || "cell").replace(/\b\w/g, function (letter) { return letter.toUpperCase(); }); // NEW
    } // NEW

    function scopeSummaryForCell(cell) { // NEW
        if (!cell || cell === model.getRoot()) return null; // NEW
        const type = eligibleScopeType(cell) || "cell"; // NEW
        return { id: cell.id || (cell.getId && cell.getId()) || "", type, label: cellLabel(cell) }; // NEW
    } // NEW

    function selectedScopeSummaries() { // NEW
        const seen = new Set(); // NEW
        const summaries = []; // NEW
        (selectedCells() || []).forEach(function (cell) { // NEW
            const summary = scopeSummaryForCell(cell); // NEW
            if (!summary || !summary.id || seen.has(summary.id)) return; // NEW
            seen.add(summary.id); // NEW
            summaries.push(summary); // NEW
        }); // NEW
        return summaries; // NEW
    } // NEW

    function viewportSize() { // NEW
        const doc = document && document.documentElement; // NEW
        return { // NEW
            width: Math.max(320, Number(window && window.innerWidth) || (doc && doc.clientWidth) || 1024), // NEW
            height: Math.max(240, Number(window && window.innerHeight) || (doc && doc.clientHeight) || 768) // NEW
        }; // NEW
    } // NEW

    function fixedPositionNearButton(width, height, gap) { // NEW
        const size = viewportSize(); // NEW
        const rect = toolbarButton && typeof toolbarButton.getBoundingClientRect === "function" ? toolbarButton.getBoundingClientRect() : null; // NEW
        const margin = 8; // NEW
        const x = rect ? rect.right - width : size.width - width - margin; // NEW
        const y = rect ? rect.bottom + (gap || 4) : 36; // NEW
        return { // NEW
            left: Math.max(margin, Math.min(x, size.width - width - margin)), // NEW
            top: Math.max(margin, Math.min(y, size.height - Math.min(height, size.height - margin * 2) - margin)) // NEW
        }; // NEW
    } // NEW

    function positionPanelNearButton() { // NEW
        if (!panel) return; // NEW
        const width = 400; // NEW
        const height = Math.min(420, viewportSize().height - 16); // NEW
        const pos = fixedPositionNearButton(width, height, 4); // NEW
        panel.style.left = pos.left + "px"; // NEW
        panel.style.top = pos.top + "px"; // NEW
        panel.style.right = "auto"; // NEW
        panel.style.width = width + "px"; // NEW
        panel.style.maxHeight = "calc(100vh - " + Math.max(16, pos.top + 8) + "px)"; // NEW
    } // NEW

    function showStatus(message) {
        if (statusNode) statusNode.textContent = String(message || "");
        else if (ui && typeof ui.alert === "function") ui.alert(String(message || ""));
    }

    function openEmailDraft(emailDraft) { // NEW
        const bridge = window.trellisShare; // NEW
        if (!bridge || typeof bridge.openEmailDraft !== "function") { // NEW
            showStatus("Syncthing sharing email bridge is unavailable in this Trellis build."); // NEW
            return Promise.resolve({ ok: false, reason: "Email bridge unavailable." }); // NEW
        } // NEW
        return bridge.openEmailDraft(emailDraft).then(function (result) { // NEW
            if (!result || result.ok === false) showStatus((result && result.reason) || "Email draft could not be opened."); // NEW
            else showStatus("Email draft opened. Review and send it from your mail client."); // NEW
            return result || { ok: false }; // NEW
        }).catch(function (err) { // NEW
            showStatus(err && err.message ? err.message : "Email draft could not be opened."); // NEW
            return { ok: false, reason: err && err.message ? err.message : String(err) }; // NEW
        }); // NEW
    } // NEW

    function showAuthStatus(message) { // NEW
        const text = String(message || ""); // NEW
        if (authStatusNode) authStatusNode.textContent = text; // NEW
        showStatus(text); // NEW
    } // NEW

    function currentFileEditable() { // NEW
        const file = ui && typeof ui.getCurrentFile === "function" ? ui.getCurrentFile() : null; // NEW
        return !file || typeof file.isEditable !== "function" || file.isEditable(); // NEW
    } // NEW

    function setGraphAuthBlocked(blocked) { // NEW
        graphAuthBlocked = !!blocked; // NEW
        const enabled = !graphAuthBlocked && currentFileEditable(); // NEW
        if (graph && typeof graph.setEnabled === "function") graph.setEnabled(enabled); // NEW
        else if (ui && typeof ui.setGraphEnabled === "function") ui.setGraphEnabled(enabled); // NEW
    } // NEW

    function closeAuthOverlay(restoreGraph) { // NEW
        const hadOverlay = !!authOverlay; // NEW
        if (authOverlay && authOverlay.parentNode) authOverlay.parentNode.removeChild(authOverlay); // NEW
        authOverlay = null; // NEW
        authStatusNode = null; // NEW
        if (restoreGraph !== false && (hadOverlay || graphAuthBlocked)) setGraphAuthBlocked(false); // CHANGE
    } // NEW

    function closeCurrentDiagramFromAuth() { // NEW
        closeAuthOverlay(false); // NEW
        currentUserId = ""; // NEW
        forgetRememberedLogin(); // NEW
        if (ui && typeof ui.fileLoaded === "function") ui.fileLoaded(null); // NEW
        else setGraphAuthBlocked(false); // NEW
        updateToolbarButton(); // NEW
    } // NEW

    function authKeepRow() { // NEW
        const label = document.createElement("label"); // NEW
        label.style.cssText = "display:flex;gap:6px;align-items:center;margin:8px 0;color:#374151;"; // NEW
        const checkbox = document.createElement("input"); // NEW
        checkbox.type = "checkbox"; // NEW
        label.appendChild(checkbox); // NEW
        label.appendChild(document.createTextNode("Keep me logged in on this device")); // NEW
        return { row: label, checkbox }; // NEW
    } // NEW

    function finishAuthSuccess(keepChecked, message) { // NEW
        const user = currentUser(); // NEW
        if (user) { // NEW
            if (keepChecked) rememberLogin(user.id, true); // NEW
            else forgetRememberedLogin(); // NEW
        } // NEW
        closeAuthOverlay(true); // NEW
        refreshPanel(); // NEW
        updateToolbarButton(); // NEW
        if (message) showStatus(message); // NEW
    } // NEW

    function appendAuthLoginForm(parent) { // NEW
        const title = document.createElement("div"); // NEW
        title.textContent = canBootstrapAdmin() ? "Create first admin" : "Log in"; // NEW
        title.style.cssText = "font-weight:700;margin-top:8px;"; // NEW
        parent.appendChild(title); // NEW
        const row = document.createElement("div"); // NEW
        row.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px;"; // NEW
        const name = makeInput("text", "Name"); // NEW
        const pin = makeInput("password", "PIN"); // NEW
        row.appendChild(name); // NEW
        row.appendChild(pin); // NEW
        parent.appendChild(row); // NEW
        const keep = authKeepRow(); // NEW
        parent.appendChild(keep.row); // NEW
        const action = makeButton(canBootstrapAdmin() ? "Create Admin" : "Login", function () { // NEW
            const result = login(name.value, pin.value); // NEW
            pin.value = ""; // NEW
            if (!result.ok) { showAuthStatus(result.reason); return; } // NEW
            finishAuthSuccess(keep.checkbox.checked, result.user && result.user.name ? "Logged in as " + result.user.name + "." : "Logged in."); // NEW
        }); // NEW
        parent.appendChild(action); // NEW
    } // NEW

    function appendAuthEnableForm(parent) { // NEW
        const hint = document.createElement("div"); // NEW
        hint.textContent = "Users are off for this diagram. Create the first admin to enable login and permissions."; // NEW
        hint.style.cssText = "color:#4B5563;margin-bottom:8px;"; // NEW
        parent.appendChild(hint); // NEW
        const row = document.createElement("div"); // NEW
        row.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;"; // NEW
        const name = makeInput("text", "Admin name"); // NEW
        const pin = makeInput("password", "PIN"); // NEW
        row.appendChild(name); // NEW
        row.appendChild(pin); // NEW
        parent.appendChild(row); // NEW
        const keep = authKeepRow(); // NEW
        parent.appendChild(keep.row); // NEW
        parent.appendChild(makeButton("Enable Users", function () { // NEW
            const result = enableUsers(name.value, pin.value); // NEW
            pin.value = ""; // NEW
            if (!result.ok) { showAuthStatus(result.reason); return; } // NEW
            finishAuthSuccess(keep.checkbox.checked, "Users enabled. Logged in as " + result.user.name + "."); // NEW
        })); // NEW
    } // NEW

    function appendAuthInviteForm(parent) { // NEW
        const box = document.createElement("div"); // NEW
        box.style.cssText = "border-top:1px solid #E5E7EB;margin-top:12px;padding-top:10px;"; // NEW
        const title = document.createElement("div"); // NEW
        title.textContent = "Accept invite"; // NEW
        title.style.cssText = "font-weight:700;"; // NEW
        box.appendChild(title); // NEW
        const row = document.createElement("div"); // NEW
        row.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px;"; // NEW
        const email = makeInput("email", "Email"); // NEW
        const code = makeInput("text", "Invite code"); // NEW
        const name = makeInput("text", "Display name"); // NEW
        const pin = makeInput("password", "PIN"); // NEW
        row.appendChild(email); // NEW
        row.appendChild(code); // NEW
        row.appendChild(name); // NEW
        row.appendChild(pin); // NEW
        box.appendChild(row); // NEW
        const keep = authKeepRow(); // NEW
        box.appendChild(keep.row); // NEW
        box.appendChild(makeButton("Accept Invite", function () { // NEW
            const result = acceptInvite({ email: email.value, code: code.value, name: name.value, pin: pin.value }); // NEW
            pin.value = ""; // NEW
            if (!result.ok) { showAuthStatus(result.reason); return; } // NEW
            finishAuthSuccess(keep.checkbox.checked, "Invite accepted. Logged in as " + result.user.name + "."); // NEW
        })); // NEW
        parent.appendChild(box); // NEW
    } // NEW

    function showAuthDialog(options) { // NEW
        if (typeof document === "undefined") return { ok: false, reason: "Document UI is unavailable." }; // NEW
        closeAccountMenu(); // NEW
        closeAuthOverlay(false); // NEW
        const source = options || {}; // NEW
        const blocking = !!source.blocking; // NEW
        const host = document.body || (graph.container && (graph.container.parentNode || graph.container)); // NEW
        if (!host) return { ok: false, reason: "Auth host is unavailable." }; // NEW
        authOverlay = document.createElement("div"); // NEW
        authOverlay.className = "trellis-users-auth-overlay"; // NEW
        authOverlay.style.cssText = "position:fixed;inset:0;z-index:" + AUTH_OVERLAY_Z + ";background:#fff;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font:12px Arial,sans-serif;"; // CHANGE
        authOverlay.addEventListener("mousedown", function (evt) { evt.stopPropagation(); }); // NEW
        const card = document.createElement("div"); // NEW
        card.style.cssText = "width:min(460px,100%);border:1px solid #111;border-radius:4px;box-shadow:0 12px 32px rgba(0,0,0,.24);padding:14px;background:#fff;box-sizing:border-box;"; // NEW
        const header = document.createElement("div"); // NEW
        header.style.cssText = "display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:8px;"; // NEW
        const title = document.createElement("div"); // NEW
        title.textContent = isEnabled() ? "Trellis Login" : "Enable People & Access"; // CHANGE
        title.style.cssText = "font-weight:700;font-size:15px;"; // NEW
        header.appendChild(title); // NEW
        header.appendChild(makeButton(blocking ? "Close Diagram" : "Cancel", function () { // NEW
            if (blocking) closeCurrentDiagramFromAuth(); // NEW
            else closeAuthOverlay(true); // NEW
        })); // NEW
        card.appendChild(header); // NEW
        authStatusNode = document.createElement("div"); // NEW
        authStatusNode.style.cssText = "min-height:16px;color:#4B5563;margin-bottom:8px;"; // NEW
        authStatusNode.textContent = source.message || (isEnabled() ? "Log in to open this diagram." : "Enable users for this diagram."); // NEW
        card.appendChild(authStatusNode); // NEW
        if (!isEnabled()) appendAuthEnableForm(card); // NEW
        else { appendAuthLoginForm(card); appendAuthInviteForm(card); } // NEW
        authOverlay.appendChild(card); // NEW
        host.appendChild(authOverlay); // NEW
        if (blocking) setGraphAuthBlocked(true); // NEW
        return { ok: true }; // NEW
    } // NEW

    function toolbarHost() { // NEW
        return ui && (ui.toolbarContainer || ui.menubarContainer || ui.container) || (graph.container && (graph.container.parentNode || graph.container)); // NEW
    } // NEW

    function toolbarLabel() { // NEW
        const user = currentUser(); // NEW
        if (user) return user.name || "Logout"; // NEW
        return "Login"; // NEW
    } // NEW

    function updateToolbarButton() { // NEW
        if (!toolbarButton) return; // NEW
        toolbarButton.textContent = toolbarLabel(); // NEW
        toolbarButton.title = currentUser() ? "People & Access account" : (isEnabled() ? "Log in to People & Access" : "Enable People & Access"); // CHANGE
    } // NEW

    function closeAccountMenu() { // NEW
        if (accountMenu && accountMenu.parentNode) accountMenu.parentNode.removeChild(accountMenu); // NEW
        accountMenu = null; // NEW
        if (accountMenuOutsideHandler && document && typeof document.removeEventListener === "function") document.removeEventListener("mousedown", accountMenuOutsideHandler, true); // NEW
        if (accountMenuKeyHandler && document && typeof document.removeEventListener === "function") document.removeEventListener("keydown", accountMenuKeyHandler, true); // NEW
        accountMenuOutsideHandler = null; // NEW
        accountMenuKeyHandler = null; // NEW
    } // NEW

    function openAccountMenu() { // NEW
        if (typeof document === "undefined" || !toolbarButton) return; // NEW
        closeAccountMenu(); // NEW
        const host = document.body; // CHANGE
        if (!host) return; // NEW
        const user = currentUser(); // NEW
        const menuWidth = 190; // NEW
        const menuHeight = 112; // NEW
        const pos = fixedPositionNearButton(menuWidth, menuHeight, 4); // NEW
        accountMenu = document.createElement("div"); // NEW
        accountMenu.className = "trellis-users-account-menu"; // NEW
        accountMenu.style.cssText = "position:fixed;top:" + pos.top + "px;left:" + pos.left + "px;z-index:" + USERS_UI_LAYER_Z + ";background:#fff;border:1px solid #111;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,.22);padding:8px;width:" + menuWidth + "px;font:12px Arial,sans-serif;box-sizing:border-box;"; // CHANGE
        accountMenu.addEventListener("mousedown", function (evt) { evt.stopPropagation(); }); // NEW
        const label = document.createElement("div"); // NEW
        label.textContent = user ? user.name + " (" + (user.admin ? "admin" : "regular") + ")" : "Not logged in"; // NEW
        label.style.cssText = "font-weight:700;margin-bottom:8px;"; // NEW
        accountMenu.appendChild(label); // NEW
        const actions = document.createElement("div"); // NEW
        actions.style.cssText = "display:grid;grid-template-columns:1fr;gap:6px;"; // NEW
        actions.appendChild(makeButton("People & Access", function () { closeAccountMenu(); togglePanel(); })); // CHANGE
        actions.appendChild(makeButton("Logout", function () { logout(); })); // NEW
        accountMenu.appendChild(actions); // NEW
        host.appendChild(accountMenu); // NEW
        accountMenuOutsideHandler = function (evt) { // NEW
            if (evt && (evt.target === toolbarButton || (accountMenu && accountMenu.contains(evt.target)))) return; // NEW
            closeAccountMenu(); // NEW
        }; // NEW
        accountMenuKeyHandler = function (evt) { if (evt && evt.key === "Escape") closeAccountMenu(); }; // NEW
        setTimeout(function () { // NEW
            if (document && typeof document.addEventListener === "function" && accountMenu) { // NEW
                document.addEventListener("mousedown", accountMenuOutsideHandler, true); // NEW
                document.addEventListener("keydown", accountMenuKeyHandler, true); // NEW
            } // NEW
        }, 0); // NEW
    } // NEW

    function installToolbarButton() { // NEW
        if (toolbarButton || typeof document === "undefined") return; // NEW
        const host = toolbarHost(); // NEW
        if (!host) return; // NEW
        toolbarButton = document.createElement("button"); // NEW
        toolbarButton.type = "button"; // NEW
        toolbarButton.className = "geButton trellis-users-login-button"; // NEW
        toolbarButton.style.cssText = "margin:2px 4px;padding:3px 8px;cursor:pointer;"; // NEW
        toolbarButton.addEventListener("click", function (evt) { // NEW
            if (evt) evt.stopPropagation(); // NEW
            if (isLoggedIn()) togglePanel(); // CHANGE
            else showAuthDialog({ blocking: false, message: isEnabled() ? "Log in to this diagram." : "Enable users for this diagram." }); // NEW
        }); // NEW
        const historyButton = host.querySelector && host.querySelector(".trellis-changemap-history-button"); // NEW
        if (historyButton && historyButton.parentNode === host) host.insertBefore(toolbarButton, historyButton); // NEW
        else host.appendChild(toolbarButton); // NEW
        updateToolbarButton(); // NEW
    } // NEW

    function applyAuthGateIfNeeded(message) { // NEW
        if (!isEnabled()) { closeAuthOverlay(true); return false; } // NEW
        if (isLoggedIn()) { closeAuthOverlay(true); return false; } // NEW
        showAuthDialog({ blocking: true, message: message || (canBootstrapAdmin() ? "Create the first admin to open this diagram." : "Log in to open this diagram.") }); // NEW
        return true; // NEW
    } // NEW

    function handleDiagramOpened() { // NEW
        currentUserId = ""; // NEW
        restoreRememberedLogin(); // NEW
        updateToolbarButton(); // NEW
        applyAuthGateIfNeeded(); // NEW
    } // NEW

    function installFileLoadedGate() { // NEW
        if (!ui || !ui.editor || ui.__trellisUsersFileGateInstalled) return; // NEW
        ui.__trellisUsersFileGateInstalled = true; // NEW
        if (typeof ui.editor.addListener === "function") { // NEW
            ui.editor.addListener("fileLoaded", function () { handleDiagramOpened(); }); // NEW
        } // NEW
    } // NEW

    function installGraphXmlLoadGuard() { // NEW
        if (!ui || !ui.editor || ui.__trellisUsersGraphXmlGuardInstalled || typeof ui.editor.setGraphXml !== "function") return; // NEW
        ui.__trellisUsersGraphXmlGuardInstalled = true; // NEW
        const originalSetGraphXml = ui.editor.setGraphXml; // NEW
        ui.editor.setGraphXml = function () { // NEW
            const wasLoggedIn = isLoggedIn(); // NEW
            graphXmlLoading += 1; // NEW
            try { // NEW
                return originalSetGraphXml.apply(this, arguments); // NEW
            } finally { // NEW
                graphXmlLoading = Math.max(0, graphXmlLoading - 1); // NEW
                if (!wasLoggedIn) setTimeout(function () { handleDiagramOpened(); }, 0); // NEW
            } // NEW
        }; // NEW
    } // NEW

    function createPanel() {
        if (panel || typeof document === "undefined") return;
        const host = document.body; // CHANGE
        if (!host) return;
        panel = document.createElement("div");
        panel.style.cssText = "position:fixed;top:36px;right:12px;z-index:" + USERS_UI_LAYER_Z + ";background:#fff;border:1px solid #111;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,.22);width:400px;max-height:calc(100vh - 72px);overflow:auto;padding:10px;font:12px Arial,sans-serif;display:none;box-sizing:border-box;"; // CHANGE
        panel.addEventListener("mousedown", function (evt) { evt.stopPropagation(); });
        const header = document.createElement("div"); // NEW
        header.style.cssText = "display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px;"; // NEW
        const title = document.createElement("div");
        title.textContent = "People & Access"; // CHANGE
        title.style.cssText = "font-weight:700;font-size:14px;"; // CHANGE
        header.appendChild(title); // NEW
        header.appendChild(makeButton("Close", function () { if (panel) panel.style.display = "none"; })); // NEW
        panel.appendChild(header); // NEW
        statusNode = document.createElement("div");
        statusNode.style.cssText = "min-height:16px;color:#4B5563;margin-bottom:8px;";
        panel.appendChild(statusNode);
        peopleFilterNode = document.createElement("div"); // NEW
        peopleFilterNode.style.cssText = "display:none;margin-bottom:8px;"; // NEW
        panel.appendChild(peopleFilterNode); // NEW
        loginNameInput = makeInput("text", "Name");
        loginPinInput = makeInput("password", "PIN");
        rosterNode = document.createElement("div");
        accessNode = document.createElement("div");
        panel.appendChild(rosterNode);
        panel.appendChild(accessNode);
        host.appendChild(panel);
        installSelectionListener();
        refreshPanel();
    }

    function togglePanel() {
        createPanel();
        if (!panel) return;
        const opening = panel.style.display === "none"; // NEW
        panel.style.display = opening ? "" : "none"; // CHANGE
        if (opening) positionPanelNearButton(); // NEW
        refreshPanel();
    }

    function installSelectionListener() {
        if (selectionListenerInstalled) return;
        selectionListenerInstalled = true;
        const selectionModel = graph.getSelectionModel && graph.getSelectionModel();
        if (selectionModel && selectionModel.addListener) selectionModel.addListener(mxEvent.CHANGE, refreshPanel);
        if (model && model.addListener) model.addListener(mxEvent.CHANGE, function () { setTimeout(refreshPanel, 0); });
    }

    function clearNode(node) {
        while (node && node.firstChild) node.removeChild(node.firstChild);
    }

    function ensurePeopleFilterControls() { // NEW
        if (!peopleFilterNode || peopleSearchInput) return; // NEW
        const row = document.createElement("div"); // NEW
        row.style.cssText = "display:grid;grid-template-columns:minmax(130px,1fr) 116px;gap:6px;align-items:center;"; // NEW
        peopleSearchInput = makeInput("search", "Search name or email"); // NEW
        peopleSearchInput.value = peopleSearchText; // NEW
        peopleSearchInput.addEventListener("input", function () { // NEW
            peopleSearchText = peopleSearchInput.value || ""; // NEW
            refreshPanel(); // NEW
        }); // NEW
        peopleTypeFilterSelect = document.createElement("select"); // NEW
        peopleTypeFilterSelect.style.cssText = "box-sizing:border-box;width:100%;padding:4px 6px;font:12px Arial,sans-serif;"; // NEW
        [["all", "All"], ["networked", "Networked"], ["local", "Local"]].forEach(function (entry) { // NEW
            const option = document.createElement("option"); // NEW
            option.value = entry[0]; // NEW
            option.textContent = entry[1]; // NEW
            peopleTypeFilterSelect.appendChild(option); // NEW
        }); // NEW
        peopleTypeFilterSelect.value = activePeopleTypeFilter(); // NEW
        peopleTypeFilterSelect.addEventListener("change", function () { // NEW
            peopleTypeFilter = peopleTypeFilterSelect.value; // NEW
            refreshPanel(); // NEW
        }); // NEW
        row.appendChild(peopleSearchInput); // NEW
        row.appendChild(peopleTypeFilterSelect); // NEW
        peopleFilterNode.appendChild(row); // NEW
    } // NEW

    function refreshPeopleFilterControls() { // NEW
        if (!peopleFilterNode) return; // NEW
        ensurePeopleFilterControls(); // NEW
        peopleFilterNode.style.display = isEnabled() && isLoggedIn() ? "" : "none"; // NEW
        if (peopleSearchInput && peopleSearchInput.value !== peopleSearchText) peopleSearchInput.value = peopleSearchText; // NEW
        if (peopleTypeFilterSelect && peopleTypeFilterSelect.value !== activePeopleTypeFilter()) peopleTypeFilterSelect.value = activePeopleTypeFilter(); // NEW
    } // NEW

    function appendLoginSection(parent) {
        const row = document.createElement("div");
        row.style.cssText = "display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:center;margin-bottom:10px;";
        row.appendChild(loginNameInput);
        row.appendChild(loginPinInput);
        row.appendChild(makeButton(canBootstrapAdmin() ? "Create admin" : "Login", function () {
            const result = login(loginNameInput.value, loginPinInput.value);
            if (!result.ok) showStatus(result.reason);
            loginPinInput.value = "";
        }));
        parent.appendChild(row);
    }

    function appendAcceptInviteSection(parent) { // NEW
        const box = document.createElement("div"); // NEW
        box.style.cssText = "border-top:1px solid #E5E7EB;padding-top:8px;margin-top:8px;"; // NEW
        const title = document.createElement("div"); // NEW
        title.textContent = "Accept invite"; // NEW
        title.style.fontWeight = "700"; // NEW
        box.appendChild(title); // NEW
        const row = document.createElement("div"); // NEW
        row.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;"; // NEW
        const email = makeInput("email", "Email"); // NEW
        const code = makeInput("text", "Invite code"); // NEW
        const name = makeInput("text", "Display name"); // NEW
        const pin = makeInput("password", "PIN"); // NEW
        row.appendChild(email); // NEW
        row.appendChild(code); // NEW
        row.appendChild(name); // NEW
        row.appendChild(pin); // NEW
        box.appendChild(row); // NEW
        const actions = document.createElement("div"); // NEW
        actions.style.cssText = "display:flex;justify-content:flex-end;margin-top:6px;"; // NEW
        actions.appendChild(makeButton("Accept Invite", function () { // NEW
            const result = acceptInvite({ email: email.value, code: code.value, name: name.value, pin: pin.value }); // NEW
            if (!result.ok) showStatus(result.reason); // NEW
            pin.value = ""; // NEW
        })); // NEW
        box.appendChild(actions); // NEW
        parent.appendChild(box); // NEW
    } // NEW

    function appendEnableSection(parent) { // NEW
        const hint = document.createElement("div"); // NEW
        hint.style.cssText = "color:#4B5563;margin-bottom:8px;"; // NEW
        hint.textContent = "Users are off for this diagram. Enable users to require login and apply owner/access permissions."; // NEW
        parent.appendChild(hint); // NEW
        const row = document.createElement("div"); // NEW
        row.style.cssText = "display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:center;margin-bottom:10px;"; // NEW
        row.appendChild(loginNameInput); // NEW
        row.appendChild(loginPinInput); // NEW
        row.appendChild(makeButton("Enable", function () { // NEW
            const result = enableUsers(loginNameInput.value, loginPinInput.value); // NEW
            if (!result.ok) showStatus(result.reason); // NEW
            loginPinInput.value = ""; // NEW
        })); // NEW
        parent.appendChild(row); // NEW
    } // NEW

    function appendPendingInvites(parent) { // NEW
        if (!isEnabled() || !isLoggedIn()) return; // NEW
        const invites = listPendingInvites().filter(inviteMatchesPeopleFilter); // CHANGE
        if (!invites.length) return; // NEW
        const box = document.createElement("div"); // NEW
        box.style.cssText = "border-top:1px solid #E5E7EB;padding-top:8px;margin-top:8px;"; // NEW
        const title = document.createElement("div"); // NEW
        title.textContent = "Pending invites"; // NEW
        title.style.fontWeight = "700"; // NEW
        box.appendChild(title); // NEW
        invites.forEach(function (invite) { // NEW
            const row = document.createElement("div"); // NEW
            row.style.cssText = "display:grid;grid-template-columns:minmax(80px,1fr) auto auto;gap:6px;align-items:center;padding:3px 0;"; // NEW
            const label = document.createElement("div"); // NEW
            label.textContent = invite.email + " - expires " + new Date(invite.expiresAt).toLocaleDateString(); // NEW
            label.title = (invite.scopeLabels || []).join(", "); // NEW
            row.appendChild(label); // NEW
            row.appendChild(makeButton("Resend", function () { // NEW
                const result = resendInvite(invite.id, {}); // NEW
                if (!result.ok) { showStatus(result.reason); return; } // NEW
                openEmailDraft(result.emailDraft); // NEW
            })); // NEW
            row.appendChild(makeButton("Revoke", function () { // NEW
                const result = revokeInvite(invite.id); // NEW
                if (!result.ok) showStatus(result.reason); // NEW
            })); // NEW
            box.appendChild(row); // NEW
        }); // NEW
        parent.appendChild(box); // NEW
    } // NEW

    function appendSessionSection(parent) {
        const user = currentUser();
        const row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px;";
        const text = document.createElement("div");
        text.textContent = user ? user.name + " (" + (user.admin ? "admin" : "regular") + ")" : "Not logged in";
        row.appendChild(text);
        row.appendChild(makeButton("Logout", logout));
        parent.appendChild(row);
    }

    function appendResetPinRow(parent, user) { // NEW
        const resetRow = document.createElement("div"); // NEW
        resetRow.style.cssText = "display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center;padding:0 0 6px 0;margin-left:12px;"; // NEW
        const pinInput = makeInput("password", "New PIN"); // NEW
        resetRow.appendChild(pinInput); // NEW
        resetRow.appendChild(makeButton("Save", function () { // NEW
            const result = resetUserPin(user.id, pinInput.value); // NEW
            if (!result.ok) { showStatus(result.reason); return; } // NEW
            pinInput.value = ""; // NEW
            resetPinUserId = ""; // NEW
            showStatus("PIN reset for " + user.name + "."); // NEW
            refreshPanel(); // NEW
        })); // NEW
        resetRow.appendChild(makeButton("Cancel", function () { // NEW
            resetPinUserId = ""; // NEW
            refreshPanel(); // NEW
        })); // NEW
        parent.appendChild(resetRow); // NEW
        setTimeout(function () { if (pinInput && typeof pinInput.focus === "function") pinInput.focus(); }, 0); // NEW
    } // NEW

    function appendAdminUserRow(parent, user) { // NEW
        const row = document.createElement("div"); // NEW
        row.style.cssText = "display:grid;grid-template-columns:minmax(80px,1fr) minmax(120px,160px) auto auto auto;gap:6px;align-items:center;padding:3px 0;"; // CHANGE
        row.appendChild(document.createTextNode(user.name + (user.admin ? " - admin" : "") + (user.disabled ? " - disabled" : ""))); // NEW
        const roleSelect = document.createElement("select"); // NEW
        roleSelect.style.cssText = "box-sizing:border-box;width:100%;padding:3px 5px;font:12px Arial,sans-serif;"; // NEW
        const none = document.createElement("option"); // NEW
        none.value = ""; // NEW
        none.textContent = "No role card"; // NEW
        roleSelect.appendChild(none); // NEW
        listRoleCards().forEach(function (role) { // NEW
            const option = document.createElement("option"); // NEW
            option.value = role.id; // NEW
            option.textContent = role.label + (role.userId && role.userId !== user.id ? " (linked)" : ""); // NEW
            roleSelect.appendChild(option); // NEW
        }); // NEW
        const linked = getUserRoleCard(user.id); // NEW
        roleSelect.value = linked ? linked.id : ""; // NEW
        roleSelect.addEventListener("change", function () { // NEW
            const role = roleSelect.value ? (model.getCell && model.getCell(roleSelect.value)) : (linked && linked.cell); // NEW
            if (!role) return; // NEW
            const result = setUserRoleCard(roleSelect.value ? user.id : "", role); // NEW
            if (!result.ok) showStatus(result.reason); // NEW
        }); // NEW
        row.appendChild(roleSelect); // NEW
        const adminToggle = makeButton(user.admin ? "Regular" : "Admin", function () { // NEW
            const result = setUserAdmin(user.id, !user.admin); // NEW
            if (!result.ok) showStatus(result.reason); // NEW
        }); // NEW
        const disableToggle = makeButton(user.disabled ? "Reactivate" : "Disable", function () { // NEW
            const result = setUserDisabled(user.id, !user.disabled); // NEW
            if (!result.ok) showStatus(result.reason); // NEW
        }); // NEW
        const resetPin = makeButton("PIN", function () { // NEW
            resetPinUserId = resetPinUserId === user.id ? "" : user.id; // NEW
            refreshPanel(); // NEW
        }); // NEW
        row.appendChild(adminToggle); // NEW
        row.appendChild(disableToggle); // NEW
        row.appendChild(resetPin); // NEW
        parent.appendChild(row); // NEW
        if (resetPinUserId === user.id) appendResetPinRow(parent, user); // NEW
    } // NEW

    function appendUserGroup(parent, titleText, users) { // NEW
        const group = document.createElement("div"); // NEW
        group.className = "trellis-users-user-group"; // NEW
        group.setAttribute("data-trellis-users-group", titleText); // NEW
        group.style.cssText = "margin-top:8px;"; // NEW
        const title = document.createElement("div"); // NEW
        title.textContent = titleText; // NEW
        title.style.cssText = "font-weight:700;color:#111827;"; // NEW
        group.appendChild(title); // NEW
        if (users.length) users.forEach(function (user) { appendAdminUserRow(group, user); }); // NEW
        else { // NEW
            const empty = document.createElement("div"); // NEW
            empty.style.cssText = "color:#6B7280;padding:3px 0;"; // NEW
            empty.textContent = filteredEmptyText(titleText); // CHANGE
            group.appendChild(empty); // NEW
        } // NEW
        parent.appendChild(group); // NEW
        return group; // NEW
    } // NEW

    function appendLocalUserCreator(parent) { // NEW
        const addRow = document.createElement("div"); // NEW
        addRow.style.cssText = "display:grid;grid-template-columns:1fr 72px auto;gap:6px;margin-top:6px;"; // NEW
        const name = makeInput("text", "Local user"); // NEW
        const pin = makeInput("password", "PIN"); // NEW
        addRow.appendChild(name); // NEW
        addRow.appendChild(pin); // NEW
        addRow.appendChild(makeButton("Add local user", function () { // NEW
            const result = createUser(name.value, pin.value, false); // NEW
            if (!result.ok) showStatus(result.reason); // NEW
            name.value = ""; // NEW
            pin.value = ""; // NEW
        })); // NEW
        parent.appendChild(addRow); // NEW
    } // NEW

    function appendAdminRoster(parent) {
        if (!isEnabled() || !isAdmin()) return; // CHANGE
        const box = document.createElement("div");
        box.style.cssText = "border-top:1px solid #E5E7EB;padding-top:8px;margin-top:8px;";
        const title = document.createElement("div");
        title.textContent = "Users"; // CHANGE
        title.style.fontWeight = "700";
        box.appendChild(title);
        const users = listUsers().filter(userMatchesPeopleFilter); // CHANGE
        if (activePeopleTypeFilter() !== "local") appendUserGroup(box, "Networked users", users.filter(userIsNetworked)); // CHANGE
        if (activePeopleTypeFilter() !== "networked") { // NEW
            const localGroup = appendUserGroup(box, "Local users", users.filter(function (user) { return !userIsNetworked(user); })); // CHANGE
            appendLocalUserCreator(localGroup); // NEW
        } // NEW
        parent.appendChild(box);
    }

    function presetLabel(preset) { // NEW
        const normalized = normalizePreset(preset); // NEW
        return normalized.charAt(0).toUpperCase() + normalized.slice(1); // NEW
    } // NEW

    function capabilityLabel(capability) { // NEW
        return ({ // NEW
            create_plantings: "Create plantings", // NEW
            manage_own_plantings: "Manage own plantings", // NEW
            move_tasks: "Move tasks", // NEW
            edit_task_details: "Edit task details", // NEW
            manage_scope_content: "Manage scope content", // NEW
            manage_access: "Manage access" // NEW
        })[capability] || capability; // NEW
    } // NEW

    function makePresetSelect(value, onChange) { // NEW
        const select = document.createElement("select"); // NEW
        select.style.cssText = "box-sizing:border-box;width:100%;padding:4px 6px;font:12px Arial,sans-serif;"; // NEW
        ACCESS_PRESETS.forEach(function (preset) { // NEW
            const option = document.createElement("option"); // NEW
            option.value = preset; // NEW
            option.textContent = presetLabel(preset); // NEW
            select.appendChild(option); // NEW
        }); // NEW
        select.value = normalizePreset(value); // NEW
        select.addEventListener("change", function () { onChange(select.value); }); // NEW
        return select; // NEW
    } // NEW

    function appendCapabilityCheckboxes(parent, grant, onChange) { // NEW
        const selected = new Set(normalizeCapabilities(grant && grant.capabilities, grant && grant.preset)); // NEW
        const wrap = document.createElement("div"); // NEW
        wrap.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:3px 8px;margin-top:4px;color:#374151;"; // NEW
        DOMAIN_CAPABILITIES.forEach(function (capability) { // NEW
            const label = document.createElement("label"); // NEW
            label.style.cssText = "display:flex;gap:4px;align-items:center;font-size:11px;"; // NEW
            const input = document.createElement("input"); // NEW
            input.type = "checkbox"; // NEW
            input.checked = selected.has(capability); // NEW
            input.addEventListener("change", function () { // NEW
                if (input.checked) selected.add(capability); else selected.delete(capability); // NEW
                onChange(Array.from(selected).sort()); // NEW
            }); // NEW
            label.appendChild(input); // NEW
            label.appendChild(document.createTextNode(capabilityLabel(capability))); // NEW
            wrap.appendChild(label); // NEW
        }); // NEW
        parent.appendChild(wrap); // NEW
    } // NEW

    function grantForUser(summary, userId) { // NEW
        return (summary.directGrants || []).find(function (grant) { return grant.userId === userId; }) || { userId, preset: "viewer", capabilities: [] }; // NEW
    } // NEW

    function appendScopeSummary(parent, summaries) { // NEW
        const list = Array.isArray(summaries) ? summaries : []; // NEW
        if (!list.length) return; // NEW
        const wrap = document.createElement("div"); // NEW
        wrap.className = "trellis-users-selected-scopes"; // NEW
        wrap.style.cssText = "color:#374151;margin:4px 0 6px 0;"; // NEW
        list.forEach(function (scope) { // NEW
            const line = document.createElement("div"); // NEW
            line.textContent = titleCaseScopeType(scope.type) + ": " + scope.label; // NEW
            wrap.appendChild(line); // NEW
        }); // NEW
        parent.appendChild(wrap); // NEW
    } // NEW

    function appendGrantedBadge(parent) { // NEW
        const badge = document.createElement("span"); // NEW
        badge.textContent = "Granted"; // NEW
        badge.style.cssText = "display:inline-block;margin-left:6px;padding:1px 5px;border:1px solid #9CA3AF;border-radius:3px;color:#374151;font-size:10px;line-height:14px;"; // NEW
        parent.appendChild(badge); // NEW
    } // NEW

    function appendAccessSection(parent) {
        if (!isEnabled()) return; // NEW
        const cell = selectedCell();
        if (!cell || cell === model.getRoot()) {
            const empty = document.createElement("div");
            empty.style.cssText = "border-top:1px solid #E5E7EB;padding-top:8px;color:#6B7280;";
            empty.textContent = "Select a module, board, or cell to manage access.";
            parent.appendChild(empty);
            return;
        }
        const summary = getAccessSummary(cell);
        const box = document.createElement("div");
        box.style.cssText = "border-top:1px solid #E5E7EB;padding-top:8px;margin-top:8px;";
        const title = document.createElement("div");
        title.textContent = "Selected access";
        title.style.fontWeight = "700";
        box.appendChild(title);
        const summaries = selectedScopeSummaries(); // NEW
        appendScopeSummary(box, summaries); // NEW
        if (summaries.length > 1) { // NEW
            const multi = document.createElement("div"); // NEW
            multi.style.cssText = "color:#6B7280;margin:4px 0;"; // NEW
            multi.textContent = "Access editor is hidden while multiple scopes are selected."; // NEW
            box.appendChild(multi); // NEW
            parent.appendChild(box); // NEW
            return; // NEW
        } // NEW
        const owner = userById(summary.ownerUserId);
        const ownerText = document.createElement("div");
        ownerText.style.cssText = "color:#4B5563;margin:4px 0;";
        ownerText.textContent = "Owner: " + (owner ? owner.name : (summary.ownerUserId || "none"));
        box.appendChild(ownerText);
        if (!summary.canManageAccess) {
            const denied = document.createElement("div");
            denied.style.color = "#6B7280";
            denied.textContent = summary.canEdit ? "You can edit this cell." : "You do not have access to this cell.";
            box.appendChild(denied);
            parent.appendChild(box);
            return;
        }
        if (summary.canTransferOwnership) { // NEW
            const ownerSelect = document.createElement("select"); // NEW
            ownerSelect.style.cssText = "box-sizing:border-box;width:100%;margin:4px 0 6px 0;padding:4px 6px;font:12px Arial,sans-serif;"; // NEW
            listUsers().filter(function (user) { return !user.disabled; }).forEach(function (user) { // NEW
                const option = document.createElement("option"); // NEW
                option.value = user.id; // NEW
                option.textContent = user.name + (user.admin ? " (admin)" : ""); // NEW
                ownerSelect.appendChild(option); // NEW
            }); // NEW
            ownerSelect.value = summary.ownerUserId || ""; // NEW
            ownerSelect.addEventListener("change", function () { // NEW
                const result = setOwner(cell, ownerSelect.value); // NEW
                if (!result.ok) showStatus(result.reason); // NEW
            }); // NEW
            box.appendChild(ownerSelect); // NEW
        } // NEW
        if (isRoleCard(cell)) { // NEW
            const roleLink = document.createElement("div"); // NEW
            roleLink.style.cssText = "border:1px solid #E5E7EB;border-radius:4px;padding:6px;margin:6px 0;"; // NEW
            const label = document.createElement("div"); // NEW
            label.textContent = "Linked Trellis user"; // NEW
            label.style.cssText = "font-weight:700;margin-bottom:4px;"; // NEW
            roleLink.appendChild(label); // NEW
            const select = document.createElement("select"); // NEW
            select.style.cssText = "box-sizing:border-box;width:100%;padding:4px 6px;font:12px Arial,sans-serif;"; // NEW
            const none = document.createElement("option"); // NEW
            none.value = ""; // NEW
            none.textContent = "No linked user"; // NEW
            select.appendChild(none); // NEW
            listUsers().filter(function (user) { return !user.disabled; }).forEach(function (user) { // NEW
                const option = document.createElement("option"); // NEW
                option.value = user.id; // NEW
                option.textContent = user.name + (user.admin ? " (admin)" : ""); // NEW
                select.appendChild(option); // NEW
            }); // NEW
            select.value = getAttr(cell, ATTR_ROLE_USER) || ""; // NEW
            select.disabled = !summary.canTransferOwnership; // NEW
            select.addEventListener("change", function () { // NEW
                const result = setUserRoleCard(select.value, cell); // NEW
                if (!result.ok) showStatus(result.reason); // NEW
            }); // NEW
            roleLink.appendChild(select); // NEW
            box.appendChild(roleLink); // NEW
        } // NEW
        const caps = document.createElement("div"); // NEW
        caps.style.cssText = "color:#4B5563;margin:4px 0;"; // NEW
        caps.textContent = "Your effective access: " + (summary.effectiveCapabilities.length ? summary.effectiveCapabilities.map(capabilityLabel).join(", ") : "Viewer"); // NEW
        box.appendChild(caps); // NEW
        if (summary.roleDerivedTask) { // NEW
            const roleDerived = document.createElement("div"); // NEW
            roleDerived.style.cssText = "color:#2563EB;margin:4px 0;"; // NEW
            roleDerived.textContent = "Task access also comes from your linked role card."; // NEW
            box.appendChild(roleDerived); // NEW
        } // NEW
        const grantUsers = listUsers().filter(function (user) { return !user.admin && !user.disabled; }); // NEW
        const visibleGrantUsers = grantUsers.filter(userMatchesPeopleFilter); // NEW
        const hiddenGrantCount = grantUsers.filter(function (user) { return summary.directUserIds.indexOf(user.id) >= 0 && !userMatchesPeopleFilter(user); }).length; // NEW
        if (hiddenGrantCount) { // NEW
            const hidden = document.createElement("div"); // NEW
            hidden.style.cssText = "color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;border-radius:3px;padding:4px 6px;margin:6px 0;"; // NEW
            hidden.textContent = hiddenGrantCount + " granted " + (hiddenGrantCount === 1 ? "user is" : "users are") + " hidden by the current filter."; // NEW
            box.appendChild(hidden); // NEW
        } // NEW
        if (!visibleGrantUsers.length) { // NEW
            const empty = document.createElement("div"); // NEW
            empty.style.cssText = "color:#6B7280;padding:6px 0;border-top:1px solid #F3F4F6;"; // NEW
            empty.textContent = "No access rows match the current filter."; // NEW
            box.appendChild(empty); // NEW
        } // NEW
        visibleGrantUsers.forEach(function (user) { // CHANGE
            const grant = grantForUser(summary, user.id); // NEW
            const directlyGranted = summary.directUserIds.indexOf(user.id) >= 0; // NEW
            const row = document.createElement("div"); // NEW
            row.style.cssText = "border-top:1px solid #F3F4F6;padding:6px 0;"; // NEW
            const head = document.createElement("div"); // NEW
            head.style.cssText = "display:grid;grid-template-columns:minmax(70px,1fr) 130px auto;gap:6px;align-items:center;"; // NEW
            const name = document.createElement("div"); // NEW
            name.textContent = user.name; // NEW
            if (directlyGranted) appendGrantedBadge(name); // NEW
            head.appendChild(name); // NEW
            head.appendChild(makePresetSelect(grant.preset, function (preset) { // NEW
                const result = setScopeGrant(cell, { userId: user.id, preset }); // NEW
                if (!result.ok) showStatus(result.reason); // NEW
            })); // NEW
            head.appendChild(makeButton(directlyGranted ? "Remove" : "Apply", function () { // CHANGE
                const result = directlyGranted ? removeScopeGrant(cell, user.id) : setScopeGrant(cell, { userId: user.id, preset: grant.preset || "viewer" }); // CHANGE
                if (!result.ok) showStatus(result.reason); // NEW
            })); // NEW
            row.appendChild(head); // NEW
            appendCapabilityCheckboxes(row, grant, function (capabilities) { // NEW
                const result = setScopeGrant(cell, { userId: user.id, preset: grant.preset || "viewer", capabilities }); // NEW
                if (!result.ok) showStatus(result.reason); // NEW
            }); // NEW
            box.appendChild(row); // NEW
        });
        parent.appendChild(box);
    }

    function refreshPanel() {
        if (!panel || !rosterNode || !accessNode) return;
        refreshPeopleFilterControls(); // NEW
        clearNode(rosterNode);
        clearNode(accessNode);
        if (!isEnabled()) appendEnableSection(rosterNode); // NEW
        else if (isLoggedIn()) appendSessionSection(rosterNode); // CHANGE
        else { appendLoginSection(rosterNode); appendAcceptInviteSection(rosterNode); } // CHANGE
        appendAdminRoster(rosterNode);
        appendPendingInvites(rosterNode); // NEW
        if (isEnabled() && isLoggedIn()) appendAccessSection(accessNode); // CHANGE
    }

    function installAction() {
        if (!ui || !ui.actions || ui.__trellisUsersActionInstalled) return;
        ui.__trellisUsersActionInstalled = true;
        ui.actions.addAction("trellisUsers", function () { togglePanel(); });
        const extras = ui.menus && ui.menus.get && ui.menus.get("extras");
        if (extras && !extras.__trellisUsersPatched) {
            const oldFunct = extras.funct;
            extras.funct = function (menu, parent) {
                if (oldFunct) oldFunct.apply(this, arguments);
                if (ui.menus && ui.menus.addMenuItems) ui.menus.addMenuItems(menu, ["trellisUsers"], parent);
            };
            extras.__trellisUsersPatched = true;
        }
    }

    function promptLoginIfNeeded() {
        setTimeout(function () {
            restoreRememberedLogin(); // NEW
            applyAuthGateIfNeeded(); // CHANGE
            updateToolbarButton(); // NEW
        }, 0);
    }

    model.addListener(mxEvent.CHANGE, inspectModelChange);
    installAction();
    installToolbarButton(); // NEW
    installFileLoadedGate(); // NEW
    installGraphXmlLoadGuard(); // NEW
    promptLoginIfNeeded();

    window.Trellis = window.Trellis || {};
    window.Trellis.users = {
        isEnabled, // NEW
        getCurrentUser: function () { return publicUser(currentUser()); },
        isLoggedIn,
        isAdmin,
        canEditCell,
        canAddCell,
        canDeleteCell,
        canManageAccess,
        canCreatePlanting, // NEW
        canManagePlanting, // NEW
        canMoveTask, // NEW
        canEditTaskDetails, // NEW
        effectiveCapabilitiesForCell, // NEW
        getAccessSummary,
        withActorMetadata,
        listUsers,
        enableUsers, // NEW
        login,
        logout,
        showAuthDialog, // NEW
        rememberLogin, // NEW
        forgetRememberedLogin, // NEW
        restoreRememberedLogin, // NEW
        createUser,
        resetUserPin, // NEW
        setUserAdmin, // NEW
        setUserDisabled, // NEW
        createPendingInvite, // NEW
        acceptInvite, // NEW
        revokeInvite, // NEW
        resendInvite, // NEW
        listPendingInvites, // NEW
        canInviteScopes, // NEW
        getEligibleShareScopes, // NEW
        getScopeGrants, // NEW
        setScopeGrant, // NEW
        removeScopeGrant, // NEW
        listRoleCards, // NEW
        getUserRoleCard, // NEW
        setUserRoleCard, // NEW
        setAccess,
        setOwner,
        stampCreatedOwner,
        stampActorOnCell,
        attrs: {
            owner: ATTR_OWNER,
            accessUsers: ATTR_ACCESS_USERS,
            accessGrants: ATTR_ACCESS_GRANTS, // NEW
            accessOpen: ATTR_ACCESS_OPEN,
            roleUser: ATTR_ROLE_USER, // NEW
            createdBy: ATTR_CREATED_BY,
            editedBy: ATTR_EDITED_BY
        },
        capabilities: { // NEW
            createPlantings: CAP_CREATE_PLANTINGS, // NEW
            manageOwnPlantings: CAP_MANAGE_OWN_PLANTINGS, // NEW
            moveTasks: CAP_MOVE_TASKS, // NEW
            editTaskDetails: CAP_EDIT_TASK_DETAILS, // NEW
            manageScopeContent: CAP_MANAGE_SCOPE_CONTENT, // NEW
            manageAccess: CAP_MANAGE_ACCESS // NEW
        }, // NEW
        _test: {
            readStore,
            writeStore,
            hashPin,
            hashInviteCode, // NEW
            nearestOwnedAncestor,
            nearestAccessGrant,
            roleLinkedBoardGrantsForUser, // NEW
            changeAllowed,
            composeInviteEmail, // NEW
            getDiagramLoginKey, // NEW
            applyAuthGateIfNeeded, // CHANGE
            refreshPanel // NEW
        }
    };
    graph.__trellisUsers = window.Trellis.users;
    installTrellisDebugSurface(); // NEW
    consoleGroup("[TrellisUsers] loaded", usersDebugStatus()); // NEW
});
