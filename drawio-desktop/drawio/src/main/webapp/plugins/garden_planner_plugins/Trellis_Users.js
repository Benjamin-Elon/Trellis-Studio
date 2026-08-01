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
    const ATTR_ACCESS_GRANTS = "trellis_access_grants_json";
    const ATTR_ACCESS_OPEN = "trellis_access_open";
    const ATTR_ROLE_USER = "trellis_role_user_id";
    const ATTR_ROLE_GARDEN_MODULE = "trellis_role_garden_module_id";
    const ATTR_ROLE_TEAM_MODULE = "trellis_role_team_module_id";
    const ATTR_ROLE_ARCHIVED_USER = "trellis_role_archived_user_id";
    const ATTR_ROLE_INACTIVE = "trellis_role_inactive";
    const ATTR_GARDEN_TEAM_MODULE = "trellis_team_module_id";
    const ATTR_TEAM_GARDEN_MODULE = "trellis_garden_module_id";
    const ATTR_GARDEN_TASK_MODULE = "trellis_task_module_id";
    const ATTR_TASK_GARDEN_MODULE = "trellis_garden_module_id";
    const ATTR_TEAM_ROLE_ARCHIVE = "trellis_team_role_archive_json";
    const ATTR_CREATED_BY = "createdByUserId";
    const ATTR_EDITED_BY = "lastEditedByUserId";
    const ATTR_ACTOR_NAME = "trellis_actor_name";
    const ATTR_ACTOR_ROLE = "trellis_actor_role";
    const ATTR_REMEMBER_DIAGRAM_ID = "trellis_users_diagram_id";
    const ATTR_HISTORY_ID = "trellis_history_id";

    const PROTECTED_ATTRS = new Set([ATTR_STORE, ATTR_OWNER, ATTR_ACCESS_USERS, ATTR_ACCESS_GRANTS, ATTR_ACCESS_OPEN, ATTR_ROLE_USER, ATTR_ROLE_GARDEN_MODULE, ATTR_ROLE_TEAM_MODULE, ATTR_ROLE_ARCHIVED_USER, ATTR_ROLE_INACTIVE, ATTR_GARDEN_TEAM_MODULE, ATTR_TEAM_GARDEN_MODULE, ATTR_TEAM_ROLE_ARCHIVE]);
    const ACCESS_PRESETS = ["visitor", "gardener", "coordinator"];
    const CAP_CREATE_PLANTINGS = "create_plantings";
    const CAP_MANAGE_OWN_PLANTINGS = "manage_own_plantings";
    const CAP_MOVE_TASKS = "move_tasks";
    const CAP_EDIT_TASK_DETAILS = "edit_task_details";
    const CAP_MANAGE_SCOPE_CONTENT = "manage_scope_content";
    const CAP_MANAGE_ACCESS = "manage_access";
    const DOMAIN_CAPABILITIES = [CAP_CREATE_PLANTINGS, CAP_MANAGE_OWN_PLANTINGS, CAP_MOVE_TASKS, CAP_EDIT_TASK_DETAILS, CAP_MANAGE_SCOPE_CONTENT, CAP_MANAGE_ACCESS];
    const PRESET_CAPABILITIES = {
        visitor: [],
        gardener: [CAP_CREATE_PLANTINGS, CAP_MANAGE_OWN_PLANTINGS, CAP_MOVE_TASKS, CAP_EDIT_TASK_DETAILS],
        coordinator: [CAP_CREATE_PLANTINGS, CAP_MANAGE_OWN_PLANTINGS, CAP_MOVE_TASKS, CAP_EDIT_TASK_DETAILS, CAP_MANAGE_SCOPE_CONTENT, CAP_MANAGE_ACCESS]
    };
    const TASK_DETAIL_ATTRS = new Set(["label", "title", "notes", "card_note", "start", "end", "due", "assigned_day", "task_estimated_hours", "scheduler_dates_locked"]);
    const TASK_ASSIGNMENT_ATTRS = new Set(["task_assignee_role_ids_json"]);
    const SCOPE_GRANT_ATTRS = new Set([ATTR_ACCESS_USERS, ATTR_ACCESS_GRANTS, ATTR_ACCESS_OPEN]);
    const USER_ID_PREFIX = "user_";
    const PIN_SALT_PREFIX = "salt_";
    const DIAGRAM_ID_PREFIX = "diagram_users_";
    const INVITE_ID_PREFIX = "invite_";
    const ACCESS_REQUEST_ID_PREFIX = "access_request_";
    const ACCESS_MESSAGE_ID_PREFIX = "access_message_";
    const INVITE_CODE_SALT_PREFIX = "invite_salt_";
    const INVITE_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;
    const REMEMBER_STORAGE_PREFIX = "trellis_users_remembered_login_v1:";
    const USERS_UI_LAYER_Z = 2000000000;
    const AUTH_OVERLAY_Z = 2147483000;
    const REJECTED_EDIT_POPOVER_MS = 2500;
    const INTERNAL_FLAG = "__trellisUsersInternalChange";
    const REJECT_FLAG = "__trellisUsersRejecting";

    function applyUsersButtonStyle(button, variant, options) {
        if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === "function") {
            window.Trellis.ui.applyButtonStyle(button, variant, options);
        } else if (button) {
            const normalized = variant || "neutral"; // CHANGE: local fallback needs the normalized variant for active styling
            const activeOpen = normalized === "open" && options && options.active === true; // CHANGE: support the shared active-open state even before Trellis UI loads
            const style = { open: ["#2563eb", activeOpen ? "#1e3a8a" : "#1d4ed8", activeOpen ? "#eff6ff" : "#fff"], add: ["#188038", "#166534", "#fff"], close: ["#b91c1c", "#b91c1c", "#fff"], danger: ["#b91c1c", "#fff", "#b91c1c"], neutral: ["#6b7280", "#111827", "#fff"] }[normalized] || ["#6b7280", "#111827", "#fff"]; // NEW
            button.setAttribute("data-trellis-button-variant", normalized);
            button.style.border = "1px solid " + style[0]; // CHANGE
            button.style.background = style[2]; // CHANGE
            button.style.color = style[1]; // CHANGE
            if (activeOpen) button.style.fontWeight = "700"; // CHANGE: fallback active emphasis
        }
        return button;
    }

    let currentUserId = "";
    let panel = null;
    let statusNode = null;
    let peopleFilterNode = null;
    let peopleSearchInput = null;
    let peopleTypeFilterSelect = null;
    let loginNameInput = null;
    let loginPinInput = null;
    let rosterNode = null;
    let accessNode = null;
    let resetPinUserId = "";
    let peopleSearchText = "";
    let peopleTypeFilter = "all";
    let openGardenAccessUserId = "";
    let gardenAccessSearchText = "";
    let gardenAccessOutsideHandler = null;
    let gardenAccessKeyHandler = null;
    let authOverlay = null;
    let authStatusNode = null;
    let toolbarButton = null;
    let accountMenu = null;
    let accountMenuOutsideHandler = null;
    let accountMenuKeyHandler = null;
    let graphAuthBlocked = false;
    let graphXmlLoading = 0;
    let selectionListenerInstalled = false;
    let lastGraphPointerPoint = null;
    let rejectedEditPopover = null;
    let rejectedEditDismissTimer = 0;
    let rejectedEditDismissPaused = false;
    let rejectedEditKeyHandler = null;
    let rejectedEditOutsideHandler = null;

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

    function ensureXmlValueDirect(cell) {
        if (!cell) return null;
        const value = cell.value;
        if (value && typeof value === "object" && value.nodeType === 1) return value;
        const doc = mxUtils.createXmlDocument();
        const obj = doc.createElement("object");
        if (value != null && value !== "") obj.setAttribute("label", String(value));
        cell.value = obj;
        return obj;
    }

    function cloneCellValueForUndo(value) {
        return value && typeof value === "object" && typeof value.cloneNode === "function" ? value.cloneNode(true) : value;
    }

    function TrellisUsersValueChange(cell, previous, value) {
        this.cell = cell;
        this.previous = previous;
        this.value = value;
        this.__trellisUsersActorStamp = true;
    }

    TrellisUsersValueChange.prototype.execute = function () {
        if (!this.cell) return;
        const next = this.previous;
        this.previous = this.cell.value;
        this.cell.value = next;
    };

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
            email: normalizeEmail(source.email || ""),
            pinSalt: String(source.pinSalt || ""),
            pinHash: String(source.pinHash || ""),
            admin: !!source.admin,
            disabled: !!source.disabled,
            createdAt: Number(source.createdAt) || nowMs()
        };
    }

    function normalizePendingUser(user) {
        const source = user || {};
        const id = String(source.id || "").trim();
        const email = normalizeEmail(source.email || "");
        if (!id || !email) return null;
        return {
            id,
            email,
            invitedBy: String(source.invitedBy || ""),
            invitedAt: Number(source.invitedAt) || nowMs(),
            disabled: !!source.disabled
        };
    }

    function normalizeInvite(invite) {
        const source = invite || {};
        const id = String(source.id || "").trim();
        const pendingUserId = String(source.pendingUserId || "").trim();
        const email = normalizeEmail(source.email || "");
        if (!id || !pendingUserId || !email) return null;
        return {
            id,
            pendingUserId,
            email,
            codeSalt: String(source.codeSalt || ""),
            codeHash: String(source.codeHash || ""),
            scopeCellIds: Array.isArray(source.scopeCellIds) ? Array.from(new Set(source.scopeCellIds.map(String).filter(Boolean))).sort() : [],
            scopeLabels: Array.isArray(source.scopeLabels) ? source.scopeLabels.map(String).filter(Boolean) : [],
            preset: normalizePreset(source.preset),
            capabilities: normalizeCapabilities(source.capabilities, source.preset),
            createdBy: String(source.createdBy || ""),
            createdAt: Number(source.createdAt) || nowMs(),
            expiresAt: Number(source.expiresAt) || (nowMs() + INVITE_EXPIRY_MS),
            status: String(source.status || "pending")
        };
    }

    function normalizeAccessRequest(request) {
        const source = request || {};
        const id = String(source.id || "").trim();
        const requesterUserId = String(source.requesterUserId || "").trim();
        const scopeCellId = String(source.scopeCellId || "").trim();
        if (!id || !requesterUserId || !scopeCellId) return null;
        const status = String(source.status || "pending").toLowerCase() === "denied" ? "denied" : "pending";
        return {
            id,
            requesterUserId,
            scopeCellId,
            scopeType: String(source.scopeType || "scope"),
            scopeLabel: String(source.scopeLabel || source.scopeCellId || "Scope"),
            requestedPreset: normalizePreset(source.requestedPreset || source.preset),
            note: String(source.note || ""),
            status,
            createdAt: Number(source.createdAt) || nowMs(),
            updatedAt: Number(source.updatedAt) || Number(source.createdAt) || nowMs(),
            decidedBy: String(source.decidedBy || ""),
            decidedAt: Number(source.decidedAt) || 0,
            decisionNote: String(source.decisionNote || "")
        };
    }

    function normalizeAccessMessage(message) {
        const source = message || {};
        const id = String(source.id || "").trim();
        const requesterUserId = String(source.requesterUserId || "").trim();
        const scopeCellId = String(source.scopeCellId || "").trim();
        const decision = String(source.decision || "").toLowerCase() === "denied" ? "denied" : "approved";
        if (!id || !requesterUserId || !scopeCellId) return null;
        return {
            id,
            requestId: String(source.requestId || ""),
            requesterUserId,
            reviewerUserId: String(source.reviewerUserId || source.decidedBy || ""),
            reviewerName: String(source.reviewerName || ""),
            scopeCellId,
            scopeAncestorCellIds: Array.isArray(source.scopeAncestorCellIds) ? Array.from(new Set(source.scopeAncestorCellIds.map(String).filter(Boolean))).sort() : [],
            scopeType: String(source.scopeType || "scope"),
            scopeLabel: String(source.scopeLabel || source.scopeCellId || "Scope"),
            decision,
            preset: normalizePreset(source.preset || source.grantedPreset || source.requestedPreset),
            note: String(source.note || source.decisionNote || ""),
            createdAt: Number(source.createdAt) || nowMs(),
            readAt: Number(source.readAt) || 0,
            dismissedAt: Number(source.dismissedAt) || 0
        };
    }

    function normalizeStore(raw) {
        const source = raw && typeof raw === "object" ? raw : {};
        const users = Array.isArray(source.users) ? source.users.map(normalizeUser).filter(Boolean) : [];
        const pendingUsers = Array.isArray(source.pendingUsers) ? source.pendingUsers.map(normalizePendingUser).filter(Boolean) : [];
        const invites = Array.isArray(source.invites) ? source.invites.map(normalizeInvite).filter(Boolean) : [];
        const accessRequests = Array.isArray(source.accessRequests) ? source.accessRequests.map(normalizeAccessRequest).filter(Boolean) : [];
        const accessMessages = Array.isArray(source.accessMessages) ? source.accessMessages.map(normalizeAccessMessage).filter(Boolean) : [];
        return { schemaVersion: 1, usersEnabled: source.usersEnabled === true || source.usersEnabled === "1", users, pendingUsers, invites, accessRequests, accessMessages };
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
        updateToolbarButton();
        refreshPanel();
        dispatchUsersStoreChanged();
    }

    function dispatchUsersStoreChanged() {
        try {
            if (window && typeof window.dispatchEvent === "function" && typeof window.CustomEvent === "function") window.dispatchEvent(new window.CustomEvent("trellisUsersStoreChanged"));
        } catch (_) { }
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

    function normalizeEmail(email) {
        return String(email || "").trim().toLowerCase();
    }

    function validEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
    }

    function makeInviteCode() {
        return Math.random().toString(36).slice(2, 6).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    }

    function hashInviteCode(code, salt) {
        return stableHash(String(salt || "") + "::invite::" + String(code || "").trim().toUpperCase());
    }

    function userById(id) {
        return readStore().users.find(function (user) { return user.id === id && !user.disabled; }) || null;
    }

    function storedUserById(id) {
        return readStore().users.find(function (user) { return user.id === id; }) || null;
    }

    function userByName(name) {
        const key = String(name || "").trim().toLowerCase();
        if (!key) return null;
        return readStore().users.find(function (user) { return !user.disabled && user.name.toLowerCase() === key; }) || null;
    }

    function publicUser(user) {
        if (!user) return null;
        return { id: user.id, name: user.name, email: user.email || "", admin: !!user.admin, disabled: !!user.disabled };
    }

    function listUsers() {
        return readStore().users.map(publicUser);
    }

    function publicInvite(invite) {
        if (!invite) return null;
        const expired = invite.status === "pending" && nowMs() > Number(invite.expiresAt || 0);
        return {
            id: invite.id,
            email: invite.email,
            pendingUserId: invite.pendingUserId,
            scopeCellIds: (invite.scopeCellIds || []).slice(),
            scopeLabels: (invite.scopeLabels || []).slice(),
            preset: normalizePreset(invite.preset),
            capabilities: normalizeCapabilities(invite.capabilities, invite.preset),
            createdBy: invite.createdBy || "",
            createdAt: invite.createdAt || 0,
            expiresAt: invite.expiresAt || 0,
            status: expired ? "expired" : invite.status
        };
    }

    function publicAccessRequest(request) {
        const normalized = normalizeAccessRequest(request);
        if (!normalized) return null;
        const requester = storedUserById(normalized.requesterUserId);
        const scopeCell = model.getCell && model.getCell(normalized.scopeCellId);
        return {
            id: normalized.id,
            requesterUserId: normalized.requesterUserId,
            requesterName: requester ? requester.name : normalized.requesterUserId,
            requesterDisabled: requester ? !!requester.disabled : true,
            scopeCellId: normalized.scopeCellId,
            scopeType: scopeCell ? (eligibleScopeType(scopeCell) || normalized.scopeType) : normalized.scopeType,
            scopeLabel: scopeCell ? cellLabel(scopeCell) : normalized.scopeLabel,
            requestedPreset: normalizePreset(normalized.requestedPreset),
            note: normalized.note,
            status: normalized.status,
            createdAt: normalized.createdAt,
            updatedAt: normalized.updatedAt,
            decidedBy: normalized.decidedBy,
            decidedAt: normalized.decidedAt,
            decisionNote: normalized.decisionNote,
            scopeMissing: !accessRequestScopeIsAvailable(scopeCell)
        };
    }

    function publicAccessMessage(message) {
        const normalized = normalizeAccessMessage(message);
        if (!normalized) return null;
        const reviewer = storedUserById(normalized.reviewerUserId);
        const scopeCell = model.getCell && model.getCell(normalized.scopeCellId);
        return {
            id: normalized.id,
            requestId: normalized.requestId,
            requesterUserId: normalized.requesterUserId,
            reviewerUserId: normalized.reviewerUserId,
            reviewerName: reviewer ? reviewer.name : (normalized.reviewerUserId || normalized.reviewerName),
            scopeCellId: normalized.scopeCellId,
            scopeAncestorCellIds: (normalized.scopeAncestorCellIds || []).slice(),
            scopeType: scopeCell ? (eligibleScopeType(scopeCell) || normalized.scopeType) : normalized.scopeType,
            scopeLabel: scopeCell ? cellLabel(scopeCell) : normalized.scopeLabel,
            decision: normalized.decision,
            preset: normalizePreset(normalized.preset),
            note: normalized.note,
            createdAt: normalized.createdAt,
            readAt: normalized.readAt,
            dismissedAt: normalized.dismissedAt,
            unread: !normalized.readAt,
            scopeMissing: !accessRequestScopeIsAvailable(scopeCell)
        };
    }

    function normalizePreset(value) {
        const preset = String(value || "visitor").trim().toLowerCase();
        if (preset === "viewer") return "visitor";
        if (preset === "grower" || preset === "task") return "gardener";
        if (preset === "manager") return "coordinator";
        return ACCESS_PRESETS.indexOf(preset) >= 0 ? preset : "visitor";
    }

    function expandImpliedCapabilities(capabilities) {
        const caps = new Set((Array.isArray(capabilities) ? capabilities : []).map(String));
        if (caps.has(CAP_MANAGE_SCOPE_CONTENT)) {
            caps.add(CAP_CREATE_PLANTINGS);
            caps.add(CAP_MANAGE_OWN_PLANTINGS);
            caps.add(CAP_MOVE_TASKS);
            caps.add(CAP_EDIT_TASK_DETAILS);
        }
        return Array.from(caps);
    }

    function normalizeCapabilityList(capabilities) {
        const base = Array.isArray(capabilities) ? capabilities : [];
        const allowed = new Set(DOMAIN_CAPABILITIES);
        return Array.from(new Set(expandImpliedCapabilities(base || []).filter(function (capability) { return allowed.has(capability); }))).sort();
    }

    function normalizeCapabilities(capabilities, preset) {
        return normalizeCapabilityList(PRESET_CAPABILITIES[normalizePreset(preset)]);
    }

    function normalizeGrant(grant) {
        const source = grant || {};
        const userId = String(source.userId || source.id || "").trim();
        if (!userId) return null;
        const preset = normalizePreset(source.preset);
        return { userId, preset, capabilities: normalizeCapabilities(source.capabilities, preset) };
    }

    function grantsFromAttr(cell) {
        const parsed = parseJson(getAttr(cell, ATTR_ACCESS_GRANTS), []);
        if (!Array.isArray(parsed)) return [];
        const byUserId = new Map();
        parsed.map(normalizeGrant).filter(Boolean).forEach(function (grant) { byUserId.set(grant.userId, grant); });
        return Array.from(byUserId.values()).sort(function (left, right) { return left.userId.localeCompare(right.userId); });
    }

    function setGrantsAttr(cell, grants) {
        const normalized = (grants || []).map(normalizeGrant).filter(Boolean).sort(function (left, right) { return left.userId.localeCompare(right.userId); });
        setAttr(cell, ATTR_ACCESS_GRANTS, normalized.length ? JSON.stringify(normalized) : "");
    }

    function publicGrant(grant) {
        const normalized = normalizeGrant(grant);
        return normalized ? { userId: normalized.userId, preset: normalized.preset, capabilities: normalized.capabilities.slice() } : null;
    }

    function getScopeGrants(cell) {
        return grantsFromAttr(cell).map(publicGrant).filter(Boolean);
    }

    function storedOrPendingUserById(id) {
        const store = readStore();
        return store.users.find(function (user) { return user.id === id && !user.disabled; }) || store.pendingUsers.find(function (user) { return user.id === id && !user.disabled; }) || null;
    }

    function listPendingInvites() {
        const store = expireInvites(readStore());
        return store.invites.filter(function (invite) { return invite.status === "pending" && canManageInvite(invite); }).map(publicInvite);
    }

    function localStore() {
        try { return window && window.localStorage ? window.localStorage : null; } catch (e) { return null; }
    }

    function usersDebugEnabled() {
        const store = localStore();
        const win = typeof window !== "undefined" ? window : null;
        return !!(win && win.__TRELLIS_USERS_DEBUG__ === true) || !!(store && store.getItem("trellis_users_debug") === "1");
    }

    function consoleGroup(label, payload, body) {
        if (!usersDebugEnabled() || typeof console === "undefined") return;
        try {
            if (console.groupCollapsed) console.groupCollapsed(label, payload || "");
            else if (console.log) console.log(label, payload || "");
            if (body) body();
        } catch (e) {
            try { if (console.log) console.log("[TrellisUsers] debug logging failed", e); } catch (_) { }
        } finally {
            try { if (console.groupEnd) console.groupEnd(); } catch (_) { }
        }
    }

    function debugFlagSnapshot() {
        const store = localStore();
        const win = typeof window !== "undefined" ? window : null;
        return {
            storage: {
                trellis_users_debug: store ? store.getItem("trellis_users_debug") : null,
                trellis_bed_fit_debug: store ? store.getItem("trellis_bed_fit_debug") : null
            },
            windowFlags: {
                users: !!(win && win.__TRELLIS_USERS_DEBUG__ === true),
                bedFit: !!(win && win.__TRELLIS_BED_FIT_DEBUG__ === true)
            }
        };
    }

    function usersDebugStatus() {
        const win = typeof window !== "undefined" ? window : null;
        const user = currentUser();
        const flags = debugFlagSnapshot();
        return {
            plugin: "Trellis_Users.js",
            loaded: true,
            debugEnabled: usersDebugEnabled(),
            url: win && win.location ? String(win.location.href || "") : "",
            origin: win && win.location ? String(win.location.origin || "") : "",
            storage: flags.storage,
            windowFlags: flags.windowFlags,
            usersApiPresent: !!(win && win.Trellis && win.Trellis.users),
            loggedIn: isLoggedIn(),
            currentUser: user ? { id: user.id, name: user.name, email: user.email, admin: !!user.admin } : null
        };
    }

    function debugProbeSnapshot() {
        const win = typeof window !== "undefined" ? window : null;
        const debug = win && win.Trellis && win.Trellis.debug;
        const flags = debugFlagSnapshot();
        return {
            url: win && win.location ? String(win.location.href || "") : "",
            origin: win && win.location ? String(win.location.origin || "") : "",
            usersPluginLoaded: !!(win && win.__TRELLIS_USERS_PLUGIN_LOADED),
            bedFitPluginLoaded: !!(win && win.__TRELLIS_BED_FIT_PLUGIN_LOADED),
            storage: flags.storage,
            windowFlags: flags.windowFlags,
            usersApiPresent: !!(win && win.Trellis && win.Trellis.users),
            tilerFitApiPresent: !!(win && win.USL && win.USL.tiler && typeof win.USL.tiler.retileAndFitToContainingBed === "function"),
            usersStatus: debug && typeof debug.usersStatus === "function" ? debug.usersStatus() : null,
            bedFitStatus: debug && typeof debug.bedFitStatus === "function" ? debug.bedFitStatus() : null
        };
    }

    function debugProbe() {
        const snapshot = debugProbeSnapshot();
        if (typeof console !== "undefined") {
            try {
                if (console.groupCollapsed) console.groupCollapsed("[TrellisDebug] probe");
                else if (console.log) console.log("[TrellisDebug] probe");
                if (console.log) console.log(snapshot);
            } finally {
                try { if (console.groupEnd) console.groupEnd(); } catch (_) { }
            }
        }
        return snapshot;
    }

    function installTrellisDebugSurface() {
        const win = typeof window !== "undefined" ? window : null;
        if (!win) return null;
        win.Trellis = win.Trellis || {};
        const debug = win.Trellis.debug = win.Trellis.debug || {};
        win.__TRELLIS_USERS_PLUGIN_LOADED = true;
        debug.usersStatus = usersDebugStatus;
        debug.enable = function () {
            const store = localStore();
            win.__TRELLIS_USERS_DEBUG__ = true;
            win.__TRELLIS_BED_FIT_DEBUG__ = true;
            if (store) { store.setItem("trellis_users_debug", "1"); store.setItem("trellis_bed_fit_debug", "1"); }
            return debugProbeSnapshot();
        };
        debug.disable = function () {
            const store = localStore();
            win.__TRELLIS_USERS_DEBUG__ = false;
            win.__TRELLIS_BED_FIT_DEBUG__ = false;
            if (store) { store.removeItem("trellis_users_debug"); store.removeItem("trellis_bed_fit_debug"); }
            return debugProbeSnapshot();
        };
        debug.probe = debugProbe;
        return debug;
    }

    function getDiagramLoginKey(create) {
        const cell = metadataCell();
        let key = getAttr(cell, ATTR_REMEMBER_DIAGRAM_ID);
        if (!key && !create) key = getAttr(cell, ATTR_HISTORY_ID);
        if (!key && create) {
            key = makeId(DIAGRAM_ID_PREFIX);
            setAttr(cell, ATTR_REMEMBER_DIAGRAM_ID, key);
        }
        return key || "";
    }

    function rememberStorageKey(create) {
        const diagramKey = getDiagramLoginKey(create);
        return diagramKey ? REMEMBER_STORAGE_PREFIX + diagramKey : "";
    }

    function rememberLogin(userId, enabled) {
        const storage = localStore();
        if (!storage) return { ok: false, reason: "Local login memory is unavailable." };
        const key = rememberStorageKey(!!enabled);
        if (!key) return { ok: false, reason: "Diagram login identity is unavailable." };
        if (enabled && userById(userId)) storage.setItem(key, String(userId));
        else storage.removeItem(key);
        return { ok: true };
    }

    function forgetRememberedLogin() {
        const storage = localStore();
        const key = rememberStorageKey(false);
        if (storage && key) storage.removeItem(key);
        return { ok: true };
    }

    function restoreRememberedLogin() {
        if (!isEnabled()) return { ok: false, reason: "Users are not enabled." };
        const storage = localStore();
        const key = rememberStorageKey(false);
        const rememberedId = storage && key ? storage.getItem(key) : "";
        const user = rememberedId ? userById(rememberedId) : null;
        if (!user) {
            currentUserId = "";
            if (storage && key && rememberedId) storage.removeItem(key);
            return { ok: false, reason: "No remembered active user for this diagram." };
        }
        currentUserId = user.id;
        updateToolbarButton();
        return { ok: true, user: publicUser(user) };
    }

    function isEnabled() {
        return !!readStore().usersEnabled;
    }

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
        const store = readStore();
        return store.usersEnabled && store.users.length === 0;
    }

    function activeAdmins(store) {
        return (store || readStore()).users.filter(function (user) { return user.admin && !user.disabled; });
    }

    function expireInvites(store) {
        const source = normalizeStore(store);
        let changed = false;
        source.invites.forEach(function (invite) {
            if (invite.status === "pending" && nowMs() > invite.expiresAt) {
                invite.status = "expired";
                removeGrantsForUser(invite.pendingUserId, invite.scopeCellIds);
                changed = true;
            }
        });
        if (changed) writeStore(source);
        return source;
    }

    function emailExists(store, email) {
        const clean = normalizeEmail(email);
        return store.users.some(function (user) { return normalizeEmail(user.email) === clean; }) ||
            store.pendingUsers.some(function (user) { return normalizeEmail(user.email) === clean; }) ||
            store.invites.some(function (invite) { return invite.status === "pending" && normalizeEmail(invite.email) === clean; });
    }

    function createUser(name, pin, admin) {
        const cleanName = String(name || "").trim();
        const cleanPin = String(pin || "");
        if (!cleanName || !cleanPin) return { ok: false, reason: "Enter a name and PIN." };
        const store = readStore();
        if (!store.usersEnabled) return { ok: false, reason: "Enable users before adding accounts." };
        const bootstrap = store.users.length === 0;
        if (!bootstrap && !isAdmin()) return { ok: false, reason: "Only admins can create users." };
        if (store.users.some(function (user) { return user.name.toLowerCase() === cleanName.toLowerCase(); })) {
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

    function finalizePublicAuthMutation(message, hadAuthGate) {
        if (hadAuthGate) closeAuthOverlay(true);
        refreshPanel();
        updateToolbarButton();
        if (!hadAuthGate && message) showStatus(message);
    }

    function enableUsersState(name, pin) {
        const store = readStore();
        if (store.usersEnabled) return { ok: true, enabled: true };
        const cleanName = String(name || "").trim();
        const cleanPin = String(pin || "");
        if (!cleanName || !cleanPin) return { ok: false, reason: "Enter a name and PIN to create the first admin." };
        const salt = makeId(PIN_SALT_PREFIX);
        const user = { id: makeId(USER_ID_PREFIX), name: cleanName, pinSalt: salt, pinHash: hashPin(cleanPin, salt), admin: true, disabled: false, createdAt: nowMs() };
        store.usersEnabled = true;
        store.users = [user];
        currentUserId = user.id;
        writeStore(store);
        return { ok: true, user: publicUser(user) };
    }

    function enableUsers(name, pin) {
        const hadAuthGate = !!authOverlay;
        const result = enableUsersState(name, pin);
        if (result.ok && result.user) finalizePublicAuthMutation("Users enabled. Created first admin: " + result.user.name, hadAuthGate);
        return result;
    }

    function loginState(name, pin) {
        if (!isEnabled()) return { ok: false, reason: "Users are not enabled for this diagram." };
        if (canBootstrapAdmin()) {
            const created = createUser(name, pin, true);
            if (!created.ok) return created;
            currentUserId = created.user.id;
            return { ok: true, user: created.user };
        }
        const user = userByName(name);
        if (!user || user.pinHash !== hashPin(pin, user.pinSalt)) return { ok: false, reason: "Unknown user or incorrect PIN." };
        currentUserId = user.id;
        return { ok: true, user: publicUser(user) };
    }

    function login(name, pin) {
        const hadAuthGate = !!authOverlay;
        const result = loginState(name, pin);
        if (result.ok && result.user) finalizePublicAuthMutation("Logged in as " + result.user.name, hadAuthGate);
        return result;
    }

    function resetUserPin(userId, pin) {
        if (!isAdmin()) return { ok: false, reason: "Only admins can reset PINs." };
        const cleanPin = String(pin || "");
        if (!cleanPin) return { ok: false, reason: "Enter a new PIN." };
        const store = readStore();
        const user = store.users.find(function (entry) { return entry.id === userId; });
        if (!user) return { ok: false, reason: "Unknown user." };
        const salt = makeId(PIN_SALT_PREFIX);
        user.pinSalt = salt;
        user.pinHash = hashPin(cleanPin, salt);
        writeStore(store);
        return { ok: true };
    }

    function setUserAdmin(userId, admin) {
        if (!isAdmin()) return { ok: false, reason: "Only admins can change admin status." };
        const store = readStore();
        const user = store.users.find(function (entry) { return entry.id === userId; });
        if (!user) return { ok: false, reason: "Unknown user." };
        if (user.admin && !admin && activeAdmins(store).length <= 1) return { ok: false, reason: "At least one active admin is required." };
        user.admin = !!admin;
        writeStore(store);
        return { ok: true };
    }

    function setUserDisabled(userId, disabled) {
        if (!isAdmin()) return { ok: false, reason: "Only admins can disable users." };
        const store = readStore();
        const user = store.users.find(function (entry) { return entry.id === userId; });
        if (!user) return { ok: false, reason: "Unknown user." };
        if (user.admin && disabled && activeAdmins(store).length <= 1) return { ok: false, reason: "At least one active admin is required." };
        user.disabled = !!disabled;
        if (user.id === currentUserId && user.disabled) { currentUserId = ""; forgetRememberedLogin(); }
        writeStore(store);
        return { ok: true };
    }

    function logout() {
        currentUserId = "";
        forgetRememberedLogin();
        closeAccountMenu();
        showStatus("Logged out.");
        refreshPanel();
        updateToolbarButton();
        applyAuthGateIfNeeded("Logged out.");
    }

    function userIdsFromAttr(cell) {
        const parsed = parseJson(getAttr(cell, ATTR_ACCESS_USERS), []);
        return Array.isArray(parsed) ? Array.from(new Set(parsed.map(String).filter(Boolean))).sort() : [];
    }

    function setUserIdsAttr(cell, ids) {
        const next = Array.from(new Set((ids || []).map(String).filter(Boolean))).sort();
        setAttr(cell, ATTR_ACCESS_USERS, next.length ? JSON.stringify(next) : "");
    }

    function traverseCells(cell, visit) {
        if (!cell || !visit) return;
        visit(cell);
        const count = model.getChildCount ? model.getChildCount(cell) : ((cell.children || []).length);
        for (let i = 0; i < count; i++) traverseCells(model.getChildAt ? model.getChildAt(cell, i) : cell.children[i], visit);
    }

    function getStyle(cell) {
        return cell && typeof cell.getStyle === "function" ? (cell.getStyle() || "") : ((cell && cell.style) || "");
    }

    function styleFlag(cell, key) {
        return new RegExp("(?:^|;)" + key + "=1(?:;|$)").test(getStyle(cell));
    }

    function isModuleCell(cell) {
        return !!cell && (styleFlag(cell, "module") || getAttr(cell, "garden_module") === "1" || getAttr(cell, "team_module") === "1" || getAttr(cell, "task_module") === "1");
    }

    function isGardenModule(cell) {
        return !!cell && getAttr(cell, "garden_module") === "1";
    }

    function isTeamModule(cell) {
        return !!cell && getAttr(cell, "team_module") === "1";
    }

    function isGardenBed(cell) {
        return !!cell && (getAttr(cell, "garden_bed") === "1" || getAttr(cell, "gardenBed") === "1" || getAttr(cell, "is_garden_bed") === "1");
    }

    function isTilerGroup(cell) {
        return !!cell && (getAttr(cell, "tiler_group") === "1" || styleFlag(cell, "tiler_group"));
    }

    function isGeneratedPlantTile(cell) {
        if (!cell || getAttr(cell, "plant_tiler") !== "1") return false;
        return getAttr(cell, "auto") === "1" || !!getAttr(cell, "tile_r") || !!getAttr(cell, "tile_c");
    }

    function isTaskBoard(cell) {
        const key = String(getAttr(cell, "board_key") || "");
        return key === "KANBAN_BOARD" || key === "MAIN_KANBAN_BOARD";
    }

    function isTaskCard(cell) {
        return !!cell && (getAttr(cell, "kanban_card") === "1" || styleFlag(cell, "kanban_card"));
    }

    function isRoleCard(cell) {
        return !!cell && styleFlag(cell, "role_card");
    }

    function hasLink(cell, id) {
        const target = String(id || "");
        if (!cell || !target) return false;
        return String(getAttr(cell, "linkedTo") || "").split(",").map(function (part) { return part.trim(); }).filter(Boolean).indexOf(target) >= 0;
    }

    function cellId(cell) {
        return cell && (cell.id || (cell.getId && cell.getId())) || "";
    }

    function linkSet(cell) {
        return new Set(String(getAttr(cell, "linkedTo") || "").split(",").map(function (part) { return part.trim(); }).filter(Boolean));
    }

    function setLinkSet(cell, ids) {
        setAttr(cell, "linkedTo", Array.from(ids || []).filter(Boolean).join(","));
    }

    function addReciprocalLink(left, right) {
        const modules = graph && graph.__trellisModules;
        if (modules && typeof modules.addReciprocalLink === "function") return modules.addReciprocalLink(left, right);
        const leftId = cellId(left);
        const rightId = cellId(right);
        if (!left || !right || !leftId || !rightId || left === right) return false;
        const leftLinks = linkSet(left);
        const rightLinks = linkSet(right);
        let changed = false;
        if (!leftLinks.has(rightId)) { leftLinks.add(rightId); setLinkSet(left, leftLinks); changed = true; }
        if (!rightLinks.has(leftId)) { rightLinks.add(leftId); setLinkSet(right, rightLinks); changed = true; }
        return changed;
    }

    function cellDisplayLabel(cell, fallback) {
        const raw = getAttr(cell, "label") || (typeof (cell && cell.value) === "string" ? cell.value : "");
        if (document && document.createElement) {
            const holder = document.createElement("div");
            holder.innerHTML = raw;
            const text = String(holder.textContent || "").replace(/\s+/g, " ").trim();
            if (text) return text;
        }
        const text = String(raw || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        return text || fallback || "";
    }

    function allCellsMatching(predicate) {
        const matches = [];
        traverseCells(model.getRoot && model.getRoot(), function (cell) { if (predicate(cell)) matches.push(cell); });
        return matches;
    }

    function allGardenModules() {
        return allCellsMatching(isGardenModule).sort(function (left, right) { return cellDisplayLabel(left, "Garden").localeCompare(cellDisplayLabel(right, "Garden"), undefined, { sensitivity: "base" }) || cellId(left).localeCompare(cellId(right)); });
    }

    function findGardenModuleAncestor(cell) {
        return nearestAncestorMatching(cell, isGardenModule);
    }

    function linkedPlantingGroupsForTask(cell) {
        if (!isTaskCard(cell)) return [];
        const id = cellId(cell);
        const linkedIds = String(getAttr(cell, "linkedTo") || "").split(",").map(function (part) { return part.trim(); }).filter(Boolean);
        return linkedIds.map(function (linkedId) { return model.getCell && model.getCell(linkedId); }).filter(function (linked) { return isTilerGroup(linked) && (!id || hasLink(linked, id)); });
    }

    function userOwnsLinkedPlantingTask(cell, userId) {
        return linkedPlantingGroupsForTask(cell).some(function (planting) { return getAttr(planting, ATTR_OWNER) === userId; });
    }

    function userCreatedManualTask(cell, userId) {
        return isTaskCard(cell) && linkedPlantingGroupsForTask(cell).length === 0 && getAttr(cell, ATTR_CREATED_BY) === userId;
    }

    function userCanWorkOwnTask(cell, userId) {
        return !!(userId && isTaskCard(cell) && (userOwnsLinkedPlantingTask(cell, userId) || userCreatedManualTask(cell, userId)));
    }

    function nearestAncestorMatching(cell, predicate) {
        let cursor = cell;
        while (cursor) {
            if (predicate(cursor)) return cursor;
            cursor = parentOf(cursor);
        }
        return null;
    }

    function nearestPlanting(cell) { return nearestAncestorMatching(cell, isTilerGroup); }

    function nearestGardenBed(cell) { return nearestAncestorMatching(cell, isGardenBed); }

    function nearestTaskBoard(cell) { return nearestAncestorMatching(cell, isTaskBoard); }

    function nearestUnownedModuleAncestor(cell) { return nearestAncestorMatching(cell, isUnownedModuleCell); }

    function directCapabilitiesForCell(cell, userId) {
        const caps = new Set();
        let cursor = cell;
        while (cursor) {
            grantsFromAttr(cursor).forEach(function (grant) {
                if (grant.userId === userId) grant.capabilities.forEach(function (capability) { caps.add(capability); });
            });
            cursor = parentOf(cursor);
        }
        return caps;
    }

    function roleCardsForUser(userId) {
        const matches = [];
        const root = model.getRoot && model.getRoot();
        traverseCells(root, function (cell) { if (isRoleCard(cell) && getAttr(cell, ATTR_ROLE_USER) === userId) matches.push(cell); });
        return matches;
    }

    function roleCardsForGardenUser(gardenCell, userId) {
        const gardenId = cellId(gardenCell);
        const cleanUserId = String(userId || "").trim();
        if (!gardenId || !cleanUserId) return [];
        return roleCardsForUser(cleanUserId).filter(function (roleCard) { return getAttr(roleCard, ATTR_ROLE_GARDEN_MODULE) === gardenId; });
    }

    function readOnlyTeamForGarden(gardenCell) {
        const gardenId = cellId(gardenCell);
        if (!gardenId) return null;
        const typedId = getAttr(gardenCell, ATTR_GARDEN_TEAM_MODULE);
        const typed = typedId && model.getCell ? model.getCell(typedId) : null;
        if (typed && isTeamModule(typed) && getAttr(typed, ATTR_TEAM_GARDEN_MODULE) === gardenId) return typed;
        return allCellsMatching(function (cell) { return isTeamModule(cell) && getAttr(cell, ATTR_TEAM_GARDEN_MODULE) === gardenId; })[0] || null;
    }

    function findTeamForGarden(gardenCell) {
        const existing = readOnlyTeamForGarden(gardenCell);
        if (existing) return existing;
        const modules = graph && graph.__trellisModules;
        if (modules && typeof modules.ensureGardenTeamModule === "function") return modules.ensureGardenTeamModule(gardenCell);
        return null;
    }

    function childCells(cell) {
        if (!cell) return [];
        if (model.getChildren) return model.getChildren(cell) || [];
        const count = model.getChildCount ? model.getChildCount(cell) : ((cell.children || []).length);
        const out = [];
        for (let i = 0; i < count; i++) out.push(model.getChildAt ? model.getChildAt(cell, i) : cell.children[i]);
        return out.filter(Boolean);
    }

    function roleField(roleCard, flag) {
        return childCells(roleCard).find(function (child) { return styleFlag(child, flag); }) || null;
    }

    function roleFieldTextValue(field) {
        if (!field) return "";
        if (field.value && field.value.nodeType === 1) return String(getAttr(field, "label") || "");
        return String(field.value || "");
    }

    function setRoleFieldText(roleCard, flag, text) {
        const field = roleField(roleCard, flag);
        if (!field) return false;
        if (field.value && field.value.nodeType === 1) setAttr(field, "label", text || "");
        else if (model.setValue) model.setValue(field, text || "");
        else field.value = text || "";
        return true;
    }

    function setRoleFieldDefault(roleCard, flag, text) {
        const field = roleField(roleCard, flag);
        if (!field || roleFieldTextValue(field).trim()) return false;
        return setRoleFieldText(roleCard, flag, text);
    }

    function roleTitleForGrant(grant) {
        return presetLabel((grant && grant.preset) || "visitor");
    }

    function makeRoleStatusCell(id, text) {
        const style = "rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor=#FEF3C7;strokeColor=#D97706;fontColor=#92400E;fontSize=10;align=center;verticalAlign=middle;spacing=2;role_status=1;";
        if (typeof mxCell !== "undefined" && typeof mxGeometry !== "undefined") {
            const cell = new mxCell(text, new mxGeometry(10, 10, 96, 18), style);
            cell.vertex = true;
            if (typeof cell.setConnectable === "function") cell.setConnectable(false);
            return cell;
        }
        return {
            id, value: text, style, vertex: true, children: [],
            getId: function () { return this.id; },
            getAttribute: function (key) { return this.value && this.value.nodeType === 1 ? this.value.getAttribute(key) : null; },
            setAttribute: function (key, value) { if (this.value && this.value.nodeType === 1) this.value.setAttribute(key, value); },
            removeAttribute: function (key) { if (this.value && this.value.nodeType === 1) this.value.removeAttribute(key); }
        };
    }

    function addChildCell(parent, child) {
        if (!parent || !child) return;
        if (!child.id) child.id = cellId(parent) + "-role-status";
        if (model.add) model.add(parent, child);
        else { child.parent = parent; parent.children = parent.children || []; parent.children.push(child); if (model.index) model.index(child); }
    }

    function removeChildCell(child) {
        if (!child) return;
        if (model.remove) { model.remove(child); return; }
        const parent = parentOf(child);
        if (parent && parent.children) parent.children = parent.children.filter(function (candidate) { return candidate !== child; });
        child.parent = null;
    }

    function markRoleCardInactive(roleCard) {
        if (!roleCard) return;
        let status = roleField(roleCard, "role_status");
        if (!status) { status = makeRoleStatusCell(cellId(roleCard) + "-role-status", "Inactive - restorable"); addChildCell(roleCard, status); }
        setRoleFieldText(roleCard, "role_status", "Inactive - restorable");
    }

    function clearRoleCardInactiveMarker(roleCard) {
        const status = roleField(roleCard, "role_status");
        if (status) removeChildCell(status);
    }

    function normalizeTeamRoleArchive(raw) {
        const source = raw && typeof raw === "object" ? raw : {};
        const roles = source.roles && typeof source.roles === "object" ? source.roles : {};
        const normalizedRoles = {};
        Object.keys(roles).forEach(function (userId) {
            const entry = roles[userId] || {};
            const cleanUserId = String(userId || "").trim();
            const roleCardId = String(entry.roleCardId || "").trim();
            if (!cleanUserId || !roleCardId) return;
            normalizedRoles[cleanUserId] = {
                roleCardId,
                preset: normalizePreset(entry.preset || "visitor"),
                archivedAt: Number(entry.archivedAt) || 0,
                archivedBy: String(entry.archivedBy || "")
            };
        });
        return { schemaVersion: 1, roles: normalizedRoles };
    }

    function readTeamRoleArchive(teamCell) {
        return normalizeTeamRoleArchive(parseJson(getAttr(teamCell, ATTR_TEAM_ROLE_ARCHIVE), null));
    }

    function writeTeamRoleArchive(teamCell, archive) {
        const normalized = normalizeTeamRoleArchive(archive);
        setAttr(teamCell, ATTR_TEAM_ROLE_ARCHIVE, Object.keys(normalized.roles).length ? JSON.stringify(normalized) : "");
    }

    function archivedRoleEntry(teamCell, userId) {
        const archive = readTeamRoleArchive(teamCell);
        return archive.roles[String(userId || "").trim()] || null;
    }

    function archiveGardenRoleCard(teamCell, userId, roleCard, grant) {
        const cleanUserId = String(userId || "").trim();
        const roleCardId = cellId(roleCard);
        if (!teamCell || !cleanUserId || !roleCardId) return;
        const archive = readTeamRoleArchive(teamCell);
        const actor = currentUser();
        archive.roles[cleanUserId] = {
            roleCardId,
            preset: normalizePreset((grant && grant.preset) || (archive.roles[cleanUserId] && archive.roles[cleanUserId].preset) || "visitor"),
            archivedAt: nowMs(),
            archivedBy: actor && actor.id || ""
        };
        writeTeamRoleArchive(teamCell, archive);
    }

    function archivedRoleCardForUser(gardenCell, teamCell, userId) {
        const entry = archivedRoleEntry(teamCell, userId);
        const roleCard = entry && model.getCell ? model.getCell(entry.roleCardId) : null;
        if (!roleCard || !isRoleCard(roleCard)) return null;
        if (getAttr(roleCard, ATTR_ROLE_GARDEN_MODULE) !== cellId(gardenCell)) return null;
        if (getAttr(roleCard, ATTR_ROLE_TEAM_MODULE) !== cellId(teamCell)) return null;
        return roleCard;
    }

    function inactiveGardenRoleCardsForArchivedUser(gardenCell, userId) {
        const gardenId = cellId(gardenCell);
        const cleanUserId = String(userId || "").trim();
        if (!gardenId || !cleanUserId) return [];
        return allCellsMatching(function (cell) {
            return isRoleCard(cell) && getAttr(cell, ATTR_ROLE_GARDEN_MODULE) === gardenId && getAttr(cell, ATTR_ROLE_ARCHIVED_USER) === cleanUserId;
        });
    }

    function fillGardenRoleCard(roleCard, user, gardenCell, teamCell, grant) {
        if (!roleCard || !user) return;
        setAttr(roleCard, ATTR_ROLE_USER, user.id);
        setAttr(roleCard, ATTR_ROLE_ARCHIVED_USER, "");
        setAttr(roleCard, ATTR_ROLE_INACTIVE, "");
        setAttr(roleCard, ATTR_ROLE_GARDEN_MODULE, cellId(gardenCell));
        setAttr(roleCard, ATTR_ROLE_TEAM_MODULE, cellId(teamCell));
        clearRoleCardInactiveMarker(roleCard);
        setRoleFieldDefault(roleCard, "role_name", user.name || "");
        setRoleFieldDefault(roleCard, "role_title", roleTitleForGrant(grant));
        setRoleFieldDefault(roleCard, "role_contact", user.email || "");
    }

    function taskBoardsInGarden(gardenCell) {
        const boards = [];
        traverseCells(gardenCell, function (cell) { if (cell !== gardenCell && isTaskBoard(cell)) boards.push(cell); });
        return boards;
    }

    function linkRoleCardToGardenBoards(roleCard, gardenCell) {
        if (!roleCard || !gardenCell) return;
        taskBoardsInGarden(gardenCell).forEach(function (board) { addReciprocalLink(roleCard, board); });
    }

    function nextRoleCardPoint(teamCell) {
        const geo = graph.getCellGeometry ? graph.getCellGeometry(teamCell) : (teamCell && teamCell.geometry);
        const count = childCells(teamCell).filter(isRoleCard).length;
        return { x: (geo && Number(geo.x) || 0) + 20 + ((count % 2) * 200), y: (geo && Number(geo.y) || 0) + 50 + (Math.floor(count / 2) * 84) };
    }

    function createGardenRoleCard(gardenCell, teamCell) {
        const modules = graph && graph.__trellisModules;
        if (!modules || typeof modules.createRoleCard !== "function") return null;
        const pt = nextRoleCardPoint(teamCell);
        return modules.createRoleCard(teamCell, pt.x, pt.y);
    }

    function resizeTeamModuleForGardenRole(teamCell) {
        const modules = graph && graph.__trellisModules;
        if (teamCell && modules && typeof modules.applyModuleMargins === "function") modules.applyModuleMargins(teamCell, { allowShrink: false });
    }

    function ensureGardenRoleCardForUser(gardenCell, userId, grant) {
        const user = userById(userId);
        if (!gardenCell || !isGardenModule(gardenCell) || !user) return null;
        const team = findTeamForGarden(gardenCell);
        if (!team) return null;
        let roleCard = roleCardsForGardenUser(gardenCell, user.id)[0] || null;
        if (!roleCard) roleCard = archivedRoleCardForUser(gardenCell, team, user.id);
        if (!roleCard) roleCard = inactiveGardenRoleCardsForArchivedUser(gardenCell, user.id)[0] || null;
        if (!roleCard) roleCard = createGardenRoleCard(gardenCell, team);
        if (!roleCard) return null;
        fillGardenRoleCard(roleCard, user, gardenCell, team, grant);
        addReciprocalLink(gardenCell, team);
        linkRoleCardToGardenBoards(roleCard, gardenCell);
        resizeTeamModuleForGardenRole(team);
        return roleCard;
    }

    function clearGardenRoleCardUser(gardenCell, userId, grant) {
        const team = findTeamForGarden(gardenCell);
        roleCardsForGardenUser(gardenCell, userId).forEach(function (roleCard) {
            if (team) archiveGardenRoleCard(team, userId, roleCard, grant);
            setAttr(roleCard, ATTR_ROLE_ARCHIVED_USER, userId);
            setAttr(roleCard, ATTR_ROLE_INACTIVE, "1");
            setAttr(roleCard, ATTR_ROLE_USER, "");
            markRoleCardInactive(roleCard);
        });
    }

    function ensureGardenRoleCardsForUser(userId) {
        const cleanUserId = String(userId || "").trim();
        if (!cleanUserId || !userById(cleanUserId)) return;
        allGardenModules().forEach(function (garden) {
            const grant = grantsFromAttr(garden).find(function (entry) { return entry.userId === cleanUserId; });
            if (grant) ensureGardenRoleCardForUser(garden, cleanUserId, grant);
        });
    }

    function syncGardenRoleCardsForGrantChange(gardenCell, previousGrants, nextGrants) {
        if (!isGardenModule(gardenCell)) return;
        const before = new Map((previousGrants || []).map(function (grant) { return [grant.userId, grant]; }));
        const after = new Map((nextGrants || []).map(function (grant) { return [grant.userId, grant]; }));
        before.forEach(function (grant, userId) { if (!after.has(userId)) clearGardenRoleCardUser(gardenCell, userId, grant); });
        after.forEach(function (grant, userId) { if (userById(userId)) ensureGardenRoleCardForUser(gardenCell, userId, grant); });
    }

    function autoLinkGardenBoardMemberships(board) {
        const garden = findGardenModuleAncestor(board);
        if (!garden || !isTaskBoard(board)) return;
        const gardenId = cellId(garden);
        allCellsMatching(function (cell) { return isRoleCard(cell) && getAttr(cell, ATTR_ROLE_GARDEN_MODULE) === gardenId && !!getAttr(cell, ATTR_ROLE_USER); }).forEach(function (roleCard) { addReciprocalLink(roleCard, board); });
    }

    function roleLinkedBoardGrantsForUser(userId, targetCell) {
        const roleCards = roleCardsForUser(userId);
        const boards = [];
        const root = model.getRoot && model.getRoot();
        traverseCells(root, function (cell) {
            if (!isTaskBoard(cell)) return;
            if (roleCards.some(function (roleCard) { return hasLink(cell, cellId(roleCard)) && hasLink(roleCard, cellId(cell)); })) boards.push(cell);
        });
        if (!targetCell) return boards;
        return boards.filter(function (board) {
            let cursor = targetCell;
            while (cursor) { if (cursor === board) return true; cursor = parentOf(cursor); }
            return false;
        });
    }

    function effectiveCapabilitiesForCell(cell, userId) {
        const user = userId ? userById(userId) : currentUser();
        const caps = new Set();
        if (!isEnabled()) DOMAIN_CAPABILITIES.forEach(function (capability) { caps.add(capability); });
        if (user && user.admin) DOMAIN_CAPABILITIES.forEach(function (capability) { caps.add(capability); });
        if (user && isOwnerOfNearestAccessScope(cell, user.id)) DOMAIN_CAPABILITIES.forEach(function (capability) { caps.add(capability); });
        if (user) directCapabilitiesForCell(cell, user.id).forEach(function (capability) { caps.add(capability); });
        return normalizeCapabilityList(Array.from(caps));
    }

    function hasCapability(cell, capability) {
        const user = currentUser();
        if (!isEnabled()) return true;
        if (!user || !cell) return false;
        if (user.admin || isOwnerOfNearestAccessScope(cell, user.id)) return true;
        return effectiveCapabilitiesForCell(cell, user.id).indexOf(capability) >= 0;
    }

    function grantUserToScopes(userId, scopeCellIds, grantOptions) {
        const source = grantOptions || {};
        (scopeCellIds || []).forEach(function (cellId) {
            const cell = model.getCell && model.getCell(cellId);
            if (!cell) return;
            setScopeGrantInternal(cell, { userId, preset: source.preset || "visitor", capabilities: source.capabilities });
        });
    }

    function removeGrantsForUser(userId, scopeCellIds) {
        graph[INTERNAL_FLAG] = true;
        model.beginUpdate();
        try {
            (scopeCellIds || []).forEach(function (cellId) {
                const cell = model.getCell && model.getCell(cellId);
                if (!cell) return;
                setGrantsAttr(cell, grantsFromAttr(cell).filter(function (grant) { return grant.userId !== userId; }));
            });
        } finally {
            model.endUpdate();
            graph[INTERNAL_FLAG] = false;
        }
    }

    function writeStoreAndGrant(store, userId, scopeCellIds, grantOptions) {
        graph[INTERNAL_FLAG] = true;
        model.beginUpdate();
        try {
            grantUserToScopes(userId, scopeCellIds, grantOptions);
            setAttr(metadataCell(), ATTR_STORE, JSON.stringify(normalizeStore(store)));
        } finally {
            model.endUpdate();
            graph[INTERNAL_FLAG] = false;
        }
        refreshPanel();
    }

    function setScopeGrantInternal(cell, grant) {
        const normalized = normalizeGrant(grant);
        if (!cell || !normalized) return false;
        const grants = grantsFromAttr(cell).filter(function (entry) { return entry.userId !== normalized.userId; });
        grants.push(normalized);
        setGrantsAttr(cell, grants);
        return true;
    }

    function syncCompanionAccessIfGarden(cell) {
        if (!isGardenModule(cell)) return;
        const modules = graph && graph.__trellisModules;
        if (!modules) return;
        const team = typeof modules.findExistingCompanionTeam === "function" ? modules.findExistingCompanionTeam(cell) : null;
        const task = typeof modules.findExistingCompanionTask === "function" ? modules.findExistingCompanionTask(cell) : null;
        if (team && typeof modules.syncCompanionModuleAccess === "function") modules.syncCompanionModuleAccess(cell, team);
        if (task && typeof modules.syncCompanionModuleAccess === "function") modules.syncCompanionModuleAccess(cell, task);
    }

    function setScopeGrant(cell, grant) {
        if (!cell || !canManageScopeGrants(cell)) return { ok: false, reason: "Select a module, garden bed, or task board to manage access." };
        const normalized = normalizeGrant(grant);
        if (!normalized || !storedOrPendingUserById(normalized.userId)) return { ok: false, reason: "Unknown user." };
        const previousGrants = grantsFromAttr(cell);
        graph[INTERNAL_FLAG] = true;
        model.beginUpdate();
        try { setScopeGrantInternal(cell, normalized); syncGardenRoleCardsForGrantChange(cell, previousGrants, grantsFromAttr(cell)); syncCompanionAccessIfGarden(cell); } finally { model.endUpdate(); graph[INTERNAL_FLAG] = false; }
        refreshPanel();
        return { ok: true, grant: publicGrant(normalized) };
    }

    function removeScopeGrant(cell, userId) {
        if (!cell || !canManageScopeGrants(cell)) return { ok: false, reason: "Select a module, garden bed, or task board to manage access." };
        const previousGrants = grantsFromAttr(cell);
        graph[INTERNAL_FLAG] = true;
        model.beginUpdate();
        try { setGrantsAttr(cell, grantsFromAttr(cell).filter(function (grant) { return grant.userId !== userId; })); syncGardenRoleCardsForGrantChange(cell, previousGrants, grantsFromAttr(cell)); syncCompanionAccessIfGarden(cell); } finally { model.endUpdate(); graph[INTERNAL_FLAG] = false; }
        refreshPanel();
        return { ok: true };
    }

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
            const grant = userId ? grantsFromAttr(cursor).find(function (entry) { return entry.userId === userId; }) : null;
            if (grant) return { cell: cursor, grant };
            cursor = parentOf(cursor);
        }
        return null;
    }

    function nearestInheritedAccessGrant(cell, userId) {
        return nearestAccessGrant(parentOf(cell), userId);
    }

    function isOwnerOfNearestScope(cell, userId) {
        const owner = nearestOwnedAncestor(cell);
        return !!(owner && owner.ownerUserId === userId);
    }

    function isOwnerOfNearestAccessScope(cell, userId) {
        const owner = nearestOwnedAncestor(cell);
        return !!(owner && owner.ownerUserId === userId && !isTilerGroup(owner.cell));
    }

    function isUnownedModuleCell(cell) {
        return isModuleCell(cell) && !getAttr(cell, ATTR_OWNER);
    }

    function canClaimUnownedModule(cell, userId) {
        return !!(userId && isUnownedModuleCell(cell));
    }

    function canDeleteModuleBoundary(cell, user) {
        return !!(cell && isModuleCell(cell) && user && (user.admin || getAttr(cell, ATTR_OWNER) === user.id));
    }

    function canEditCell(cell) {
        if (!isEnabled()) return true;
        const user = currentUser();
        if (!user || !cell || cell === model.getRoot()) return false;
        if (user.admin) return true;
        if (canClaimUnownedModule(cell, user.id)) return true;
        if (canClaimUnownedModule(nearestUnownedModuleAncestor(cell), user.id)) return true;
        if (isOwnerOfNearestScope(cell, user.id)) return true;
        if (isTaskCard(cell)) return canEditTaskDetails(cell);
        const planting = nearestPlanting(cell);
        if (planting) return canManagePlanting(planting);
        return hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT);
    }

    function canAddCell(parent) {
        if (!isEnabled()) return true;
        const user = currentUser();
        if (!user) return false;
        if (user.admin) return true;
        if (!parent || parent === model.getRoot() || parent === graph.getDefaultParent()) return true;
        if (canClaimUnownedModule(parent, user.id)) return true;
        return isOwnerOfNearestScope(parent, user.id) || hasCapability(parent, CAP_MANAGE_SCOPE_CONTENT);
    }

    function canDeleteCell(cell) {
        if (!isEnabled()) return true;
        const user = currentUser();
        if (!user || !cell || cell === model.getRoot() || cell === graph.getDefaultParent()) return false;
        if (isModuleCell(cell)) return canDeleteModuleBoundary(cell, user);
        if (user.admin) return true;
        if (canClaimUnownedModule(nearestUnownedModuleAncestor(parentOf(cell)), user.id)) return true;
        return isOwnerOfNearestScope(cell, user.id) || canManagePlanting(cell) || hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT);
    }

    function canDeleteFromPreviousParent(cell, previousParent) {
        if (!isEnabled()) return true;
        const user = currentUser();
        if (!user || !cell || cell === model.getRoot() || cell === graph.getDefaultParent()) return false;
        if (isModuleCell(cell)) return canDeleteModuleBoundary(cell, user);
        if (user.admin) return true;
        if (canClaimUnownedModule(previousParent, user.id)) return true;
        if (isOwnerOfNearestScope(cell, user.id)) return true;
        if (canManagePlanting(cell)) return true;
        return !!(previousParent && (isOwnerOfNearestScope(previousParent, user.id) || hasCapability(previousParent, CAP_MANAGE_SCOPE_CONTENT)));
    }

    function canMoveCell(cell) {
        if (!isEnabled()) return true;
        const user = currentUser();
        if (!user || !cell || cell === model.getRoot() || cell === graph.getDefaultParent()) return false;
        if (user.admin) return true;
        if (canClaimUnownedModule(cell, user.id)) return true;
        if (canClaimUnownedModule(nearestUnownedModuleAncestor(cell), user.id)) return true;
        if (isOwnerOfNearestScope(cell, user.id)) return true;
        if (isTaskCard(cell)) return canMoveTask(cell);
        if (nearestPlanting(cell)) return canManagePlanting(cell);
        return hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT);
    }

    function canCreatePlanting(parent) {
        if (!isEnabled()) return true;
        const user = currentUser();
        if (!user || !parent) return false;
        if (user.admin || isOwnerOfNearestScope(parent, user.id)) return true;
        const bed = nearestGardenBed(parent);
        const scope = bed || parent;
        return hasCapability(scope, CAP_CREATE_PLANTINGS);
    }

    function canManagePlanting(cell) {
        if (!isEnabled()) return true;
        const user = currentUser();
        const planting = nearestPlanting(cell);
        if (!user || !planting) return false;
        if (user.admin || isOwnerOfNearestScope(planting, user.id)) return true;
        if (hasCapability(planting, CAP_MANAGE_SCOPE_CONTENT)) return true;
        return getAttr(planting, ATTR_OWNER) === user.id && hasCapability(planting, CAP_MANAGE_OWN_PLANTINGS);
    }

    function canMoveTask(cell) {
        if (!isEnabled()) return true;
        const user = currentUser();
        if (!user || !cell) return false;
        if (user.admin || isOwnerOfNearestScope(cell, user.id) || hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT)) return true;
        const board = nearestTaskBoard(cell);
        return !!board && hasCapability(board, CAP_MOVE_TASKS) && userCanWorkOwnTask(cell, user.id);
    }

    function canEditTaskDetails(cell) {
        if (!isEnabled()) return true;
        const user = currentUser();
        if (!user || !cell) return false;
        if (user.admin || isOwnerOfNearestScope(cell, user.id) || hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT)) return true;
        const board = nearestTaskBoard(cell);
        return !!board && hasCapability(board, CAP_EDIT_TASK_DETAILS) && userCanWorkOwnTask(cell, user.id);
    }

    function canManageAccess(cell) {
        if (!isEnabled()) return false;
        const user = currentUser();
        if (!user || !cell || cell === model.getRoot()) return false;
        if (user.admin) return true;
        return isOwnerOfNearestAccessScope(cell, user.id) || hasCapability(cell, CAP_MANAGE_ACCESS);
    }

    function canManageScopeGrants(cell) {
        return !!eligibleScopeType(cell) && canManageAccess(cell);
    }

    function canTransferOwnership(cell) {
        if (!isEnabled()) return false;
        const user = currentUser();
        if (!user || !cell || cell === model.getRoot()) return false;
        return user.admin || isOwnerOfNearestAccessScope(cell, user.id);
    }

    function eligibleScopeType(cell) {
        if (!cell || cell === model.getRoot() || cell === graph.getDefaultParent()) return "";
        if (isModuleCell(cell)) return "module";
        if (isTaskBoard(cell)) return "task board";
        if (isGardenBed(cell)) return "garden bed";
        return "";
    }

    function cellLabel(cell) {
        const label = getAttr(cell, "label");
        if (label) return String(label);
        if (typeof cell.value === "string" && cell.value) return cell.value;
        return (eligibleScopeType(cell) || "scope") + " " + (cell && (cell.id || (cell.getId && cell.getId())) || "");
    }

    function selectedCells() {
        return graph.getSelectionCells ? (graph.getSelectionCells() || []) : [selectedCell()].filter(Boolean);
    }

    function normalizeScopeCells(input) {
        const raw = Array.isArray(input) ? input : [];
        return raw.map(function (entry) {
            if (!entry) return null;
            if (typeof entry === "string") return model.getCell && model.getCell(entry);
            return entry;
        }).filter(Boolean);
    }

    function getEligibleShareScopes(cells) {
        const resolved = normalizeScopeCells(cells || selectedCells());
        const seen = new Set();
        const scopes = [];
        for (let i = 0; i < resolved.length; i++) {
            const cell = resolved[i];
            const id = cell && (cell.id || (cell.getId && cell.getId()));
            const type = eligibleScopeType(cell);
            if (!id || !type) return { ok: false, reason: "Select only module(s), task board(s), or garden bed(s).", scopes: [] };
            if (seen.has(id)) continue;
            seen.add(id);
            scopes.push({ id, type, label: cellLabel(cell), cell });
        }
        if (!scopes.length) return { ok: false, reason: "Select at least one module, task board, or garden bed to share.", scopes: [] };
        return { ok: true, scopes, cells: scopes.map(function (scope) { return scope.cell; }) };
    }

    function canInviteScopes(cells) {
        if (!isEnabled()) return { ok: false, reason: "Enable users before sharing this garden canvas." };
        if (!isLoggedIn()) return { ok: false, reason: "Log in before sharing this garden canvas." };
        const eligible = getEligibleShareScopes(cells);
        if (!eligible.ok) return eligible;
        for (let i = 0; i < eligible.cells.length; i++) {
            if (!canManageAccess(eligible.cells[i])) return { ok: false, reason: "You can only share scopes you own or administer.", scopes: eligible.scopes };
        }
        return eligible;
    }

    function nearestAccessRequestScope(cell) {
        return nearestAncestorMatching(cell, function (candidate) { return !!eligibleScopeType(candidate); });
    }

    function accessRequestScopeSummary(cell) {
        const scopeCell = nearestAccessRequestScope(cell);
        if (!scopeCell) return null;
        return { id: cellId(scopeCell), type: eligibleScopeType(scopeCell), label: cellLabel(scopeCell), cell: scopeCell };
    }

    function accessRequestMatches(request, userId, scopeCellId) {
        return request && request.requesterUserId === userId && request.scopeCellId === scopeCellId && (request.status === "pending" || request.status === "denied");
    }

    function getAccessRequestForCurrentUser(cell) {
        const user = currentUser();
        if (!isEnabled() || !user) return null;
        const scope = accessRequestScopeSummary(cell);
        if (!scope) return null;
        const request = readStore().accessRequests.find(function (entry) { return accessRequestMatches(entry, user.id, scope.id); });
        return publicAccessRequest(request);
    }

    function requestAccess(cell, options) {
        const source = options || {};
        if (!isEnabled()) return { ok: false, reason: "Users are not enabled for this diagram." };
        const user = currentUser();
        if (!user) return { ok: false, reason: "Log in before requesting access." };
        if (!cell) return { ok: false, reason: "Select a cell before requesting access." };
        if (canEditCell(cell)) return { ok: false, reason: "You already have edit access to this cell." };
        const scope = accessRequestScopeSummary(cell);
        if (!scope || !scope.id) return { ok: false, reason: "Select a module, garden bed, or task board to request access." };
        const store = readStore();
        const existing = store.accessRequests.find(function (entry) { return accessRequestMatches(entry, user.id, scope.id); });
        const timestamp = nowMs();
        if (existing) {
            existing.scopeType = scope.type;
            existing.scopeLabel = scope.label;
            existing.requestedPreset = normalizePreset(source.requestedPreset || source.preset || existing.requestedPreset);
            existing.note = String(source.note || "");
            existing.status = "pending";
            existing.updatedAt = timestamp;
            existing.decidedBy = "";
            existing.decidedAt = 0;
            existing.decisionNote = "";
        } else {
            store.accessRequests.push({
                id: makeId(ACCESS_REQUEST_ID_PREFIX),
                requesterUserId: user.id,
                scopeCellId: scope.id,
                scopeType: scope.type,
                scopeLabel: scope.label,
                requestedPreset: normalizePreset(source.requestedPreset || source.preset),
                note: String(source.note || ""),
                status: "pending",
                createdAt: timestamp,
                updatedAt: timestamp,
                decidedBy: "",
                decidedAt: 0,
                decisionNote: ""
            });
        }
        writeStore(store);
        showStatus("Access request sent for " + scope.label + ".");
        return { ok: true, request: getAccessRequestForCurrentUser(cell) };
    }

    function cellContainsCell(rootCell, targetCell) {
        if (!rootCell || !targetCell) return false;
        let cursor = targetCell;
        while (cursor) {
            if (cursor === rootCell) return true;
            cursor = parentOf(cursor);
        }
        return false;
    }

    function scopeFilterCell(options) {
        const source = options || {};
        if (source.scopeCell) return source.scopeCell;
        if (source.moduleCell) return source.moduleCell;
        const id = String(source.scopeCellId || source.moduleCellId || "").trim();
        return id && model.getCell ? model.getCell(id) : null;
    }

    function accessRequestScopeIsAvailable(cell) {
        return !!(cell && cell !== model.getRoot() && cell !== graph.getDefaultParent() && parentOf(cell));
    }

    function accessRequestInScope(request, filterCell) {
        if (!filterCell) return true;
        const scopeCell = model.getCell && model.getCell(request.scopeCellId);
        return accessRequestScopeIsAvailable(scopeCell) && cellContainsCell(filterCell, scopeCell);
    }

    function canReviewAccessRequest(request) {
        const user = currentUser();
        if (!isEnabled() || !user || !request || request.status !== "pending") return false;
        const scopeCell = model.getCell && model.getCell(request.scopeCellId);
        if (!accessRequestScopeIsAvailable(scopeCell)) return false;
        if (user.admin) return true;
        return accessRequestScopeIsAvailable(scopeCell) && isOwnerOfNearestAccessScope(scopeCell, user.id);
    }

    function listIncomingAccessRequests(options) {
        if (!isEnabled() || !isLoggedIn()) return [];
        const filterCell = scopeFilterCell(options);
        return readStore().accessRequests.filter(function (request) {
            return request.status === "pending" && accessRequestInScope(request, filterCell) && canReviewAccessRequest(request);
        }).map(publicAccessRequest).filter(Boolean);
    }

    function incomingAccessRequestCount(options) {
        return listIncomingAccessRequests(options).length;
    }

    function cellAncestorIds(cell) {
        const ids = [];
        let cursor = cell;
        while (cursor) {
            const id = cellId(cursor);
            if (id) ids.push(id);
            cursor = parentOf(cursor);
        }
        return ids;
    }

    function accessMessageInScope(message, filterCell) {
        if (!filterCell) return true;
        const filterId = cellId(filterCell);
        const scopeCell = model.getCell && model.getCell(message.scopeCellId);
        if (accessRequestScopeIsAvailable(scopeCell)) return cellContainsCell(filterCell, scopeCell);
        return !!(filterId && (message.scopeCellId === filterId || (message.scopeAncestorCellIds || []).indexOf(filterId) >= 0));
    }

    function addAccessDecisionMessage(store, request, decision, preset, note, actor) {
        const scopeCell = model.getCell && model.getCell(request.scopeCellId);
        const reviewer = actor || currentUser();
        store.accessMessages = store.accessMessages || [];
        store.accessMessages.push({
            id: makeId(ACCESS_MESSAGE_ID_PREFIX),
            requestId: request.id,
            requesterUserId: request.requesterUserId,
            reviewerUserId: reviewer ? reviewer.id : "",
            reviewerName: reviewer ? reviewer.name : "",
            scopeCellId: request.scopeCellId,
            scopeAncestorCellIds: cellAncestorIds(scopeCell),
            scopeType: scopeCell ? (eligibleScopeType(scopeCell) || request.scopeType) : request.scopeType,
            scopeLabel: scopeCell ? cellLabel(scopeCell) : request.scopeLabel,
            decision: decision === "denied" ? "denied" : "approved",
            preset: normalizePreset(preset || request.requestedPreset),
            note: String(note || ""),
            createdAt: nowMs(),
            readAt: 0,
            dismissedAt: 0
        });
    }

    function listAccessMessages(options) {
        const user = currentUser();
        if (!isEnabled() || !user) return [];
        const filterCell = scopeFilterCell(options);
        return readStore().accessMessages.filter(function (message) {
            return message.requesterUserId === user.id && !message.dismissedAt && accessMessageInScope(message, filterCell);
        }).map(publicAccessMessage).filter(Boolean);
    }

    function unreadAccessMessageCount(options) {
        return listAccessMessages(options).filter(function (message) { return !message.readAt; }).length;
    }

    function updateCurrentUserAccessMessage(messageId, updater) {
        const user = currentUser();
        if (!isEnabled() || !user) return { ok: false, reason: "Log in before updating messages." };
        const store = readStore();
        const message = (store.accessMessages || []).find(function (entry) { return entry.id === messageId && entry.requesterUserId === user.id; });
        if (!message) return { ok: false, reason: "Access message was not found." };
        updater(message, nowMs());
        writeStore(store);
        return { ok: true, message: publicAccessMessage(message) };
    }

    function markAccessMessageRead(messageId) {
        return updateCurrentUserAccessMessage(messageId, function (message, timestamp) { if (!message.readAt) message.readAt = timestamp; });
    }

    function dismissAccessMessage(messageId) {
        return updateCurrentUserAccessMessage(messageId, function (message, timestamp) { message.dismissedAt = timestamp; if (!message.readAt) message.readAt = timestamp; });
    }

    function requesterAlreadyHasRequestedAccess(scopeCell, requester, requestedPreset) {
        if (!scopeCell || !requester) return false;
        if (requester.admin || isOwnerOfNearestAccessScope(scopeCell, requester.id)) return true;
        const grant = nearestAccessGrant(scopeCell, requester.id);
        const caps = effectiveCapabilitiesForCell(scopeCell, requester.id);
        const preset = normalizePreset(requestedPreset);
        if (preset === "visitor") return !!grant;
        if (preset === "gardener") return caps.indexOf(CAP_CREATE_PLANTINGS) >= 0 || caps.indexOf(CAP_MOVE_TASKS) >= 0 || caps.indexOf(CAP_EDIT_TASK_DETAILS) >= 0 || caps.indexOf(CAP_MANAGE_SCOPE_CONTENT) >= 0;
        return caps.indexOf(CAP_MANAGE_SCOPE_CONTENT) >= 0 || caps.indexOf(CAP_MANAGE_ACCESS) >= 0;
    }

    function removeAccessRequestFromStore(store, requestId) {
        store.accessRequests = (store.accessRequests || []).filter(function (entry) { return entry.id !== requestId; });
    }

    function approveAccessRequest(requestId, options) {
        const source = options || {};
        const store = readStore();
        const request = store.accessRequests.find(function (entry) { return entry.id === requestId && entry.status === "pending"; });
        if (!request) return { ok: false, reason: "No pending access request was found." };
        const scopeCell = model.getCell && model.getCell(request.scopeCellId);
        if (!accessRequestScopeIsAvailable(scopeCell)) return { ok: false, reason: "The requested scope is no longer available." };
        if (!canReviewAccessRequest(request)) return { ok: false, reason: "You cannot approve this access request." };
        const requester = userById(request.requesterUserId);
        if (!requester) return { ok: false, reason: "The requester is disabled or unavailable." };
        const preset = normalizePreset(source.requestedPreset || source.preset || request.requestedPreset);
        const actor = currentUser();
        if (requesterAlreadyHasRequestedAccess(scopeCell, requester, preset)) {
            addAccessDecisionMessage(store, request, "approved", preset, source.decisionNote, actor);
            removeAccessRequestFromStore(store, request.id);
            writeStore(store);
            return { ok: true, alreadyGranted: true };
        }
        const previousGrants = grantsFromAttr(scopeCell);
        graph[INTERNAL_FLAG] = true;
        model.beginUpdate();
        try {
            setScopeGrantInternal(scopeCell, { userId: requester.id, preset });
            syncGardenRoleCardsForGrantChange(scopeCell, previousGrants, grantsFromAttr(scopeCell));
            addAccessDecisionMessage(store, request, "approved", preset, source.decisionNote, actor);
            removeAccessRequestFromStore(store, request.id);
            setAttr(metadataCell(), ATTR_STORE, JSON.stringify(normalizeStore(store)));
        } finally {
            model.endUpdate();
            graph[INTERNAL_FLAG] = false;
        }
        refreshPanel();
        updateToolbarButton();
        dispatchUsersStoreChanged();
        showStatus("Access approved for " + requester.name + ".");
        return { ok: true, request: publicAccessRequest(request), preset };
    }

    function denyAccessRequest(requestId, decisionNote) {
        const store = readStore();
        const request = store.accessRequests.find(function (entry) { return entry.id === requestId && entry.status === "pending"; });
        if (!request) return { ok: false, reason: "No pending access request was found." };
        if (!canReviewAccessRequest(request)) return { ok: false, reason: "You cannot deny this access request." };
        const actor = currentUser();
        request.status = "denied";
        request.decidedBy = actor ? actor.id : "";
        request.decidedAt = nowMs();
        request.decisionNote = String(decisionNote || "");
        request.updatedAt = request.decidedAt;
        addAccessDecisionMessage(store, request, "denied", request.requestedPreset, request.decisionNote, actor);
        writeStore(store);
        showStatus("Access request denied.");
        return { ok: true, request: publicAccessRequest(request) };
    }

    function getAccessSummary(cell) {
        const owner = nearestOwnedAncestor(cell);
        const grants = getScopeGrants(cell);
        const current = currentUser();
        const currentInheritedGrant = current ? nearestInheritedAccessGrant(cell, current.id) : null;
        return {
            ownerUserId: owner && owner.ownerUserId || "",
            ownerCellId: owner && owner.cell && owner.cell.id || "",
            directOpen: getAttr(cell, ATTR_ACCESS_OPEN) === "1",
            directUserIds: grants.map(function (grant) { return grant.userId; }),
            directGrants: grants,
            effectiveCapabilities: current ? effectiveCapabilitiesForCell(cell, current.id) : [],
            inheritedAccessGrant: currentInheritedGrant ? publicGrant(currentInheritedGrant.grant) : null,
            inheritedAccessSource: currentInheritedGrant ? scopeSummaryForCell(currentInheritedGrant.cell) : null,
            effectiveOpen: !!nearestAccessGrant(cell, null),
            canEdit: canEditCell(cell),
            canAdd: canAddCell(cell),
            canDelete: canDeleteCell(cell),
            canManageAccess: canManageAccess(cell),
            canManageScopeGrants: canManageScopeGrants(cell),
            canTransferOwnership: canTransferOwnership(cell)
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

    function writeActorAttribute(node, key, value) {
        if (!node || !key) return false;
        const next = value == null || value === "" ? "" : String(value);
        const current = node.getAttribute(key) || "";
        if (current === next) return false;
        if (next) node.setAttribute(key, next);
        else node.removeAttribute(key);
        return true;
    }

    function applyActorStamp(node, user, kind, options) {
        if (!node || !user) return false;
        const opts = options || {};
        let changed = false;
        if (opts.owner === true && !node.getAttribute(ATTR_OWNER)) changed = writeActorAttribute(node, ATTR_OWNER, user.id) || changed;
        if (kind === "created" && !node.getAttribute(ATTR_CREATED_BY)) changed = writeActorAttribute(node, ATTR_CREATED_BY, user.id) || changed;
        if (kind === "edited") changed = writeActorAttribute(node, ATTR_EDITED_BY, user.id) || changed;
        changed = writeActorAttribute(node, ATTR_ACTOR_NAME, user.name) || changed;
        changed = writeActorAttribute(node, ATTR_ACTOR_ROLE, user.admin ? "admin" : "regular") || changed;
        return changed;
    }

    function addChangeToEdit(edit, change) {
        if (!edit || !change) return false;
        if (typeof edit.add === "function") edit.add(change);
        else if (Array.isArray(edit.changes)) edit.changes.push(change);
        else return false;
        return true;
    }

    function stampActorDirect(cell, kind, options) {
        const user = currentUser();
        if (!cell || !user) return false;
        const node = ensureXmlValueDirect(cell);
        const changed = applyActorStamp(node, user, kind, options);
        if (!changed) return false;
        refreshPanel();
        return true;
    }

    function stampActorIntoEdit(edit, cell, kind, options) {
        const user = currentUser();
        if (!cell || !user) return false;
        if (!edit || !Array.isArray(edit.changes)) return stampActorDirect(cell, kind, options);
        const previous = cloneCellValueForUndo(cell.value);
        const node = ensureXmlValueDirect(cell);
        if (!applyActorStamp(node, user, kind, options)) return false;
        const value = cloneCellValueForUndo(cell.value);
        return addChangeToEdit(edit, new TrellisUsersValueChange(cell, previous, value));
    }

    function activeModelEdit() {
        return model && model.currentEdit && Array.isArray(model.currentEdit.changes) ? model.currentEdit : null;
    }

    function stampCreatedOwner(cell, edit) {
        const targetEdit = edit || activeModelEdit();
        const stamped = targetEdit ? stampActorIntoEdit(targetEdit, cell, "created", { owner: true }) : stampActorDirect(cell, "created", { owner: true });
        if (stamped && graph.refresh) graph.refresh(cell);
        return stamped;
    }

    function stampActorOnCell(cell, kind, edit) {
        const targetEdit = edit || activeModelEdit();
        const stamped = targetEdit ? stampActorIntoEdit(targetEdit, cell, kind) : stampActorDirect(cell, kind);
        if (stamped && graph.refresh) graph.refresh(cell);
        return stamped;
    }

    function setAccess(cell, options) {
        if (!cell || !canManageScopeGrants(cell)) return { ok: false, reason: "Select a module, garden bed, or task board to manage access." };
        const source = options || {};
        const previousGrants = grantsFromAttr(cell);
        graph[INTERNAL_FLAG] = true;
        model.beginUpdate();
        try {
            setAttr(cell, ATTR_ACCESS_OPEN, "");
            const grants = (source.userIds || []).filter(function (id) { return !!storedOrPendingUserById(id); }).map(function (userId) { return normalizeGrant({ userId, preset: source.preset || "visitor", capabilities: source.capabilities }); });
            setGrantsAttr(cell, grants);
            syncGardenRoleCardsForGrantChange(cell, previousGrants, grantsFromAttr(cell));
            syncCompanionAccessIfGarden(cell);
        } finally {
            model.endUpdate();
            graph[INTERNAL_FLAG] = false;
        }
        refreshPanel();
        return { ok: true };
    }

    function setOwner(cell, userId) {
        if (!cell || !canTransferOwnership(cell)) return { ok: false, reason: "You cannot change ownership for this cell." };
        if (!userById(userId)) return { ok: false, reason: "Unknown owner." };
        graph[INTERNAL_FLAG] = true;
        model.beginUpdate();
        try { setAttr(cell, ATTR_OWNER, userId); syncCompanionAccessIfGarden(cell); } finally { model.endUpdate(); graph[INTERNAL_FLAG] = false; }
        refreshPanel();
        return { ok: true };
    }

    function getUserRoleCard(userId) {
        const matches = roleCardsForUser(String(userId || ""));
        if (matches.length !== 1) return null;
        const cell = matches[0];
        return { id: cell.id || (cell.getId && cell.getId()) || "", cell, label: cellLabel(cell) };
    }

    function getUserGardenRoleCard(userId, gardenCell) {
        const matches = roleCardsForGardenUser(gardenCell, String(userId || ""));
        if (matches.length !== 1) return null;
        const cell = matches[0];
        return { id: cellId(cell), cell, label: cellLabel(cell), gardenId: cellId(gardenCell) };
    }

    function listRoleCards() {
        const cards = [];
        traverseCells(model.getRoot && model.getRoot(), function (cell) {
            if (isRoleCard(cell)) cards.push({ id: cell.id || (cell.getId && cell.getId()) || "", cell, label: cellLabel(cell), userId: getAttr(cell, ATTR_ROLE_USER) || "" });
        });
        return cards.sort(function (left, right) { return left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id); });
    }

    function listGardenRoleCards(gardenCell) {
        const gardenId = cellId(gardenCell);
        return listRoleCards().filter(function (role) { return getAttr(role.cell, ATTR_ROLE_GARDEN_MODULE) === gardenId; });
    }

    function setUserRoleCard(userId, roleCard) {
        const cleanUserId = String(userId || "").trim();
        if (!roleCard || !isRoleCard(roleCard)) return { ok: false, reason: "Select a role card." };
        if (!canTransferOwnership(roleCard)) return { ok: false, reason: "Only admins or owners can link users to role cards." };
        if (cleanUserId && !userById(cleanUserId)) return { ok: false, reason: "Unknown user." };
        graph[INTERNAL_FLAG] = true;
        model.beginUpdate();
        try {
            const gardenId = getAttr(roleCard, ATTR_ROLE_GARDEN_MODULE) || "";
            traverseCells(model.getRoot && model.getRoot(), function (cell) {
                if (isRoleCard(cell) && cleanUserId && getAttr(cell, ATTR_ROLE_USER) === cleanUserId && cell !== roleCard && (gardenId ? getAttr(cell, ATTR_ROLE_GARDEN_MODULE) === gardenId : !getAttr(cell, ATTR_ROLE_GARDEN_MODULE))) setAttr(cell, ATTR_ROLE_USER, "");
            });
            setAttr(roleCard, ATTR_ROLE_USER, cleanUserId);
        } finally {
            model.endUpdate();
            graph[INTERNAL_FLAG] = false;
        }
        refreshPanel();
        return { ok: true, roleCard: cleanUserId ? getUserRoleCard(cleanUserId) : null };
    }

    function composeInviteEmail(invite, code, shareInfo) {
        const info = shareInfo || {};
        const lines = [
            "You have been invited to collaborate on a Trellis garden canvas.",
            "",
            "1. Add the sender in Syncthing using the device and folder details below.",
            "2. Wait for the sender to approve your Syncthing device/share.",
            "3. Open the synced diagram in Trellis Studio.",
            "4. In People & Access, choose Accept Invite and enter your email, invite code, display name, and PIN.",
            "",
            "Trellis invite code: " + code,
            "Invite expires: " + new Date(invite.expiresAt).toLocaleString(),
            "Recipient email: " + invite.email,
            "Shared scopes: " + ((invite.scopeLabels || []).join(", ") || "Selected scopes"),
            "",
            "Syncthing device ID: " + (info.deviceId || "(unavailable)"),
            "Syncthing folder ID: " + (info.folderId || "(unavailable)"),
            "Syncthing folder label: " + (info.folderLabel || "(unavailable)"),
            "Syncthing folder path: " + (info.folderPath || "(unavailable)"),
            "",
            "This is a low-security local workflow invite. Access can be revoked from the People & Access panel."
        ];
        return { to: invite.email, subject: "Trellis garden canvas invite", body: lines.join("\n") };
    }

    function createPendingInvite(options) {
        const source = options || {};
        const email = normalizeEmail(source.email);
        if (!validEmail(email)) return { ok: false, reason: "Enter a complete recipient email address." };
        const store = expireInvites(readStore());
        if (!store.usersEnabled) return { ok: false, reason: "Enable users before sharing this garden canvas." };
        const actor = currentUser();
        if (!actor) return { ok: false, reason: "Log in before sharing this garden canvas." };
        if (emailExists(store, email)) return { ok: false, reason: "That email is already invited or already belongs to a user." };
        const scopeCheck = canInviteScopes(source.scopeCellIds || source.cells || []);
        if (!scopeCheck.ok) return { ok: false, reason: scopeCheck.reason };
        const preset = normalizePreset(source.preset || "visitor");
        const capabilities = normalizeCapabilities(source.capabilities, preset);
        const code = makeInviteCode();
        const codeSalt = makeId(INVITE_CODE_SALT_PREFIX);
        const pendingUser = { id: makeId(USER_ID_PREFIX), email, invitedBy: actor.id, invitedAt: nowMs(), disabled: false };
        const invite = {
            id: makeId(INVITE_ID_PREFIX),
            pendingUserId: pendingUser.id,
            email,
            codeSalt,
            codeHash: hashInviteCode(code, codeSalt),
            scopeCellIds: scopeCheck.scopes.map(function (scope) { return scope.id; }),
            scopeLabels: scopeCheck.scopes.map(function (scope) { return scope.label; }),
            preset,
            capabilities,
            createdBy: actor.id,
            createdAt: nowMs(),
            expiresAt: nowMs() + INVITE_EXPIRY_MS,
            status: "pending"
        };
        store.pendingUsers.push(pendingUser);
        store.invites.push(invite);
        writeStoreAndGrant(store, pendingUser.id, invite.scopeCellIds, { preset, capabilities });
        const emailDraft = composeInviteEmail(invite, code, source.shareInfo || {});
        showStatus("Invite created for " + email + ". Review and send the email draft.");
        return { ok: true, invite: publicInvite(invite), code, emailDraft };
    }

    function acceptInviteState(options) {
        const source = options || {};
        const email = normalizeEmail(source.email);
        const name = String(source.name || "").trim();
        const pin = String(source.pin || "");
        const code = String(source.code || "").trim().toUpperCase();
        if (!validEmail(email) || !code || !name || !pin) return { ok: false, reason: "Enter email, invite code, display name, and PIN." };
        const store = expireInvites(readStore());
        const invite = store.invites.find(function (entry) { return entry.status === "pending" && normalizeEmail(entry.email) === email; });
        if (!invite) return { ok: false, reason: "No active invite matches that email." };
        if (nowMs() > invite.expiresAt) return { ok: false, reason: "That invite has expired." };
        if (invite.codeHash !== hashInviteCode(code, invite.codeSalt)) return { ok: false, reason: "Invite code is incorrect." };
        if (store.users.some(function (user) { return user.name.toLowerCase() === name.toLowerCase(); })) return { ok: false, reason: "A user with that name already exists." };
        const pending = store.pendingUsers.find(function (entry) { return entry.id === invite.pendingUserId; });
        if (!pending) return { ok: false, reason: "Invite user record is missing." };
        const salt = makeId(PIN_SALT_PREFIX);
        const user = { id: pending.id, name, email, pinSalt: salt, pinHash: hashPin(pin, salt), admin: false, disabled: false, createdAt: nowMs() };
        store.users.push(user);
        store.pendingUsers = store.pendingUsers.filter(function (entry) { return entry.id !== pending.id; });
        invite.status = "accepted";
        writeStore(store);
        currentUserId = user.id;
        graph[INTERNAL_FLAG] = true;
        model.beginUpdate();
        try { ensureGardenRoleCardsForUser(user.id); } finally { model.endUpdate(); graph[INTERNAL_FLAG] = false; }
        return { ok: true, user: publicUser(user) };
    }

    function acceptInvite(options) {
        const hadAuthGate = !!authOverlay;
        const result = acceptInviteState(options);
        if (result.ok && result.user) finalizePublicAuthMutation("Invite accepted. Logged in as " + result.user.name + ".", hadAuthGate);
        return result;
    }

    function canManageInvite(invite) {
        const actor = currentUser();
        if (!actor || !invite) return false;
        if (actor.admin) return true;
        return (invite.scopeCellIds || []).every(function (cellId) {
            const cell = model.getCell && model.getCell(cellId);
            return !!cell && canManageAccess(cell);
        });
    }

    function revokeInvite(inviteId) {
        const store = expireInvites(readStore());
        const invite = store.invites.find(function (entry) { return entry.id === inviteId; });
        if (!invite || invite.status !== "pending") return { ok: false, reason: "No pending invite was found." };
        if (!canManageInvite(invite)) return { ok: false, reason: "You cannot revoke this invite." };
        invite.status = "revoked";
        store.pendingUsers = store.pendingUsers.filter(function (entry) { return entry.id !== invite.pendingUserId; });
        removeGrantsForUser(invite.pendingUserId, invite.scopeCellIds);
        writeStore(store);
        showStatus("Invite revoked for " + invite.email + ".");
        return { ok: true };
    }

    function resendInvite(inviteId, shareInfo) {
        const store = expireInvites(readStore());
        const invite = store.invites.find(function (entry) { return entry.id === inviteId; });
        if (!invite || invite.status !== "pending") return { ok: false, reason: "No pending invite was found." };
        if (!canManageInvite(invite)) return { ok: false, reason: "You cannot resend this invite." };
        const code = makeInviteCode();
        invite.codeSalt = makeId(INVITE_CODE_SALT_PREFIX);
        invite.codeHash = hashInviteCode(code, invite.codeSalt);
        invite.expiresAt = nowMs() + INVITE_EXPIRY_MS;
        writeStore(store);
        return { ok: true, invite: publicInvite(invite), code, emailDraft: composeInviteEmail(invite, code, shareInfo || {}) };
    }

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
        const directKey = String(change.key || change.attribute || change.name || "");
        if (PROTECTED_ATTRS.has(directKey)) return true;
        const before = valueAttrSnapshot(change.previous);
        const after = valueAttrSnapshot(change.value || (change.cell && change.cell.value));
        for (const key of PROTECTED_ATTRS) if ((before[key] || "") !== (after[key] || "")) return true;
        return false;
    }

    function roleUserLinkChanged(change) {
        if (!change) return false;
        const directKey = String(change.key || change.attribute || change.name || "");
        if (directKey === ATTR_ROLE_USER) return true;
        const before = allValueAttrSnapshot(change.previous);
        const after = allValueAttrSnapshot(change.value || (change.cell && change.cell.value));
        return (before[ATTR_ROLE_USER] || "") !== (after[ATTR_ROLE_USER] || "");
    }

    function allValueAttrSnapshot(value) {
        const out = {};
        if (!value || typeof value !== "object" || value.nodeType !== 1 || !value.attributes) return out;
        for (let i = 0; i < value.attributes.length; i++) {
            const attr = value.attributes[i];
            if (attr) out[attr.name] = attr.value;
        }
        return out;
    }

    function changedAttributeNames(change) {
        const direct = String(change && (change.key || change.attribute || change.name || "") || "");
        if (direct) return [direct];
        const names = new Set();
        const before = allValueAttrSnapshot(change && change.previous);
        const after = allValueAttrSnapshot(change && (change.value || (change.cell && change.cell.value)));
        Object.keys(before).forEach(function (key) { if ((before[key] || "") !== (after[key] || "")) names.add(key); });
        Object.keys(after).forEach(function (key) { if ((before[key] || "") !== (after[key] || "")) names.add(key); });
        return Array.from(names);
    }

    function isTaskDetailOnlyChange(change) {
        const names = changedAttributeNames(change);
        if (!names.length) return true;
        return names.every(function (name) { return TASK_DETAIL_ATTRS.has(name) && !TASK_ASSIGNMENT_ATTRS.has(name); });
    }

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

    function debugCellId(cell) {
        return cell && (cell.id || (typeof cell.getId === "function" && cell.getId())) || null;
    }

    function debugGeometry(cell) {
        const g = cell && typeof cell.getGeometry === "function" ? cell.getGeometry() : null;
        return g ? { x: g.x, y: g.y, width: g.width, height: g.height } : null;
    }

    function debugCellRef(cell) {
        return cell ? { id: debugCellId(cell), label: getAttr(cell, "label") || "", valueName: cell.value && cell.value.nodeName || "", style: getStyle(cell) || "" } : null;
    }

    function debugCellSnapshot(cell) {
        if (!cell) return null;
        return {
            id: debugCellId(cell),
            label: getAttr(cell, "label") || "",
            valueName: cell.value && cell.value.nodeName || "",
            style: getStyle(cell) || "",
            geometry: debugGeometry(cell),
            attrs: {
                tiler_group: getAttr(cell, "tiler_group"),
                garden_bed: getAttr(cell, "garden_bed") || getAttr(cell, "gardenBed") || getAttr(cell, "is_garden_bed"),
                garden_module: getAttr(cell, "garden_module") || getAttr(cell, "team_module"),
                board_key: getAttr(cell, "board_key"),
                kanban_card: getAttr(cell, "kanban_card"),
                lane_key: getAttr(cell, "lane_key"),
                owner: getAttr(cell, ATTR_OWNER),
                roleUser: getAttr(cell, ATTR_ROLE_USER)
            },
            classification: {
                module: isModuleCell(cell),
                gardenBed: isGardenBed(cell),
                tilerGroup: isTilerGroup(cell),
                taskBoard: isTaskBoard(cell),
                taskCard: isTaskCard(cell),
                roleCard: isRoleCard(cell),
                nearestPlanting: debugCellId(nearestPlanting(cell)),
                nearestGardenBed: debugCellId(nearestGardenBed(cell)),
                nearestTaskBoard: debugCellId(nearestTaskBoard(cell))
            }
        };
    }

    function debugOwnedScope(cell) {
        const owner = nearestOwnedAncestor(cell);
        return owner ? { cellId: debugCellId(owner.cell), ownerUserId: owner.ownerUserId, accessScope: !isTilerGroup(owner.cell) } : null;
    }

    function debugPermissionSnapshot(change) {
        const cell = cellFromChange(change);
        const currentParent = currentParentOfChange(change);
        const previousParent = previousParentOfChange(change);
        const user = currentUser();
        return {
            enabled: isEnabled(),
            loggedIn: isLoggedIn(),
            currentUser: user ? { id: user.id, name: user.name, email: user.email, admin: !!user.admin } : null,
            change: {
                type: change && change.constructor && change.constructor.name || "",
                key: String(change && (change.key || change.attribute || change.name || "") || ""),
                changedAttrs: changedAttributeNames(change),
                previousParentId: debugCellId(previousParent),
                currentParentId: debugCellId(currentParent)
            },
            cell: debugCellSnapshot(cell),
            currentParent: debugCellRef(currentParent),
            previousParent: debugCellRef(previousParent),
            nearestOwnedScope: debugOwnedScope(cell),
            effectiveCapabilities: cell && user ? effectiveCapabilitiesForCell(cell, user.id) : [],
            decisions: {
                canCreatePlantingAtCurrentParent: canCreatePlanting(currentParent),
                canManagePlanting: canManagePlanting(cell),
                canMoveCell: canMoveCell(cell),
                canEditCell: canEditCell(cell),
                canManageAccess: canManageAccess(cell),
                canTransferOwnership: canTransferOwnership(cell)
            }
        };
    }

    function debugChangeSummary(change, index) {
        const cell = cellFromChange(change);
        return {
            index,
            type: change && change.constructor && change.constructor.name || "",
            cellId: debugCellId(cell),
            key: String(change && (change.key || change.attribute || change.name || "") || ""),
            changedAttrs: changedAttributeNames(change),
            currentParentId: debugCellId(currentParentOfChange(change)),
            previousParentId: debugCellId(previousParentOfChange(change)),
            classification: cell ? { module: isModuleCell(cell), gardenBed: isGardenBed(cell), tilerGroup: isTilerGroup(cell), taskBoard: isTaskBoard(cell), taskCard: isTaskCard(cell), roleCard: isRoleCard(cell), nearestPlanting: debugCellId(nearestPlanting(cell)) } : null
        };
    }

    function logDeniedChange(change, index) {
        consoleGroup("[TrellisUsers] denied change", debugChangeSummary(change, index), function () {
            const detail = debugPermissionSnapshot(change);
            if (console.log) console.log(detail);
        });
    }

    function logRejectedEdit(edit, reason) {
        const changes = edit && edit.changes || [];
        consoleGroup("[TrellisUsers] rejected edit", { reason: reason || "", changeCount: changes.length }, function () {
            const rows = changes.map(function (change, index) { return debugChangeSummary(change, index); });
            if (console.table) console.table(rows);
            else if (console.log) console.log(rows);
        });
    }

    function isActorStampableEditChange(change) {
        const name = change && change.constructor && change.constructor.name;
        return name === "mxStyleChange" || name === "mxValueChange" || name === "mxTerminalChange" || name === "mxGeometryChange" || name === "mxCollapseChange" || name === "mxVisibleChange" || name === "mxCellAttributeChange";
    }

    function stampAcceptedActorMetadata(edit, changes) {
        const sourceChanges = (changes || []).slice();
        const stamped = new Set();
        sourceChanges.forEach(function (change) {
            if (!change || change.__trellisUsersActorStamp) return;
            const name = change && change.constructor && change.constructor.name;
            const cell = cellFromChange(change);
            if (!cell) return;
            const keyBase = String(cell.id || (cell.getId && cell.getId()) || "");
            [cell, currentParentOfChange(change), previousParentOfChange(change)].forEach(function (moduleCell) {
                if (!isUnownedModuleCell(moduleCell)) return;
                const moduleKey = cellStableId(moduleCell) + ":createdOwner";
                if (!stamped.has(moduleKey)) { stampCreatedOwner(moduleCell, edit); stamped.add(moduleKey); }
            });
            if (name === "mxChildChange" && currentParentOfChange(change) && !previousParentOfChange(change) && isTilerGroup(cell)) {
                const key = keyBase + ":createdOwner";
                if (!stamped.has(key)) { stampCreatedOwner(cell, edit); stamped.add(key); }
                return;
            }
            if (isActorStampableEditChange(change)) {
                const key = keyBase + ":edited";
                if (!stamped.has(key)) { stampActorIntoEdit(edit, cell, "edited"); stamped.add(key); }
            }
        });
    }

    function isOrphanGeneratedPlantTileChildChange(change) {
        const name = change && change.constructor && change.constructor.name;
        if (name !== "mxChildChange") return false;
        if (currentParentOfChange(change) || previousParentOfChange(change)) return false;
        return isGeneratedPlantTile(cellFromChange(change));
    }

    function cellStableId(cell) {
        return cell && (cell.id || (typeof cell.getId === "function" && cell.getId())) || "";
    }

    function collectAllowedCreatedPlantingIds(changes) {
        const ids = new Set();
        (Array.isArray(changes) ? changes : []).forEach(function (change) {
            const name = change && change.constructor && change.constructor.name;
            const cell = cellFromChange(change);
            if (name !== "mxChildChange" || !cell || !isTilerGroup(cell)) return;
            const currentParent = currentParentOfChange(change);
            const previousParent = previousParentOfChange(change);
            if (currentParent && !previousParent && canCreatePlanting(currentParent)) ids.add(cellStableId(cell));
        });
        return ids;
    }

    function isCreatedPlantingInContext(cell, context) {
        const ids = context && context.createdPlantingIds;
        return !!(cell && isTilerGroup(cell) && ids && ids.has(cellStableId(cell)));
    }

    function isCreatedPlantingInitializationChange(change, context) {
        const name = change && change.constructor && change.constructor.name;
        if (name !== "mxCellAttributeChange" && name !== "mxValueChange" && name !== "mxStyleChange" && name !== "mxGeometryChange" && name !== "mxCollapseChange" && name !== "mxVisibleChange") return false;
        return isCreatedPlantingInContext(cellFromChange(change), context);
    }

    function nearestCreatedPlantingForGeneratedTile(cell, context) {
        if (!isGeneratedPlantTile(cell)) return null;
        const planting = nearestPlanting(cell);
        return isCreatedPlantingInContext(planting, context) ? planting : null;
    }

    function isGeneratedPlantTileInitializationChange(change, context) {
        const name = change && change.constructor && change.constructor.name;
        if (name !== "mxValueChange" && name !== "mxStyleChange" && name !== "mxGeometryChange" && name !== "mxCollapseChange" && name !== "mxVisibleChange") return false;
        return !!nearestCreatedPlantingForGeneratedTile(cellFromChange(change), context);
    }

    function plantingContextAllowsGeneratedTileChurn(change) {
        const name = change && change.constructor && change.constructor.name;
        const cell = cellFromChange(change);
        if (!name || !cell) return false;
        if (change && change.__trellisUsersActorStamp) return false;
        if (isOrphanGeneratedPlantTileChildChange(change)) return false;
        if (name === "mxChildChange") {
            const currentParent = currentParentOfChange(change);
            const previousParent = previousParentOfChange(change);
            if (currentParent && !previousParent && isTilerGroup(cell)) return canCreatePlanting(currentParent);
            if (nearestPlanting(cell)) return canManagePlanting(cell);
            return false;
        }
        return nearestPlanting(cell) ? canManagePlanting(cell) : false;
    }

    function editPermissionContext(changes) {
        const source = Array.isArray(changes) ? changes : [];
        const createdPlantingIds = collectAllowedCreatedPlantingIds(source);
        return {
            createdPlantingIds,
            allowGeneratedPlantTileChurn: createdPlantingIds.size > 0 || source.some(plantingContextAllowsGeneratedTileChurn)
        };
    }

    function changeAllowed(change, context) {
        if (change && change.__trellisUsersActorStamp) return true;
        const name = change && change.constructor && change.constructor.name;
        const cell = cellFromChange(change);
        if (!name || !cell) return true;
        if (roleUserLinkChanged(change)) return canTransferOwnership(cell);
        const changedAttrs = (name === "mxCellAttributeChange" || name === "mxValueChange") ? changedAttributeNames(change) : [];
        if (changedAttrs.indexOf(ATTR_OWNER) >= 0) return canTransferOwnership(cell);
        if (changedAttrs.some(function (attr) { return SCOPE_GRANT_ATTRS.has(attr); })) return canManageScopeGrants(cell);
        if ((name === "mxCellAttributeChange" || name === "mxValueChange") && PROTECTED_ATTRS.has(String(change.key || "")) && !canManageAccess(cell)) return false;
        if ((name === "mxCellAttributeChange" || name === "mxValueChange") && protectedAttrsChanged(change) && !canManageAccess(cell)) return false;
        if ((name === "mxCellAttributeChange" || name === "mxValueChange") && isModuleCell(cell)) return canEditCell(cell);
        if (name === "mxChildChange") {
            const currentParent = currentParentOfChange(change);
            const previousParent = previousParentOfChange(change);
            if (!currentParent && !previousParent && isGeneratedPlantTile(cell)) return !!(context && context.allowGeneratedPlantTileChurn);
            if (currentParent && !previousParent && isTilerGroup(cell)) return canCreatePlanting(currentParent);
            if (currentParent && !previousParent && isGeneratedPlantTile(cell) && isCreatedPlantingInContext(currentParent, context)) return true;
            if (currentParent && previousParent && currentParent !== previousParent && isTaskCard(cell)) return canMoveTask(cell);
            if (currentParent && previousParent && currentParent === previousParent && isTaskCard(cell)) return canMoveTask(cell);
            if (currentParent && !canAddCell(currentParent)) return false;
            if (!currentParent && previousParent) return canDeleteFromPreviousParent(cell, previousParent);
            if (currentParent && previousParent && currentParent !== previousParent && !canDeleteFromPreviousParent(cell, previousParent)) return false;
            return !!currentParent;
        }
        if (name === "mxValueChange" && protectedAttrsChanged(change)) return canManageAccess(cell);
        if ((name === "mxCellAttributeChange" || name === "mxValueChange") && isTaskCard(cell)) {
            if (changedAttributeNames(change).some(function (attr) { return TASK_ASSIGNMENT_ATTRS.has(attr); })) return hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT);
            return isTaskDetailOnlyChange(change) ? canEditTaskDetails(cell) : hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT);
        }
        if (isCreatedPlantingInitializationChange(change, context)) return true;
        if (isGeneratedPlantTileInitializationChange(change, context)) return true;
        if (name === "mxCellAttributeChange") {
            if (nearestPlanting(cell)) return canManagePlanting(cell);
            return hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT);
        }
        if (name === "mxGeometryChange") return canMoveCell(cell);
        if (name === "mxStyleChange" || name === "mxValueChange" || name === "mxTerminalChange" || name === "mxCollapseChange" || name === "mxVisibleChange") {
            if (nearestPlanting(cell)) return canManagePlanting(cell);
            return canEditCell(cell);
        }
        return true;
    }

    function rejectEdit(edit, reason, context) {
        logRejectedEdit(edit, reason);
        if (edit) edit.__trellisUsersRejected = true;
        graph[REJECT_FLAG] = true;
        graph[INTERNAL_FLAG] = true;
        try {
            if (edit && typeof edit.undo === "function") edit.undo();
        } finally {
            graph[INTERNAL_FLAG] = false;
            graph[REJECT_FLAG] = false;
        }
        showRejectedEditPopover(reason || "Change rejected.", context);
        if (graph.refresh) graph.refresh();
    }

    function inspectModelChange(_sender, evt) {
        if (!isEnabled()) return;
        if (graph[INTERNAL_FLAG] || graph[REJECT_FLAG]) return;
        if ((ui && ui.openingFile) || graphXmlLoading > 0) return;
        const edit = evt && evt.getProperty && evt.getProperty("edit");
        if (edit && (edit.undone || edit.redone)) return;
        const changes = edit && edit.changes || [];
        if (!changes.length) return;
        if (!isLoggedIn()) { rejectEdit(edit, "Log in before editing this diagram.", { action: "login" }); return; }
        const permissionContext = editPermissionContext(changes);
        for (let i = 0; i < changes.length; i++) {
            if (!changeAllowed(changes[i], permissionContext)) {
                logDeniedChange(changes[i], i);
                rejectEdit(edit, "Change rejected by Trellis user permissions.", { cell: cellFromChange(changes[i]) });
                return;
            }
        }
        stampAcceptedActorMetadata(edit, changes);
    }

    function makeButton(label, onClick, variant) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.style.cssText = "padding:4px 8px;border:1px solid #9CA3AF;border-radius:4px;background:#fff;cursor:pointer;font:12px Arial,sans-serif;";
        applyUsersButtonStyle(button, variant || "neutral", { compact: true });
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

    function activePeopleSearch() {
        return String(peopleSearchText || "").trim().toLowerCase();
    }

    function activePeopleTypeFilter() {
        return ["networked", "local"].indexOf(peopleTypeFilter) >= 0 ? peopleTypeFilter : "all";
    }

    function userIsNetworked(user) {
        return !!normalizeEmail(user && user.email);
    }

    function userMatchesPeopleSearch(user) {
        const query = activePeopleSearch();
        if (!query) return true;
        return String(user && user.name || "").toLowerCase().indexOf(query) >= 0 || normalizeEmail(user && user.email).indexOf(query) >= 0;
    }

    function userMatchesPeopleFilter(user) {
        const type = activePeopleTypeFilter();
        if (type === "networked" && !userIsNetworked(user)) return false;
        if (type === "local" && userIsNetworked(user)) return false;
        return userMatchesPeopleSearch(user);
    }

    function inviteMatchesPeopleFilter(invite) {
        if (activePeopleTypeFilter() === "local") return false;
        const query = activePeopleSearch();
        return !query || normalizeEmail(invite && invite.email).indexOf(query) >= 0;
    }

    function filteredEmptyText(label) {
        return activePeopleSearch() || activePeopleTypeFilter() !== "all" ? "No " + label.toLowerCase() + " match the current filter." : "None";
    }

    function titleCaseScopeType(type) {
        return String(type || "cell").replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
    }

    function scopeSummaryForCell(cell) {
        if (!cell || cell === model.getRoot()) return null;
        const type = eligibleScopeType(cell) || "cell";
        return { id: cell.id || (cell.getId && cell.getId()) || "", type, label: cellLabel(cell) };
    }

    function selectedScopeSummaries() {
        const seen = new Set();
        const summaries = [];
        (selectedCells() || []).forEach(function (cell) {
            const summary = scopeSummaryForCell(cell);
            if (!summary || !summary.id || seen.has(summary.id)) return;
            seen.add(summary.id);
            summaries.push(summary);
        });
        return summaries;
    }

    function viewportSize() {
        const doc = document && document.documentElement;
        return {
            width: Math.max(320, Number(window && window.innerWidth) || (doc && doc.clientWidth) || 1024),
            height: Math.max(240, Number(window && window.innerHeight) || (doc && doc.clientHeight) || 768)
        };
    }

    function fixedPositionNearButton(width, height, gap) {
        const size = viewportSize();
        const rect = toolbarButton && typeof toolbarButton.getBoundingClientRect === "function" ? toolbarButton.getBoundingClientRect() : null;
        const margin = 8;
        const x = rect ? rect.right - width : size.width - width - margin;
        const y = rect ? rect.bottom + (gap || 4) : 36;
        return {
            left: Math.max(margin, Math.min(x, size.width - width - margin)),
            top: Math.max(margin, Math.min(y, size.height - Math.min(height, size.height - margin * 2) - margin))
        };
    }

    function positionPanelNearButton() {
        if (!panel) return;
        const width = 400;
        const height = Math.min(420, viewportSize().height - 16);
        const pos = fixedPositionNearButton(width, height, 4);
        panel.style.left = pos.left + "px";
        panel.style.top = pos.top + "px";
        panel.style.right = "auto";
        panel.style.width = width + "px";
        panel.style.maxHeight = "calc(100vh - " + Math.max(16, pos.top + 8) + "px)";
    }

    function showStatus(message) {
        if (statusNode) statusNode.textContent = String(message || "");
        else if (ui && typeof ui.alert === "function") ui.alert(String(message || ""));
    }

    function clientPointFromEvent(evt) {
        const event = evt && typeof evt.getEvent === "function" ? evt.getEvent() : evt;
        const x = Number(event && event.clientX);
        const y = Number(event && event.clientY);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }

    function rememberGraphPointerPoint(evt) {
        const point = clientPointFromEvent(evt);
        if (point) lastGraphPointerPoint = point;
    }

    function fallbackRejectedEditPoint() {
        const size = viewportSize();
        return { x: Math.round(size.width / 2), y: Math.round(size.height / 2) };
    }

    function fixedPositionNearPoint(point, width, height, gap) {
        const size = viewportSize();
        const margin = 8;
        const anchor = point || fallbackRejectedEditPoint();
        const offset = gap || 12;
        let left = anchor.x + offset;
        let top = anchor.y + offset;
        if (left + width > size.width - margin) left = anchor.x - width - offset;
        if (top + height > size.height - margin) top = anchor.y - height - offset;
        return {
            left: Math.max(margin, Math.min(left, size.width - width - margin)),
            top: Math.max(margin, Math.min(top, size.height - height - margin))
        };
    }

    function clearRejectedEditDismissTimer() {
        if (rejectedEditDismissTimer && typeof clearTimeout === "function") clearTimeout(rejectedEditDismissTimer);
        rejectedEditDismissTimer = 0;
    }

    function closeRejectedEditPopover() {
        clearRejectedEditDismissTimer();
        if (typeof document !== "undefined" && rejectedEditKeyHandler && document.removeEventListener) document.removeEventListener("keydown", rejectedEditKeyHandler, true);
        if (typeof document !== "undefined" && rejectedEditOutsideHandler && document.removeEventListener) document.removeEventListener("mousedown", rejectedEditOutsideHandler, true);
        rejectedEditKeyHandler = null;
        rejectedEditOutsideHandler = null;
        rejectedEditDismissPaused = false;
        if (rejectedEditPopover && rejectedEditPopover.parentNode) rejectedEditPopover.parentNode.removeChild(rejectedEditPopover);
        rejectedEditPopover = null;
    }

    function scheduleRejectedEditDismiss() {
        clearRejectedEditDismissTimer();
        if (!rejectedEditPopover || rejectedEditDismissPaused || typeof setTimeout !== "function") return;
        rejectedEditDismissTimer = setTimeout(closeRejectedEditPopover, REJECTED_EDIT_POPOVER_MS);
    }

    function rejectedEditPopoverAction(context) {
        const source = context || {};
        if (!isLoggedIn()) return { label: "Log in", run: function () { showAuthDialog({ blocking: false, message: "Log in before editing this diagram." }); } };
        const cell = source.cell || selectedCell();
        return cell && accessRequestScopeSummary(cell) ? { label: "Request Access", run: function () { openAccessRequestDialog(cell); } } : null;
    }

    function showRejectedEditPopover(reason, context) {
        const message = String(reason || "Change rejected.");
        if (typeof document === "undefined") { showStatus(message); return false; }
        const host = document.body || graph.container;
        if (!host || !host.appendChild) { showStatus(message); return false; }
        closeRejectedEditPopover();
        const width = 320;
        const height = 126;
        const pos = fixedPositionNearPoint(lastGraphPointerPoint, width, height, 12);
        const root = document.createElement("div");
        root.className = "trellis-users-rejected-edit-popover";
        root.setAttribute("role", "status");
        root.style.cssText = "position:fixed;left:" + pos.left + "px;top:" + pos.top + "px;z-index:" + USERS_UI_LAYER_Z + ";width:" + width + "px;max-width:calc(100vw - 16px);background:#fff;border:1px solid #B91C1C;border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,.24);padding:10px 12px;box-sizing:border-box;font:12px Arial,sans-serif;color:#1F2937;line-height:16px;";
        const title = document.createElement("div");
        title.textContent = "Change rejected";
        title.style.cssText = "font-weight:700;color:#991B1B;margin-bottom:4px;";
        const detail = document.createElement("div");
        detail.textContent = message;
        detail.style.cssText = "color:#374151;";
        root.appendChild(title);
        root.appendChild(detail);
        const action = rejectedEditPopoverAction(context);
        if (action) {
            const actions = document.createElement("div");
            actions.style.cssText = "display:flex;justify-content:flex-end;margin-top:8px;";
            const button = makeButton(action.label, function () { closeRejectedEditPopover(); action.run(); }, "open");
            button.className = (button.className || "") + (action.label === "Request Access" ? " trellis-users-rejected-edit-request-access-button" : " trellis-users-rejected-edit-login-button");
            actions.appendChild(button);
            root.appendChild(actions);
        }
        root.addEventListener("mouseenter", function () { rejectedEditDismissPaused = true; clearRejectedEditDismissTimer(); });
        root.addEventListener("mouseleave", function () { rejectedEditDismissPaused = false; scheduleRejectedEditDismiss(); });
        root.addEventListener("focusin", function () { rejectedEditDismissPaused = true; clearRejectedEditDismissTimer(); });
        root.addEventListener("focusout", function () {
            setTimeout(function () {
                if (rejectedEditPopover === root && (!document.activeElement || !root.contains(document.activeElement))) {
                    rejectedEditDismissPaused = false;
                    scheduleRejectedEditDismiss();
                }
            }, 0);
        });
        root.addEventListener("mousedown", function (evt) { if (evt) evt.stopPropagation(); });
        rejectedEditKeyHandler = function (evt) { if (evt && evt.key === "Escape") closeRejectedEditPopover(); };
        rejectedEditOutsideHandler = function (evt) { if (rejectedEditPopover && evt && !rejectedEditPopover.contains(evt.target)) closeRejectedEditPopover(); };
        document.addEventListener("keydown", rejectedEditKeyHandler, true);
        document.addEventListener("mousedown", rejectedEditOutsideHandler, true);
        host.appendChild(root);
        rejectedEditPopover = root;
        scheduleRejectedEditDismiss();
        return true;
    }

    function openEmailDraft(emailDraft) {
        const bridge = window.trellisShare;
        if (!bridge || typeof bridge.openEmailDraft !== "function") {
            showStatus("Syncthing sharing email bridge is unavailable in this Trellis build.");
            return Promise.resolve({ ok: false, reason: "Email bridge unavailable." });
        }
        return bridge.openEmailDraft(emailDraft).then(function (result) {
            if (!result || result.ok === false) showStatus((result && result.reason) || "Email draft could not be opened.");
            else showStatus("Email draft opened. Review and send it from your mail client.");
            return result || { ok: false };
        }).catch(function (err) {
            showStatus(err && err.message ? err.message : "Email draft could not be opened.");
            return { ok: false, reason: err && err.message ? err.message : String(err) };
        });
    }

    function showAuthStatus(message) {
        const text = String(message || "");
        if (authStatusNode) authStatusNode.textContent = text;
    }

    function currentFileEditable() {
        const file = ui && typeof ui.getCurrentFile === "function" ? ui.getCurrentFile() : null;
        return !file || typeof file.isEditable !== "function" || file.isEditable();
    }

    function setGraphAuthBlocked(blocked) {
        graphAuthBlocked = !!blocked;
        const enabled = !graphAuthBlocked && currentFileEditable();
        if (graph && typeof graph.setEnabled === "function") graph.setEnabled(enabled);
        else if (ui && typeof ui.setGraphEnabled === "function") ui.setGraphEnabled(enabled);
    }

    function closeAuthOverlay(restoreGraph) {
        const hadOverlay = !!authOverlay;
        if (authOverlay && authOverlay.parentNode) authOverlay.parentNode.removeChild(authOverlay);
        authOverlay = null;
        authStatusNode = null;
        if (restoreGraph !== false && (hadOverlay || graphAuthBlocked)) setGraphAuthBlocked(false);
    }

    function closeCurrentDiagramFromAuth() {
        closeAuthOverlay(false);
        currentUserId = "";
        forgetRememberedLogin();
        if (ui && typeof ui.fileLoaded === "function") ui.fileLoaded(null);
        else setGraphAuthBlocked(false);
        updateToolbarButton();
    }

    function authKeepRow() {
        const label = document.createElement("label");
        label.style.cssText = "display:flex;gap:6px;align-items:center;margin:8px 0;color:#374151;";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode("Keep me logged in on this device"));
        return { row: label, checkbox };
    }

    function finishAuthSuccess(keepChecked) {
        const user = currentUser();
        if (user) {
            if (keepChecked) rememberLogin(user.id, true);
            else forgetRememberedLogin();
        }
        closeAuthOverlay(true);
        refreshPanel();
        updateToolbarButton();
    }

    function appendAuthLoginForm(parent) {
        const title = document.createElement("div");
        title.textContent = canBootstrapAdmin() ? "Create first admin" : "Log in";
        title.style.cssText = "font-weight:700;margin-top:8px;";
        parent.appendChild(title);
        const row = document.createElement("div");
        row.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px;";
        const name = makeInput("text", "Name");
        const pin = makeInput("password", "PIN");
        row.appendChild(name);
        row.appendChild(pin);
        parent.appendChild(row);
        const keep = authKeepRow();
        parent.appendChild(keep.row);
        const action = makeButton(canBootstrapAdmin() ? "Create Admin" : "Login", function () {
            const result = loginState(name.value, pin.value);
            pin.value = "";
            if (!result.ok) { showAuthStatus(result.reason); return; }
            finishAuthSuccess(keep.checkbox.checked);
        }, canBootstrapAdmin() ? "add" : "open");
        parent.appendChild(action);
    }

    function appendAuthEnableForm(parent) {
        const hint = document.createElement("div");
        hint.textContent = "Users are off for this diagram. Create the first admin to enable login and permissions.";
        hint.style.cssText = "color:#4B5563;margin-bottom:8px;";
        parent.appendChild(hint);
        const row = document.createElement("div");
        row.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;";
        const name = makeInput("text", "Admin name");
        const pin = makeInput("password", "PIN");
        row.appendChild(name);
        row.appendChild(pin);
        parent.appendChild(row);
        const keep = authKeepRow();
        parent.appendChild(keep.row);
        parent.appendChild(makeButton("Enable Users", function () {
            const result = enableUsersState(name.value, pin.value);
            pin.value = "";
            if (!result.ok) { showAuthStatus(result.reason); return; }
            finishAuthSuccess(keep.checkbox.checked);
        }, "add"));
    }

    function appendAuthInviteForm(parent) {
        const box = document.createElement("div");
        box.style.cssText = "border-top:1px solid #E5E7EB;margin-top:12px;padding-top:10px;";
        const title = document.createElement("div");
        title.textContent = "Accept invite";
        title.style.cssText = "font-weight:700;";
        box.appendChild(title);
        const row = document.createElement("div");
        row.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px;";
        const email = makeInput("email", "Email");
        const code = makeInput("text", "Invite code");
        const name = makeInput("text", "Display name");
        const pin = makeInput("password", "PIN");
        row.appendChild(email);
        row.appendChild(code);
        row.appendChild(name);
        row.appendChild(pin);
        box.appendChild(row);
        const keep = authKeepRow();
        box.appendChild(keep.row);
        box.appendChild(makeButton("Accept Invite", function () {
            const result = acceptInviteState({ email: email.value, code: code.value, name: name.value, pin: pin.value });
            pin.value = "";
            if (!result.ok) { showAuthStatus(result.reason); return; }
            finishAuthSuccess(keep.checkbox.checked);
        }, "add"));
        parent.appendChild(box);
    }

    function showAuthDialog(options) {
        if (typeof document === "undefined") return { ok: false, reason: "Document UI is unavailable." };
        closeAccountMenu();
        const source = options || {};
        const blocking = !!source.blocking;
        if (authOverlay && authOverlay.parentNode) {
            if (authStatusNode) authStatusNode.textContent = source.message || (isEnabled() ? "Log in to open this diagram." : "Enable users for this diagram.");
            if (blocking) setGraphAuthBlocked(true);
            return { ok: true };
        }
        closeAuthOverlay(false);
        const host = document.body || (graph.container && (graph.container.parentNode || graph.container));
        if (!host) return { ok: false, reason: "Auth host is unavailable." };
        authOverlay = document.createElement("div");
        authOverlay.className = "trellis-users-auth-overlay";
        authOverlay.style.cssText = "position:fixed;inset:0;z-index:" + AUTH_OVERLAY_Z + ";background:#fff;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font:12px Arial,sans-serif;";
        authOverlay.addEventListener("mousedown", function (evt) { evt.stopPropagation(); });
        const card = document.createElement("div");
        card.style.cssText = "width:min(460px,100%);border:1px solid #111;border-radius:4px;box-shadow:0 12px 32px rgba(0,0,0,.24);padding:14px;background:#fff;box-sizing:border-box;";
        const header = document.createElement("div");
        header.style.cssText = "display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:8px;";
        const title = document.createElement("div");
        title.textContent = isEnabled() ? "Trellis Login" : "Enable People & Access";
        title.style.cssText = "font-weight:700;font-size:15px;";
        header.appendChild(title);
        header.appendChild(makeButton(blocking ? "Close Diagram" : "Cancel", function () {
            if (blocking) closeCurrentDiagramFromAuth();
            else closeAuthOverlay(true);
        }, "add"));
        card.appendChild(header);
        authStatusNode = document.createElement("div");
        authStatusNode.style.cssText = "min-height:16px;color:#4B5563;margin-bottom:8px;";
        authStatusNode.textContent = source.message || (isEnabled() ? "Log in to open this diagram." : "Enable users for this diagram.");
        card.appendChild(authStatusNode);
        if (!isEnabled()) appendAuthEnableForm(card);
        else { appendAuthLoginForm(card); appendAuthInviteForm(card); }
        authOverlay.appendChild(card);
        host.appendChild(authOverlay);
        if (blocking) setGraphAuthBlocked(true);
        return { ok: true };
    }

    function toolbarHost() {
        return ui && (ui.toolbarContainer || ui.menubarContainer || ui.container) || (graph.container && (graph.container.parentNode || graph.container));
    }

    function toolbarLabel() {
        const user = currentUser();
        if (user) return user.name || "Logout";
        return "Login";
    }

    function updateToolbarButton() {
        if (!toolbarButton) return;
        const panelActive = !!(panel && panel.style.display !== "none"); // CHANGE: user button is active only while the main People & Access panel is visible
        toolbarButton.textContent = toolbarLabel();
        toolbarButton.title = currentUser() ? "People & Access account" : (isEnabled() ? "Log in to People & Access" : "Enable People & Access");
        applyUsersButtonStyle(toolbarButton, "open", { compact: true, active: panelActive }); // CHANGE: reuse the shared light-blue active open-button style
        toolbarButton.setAttribute("aria-pressed", panelActive ? "true" : "false"); // CHANGE: expose the active panel state to assistive tech
    }

    function closeAccountMenu() {
        if (accountMenu && accountMenu.parentNode) accountMenu.parentNode.removeChild(accountMenu);
        accountMenu = null;
        if (accountMenuOutsideHandler && document && typeof document.removeEventListener === "function") document.removeEventListener("mousedown", accountMenuOutsideHandler, true);
        if (accountMenuKeyHandler && document && typeof document.removeEventListener === "function") document.removeEventListener("keydown", accountMenuKeyHandler, true);
        accountMenuOutsideHandler = null;
        accountMenuKeyHandler = null;
    }

    function openAccountMenu() {
        if (typeof document === "undefined" || !toolbarButton) return;
        closeAccountMenu();
        const host = document.body;
        if (!host) return;
        const user = currentUser();
        const menuWidth = 190;
        const menuHeight = 112;
        const pos = fixedPositionNearButton(menuWidth, menuHeight, 4);
        accountMenu = document.createElement("div");
        accountMenu.className = "trellis-users-account-menu";
        accountMenu.style.cssText = "position:fixed;top:" + pos.top + "px;left:" + pos.left + "px;z-index:" + USERS_UI_LAYER_Z + ";background:#fff;border:1px solid #111;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,.22);padding:8px;width:" + menuWidth + "px;font:12px Arial,sans-serif;box-sizing:border-box;";
        accountMenu.addEventListener("mousedown", function (evt) { evt.stopPropagation(); });
        const label = document.createElement("div");
        label.textContent = user ? user.name + " (" + (user.admin ? "admin" : "regular") + ")" : "Not logged in";
        label.style.cssText = "font-weight:700;margin-bottom:8px;";
        accountMenu.appendChild(label);
        const actions = document.createElement("div");
        actions.style.cssText = "display:grid;grid-template-columns:1fr;gap:6px;";
        actions.appendChild(makeButton("People & Access", function () { closeAccountMenu(); togglePanel(); }, "open"));
        actions.appendChild(makeButton("Logout", function () { logout(); }, "neutral"));
        accountMenu.appendChild(actions);
        host.appendChild(accountMenu);
        accountMenuOutsideHandler = function (evt) {
            if (evt && (evt.target === toolbarButton || (accountMenu && accountMenu.contains(evt.target)))) return;
            closeAccountMenu();
        };
        accountMenuKeyHandler = function (evt) { if (evt && evt.key === "Escape") closeAccountMenu(); };
        setTimeout(function () {
            if (document && typeof document.addEventListener === "function" && accountMenu) {
                document.addEventListener("mousedown", accountMenuOutsideHandler, true);
                document.addEventListener("keydown", accountMenuKeyHandler, true);
            }
        }, 0);
    }

    function installToolbarButton() {
        if (toolbarButton || typeof document === "undefined") return;
        const host = toolbarHost();
        if (!host) return;
        toolbarButton = document.createElement("button");
        toolbarButton.type = "button";
        toolbarButton.className = "geButton trellis-users-login-button";
        toolbarButton.style.cssText = "margin:2px 4px;padding:3px 8px;cursor:pointer;";
        applyUsersButtonStyle(toolbarButton, "open", { compact: true });
        toolbarButton.addEventListener("click", function (evt) {
            if (evt) evt.stopPropagation();
            if (isLoggedIn()) togglePanel();
            else showAuthDialog({ blocking: false, message: isEnabled() ? "Log in to this diagram." : "Enable users for this diagram." });
        });
        const historyButton = host.querySelector && host.querySelector(".trellis-changemap-history-button");
        if (historyButton && historyButton.parentNode === host) host.insertBefore(toolbarButton, historyButton);
        else host.appendChild(toolbarButton);
        updateToolbarButton();
    }

    function applyAuthGateIfNeeded(message) {
        if (!isEnabled()) { closeAuthOverlay(true); return false; }
        if (isLoggedIn()) { closeAuthOverlay(true); return false; }
        showAuthDialog({ blocking: true, message: message || (canBootstrapAdmin() ? "Create the first admin to open this diagram." : "Log in to open this diagram.") });
        return true;
    }

    function handleDiagramOpened() {
        currentUserId = "";
        restoreRememberedLogin();
        updateToolbarButton();
        applyAuthGateIfNeeded();
    }

    function installFileLoadedGate() {
        if (!ui || !ui.editor || ui.__trellisUsersFileGateInstalled) return;
        ui.__trellisUsersFileGateInstalled = true;
        if (typeof ui.editor.addListener === "function") {
            ui.editor.addListener("fileLoaded", function () { handleDiagramOpened(); });
        }
    }

    function installGraphXmlLoadGuard() {
        if (!ui || !ui.editor || ui.__trellisUsersGraphXmlGuardInstalled || typeof ui.editor.setGraphXml !== "function") return;
        ui.__trellisUsersGraphXmlGuardInstalled = true;
        const originalSetGraphXml = ui.editor.setGraphXml;
        ui.editor.setGraphXml = function () {
            const wasLoggedIn = isLoggedIn();
            graphXmlLoading += 1;
            try {
                return originalSetGraphXml.apply(this, arguments);
            } finally {
                graphXmlLoading = Math.max(0, graphXmlLoading - 1);
                if (!wasLoggedIn) setTimeout(function () { handleDiagramOpened(); }, 0);
            }
        };
    }

    function createPanel() {
        if (panel || typeof document === "undefined") return;
        const host = document.body;
        if (!host) return;
        panel = document.createElement("div");
        panel.style.cssText = "position:fixed;top:36px;right:12px;z-index:" + USERS_UI_LAYER_Z + ";background:#fff;border:1px solid #111;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,.22);width:400px;max-height:calc(100vh - 72px);overflow:auto;padding:10px;font:12px Arial,sans-serif;display:none;box-sizing:border-box;";
        panel.addEventListener("mousedown", function (evt) { evt.stopPropagation(); });
        const header = document.createElement("div");
        header.style.cssText = "display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px;";
        const title = document.createElement("div");
        title.textContent = "People & Access";
        title.style.cssText = "font-weight:700;font-size:14px;";
        header.appendChild(title);
        header.appendChild(makeButton("Close", function () { if (panel) panel.style.display = "none"; updateToolbarButton(); }, "close")); // CHANGE: closing the panel clears the user button active state
        panel.appendChild(header);
        statusNode = document.createElement("div");
        statusNode.style.cssText = "min-height:16px;color:#4B5563;margin-bottom:8px;";
        panel.appendChild(statusNode);
        peopleFilterNode = document.createElement("div");
        peopleFilterNode.style.cssText = "display:none;margin-bottom:8px;";
        panel.appendChild(peopleFilterNode);
        loginNameInput = makeInput("text", "Name");
        loginPinInput = makeInput("password", "PIN");
        rosterNode = document.createElement("div");
        accessNode = document.createElement("div");
        panel.appendChild(rosterNode);
        panel.appendChild(accessNode);
        host.appendChild(panel);
        installGardenAccessDismissHandlers();
        installSelectionListener();
        refreshPanel();
    }

    function togglePanel() {
        createPanel();
        if (!panel) return;
        const opening = panel.style.display === "none";
        panel.style.display = opening ? "" : "none";
        if (opening) positionPanelNearButton();
        refreshPanel();
        updateToolbarButton(); // CHANGE: keep the toolbar button active state synchronized with the panel visibility
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

    function ensurePeopleFilterControls() {
        if (!peopleFilterNode || peopleSearchInput) return;
        const row = document.createElement("div");
        row.style.cssText = "display:grid;grid-template-columns:minmax(130px,1fr) 116px;gap:6px;align-items:center;";
        peopleSearchInput = makeInput("search", "Search name or email");
        peopleSearchInput.value = peopleSearchText;
        peopleSearchInput.addEventListener("input", function () {
            peopleSearchText = peopleSearchInput.value || "";
            refreshPanel();
        });
        peopleTypeFilterSelect = document.createElement("select");
        peopleTypeFilterSelect.style.cssText = "box-sizing:border-box;width:100%;padding:4px 6px;font:12px Arial,sans-serif;";
        [["all", "All"], ["networked", "Networked"], ["local", "Local"]].forEach(function (entry) {
            const option = document.createElement("option");
            option.value = entry[0];
            option.textContent = entry[1];
            peopleTypeFilterSelect.appendChild(option);
        });
        peopleTypeFilterSelect.value = activePeopleTypeFilter();
        peopleTypeFilterSelect.addEventListener("change", function () {
            peopleTypeFilter = peopleTypeFilterSelect.value;
            refreshPanel();
        });
        row.appendChild(peopleSearchInput);
        row.appendChild(peopleTypeFilterSelect);
        peopleFilterNode.appendChild(row);
    }

    function refreshPeopleFilterControls() {
        if (!peopleFilterNode) return;
        ensurePeopleFilterControls();
        peopleFilterNode.style.display = isEnabled() && isLoggedIn() ? "" : "none";
        if (peopleSearchInput && peopleSearchInput.value !== peopleSearchText) peopleSearchInput.value = peopleSearchText;
        if (peopleTypeFilterSelect && peopleTypeFilterSelect.value !== activePeopleTypeFilter()) peopleTypeFilterSelect.value = activePeopleTypeFilter();
    }

    function appendLoginSection(parent) {
        const row = document.createElement("div");
        row.style.cssText = "display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:center;margin-bottom:10px;";
        row.appendChild(loginNameInput);
        row.appendChild(loginPinInput);
        row.appendChild(makeButton(canBootstrapAdmin() ? "Create admin" : "Login", function () {
            const result = login(loginNameInput.value, loginPinInput.value);
            if (!result.ok) showStatus(result.reason);
            loginPinInput.value = "";
        }, canBootstrapAdmin() ? "add" : "open"));
        parent.appendChild(row);
    }

    function appendAcceptInviteSection(parent) {
        const box = document.createElement("div");
        box.style.cssText = "border-top:1px solid #E5E7EB;padding-top:8px;margin-top:8px;";
        const title = document.createElement("div");
        title.textContent = "Accept invite";
        title.style.fontWeight = "700";
        box.appendChild(title);
        const row = document.createElement("div");
        row.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;";
        const email = makeInput("email", "Email");
        const code = makeInput("text", "Invite code");
        const name = makeInput("text", "Display name");
        const pin = makeInput("password", "PIN");
        row.appendChild(email);
        row.appendChild(code);
        row.appendChild(name);
        row.appendChild(pin);
        box.appendChild(row);
        const actions = document.createElement("div");
        actions.style.cssText = "display:flex;justify-content:flex-end;margin-top:6px;";
        actions.appendChild(makeButton("Accept Invite", function () {
            const result = acceptInvite({ email: email.value, code: code.value, name: name.value, pin: pin.value });
            if (!result.ok) showStatus(result.reason);
            pin.value = "";
        }, "add"));
        box.appendChild(actions);
        parent.appendChild(box);
    }

    function appendEnableSection(parent) {
        const hint = document.createElement("div");
        hint.style.cssText = "color:#4B5563;margin-bottom:8px;";
        hint.textContent = "Users are off for this diagram. Enable users to require login and apply owner/access permissions.";
        parent.appendChild(hint);
        const row = document.createElement("div");
        row.style.cssText = "display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:center;margin-bottom:10px;";
        row.appendChild(loginNameInput);
        row.appendChild(loginPinInput);
        row.appendChild(makeButton("Enable", function () {
            const result = enableUsers(loginNameInput.value, loginPinInput.value);
            if (!result.ok) showStatus(result.reason);
            loginPinInput.value = "";
        }, "add"));
        parent.appendChild(row);
    }

    function appendPendingInvites(parent) {
        if (!isEnabled() || !isLoggedIn()) return;
        const invites = listPendingInvites().filter(inviteMatchesPeopleFilter);
        if (!invites.length) return;
        const box = document.createElement("div");
        box.style.cssText = "border-top:1px solid #E5E7EB;padding-top:8px;margin-top:8px;";
        const title = document.createElement("div");
        title.textContent = "Pending invites";
        title.style.fontWeight = "700";
        box.appendChild(title);
        invites.forEach(function (invite) {
            const row = document.createElement("div");
            row.style.cssText = "display:grid;grid-template-columns:minmax(80px,1fr) auto auto;gap:6px;align-items:center;padding:3px 0;";
            const label = document.createElement("div");
            label.textContent = invite.email + " - expires " + new Date(invite.expiresAt).toLocaleDateString();
            label.title = (invite.scopeLabels || []).join(", ");
            row.appendChild(label);
            row.appendChild(makeButton("Resend", function () {
                const result = resendInvite(invite.id, {});
                if (!result.ok) { showStatus(result.reason); return; }
                openEmailDraft(result.emailDraft);
            }, "open"));
            row.appendChild(makeButton("Revoke", function () {
                const result = revokeInvite(invite.id);
                if (!result.ok) showStatus(result.reason);
            }, "danger"));
            box.appendChild(row);
        });
        parent.appendChild(box);
    }

    function appendSessionSection(parent) {
        const user = currentUser();
        const row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px;";
        const text = document.createElement("div");
        text.textContent = user ? user.name + " (" + (user.admin ? "admin" : "regular") + ")" : "Not logged in";
        row.appendChild(text);
        row.appendChild(makeButton("Logout", logout, "neutral"));
        parent.appendChild(row);
    }

    function appendResetPinRow(parent, user) {
        const resetRow = document.createElement("div");
        resetRow.style.cssText = "display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center;padding:0 0 6px 0;margin-left:12px;";
        const pinInput = makeInput("password", "New PIN");
        resetRow.appendChild(pinInput);
        resetRow.appendChild(makeButton("Save", function () {
            const result = resetUserPin(user.id, pinInput.value);
            if (!result.ok) { showStatus(result.reason); return; }
            pinInput.value = "";
            resetPinUserId = "";
            showStatus("PIN reset for " + user.name + ".");
            refreshPanel();
        }, "add"));
        resetRow.appendChild(makeButton("Cancel", function () {
            resetPinUserId = "";
            refreshPanel();
        }, "neutral"));
        parent.appendChild(resetRow);
        setTimeout(function () { if (pinInput && typeof pinInput.focus === "function") pinInput.focus(); }, 0);
    }

    function appendAdminUserRow(parent, user) {
        const row = document.createElement("div");
        row.style.cssText = "display:grid;grid-template-columns:minmax(80px,1fr) auto auto auto;gap:6px;align-items:center;padding:3px 0;";
        row.appendChild(document.createTextNode(user.name + (user.admin ? " - admin" : "") + (user.disabled ? " - disabled" : "")));
        const adminToggle = makeButton(user.admin ? "Regular" : "Admin", function () {
            const result = setUserAdmin(user.id, !user.admin);
            if (!result.ok) showStatus(result.reason);
        }, "neutral");
        const disableToggle = makeButton(user.disabled ? "Reactivate" : "Disable", function () {
            const result = setUserDisabled(user.id, !user.disabled);
            if (!result.ok) showStatus(result.reason);
        }, user.disabled ? "neutral" : "danger");
        const resetPin = makeButton("PIN", function () {
            resetPinUserId = resetPinUserId === user.id ? "" : user.id;
            refreshPanel();
        }, "open");
        row.appendChild(adminToggle);
        row.appendChild(disableToggle);
        row.appendChild(resetPin);
        parent.appendChild(row);
        appendGardenAccessDropdown(parent, user);
        if (resetPinUserId === user.id) appendResetPinRow(parent, user);
    }

    function gardenGrantForUser(garden, userId) {
        return grantsFromAttr(garden).find(function (entry) { return entry.userId === userId; }) || null;
    }

    function archivedGardenRoleCardForUi(garden, userId) {
        const team = readOnlyTeamForGarden(garden);
        return (team && archivedRoleCardForUser(garden, team, userId)) || inactiveGardenRoleCardsForArchivedUser(garden, userId)[0] || null;
    }

    function archivedGardenPresetForUi(garden, userId) {
        const team = readOnlyTeamForGarden(garden);
        const entry = team && archivedRoleEntry(team, userId);
        return normalizePreset(entry && entry.preset);
    }

    function gardenAccessStatusLabel(garden, userId, grant) {
        if (grant) return getUserGardenRoleCard(userId, garden) ? "Active" : "Missing role";
        return archivedGardenRoleCardForUi(garden, userId) ? "Inactive/restorable" : "Missing";
    }

    function gardenAccessMatchesSearch(garden) {
        const query = String(gardenAccessSearchText || "").trim().toLowerCase();
        if (!query) return true;
        return cellDisplayLabel(garden, "Garden").toLowerCase().indexOf(query) >= 0;
    }

    function closeGardenAccessPopover() {
        if (!openGardenAccessUserId) return;
        openGardenAccessUserId = "";
        refreshPanel();
    }

    function installGardenAccessDismissHandlers() {
        if (!document || gardenAccessOutsideHandler) return;
        gardenAccessOutsideHandler = function (evt) {
            if (!openGardenAccessUserId) return;
            const target = evt && evt.target;
            if (target && target.closest && target.closest(".trellis-users-garden-access-dropdown")) return;
            closeGardenAccessPopover();
        };
        gardenAccessKeyHandler = function (evt) {
            if (!openGardenAccessUserId || !evt || evt.key !== "Escape") return;
            openGardenAccessUserId = "";
            refreshPanel();
        };
        document.addEventListener("mousedown", gardenAccessOutsideHandler, true);
        document.addEventListener("keydown", gardenAccessKeyHandler, true);
    }

    function appendGardenAccessDropdown(parent, user) {
        const gardens = allGardenModules();
        if (!gardens.length) return;
        const activeCount = gardens.filter(function (garden) { return !!gardenGrantForUser(garden, user.id); }).length;
        const isOpen = openGardenAccessUserId === user.id;
        const dropdown = document.createElement("div");
        dropdown.className = "trellis-users-garden-access-dropdown";
        dropdown.setAttribute("data-trellis-users-user-id", user.id);
        dropdown.style.cssText = "position:relative;margin-left:12px;padding:2px 0 4px 0;color:#374151;";
        const button = makeButton("Garden access (" + activeCount + ")", function () {
            openGardenAccessUserId = isOpen ? "" : user.id;
            refreshPanel();
        }, "open");
        button.className = (button.className || "") + " trellis-users-garden-access-button";
        button.setAttribute("aria-haspopup", "dialog");
        button.setAttribute("aria-expanded", isOpen ? "true" : "false");
        dropdown.appendChild(button);
        if (!isOpen) { parent.appendChild(dropdown); return; }
        const popover = document.createElement("div");
        popover.className = "trellis-users-garden-access-popover";
        popover.setAttribute("role", "dialog");
        popover.setAttribute("aria-label", "Garden access");
        popover.style.cssText = "position:absolute;left:0;top:28px;z-index:" + (USERS_UI_LAYER_Z + 2) + ";width:360px;max-width:calc(100vw - 32px);max-height:360px;overflow:auto;background:#fff;border:1px solid #111;border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,.22);padding:6px;box-sizing:border-box;";
        const search = makeInput("search", "Search gardens");
        search.className = (search.className || "") + " trellis-users-garden-access-search";
        search.setAttribute("aria-label", "Search gardens");
        search.value = gardenAccessSearchText;
        search.style.cssText = "box-sizing:border-box;width:100%;margin-bottom:5px;padding:4px 6px;font:12px Arial,sans-serif;";
        search.addEventListener("input", function () { gardenAccessSearchText = search.value || ""; refreshPanel(); });
        popover.appendChild(search);
        const visibleGardens = gardens.filter(gardenAccessMatchesSearch);
        visibleGardens.forEach(function (garden) {
            const grant = gardenGrantForUser(garden, user.id);
            const accessRow = document.createElement("div");
            accessRow.className = "trellis-users-garden-access-row";
            accessRow.setAttribute("data-trellis-users-garden-id", cellId(garden));
            accessRow.setAttribute("data-trellis-users-user-id", user.id);
            accessRow.style.cssText = "display:grid;grid-template-columns:18px minmax(90px,1fr) minmax(104px,128px) minmax(104px,130px);gap:6px;align-items:center;padding:2px 0;";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = !!grant;
            checkbox.setAttribute("aria-label", "Garden access for " + cellDisplayLabel(garden, "Garden"));
            accessRow.appendChild(checkbox);
            const gardenName = document.createElement("div");
            gardenName.textContent = cellDisplayLabel(garden, "Garden");
            accessRow.appendChild(gardenName);
            const presetSelect = makePresetSelect((grant && grant.preset) || archivedGardenPresetForUi(garden, user.id), function (preset) {
                if (!checkbox.checked) return;
                const result = setScopeGrant(garden, { userId: user.id, preset });
                if (!result.ok) showStatus(result.reason);
            });
            accessRow.appendChild(presetSelect);
            const status = document.createElement("div");
            status.textContent = gardenAccessStatusLabel(garden, user.id, grant);
            status.style.cssText = "font-size:11px;color:" + (grant ? "#047857" : (archivedGardenRoleCardForUi(garden, user.id) ? "#92400E" : "#6B7280")) + ";";
            accessRow.appendChild(status);
            checkbox.addEventListener("change", function () {
                openGardenAccessUserId = user.id;
                const result = checkbox.checked ? setScopeGrant(garden, { userId: user.id, preset: presetSelect.value }) : removeScopeGrant(garden, user.id);
                if (!result.ok) showStatus(result.reason);
            });
            popover.appendChild(accessRow);
        });
        if (!visibleGardens.length) {
            const empty = document.createElement("div");
            empty.className = "trellis-users-garden-access-empty";
            empty.textContent = "No matching gardens";
            empty.style.cssText = "color:#6B7280;padding:4px 2px;";
            popover.appendChild(empty);
        }
        dropdown.appendChild(popover);
        parent.appendChild(dropdown);
        setTimeout(function () { if (search && typeof search.focus === "function") search.focus(); }, 0);
    }

    function appendUserGroup(parent, titleText, users) {
        const group = document.createElement("div");
        group.className = "trellis-users-user-group";
        group.setAttribute("data-trellis-users-group", titleText);
        group.style.cssText = "margin-top:8px;";
        const title = document.createElement("div");
        title.textContent = titleText;
        title.style.cssText = "font-weight:700;color:#111827;";
        group.appendChild(title);
        if (users.length) users.forEach(function (user) { appendAdminUserRow(group, user); });
        else {
            const empty = document.createElement("div");
            empty.style.cssText = "color:#6B7280;padding:3px 0;";
            empty.textContent = filteredEmptyText(titleText);
            group.appendChild(empty);
        }
        parent.appendChild(group);
        return group;
    }

    function appendLocalUserCreator(parent) {
        const addRow = document.createElement("div");
        addRow.style.cssText = "display:grid;grid-template-columns:1fr 72px auto;gap:6px;margin-top:6px;";
        const name = makeInput("text", "Local user");
        const pin = makeInput("password", "PIN");
        addRow.appendChild(name);
        addRow.appendChild(pin);
        addRow.appendChild(makeButton("Add local user", function () {
            const result = createUser(name.value, pin.value, false);
            if (!result.ok) showStatus(result.reason);
            name.value = "";
            pin.value = "";
        }, "add"));
        parent.appendChild(addRow);
    }

    function appendAdminRoster(parent) {
        if (!isEnabled() || !isAdmin()) return;
        const box = document.createElement("div");
        box.style.cssText = "border-top:1px solid #E5E7EB;padding-top:8px;margin-top:8px;";
        const title = document.createElement("div");
        title.textContent = "Users";
        title.style.fontWeight = "700";
        box.appendChild(title);
        const users = listUsers().filter(userMatchesPeopleFilter);
        if (activePeopleTypeFilter() !== "local") appendUserGroup(box, "Networked users", users.filter(userIsNetworked));
        if (activePeopleTypeFilter() !== "networked") {
            const localGroup = appendUserGroup(box, "Local users", users.filter(function (user) { return !userIsNetworked(user); }));
            appendLocalUserCreator(localGroup);
        }
        parent.appendChild(box);
    }

    function presetLabel(preset) {
        const normalized = normalizePreset(preset);
        return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }

    function makePresetSelect(value, onChange) {
        const select = document.createElement("select");
        select.style.cssText = "box-sizing:border-box;width:100%;padding:4px 6px;font:12px Arial,sans-serif;";
        ACCESS_PRESETS.forEach(function (preset) {
            const option = document.createElement("option");
            option.value = preset;
            option.textContent = presetLabel(preset);
            select.appendChild(option);
        });
        select.value = normalizePreset(value);
        select.addEventListener("change", function () { onChange(select.value); });
        return select;
    }

    function grantForUser(summary, userId) {
        return (summary.directGrants || []).find(function (grant) { return grant.userId === userId; }) || { userId, preset: "visitor", capabilities: [] };
    }

    function effectiveAccessLabel(capabilities) {
        const caps = new Set(capabilities || []);
        if (caps.has(CAP_MANAGE_SCOPE_CONTENT) || caps.has(CAP_MANAGE_ACCESS)) return presetLabel("coordinator");
        if (caps.has(CAP_CREATE_PLANTINGS) || caps.has(CAP_MANAGE_OWN_PLANTINGS) || caps.has(CAP_MOVE_TASKS) || caps.has(CAP_EDIT_TASK_DETAILS)) return presetLabel("gardener");
        return presetLabel("visitor");
    }

    function currentAccessGrantForSummary(summary) {
        const user = currentUser();
        if (!user || !summary) return null;
        return (summary.directGrants || []).find(function (grant) { return grant.userId === user.id; }) || summary.inheritedAccessGrant || null;
    }

    function hasEffectiveAccessForSummary(summary) {
        return !!(currentAccessGrantForSummary(summary) || (summary && summary.effectiveCapabilities && summary.effectiveCapabilities.length));
    }

    function effectiveAccessDisplayLabel(summary) {
        const grant = currentAccessGrantForSummary(summary);
        return grant ? presetLabel(grant.preset) : effectiveAccessLabel(summary && summary.effectiveCapabilities);
    }

    function selectedAccessDetailText(summary) {
        if (summary.canManageAccess) return "Select a module, garden bed, or task board to manage grants.";
        if (summary.canEdit) return "You can edit this cell.";
        if (hasEffectiveAccessForSummary(summary)) return "You have " + effectiveAccessDisplayLabel(summary) + " access here, but this selected cell is not directly editable.";
        return "You do not have access to this cell.";
    }

    function accessDisplayForUser(cell, summary, user) {
        const directGrant = grantForUser(summary, user.id);
        const directlyGranted = summary.directUserIds.indexOf(user.id) >= 0;
        const inherited = nearestInheritedAccessGrant(cell, user.id);
        const effectiveCapabilities = effectiveCapabilitiesForCell(cell, user.id);
        return {
            userId: user.id,
            directGrant,
            directlyGranted,
            inheritedGrant: inherited ? publicGrant(inherited.grant) : null,
            inheritedSource: inherited ? scopeSummaryForCell(inherited.cell) : null,
            preset: directlyGranted ? directGrant.preset : (inherited && inherited.grant ? normalizePreset(inherited.grant.preset) : directGrant.preset),
            capabilities: effectiveCapabilities
        };
    }

    function inheritedLabel(source, grant) {
        if (!source) return "";
        const access = grant ? effectiveAccessLabel(grant.capabilities || normalizeCapabilities(null, grant.preset)) : "Inherited";
        return access + " in " + source.label;
    }

    function appendScopeSummary(parent, summaries) {
        const list = Array.isArray(summaries) ? summaries : [];
        if (!list.length) return;
        const wrap = document.createElement("div");
        wrap.className = "trellis-users-selected-scopes";
        wrap.style.cssText = "color:#374151;margin:4px 0 6px 0;";
        list.forEach(function (scope) {
            const line = document.createElement("div");
            line.textContent = titleCaseScopeType(scope.type) + ": " + scope.label;
            wrap.appendChild(line);
        });
        parent.appendChild(wrap);
    }

    function appendGrantedBadge(parent) {
        const badge = document.createElement("span");
        badge.textContent = "Granted";
        badge.style.cssText = "display:inline-block;margin-left:6px;padding:1px 5px;border:1px solid #9CA3AF;border-radius:3px;color:#374151;font-size:10px;line-height:14px;";
        parent.appendChild(badge);
    }

    function appendInheritedBadge(parent, source, grant) {
        const label = inheritedLabel(source, grant);
        if (!label) return;
        const badge = document.createElement("span");
        badge.textContent = label;
        badge.style.cssText = "display:inline-block;margin-left:6px;padding:1px 5px;border:1px solid #BFDBFE;border-radius:3px;color:#1D4ED8;background:#EFF6FF;font-size:10px;line-height:14px;";
        parent.appendChild(badge);
    }

    function makeAccessDialogShell(titleText, width) {
        if (typeof document === "undefined") return null;
        const overlay = document.createElement("div");
        overlay.className = "trellis-users-access-dialog";
        overlay.style.cssText = "position:fixed;inset:0;z-index:" + USERS_UI_LAYER_Z + ";background:rgba(0,0,0,.24);display:flex;align-items:flex-start;justify-content:center;padding-top:72px;box-sizing:border-box;font:12px Arial,sans-serif;";
        overlay.addEventListener("mousedown", function (evt) { if (evt.target === overlay) closeAccessDialog(overlay); });
        const box = document.createElement("div");
        box.style.cssText = "width:" + (width || 420) + "px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #111;border-radius:4px;box-shadow:0 12px 32px rgba(0,0,0,.24);padding:14px;box-sizing:border-box;";
        const header = document.createElement("div");
        header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;";
        const title = document.createElement("div");
        title.textContent = titleText;
        title.style.cssText = "font-weight:700;font-size:15px;";
        header.appendChild(title);
        header.appendChild(makeButton("Close", function () { closeAccessDialog(overlay); }, "close")); // CHANGE
        box.appendChild(header);
        overlay.appendChild(box);
        return { overlay, box };
    }

    function closeAccessDialog(dialog) {
        if (dialog && dialog.parentNode) dialog.parentNode.removeChild(dialog);
    }

    function makeTextArea(placeholder) {
        const text = document.createElement("textarea");
        text.placeholder = placeholder || "";
        text.rows = 3;
        text.style.cssText = "box-sizing:border-box;width:100%;padding:5px 6px;border:1px solid #D1D5DB;border-radius:3px;font:12px Arial,sans-serif;resize:vertical;";
        return text;
    }

    function openAccessRequestDialog(cell) {
        const scope = accessRequestScopeSummary(cell);
        if (!scope) { showStatus("Select a module, garden bed, or task board to request access."); return; }
        const shell = makeAccessDialogShell("Request access", 420);
        if (!shell) return;
        const currentRequest = getAccessRequestForCurrentUser(cell);
        const scopeText = document.createElement("div");
        scopeText.style.cssText = "color:#374151;margin-bottom:8px;line-height:18px;";
        scopeText.textContent = titleCaseScopeType(scope.type) + ": " + scope.label;
        const preset = makePresetSelect(currentRequest && currentRequest.requestedPreset || "gardener", function () { });
        preset.style.marginBottom = "8px";
        const note = makeTextArea("Optional note");
        note.value = currentRequest && currentRequest.status === "pending" ? currentRequest.note : "";
        const status = document.createElement("div");
        status.style.cssText = "min-height:18px;color:#4B5563;margin:8px 0;";
        const actions = document.createElement("div");
        actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
        actions.appendChild(makeButton("Cancel", function () { closeAccessDialog(shell.overlay); }, "neutral"));
        actions.appendChild(makeButton("Send Request", function () {
            const result = requestAccess(cell, { requestedPreset: preset.value, note: note.value });
            if (!result.ok) { status.textContent = result.reason; return; }
            closeAccessDialog(shell.overlay);
        }, "add"));
        shell.box.appendChild(scopeText);
        shell.box.appendChild(preset);
        shell.box.appendChild(note);
        shell.box.appendChild(status);
        shell.box.appendChild(actions);
        (document.body || graph.container).appendChild(shell.overlay);
        note.focus();
    }

    function appendRequesterAccessRequestStatus(parent, cell, decisionStatusVisible) {
        const request = getAccessRequestForCurrentUser(cell);
        if (!request) return;
        if (decisionStatusVisible && request.status === "denied") return;
        const status = document.createElement("div");
        status.className = "trellis-users-access-request-status";
        status.style.cssText = "border:1px solid " + (request.status === "denied" ? "#FCA5A5" : "#FDE68A") + ";background:" + (request.status === "denied" ? "#FEF2F2" : "#FFFBEB") + ";color:#374151;border-radius:3px;padding:5px 6px;margin:6px 0;line-height:16px;";
        status.textContent = request.status === "denied" ? "Access request denied" : "Access request pending";
        status.textContent += " (" + presetLabel(request.requestedPreset) + ").";
        if (request.status === "denied" && request.decisionNote) status.textContent += " " + request.decisionNote;
        parent.appendChild(status);
    }

    function latestAccessMessageForCell(cell) {
        const scope = accessRequestScopeSummary(cell);
        const messages = listAccessMessages({ scopeCell: scope ? scope.cell : cell });
        if (!messages.length) return null;
        const unread = messages.filter(function (message) { return message.unread; });
        const candidates = unread.length ? unread : messages;
        candidates.sort(function (left, right) { return Number(right.createdAt || 0) - Number(left.createdAt || 0); });
        return candidates[0] || null;
    }

    function appendRequesterAccessDecisionStatus(parent, cell) {
        const message = latestAccessMessageForCell(cell);
        if (!message) return false;
        const approved = message.decision !== "denied";
        const status = document.createElement("div");
        status.className = "trellis-users-access-decision-status";
        status.style.cssText = "border:1px solid " + (approved ? "#86EFAC" : "#FCA5A5") + ";background:" + (approved ? "#F0FDF4" : "#FEF2F2") + ";color:#374151;border-radius:3px;padding:5px 6px;margin:6px 0;line-height:16px;";
        status.textContent = "Access " + (approved ? "approved" : "denied") + " (" + presetLabel(message.preset) + ").";
        if (message.note) status.textContent += " " + message.note;
        parent.appendChild(status);
        return true;
    }

    function openMessagesDialog(options) {
        if (!isEnabled() || !isLoggedIn()) {
            showAuthDialog({ blocking: false, message: isEnabled() ? "Log in to review access messages." : "Enable users before reviewing access messages." });
            return { ok: false, reason: "Login required." };
        }
        const shell = makeAccessDialogShell("Messages", 560);
        if (!shell) return { ok: false, reason: "Document UI is unavailable." };
        const list = document.createElement("div");
        list.className = "trellis-users-messages-list";
        const render = function () {
            clearNode(list);
            const requests = listIncomingAccessRequests(options);
            const responses = listAccessMessages(options);
            if (!requests.length && !responses.length) {
                const empty = document.createElement("div");
                empty.style.cssText = "color:#6B7280;padding:8px 0;";
                empty.textContent = "No messages.";
                list.appendChild(empty);
                return;
            }
            if (requests.length) {
                const requestTitle = document.createElement("div");
                requestTitle.className = "trellis-users-messages-section-title";
                requestTitle.style.cssText = "font-weight:700;margin:4px 0 6px;";
                requestTitle.textContent = "Access requests";
                list.appendChild(requestTitle);
                requests.forEach(function (request) {
                    const row = document.createElement("div");
                    row.className = "trellis-users-message-row";
                    row.setAttribute("data-trellis-users-request-id", request.id);
                    row.style.cssText = "border-top:1px solid #E5E7EB;padding:10px 0;";
                    const head = document.createElement("div");
                    head.style.cssText = "font-weight:700;margin-bottom:4px;";
                    head.textContent = request.requesterName + " requested " + presetLabel(request.requestedPreset) + " access";
                    const scope = document.createElement("div");
                    scope.style.cssText = "color:#374151;margin-bottom:4px;";
                    scope.textContent = titleCaseScopeType(request.scopeType) + ": " + request.scopeLabel;
                    const note = document.createElement("div");
                    note.style.cssText = "color:#6B7280;margin-bottom:6px;white-space:pre-wrap;";
                    note.textContent = request.note || "No note.";
                    const preset = makePresetSelect(request.requestedPreset, function () { });
                    const decisionNote = makeTextArea("Optional response note");
                    const status = document.createElement("div");
                    status.style.cssText = "min-height:16px;color:#4B5563;margin-top:6px;";
                    const actions = document.createElement("div");
                    actions.style.cssText = "display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:start;";
                    actions.appendChild(preset);
                    actions.appendChild(makeButton("Approve", function () {
                        const result = approveAccessRequest(request.id, { preset: preset.value, decisionNote: decisionNote.value });
                        if (!result.ok) { status.textContent = result.reason; return; }
                        render();
                    }, "add"));
                    actions.appendChild(makeButton("Deny", function () {
                        const result = denyAccessRequest(request.id, decisionNote.value);
                        if (!result.ok) { status.textContent = result.reason; return; }
                        render();
                    }, "danger"));
                    row.appendChild(head);
                    row.appendChild(scope);
                    row.appendChild(note);
                    row.appendChild(decisionNote);
                    row.appendChild(actions);
                    row.appendChild(status);
                    list.appendChild(row);
                });
            }
            if (responses.length) {
                const responseTitle = document.createElement("div");
                responseTitle.className = "trellis-users-responses-section-title";
                responseTitle.style.cssText = "font-weight:700;margin:12px 0 6px;";
                responseTitle.textContent = "Responses";
                list.appendChild(responseTitle);
                responses.forEach(function (message) {
                    const row = document.createElement("div");
                    row.className = "trellis-users-response-message-row";
                    row.setAttribute("data-trellis-users-message-id", message.id);
                    row.style.cssText = "border-top:1px solid #E5E7EB;padding:10px 0;";
                    const head = document.createElement("div");
                    head.style.cssText = "font-weight:700;margin-bottom:4px;";
                    head.textContent = "Access " + (message.decision === "denied" ? "denied" : "approved") + " for " + presetLabel(message.preset);
                    const scope = document.createElement("div");
                    scope.style.cssText = "color:#374151;margin-bottom:4px;";
                    scope.textContent = titleCaseScopeType(message.scopeType) + ": " + message.scopeLabel + (message.scopeMissing ? " (unavailable)" : "");
                    const reviewer = document.createElement("div");
                    reviewer.style.cssText = "color:#6B7280;margin-bottom:4px;";
                    reviewer.textContent = message.reviewerName ? "Reviewed by " + message.reviewerName + "." : "Reviewer unavailable.";
                    const note = document.createElement("div");
                    note.style.cssText = "color:#6B7280;margin-bottom:6px;white-space:pre-wrap;";
                    note.textContent = message.note || "No response note.";
                    const actions = document.createElement("div");
                    actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
                    if (message.unread) {
                        actions.appendChild(makeButton("Mark read", function () {
                            const result = markAccessMessageRead(message.id);
                            if (!result.ok) { showStatus(result.reason); return; }
                            render();
                        }, "neutral"));
                    }
                    actions.appendChild(makeButton("Dismiss", function () {
                        const result = dismissAccessMessage(message.id);
                        if (!result.ok) { showStatus(result.reason); return; }
                        render();
                    }, "neutral"));
                    row.appendChild(head);
                    row.appendChild(scope);
                    row.appendChild(reviewer);
                    row.appendChild(note);
                    row.appendChild(actions);
                    list.appendChild(row);
                });
            }
        };
        render();
        shell.box.appendChild(list);
        (document.body || graph.container).appendChild(shell.overlay);
        return { ok: true };
    }

    function appendAccessSection(parent) {
        if (!isEnabled()) return;
        const cell = selectedCell();
        if (!cell || cell === model.getRoot()) {
            const empty = document.createElement("div");
            empty.style.cssText = "border-top:1px solid #E5E7EB;padding-top:8px;color:#6B7280;";
            empty.textContent = "Select a module, garden bed, or task board to manage access.";
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
        const summaries = selectedScopeSummaries();
        appendScopeSummary(box, summaries);
        if (summaries.length > 1) {
            const multi = document.createElement("div");
            multi.style.cssText = "color:#6B7280;margin:4px 0;";
            multi.textContent = "Access editor is hidden while multiple scopes are selected.";
            box.appendChild(multi);
            parent.appendChild(box);
            return;
        }
        const owner = userById(summary.ownerUserId);
        const ownerText = document.createElement("div");
        ownerText.style.cssText = "color:#4B5563;margin:4px 0;";
        ownerText.textContent = "Owner: " + (owner ? owner.name : (summary.ownerUserId || "none"));
        box.appendChild(ownerText);
        if (!summary.canManageScopeGrants) {
            const caps = document.createElement("div");
            caps.style.cssText = "color:#4B5563;margin:4px 0;";
            caps.textContent = "Your effective access: " + (hasEffectiveAccessForSummary(summary) ? effectiveAccessDisplayLabel(summary) : "None");
            box.appendChild(caps);
            if (summary.inheritedAccessSource) {
                const inherited = document.createElement("div");
                inherited.style.cssText = "color:#2563EB;margin:4px 0;";
                inherited.textContent = inheritedLabel(summary.inheritedAccessSource, summary.inheritedAccessGrant);
                box.appendChild(inherited);
            }
            const decisionStatusVisible = appendRequesterAccessDecisionStatus(box, cell);
            const denied = document.createElement("div");
            denied.style.color = "#6B7280";
            denied.textContent = selectedAccessDetailText(summary);
            box.appendChild(denied);
            if (!summary.canEdit) {
                appendRequesterAccessRequestStatus(box, cell, decisionStatusVisible);
                const requestButton = makeButton(hasEffectiveAccessForSummary(summary) ? "Request More Access" : "Request Access", function () { openAccessRequestDialog(cell); }, "open");
                requestButton.className = (requestButton.className || "") + " trellis-users-request-access-button";
                box.appendChild(requestButton);
            }
            parent.appendChild(box);
            return;
        }
        if (summary.canTransferOwnership) {
            const ownerSelect = document.createElement("select");
            ownerSelect.style.cssText = "box-sizing:border-box;width:100%;margin:4px 0 6px 0;padding:4px 6px;font:12px Arial,sans-serif;";
            listUsers().filter(function (user) { return !user.disabled; }).forEach(function (user) {
                const option = document.createElement("option");
                option.value = user.id;
                option.textContent = user.name + (user.admin ? " (admin)" : "");
                ownerSelect.appendChild(option);
            });
            ownerSelect.value = summary.ownerUserId || "";
            ownerSelect.addEventListener("change", function () {
                const result = setOwner(cell, ownerSelect.value);
                if (!result.ok) showStatus(result.reason);
            });
            box.appendChild(ownerSelect);
        }
        if (isRoleCard(cell)) {
            const roleLink = document.createElement("div");
            roleLink.style.cssText = "border:1px solid #E5E7EB;border-radius:4px;padding:6px;margin:6px 0;";
            const label = document.createElement("div");
            label.textContent = "Linked Trellis user";
            label.style.cssText = "font-weight:700;margin-bottom:4px;";
            roleLink.appendChild(label);
            const select = document.createElement("select");
            select.style.cssText = "box-sizing:border-box;width:100%;padding:4px 6px;font:12px Arial,sans-serif;";
            const none = document.createElement("option");
            none.value = "";
            none.textContent = "No linked user";
            select.appendChild(none);
            listUsers().filter(function (user) { return !user.disabled; }).forEach(function (user) {
                const option = document.createElement("option");
                option.value = user.id;
                option.textContent = user.name + (user.admin ? " (admin)" : "");
                select.appendChild(option);
            });
            select.value = getAttr(cell, ATTR_ROLE_USER) || "";
            select.disabled = !summary.canTransferOwnership;
            select.addEventListener("change", function () {
                const result = setUserRoleCard(select.value, cell);
                if (!result.ok) showStatus(result.reason);
            });
            roleLink.appendChild(select);
            box.appendChild(roleLink);
        }
        const caps = document.createElement("div");
        caps.style.cssText = "color:#4B5563;margin:4px 0;";
        caps.textContent = "Your effective access: " + effectiveAccessLabel(summary.effectiveCapabilities);
        box.appendChild(caps);
        if (summary.inheritedAccessSource) {
            const inherited = document.createElement("div");
            inherited.style.cssText = "color:#2563EB;margin:4px 0;";
            inherited.textContent = inheritedLabel(summary.inheritedAccessSource, summary.inheritedAccessGrant);
            box.appendChild(inherited);
        }
        const grantUsers = listUsers().filter(function (user) { return !user.admin && !user.disabled; });
        const visibleGrantUsers = grantUsers.filter(userMatchesPeopleFilter);
        const hiddenGrantCount = grantUsers.filter(function (user) { return summary.directUserIds.indexOf(user.id) >= 0 && !userMatchesPeopleFilter(user); }).length;
        if (hiddenGrantCount) {
            const hidden = document.createElement("div");
            hidden.style.cssText = "color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;border-radius:3px;padding:4px 6px;margin:6px 0;";
            hidden.textContent = hiddenGrantCount + " granted " + (hiddenGrantCount === 1 ? "user is" : "users are") + " hidden by the current filter.";
            box.appendChild(hidden);
        }
        if (!visibleGrantUsers.length) {
            const empty = document.createElement("div");
            empty.style.cssText = "color:#6B7280;padding:6px 0;border-top:1px solid #F3F4F6;";
            empty.textContent = "No access rows match the current filter.";
            box.appendChild(empty);
        }
        visibleGrantUsers.forEach(function (user) {
            const access = accessDisplayForUser(cell, summary, user);
            const grant = { userId: user.id, preset: access.preset, capabilities: access.capabilities };
            const directlyGranted = access.directlyGranted;
            const row = document.createElement("div");
            row.className = "trellis-users-access-row";
            row.setAttribute("data-trellis-users-user-id", user.id);
            row.style.cssText = "border-top:1px solid #F3F4F6;padding:6px 0;";
            const head = document.createElement("div");
            head.style.cssText = "display:grid;grid-template-columns:minmax(70px,1fr) 130px auto;gap:6px;align-items:center;";
            const name = document.createElement("div");
            name.textContent = user.name;
            if (directlyGranted) appendGrantedBadge(name);
            if (access.inheritedSource) appendInheritedBadge(name, access.inheritedSource, access.inheritedGrant);
            head.appendChild(name);
            head.appendChild(makePresetSelect(grant.preset, function (preset) {
                const result = setScopeGrant(cell, { userId: user.id, preset });
                if (!result.ok) showStatus(result.reason);
            }));
            head.appendChild(makeButton(directlyGranted ? "Remove" : "Apply", function () {
                const result = directlyGranted ? removeScopeGrant(cell, user.id) : setScopeGrant(cell, { userId: user.id, preset: grant.preset || "visitor" });
                if (!result.ok) showStatus(result.reason);
            }, directlyGranted ? "danger" : "neutral"));
            row.appendChild(head);
            box.appendChild(row);
        });
        parent.appendChild(box);
    }

    function refreshPanel() {
        if (!panel || !rosterNode || !accessNode) return;
        refreshPeopleFilterControls();
        clearNode(rosterNode);
        clearNode(accessNode);
        if (!isEnabled()) appendEnableSection(rosterNode);
        else if (isLoggedIn()) appendSessionSection(rosterNode);
        else { appendLoginSection(rosterNode); appendAcceptInviteSection(rosterNode); }
        appendAdminRoster(rosterNode);
        appendPendingInvites(rosterNode);
        if (isEnabled() && isLoggedIn()) appendAccessSection(accessNode);
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
            restoreRememberedLogin();
            applyAuthGateIfNeeded();
            updateToolbarButton();
        }, 0);
    }

    function installRejectedEditPointerTracking() {
        const container = graph && graph.container;
        if (!container || !container.addEventListener) return;
        container.addEventListener("pointermove", rememberGraphPointerPoint, true);
        container.addEventListener("mousemove", rememberGraphPointerPoint, true);
        container.addEventListener("mousedown", rememberGraphPointerPoint, true);
    }

    model.addListener(mxEvent.CHANGE, inspectModelChange);
    if (graph.addListener && mxEvent && mxEvent.ADD_CELLS) graph.addListener(mxEvent.ADD_CELLS, function (_sender, evt) {
        const cells = evt && evt.getProperty ? (evt.getProperty("cells") || []) : [];
        cells.forEach(autoLinkGardenBoardMemberships);
    });
    if (graph.addListener && mxEvent && mxEvent.CELLS_ADDED) graph.addListener(mxEvent.CELLS_ADDED, function (_sender, evt) {
        const cells = evt && evt.getProperty ? (evt.getProperty("cells") || []) : [];
        cells.forEach(autoLinkGardenBoardMemberships);
    });
    installAction();
    installToolbarButton();
    installFileLoadedGate();
    installGraphXmlLoadGuard();
    installRejectedEditPointerTracking();
    promptLoginIfNeeded();

    window.Trellis = window.Trellis || {};
    window.Trellis.users = {
        isEnabled,
        getCurrentUser: function () { return publicUser(currentUser()); },
        isLoggedIn,
        isAdmin,
        canEditCell,
        canAddCell,
        canDeleteCell,
        canManageAccess,
        canCreatePlanting,
        canManagePlanting,
        canMoveTask,
        canEditTaskDetails,
        effectiveCapabilitiesForCell,
        getAccessSummary,
        withActorMetadata,
        listUsers,
        enableUsers,
        login,
        logout,
        showAuthDialog,
        rememberLogin,
        forgetRememberedLogin,
        restoreRememberedLogin,
        createUser,
        resetUserPin,
        setUserAdmin,
        setUserDisabled,
        createPendingInvite,
        acceptInvite,
        revokeInvite,
        resendInvite,
        listPendingInvites,
        canInviteScopes,
        getEligibleShareScopes,
        requestAccess,
        getAccessRequestForCurrentUser,
        listIncomingAccessRequests,
        approveAccessRequest,
        denyAccessRequest,
        openMessagesDialog,
        incomingAccessRequestCount,
        listAccessMessages,
        unreadAccessMessageCount,
        markAccessMessageRead,
        dismissAccessMessage,
        getScopeGrants,
        setScopeGrant,
        removeScopeGrant,
        listRoleCards,
        getUserRoleCard,
        setUserRoleCard,
        setAccess,
        setOwner,
        stampCreatedOwner,
        stampActorOnCell,
        stampActorDirect,
        stampActorIntoEdit,
        attrs: {
            owner: ATTR_OWNER,
            accessUsers: ATTR_ACCESS_USERS,
            accessGrants: ATTR_ACCESS_GRANTS,
            accessOpen: ATTR_ACCESS_OPEN,
            roleUser: ATTR_ROLE_USER,
            roleArchivedUser: ATTR_ROLE_ARCHIVED_USER,
            roleInactive: ATTR_ROLE_INACTIVE,
            roleGardenModule: ATTR_ROLE_GARDEN_MODULE,
            roleTeamModule: ATTR_ROLE_TEAM_MODULE,
            gardenTeamModule: ATTR_GARDEN_TEAM_MODULE,
            teamGardenModule: ATTR_TEAM_GARDEN_MODULE,
            gardenTaskModule: ATTR_GARDEN_TASK_MODULE,
            taskGardenModule: ATTR_TASK_GARDEN_MODULE,
            teamRoleArchive: ATTR_TEAM_ROLE_ARCHIVE,
            createdBy: ATTR_CREATED_BY,
            editedBy: ATTR_EDITED_BY
        },
        capabilities: {
            createPlantings: CAP_CREATE_PLANTINGS,
            manageOwnPlantings: CAP_MANAGE_OWN_PLANTINGS,
            moveTasks: CAP_MOVE_TASKS,
            editTaskDetails: CAP_EDIT_TASK_DETAILS,
            manageScopeContent: CAP_MANAGE_SCOPE_CONTENT,
            manageAccess: CAP_MANAGE_ACCESS
        },
        _test: {
            readStore,
            writeStore,
            hashPin,
            hashInviteCode,
            nearestOwnedAncestor,
            nearestAccessGrant,
            roleLinkedBoardGrantsForUser,
            ensureGardenRoleCardForUser,
            ensureGardenRoleCardsForUser,
            getUserGardenRoleCard,
            readTeamRoleArchive,
            archivedRoleEntry,
            allGardenModules,
            nearestAccessRequestScope,
            accessRequestScopeSummary,
            publicAccessMessage,
            normalizeAccessMessage,
            autoLinkGardenBoardMemberships,
            normalizeCapabilities,
            changeAllowed,
            composeInviteEmail,
            getDiagramLoginKey,
            applyAuthGateIfNeeded,
            stampActorDirect,
            stampActorIntoEdit,
            refreshPanel,
            closeRejectedEditPopover,
            showRejectedEditPopover
        }
    };
    graph.__trellisUsers = window.Trellis.users;
    installTrellisDebugSurface();
    consoleGroup("[TrellisUsers] loaded", usersDebugStatus());
});
