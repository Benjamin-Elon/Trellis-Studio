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
    const ATTR_ROLE_GARDEN_MODULE = "trellis_role_garden_module_id"; // NEW
    const ATTR_ROLE_TEAM_MODULE = "trellis_role_team_module_id"; // NEW
    const ATTR_ROLE_ARCHIVED_USER = "trellis_role_archived_user_id"; // NEW
    const ATTR_ROLE_INACTIVE = "trellis_role_inactive"; // NEW
    const ATTR_GARDEN_TEAM_MODULE = "trellis_team_module_id"; // NEW
    const ATTR_TEAM_GARDEN_MODULE = "trellis_garden_module_id"; // NEW
    const ATTR_GARDEN_TASK_MODULE = "trellis_task_module_id"; // NEW
    const ATTR_TASK_GARDEN_MODULE = "trellis_garden_module_id"; // NEW
    const ATTR_TEAM_ROLE_ARCHIVE = "trellis_team_role_archive_json"; // NEW
    const ATTR_CREATED_BY = "createdByUserId";
    const ATTR_EDITED_BY = "lastEditedByUserId";
    const ATTR_ACTOR_NAME = "trellis_actor_name";
    const ATTR_ACTOR_ROLE = "trellis_actor_role";
    const ATTR_REMEMBER_DIAGRAM_ID = "trellis_users_diagram_id"; // NEW
    const ATTR_HISTORY_ID = "trellis_history_id"; // NEW

    const PROTECTED_ATTRS = new Set([ATTR_STORE, ATTR_OWNER, ATTR_ACCESS_USERS, ATTR_ACCESS_GRANTS, ATTR_ACCESS_OPEN, ATTR_ROLE_USER, ATTR_ROLE_GARDEN_MODULE, ATTR_ROLE_TEAM_MODULE, ATTR_ROLE_ARCHIVED_USER, ATTR_ROLE_INACTIVE, ATTR_GARDEN_TEAM_MODULE, ATTR_TEAM_GARDEN_MODULE, ATTR_TEAM_ROLE_ARCHIVE]); // CHANGE
    const ACCESS_PRESETS = ["visitor", "gardener", "coordinator"]; // CHANGE
    const CAP_CREATE_PLANTINGS = "create_plantings"; // NEW
    const CAP_MANAGE_OWN_PLANTINGS = "manage_own_plantings"; // NEW
    const CAP_MOVE_TASKS = "move_tasks"; // NEW
    const CAP_EDIT_TASK_DETAILS = "edit_task_details"; // NEW
    const CAP_MANAGE_SCOPE_CONTENT = "manage_scope_content"; // NEW
    const CAP_MANAGE_ACCESS = "manage_access"; // NEW
    const DOMAIN_CAPABILITIES = [CAP_CREATE_PLANTINGS, CAP_MANAGE_OWN_PLANTINGS, CAP_MOVE_TASKS, CAP_EDIT_TASK_DETAILS, CAP_MANAGE_SCOPE_CONTENT, CAP_MANAGE_ACCESS]; // NEW
    const PRESET_CAPABILITIES = { // NEW
        visitor: [], // CHANGE
        gardener: [CAP_CREATE_PLANTINGS, CAP_MANAGE_OWN_PLANTINGS, CAP_MOVE_TASKS, CAP_EDIT_TASK_DETAILS], // CHANGE
        coordinator: [CAP_CREATE_PLANTINGS, CAP_MANAGE_OWN_PLANTINGS, CAP_MOVE_TASKS, CAP_EDIT_TASK_DETAILS, CAP_MANAGE_SCOPE_CONTENT, CAP_MANAGE_ACCESS] // CHANGE
    }; // NEW
    const TASK_DETAIL_ATTRS = new Set(["label", "title", "notes", "card_note", "start", "end", "due", "assigned_day", "task_estimated_hours", "scheduler_dates_locked"]); // NEW
    const TASK_ASSIGNMENT_ATTRS = new Set(["task_assignee_role_ids_json"]); // NEW
    const SCOPE_GRANT_ATTRS = new Set([ATTR_ACCESS_USERS, ATTR_ACCESS_GRANTS, ATTR_ACCESS_OPEN]); // NEW
    const USER_ID_PREFIX = "user_";
    const PIN_SALT_PREFIX = "salt_";
    const DIAGRAM_ID_PREFIX = "diagram_users_"; // NEW
    const INVITE_ID_PREFIX = "invite_"; // NEW
    const ACCESS_REQUEST_ID_PREFIX = "access_request_"; // NEW
    const ACCESS_MESSAGE_ID_PREFIX = "access_message_"; // NEW
    const INVITE_CODE_SALT_PREFIX = "invite_salt_"; // NEW
    const INVITE_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000; // NEW
    const REMEMBER_STORAGE_PREFIX = "trellis_users_remembered_login_v1:"; // NEW
    const USERS_UI_LAYER_Z = 2000000000; // NEW
    const AUTH_OVERLAY_Z = 2147483000; // NEW
    const REJECTED_EDIT_POPOVER_MS = 2500; // NEW
    const INTERNAL_FLAG = "__trellisUsersInternalChange";
    const REJECT_FLAG = "__trellisUsersRejecting";

    function applyUsersButtonStyle(button, variant, options) { // NEW
        if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === "function") { // NEW
            window.Trellis.ui.applyButtonStyle(button, variant, options); // NEW
        } else if (button) { // NEW
            button.setAttribute("data-trellis-button-variant", variant || "neutral"); // NEW
        } // NEW
        return button; // NEW
    } // NEW

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
    let openGardenAccessUserId = ""; // NEW
    let gardenAccessSearchText = ""; // NEW
    let gardenAccessOutsideHandler = null; // NEW
    let gardenAccessKeyHandler = null; // NEW
    let authOverlay = null; // NEW
    let authStatusNode = null; // NEW
    let toolbarButton = null; // NEW
    let accountMenu = null; // NEW
    let accountMenuOutsideHandler = null; // NEW
    let accountMenuKeyHandler = null; // NEW
    let graphAuthBlocked = false; // NEW
    let graphXmlLoading = 0; // NEW
    let selectionListenerInstalled = false;
    let lastGraphPointerPoint = null; // NEW
    let rejectedEditPopover = null; // NEW
    let rejectedEditDismissTimer = 0; // NEW
    let rejectedEditDismissPaused = false; // NEW
    let rejectedEditKeyHandler = null; // NEW
    let rejectedEditOutsideHandler = null; // NEW

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

    function ensureXmlValueDirect(cell) { // NEW
        if (!cell) return null; // NEW
        const value = cell.value; // NEW
        if (value && typeof value === "object" && value.nodeType === 1) return value; // NEW
        const doc = mxUtils.createXmlDocument(); // NEW
        const obj = doc.createElement("object"); // NEW
        if (value != null && value !== "") obj.setAttribute("label", String(value)); // NEW
        cell.value = obj; // NEW
        return obj; // NEW
    } // NEW

    function cloneCellValueForUndo(value) { // NEW
        return value && typeof value === "object" && typeof value.cloneNode === "function" ? value.cloneNode(true) : value; // NEW
    } // NEW

    function TrellisUsersValueChange(cell, previous, value) { // NEW
        this.cell = cell; // NEW
        this.previous = previous; // NEW
        this.value = value; // NEW
        this.__trellisUsersActorStamp = true; // NEW
    } // NEW

    TrellisUsersValueChange.prototype.execute = function () { // NEW
        if (!this.cell) return; // NEW
        const next = this.previous; // NEW
        this.previous = this.cell.value; // NEW
        this.cell.value = next; // NEW
    }; // NEW

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

    function normalizeAccessRequest(request) { // NEW
        const source = request || {}; // NEW
        const id = String(source.id || "").trim(); // NEW
        const requesterUserId = String(source.requesterUserId || "").trim(); // NEW
        const scopeCellId = String(source.scopeCellId || "").trim(); // NEW
        if (!id || !requesterUserId || !scopeCellId) return null; // NEW
        const status = String(source.status || "pending").toLowerCase() === "denied" ? "denied" : "pending"; // NEW
        return { // NEW
            id, // NEW
            requesterUserId, // NEW
            scopeCellId, // NEW
            scopeType: String(source.scopeType || "scope"), // NEW
            scopeLabel: String(source.scopeLabel || source.scopeCellId || "Scope"), // NEW
            requestedPreset: normalizePreset(source.requestedPreset || source.preset), // NEW
            note: String(source.note || ""), // NEW
            status, // NEW
            createdAt: Number(source.createdAt) || nowMs(), // NEW
            updatedAt: Number(source.updatedAt) || Number(source.createdAt) || nowMs(), // NEW
            decidedBy: String(source.decidedBy || ""), // NEW
            decidedAt: Number(source.decidedAt) || 0, // NEW
            decisionNote: String(source.decisionNote || "") // NEW
        }; // NEW
    } // NEW

    function normalizeAccessMessage(message) { // NEW
        const source = message || {}; // NEW
        const id = String(source.id || "").trim(); // NEW
        const requesterUserId = String(source.requesterUserId || "").trim(); // NEW
        const scopeCellId = String(source.scopeCellId || "").trim(); // NEW
        const decision = String(source.decision || "").toLowerCase() === "denied" ? "denied" : "approved"; // NEW
        if (!id || !requesterUserId || !scopeCellId) return null; // NEW
        return { // NEW
            id, // NEW
            requestId: String(source.requestId || ""), // NEW
            requesterUserId, // NEW
            reviewerUserId: String(source.reviewerUserId || source.decidedBy || ""), // NEW
            reviewerName: String(source.reviewerName || ""), // NEW
            scopeCellId, // NEW
            scopeAncestorCellIds: Array.isArray(source.scopeAncestorCellIds) ? Array.from(new Set(source.scopeAncestorCellIds.map(String).filter(Boolean))).sort() : [], // NEW
            scopeType: String(source.scopeType || "scope"), // NEW
            scopeLabel: String(source.scopeLabel || source.scopeCellId || "Scope"), // NEW
            decision, // NEW
            preset: normalizePreset(source.preset || source.grantedPreset || source.requestedPreset), // NEW
            note: String(source.note || source.decisionNote || ""), // NEW
            createdAt: Number(source.createdAt) || nowMs(), // NEW
            readAt: Number(source.readAt) || 0, // NEW
            dismissedAt: Number(source.dismissedAt) || 0 // NEW
        }; // NEW
    } // NEW

    function normalizeStore(raw) {
        const source = raw && typeof raw === "object" ? raw : {};
        const users = Array.isArray(source.users) ? source.users.map(normalizeUser).filter(Boolean) : [];
        const pendingUsers = Array.isArray(source.pendingUsers) ? source.pendingUsers.map(normalizePendingUser).filter(Boolean) : []; // NEW
        const invites = Array.isArray(source.invites) ? source.invites.map(normalizeInvite).filter(Boolean) : []; // NEW
        const accessRequests = Array.isArray(source.accessRequests) ? source.accessRequests.map(normalizeAccessRequest).filter(Boolean) : []; // NEW
        const accessMessages = Array.isArray(source.accessMessages) ? source.accessMessages.map(normalizeAccessMessage).filter(Boolean) : []; // NEW
        return { schemaVersion: 1, usersEnabled: source.usersEnabled === true || source.usersEnabled === "1", users, pendingUsers, invites, accessRequests, accessMessages }; // CHANGE
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
        dispatchUsersStoreChanged(); // NEW
    }

    function dispatchUsersStoreChanged() { // NEW
        try { // NEW
            if (window && typeof window.dispatchEvent === "function" && typeof window.CustomEvent === "function") window.dispatchEvent(new window.CustomEvent("trellisUsersStoreChanged")); // NEW
        } catch (_) { } // NEW
    } // NEW

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

    function publicAccessRequest(request) { // NEW
        const normalized = normalizeAccessRequest(request); // NEW
        if (!normalized) return null; // NEW
        const requester = storedUserById(normalized.requesterUserId); // NEW
        const scopeCell = model.getCell && model.getCell(normalized.scopeCellId); // NEW
        return { // NEW
            id: normalized.id, // NEW
            requesterUserId: normalized.requesterUserId, // NEW
            requesterName: requester ? requester.name : normalized.requesterUserId, // NEW
            requesterDisabled: requester ? !!requester.disabled : true, // NEW
            scopeCellId: normalized.scopeCellId, // NEW
            scopeType: scopeCell ? (eligibleScopeType(scopeCell) || normalized.scopeType) : normalized.scopeType, // NEW
            scopeLabel: scopeCell ? cellLabel(scopeCell) : normalized.scopeLabel, // NEW
            requestedPreset: normalizePreset(normalized.requestedPreset), // NEW
            note: normalized.note, // NEW
            status: normalized.status, // NEW
            createdAt: normalized.createdAt, // NEW
            updatedAt: normalized.updatedAt, // NEW
            decidedBy: normalized.decidedBy, // NEW
            decidedAt: normalized.decidedAt, // NEW
            decisionNote: normalized.decisionNote, // NEW
            scopeMissing: !accessRequestScopeIsAvailable(scopeCell) // CHANGE
        }; // NEW
    } // NEW

    function publicAccessMessage(message) { // NEW
        const normalized = normalizeAccessMessage(message); // NEW
        if (!normalized) return null; // NEW
        const reviewer = storedUserById(normalized.reviewerUserId); // NEW
        const scopeCell = model.getCell && model.getCell(normalized.scopeCellId); // NEW
        return { // NEW
            id: normalized.id, // NEW
            requestId: normalized.requestId, // NEW
            requesterUserId: normalized.requesterUserId, // NEW
            reviewerUserId: normalized.reviewerUserId, // NEW
            reviewerName: reviewer ? reviewer.name : (normalized.reviewerUserId || normalized.reviewerName), // CHANGE
            scopeCellId: normalized.scopeCellId, // NEW
            scopeAncestorCellIds: (normalized.scopeAncestorCellIds || []).slice(), // NEW
            scopeType: scopeCell ? (eligibleScopeType(scopeCell) || normalized.scopeType) : normalized.scopeType, // NEW
            scopeLabel: scopeCell ? cellLabel(scopeCell) : normalized.scopeLabel, // NEW
            decision: normalized.decision, // NEW
            preset: normalizePreset(normalized.preset), // NEW
            note: normalized.note, // NEW
            createdAt: normalized.createdAt, // NEW
            readAt: normalized.readAt, // NEW
            dismissedAt: normalized.dismissedAt, // NEW
            unread: !normalized.readAt, // NEW
            scopeMissing: !accessRequestScopeIsAvailable(scopeCell) // CHANGE
        }; // NEW
    } // NEW

    function normalizePreset(value) { // NEW
        const preset = String(value || "visitor").trim().toLowerCase(); // CHANGE
        if (preset === "viewer") return "visitor"; // CHANGE
        if (preset === "grower" || preset === "task") return "gardener"; // CHANGE
        if (preset === "manager") return "coordinator"; // CHANGE
        return ACCESS_PRESETS.indexOf(preset) >= 0 ? preset : "visitor"; // CHANGE
    } // NEW

    function expandImpliedCapabilities(capabilities) { // NEW
        const caps = new Set((Array.isArray(capabilities) ? capabilities : []).map(String)); // NEW
        if (caps.has(CAP_MANAGE_SCOPE_CONTENT)) { // NEW
            caps.add(CAP_CREATE_PLANTINGS); // NEW
            caps.add(CAP_MANAGE_OWN_PLANTINGS); // NEW
            caps.add(CAP_MOVE_TASKS); // NEW
            caps.add(CAP_EDIT_TASK_DETAILS); // NEW
        } // NEW
        return Array.from(caps); // NEW
    } // NEW

    function normalizeCapabilityList(capabilities) { // NEW
        const base = Array.isArray(capabilities) ? capabilities : []; // NEW
        const allowed = new Set(DOMAIN_CAPABILITIES); // NEW
        return Array.from(new Set(expandImpliedCapabilities(base || []).filter(function (capability) { return allowed.has(capability); }))).sort(); // CHANGE
    } // NEW

    function normalizeCapabilities(capabilities, preset) { // NEW
        return normalizeCapabilityList(PRESET_CAPABILITIES[normalizePreset(preset)]); // CHANGE
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

    function finalizePublicAuthMutation(message, hadAuthGate) { // NEW
        if (hadAuthGate) closeAuthOverlay(true); // NEW
        refreshPanel(); // NEW
        updateToolbarButton(); // NEW
        if (!hadAuthGate && message) showStatus(message); // NEW
    } // NEW

    function enableUsersState(name, pin) { // NEW
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
        return { ok: true, user: publicUser(user) }; // NEW
    } // NEW

    function enableUsers(name, pin) { // CHANGE
        const hadAuthGate = !!authOverlay; // NEW
        const result = enableUsersState(name, pin); // NEW
        if (result.ok && result.user) finalizePublicAuthMutation("Users enabled. Created first admin: " + result.user.name, hadAuthGate); // NEW
        return result; // NEW
    } // NEW

    function loginState(name, pin) { // NEW
        if (!isEnabled()) return { ok: false, reason: "Users are not enabled for this diagram." }; // NEW
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
    } // NEW

    function login(name, pin) { // CHANGE
        const hadAuthGate = !!authOverlay; // NEW
        const result = loginState(name, pin); // NEW
        if (result.ok && result.user) finalizePublicAuthMutation("Logged in as " + result.user.name, hadAuthGate); // NEW
        return result; // NEW
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
        return !!cell && (styleFlag(cell, "module") || getAttr(cell, "garden_module") === "1" || getAttr(cell, "team_module") === "1" || getAttr(cell, "task_module") === "1"); // CHANGE
    } // NEW

    function isGardenModule(cell) { // NEW
        return !!cell && getAttr(cell, "garden_module") === "1"; // NEW
    } // NEW

    function isTeamModule(cell) { // NEW
        return !!cell && getAttr(cell, "team_module") === "1"; // NEW
    } // NEW

    function isGardenBed(cell) { // NEW
        return !!cell && (getAttr(cell, "garden_bed") === "1" || getAttr(cell, "gardenBed") === "1" || getAttr(cell, "is_garden_bed") === "1"); // NEW
    } // NEW

    function isTilerGroup(cell) { // NEW
        return !!cell && (getAttr(cell, "tiler_group") === "1" || styleFlag(cell, "tiler_group")); // NEW
    } // NEW

    function isGeneratedPlantTile(cell) { // NEW
        if (!cell || getAttr(cell, "plant_tiler") !== "1") return false; // NEW
        return getAttr(cell, "auto") === "1" || !!getAttr(cell, "tile_r") || !!getAttr(cell, "tile_c"); // NEW
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

    function cellId(cell) { // NEW
        return cell && (cell.id || (cell.getId && cell.getId())) || ""; // NEW
    } // NEW

    function linkSet(cell) { // NEW
        return new Set(String(getAttr(cell, "linkedTo") || "").split(",").map(function (part) { return part.trim(); }).filter(Boolean)); // NEW
    } // NEW

    function setLinkSet(cell, ids) { // NEW
        setAttr(cell, "linkedTo", Array.from(ids || []).filter(Boolean).join(",")); // NEW
    } // NEW

    function addReciprocalLink(left, right) { // NEW
        const modules = graph && graph.__trellisModules; // NEW
        if (modules && typeof modules.addReciprocalLink === "function") return modules.addReciprocalLink(left, right); // NEW
        const leftId = cellId(left); // NEW
        const rightId = cellId(right); // NEW
        if (!left || !right || !leftId || !rightId || left === right) return false; // NEW
        const leftLinks = linkSet(left); // NEW
        const rightLinks = linkSet(right); // NEW
        let changed = false; // NEW
        if (!leftLinks.has(rightId)) { leftLinks.add(rightId); setLinkSet(left, leftLinks); changed = true; } // NEW
        if (!rightLinks.has(leftId)) { rightLinks.add(leftId); setLinkSet(right, rightLinks); changed = true; } // NEW
        return changed; // NEW
    } // NEW

    function cellDisplayLabel(cell, fallback) { // NEW
        const raw = getAttr(cell, "label") || (typeof (cell && cell.value) === "string" ? cell.value : ""); // NEW
        if (document && document.createElement) { // NEW
            const holder = document.createElement("div"); // NEW
            holder.innerHTML = raw; // NEW
            const text = String(holder.textContent || "").replace(/\s+/g, " ").trim(); // NEW
            if (text) return text; // NEW
        } // NEW
        const text = String(raw || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); // NEW
        return text || fallback || ""; // NEW
    } // NEW

    function allCellsMatching(predicate) { // NEW
        const matches = []; // NEW
        traverseCells(model.getRoot && model.getRoot(), function (cell) { if (predicate(cell)) matches.push(cell); }); // NEW
        return matches; // NEW
    } // NEW

    function allGardenModules() { // NEW
        return allCellsMatching(isGardenModule).sort(function (left, right) { return cellDisplayLabel(left, "Garden").localeCompare(cellDisplayLabel(right, "Garden"), undefined, { sensitivity: "base" }) || cellId(left).localeCompare(cellId(right)); }); // NEW
    } // NEW

    function findGardenModuleAncestor(cell) { // NEW
        return nearestAncestorMatching(cell, isGardenModule); // NEW
    } // NEW

    function linkedPlantingGroupsForTask(cell) { // NEW
        if (!isTaskCard(cell)) return []; // NEW
        const id = cellId(cell); // NEW
        const linkedIds = String(getAttr(cell, "linkedTo") || "").split(",").map(function (part) { return part.trim(); }).filter(Boolean); // NEW
        return linkedIds.map(function (linkedId) { return model.getCell && model.getCell(linkedId); }).filter(function (linked) { return isTilerGroup(linked) && (!id || hasLink(linked, id)); }); // NEW
    } // NEW

    function userOwnsLinkedPlantingTask(cell, userId) { // NEW
        return linkedPlantingGroupsForTask(cell).some(function (planting) { return getAttr(planting, ATTR_OWNER) === userId; }); // NEW
    } // NEW

    function userCreatedManualTask(cell, userId) { // NEW
        return isTaskCard(cell) && linkedPlantingGroupsForTask(cell).length === 0 && getAttr(cell, ATTR_CREATED_BY) === userId; // NEW
    } // NEW

    function userCanWorkOwnTask(cell, userId) { // NEW
        return !!(userId && isTaskCard(cell) && (userOwnsLinkedPlantingTask(cell, userId) || userCreatedManualTask(cell, userId))); // NEW
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

    function nearestUnownedModuleAncestor(cell) { return nearestAncestorMatching(cell, isUnownedModuleCell); } // NEW

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

    function roleCardsForGardenUser(gardenCell, userId) { // NEW
        const gardenId = cellId(gardenCell); // NEW
        const cleanUserId = String(userId || "").trim(); // NEW
        if (!gardenId || !cleanUserId) return []; // NEW
        return roleCardsForUser(cleanUserId).filter(function (roleCard) { return getAttr(roleCard, ATTR_ROLE_GARDEN_MODULE) === gardenId; }); // NEW
    } // NEW

    function readOnlyTeamForGarden(gardenCell) { // NEW
        const gardenId = cellId(gardenCell); // NEW
        if (!gardenId) return null; // NEW
        const typedId = getAttr(gardenCell, ATTR_GARDEN_TEAM_MODULE); // NEW
        const typed = typedId && model.getCell ? model.getCell(typedId) : null; // NEW
        if (typed && isTeamModule(typed) && getAttr(typed, ATTR_TEAM_GARDEN_MODULE) === gardenId) return typed; // NEW
        return allCellsMatching(function (cell) { return isTeamModule(cell) && getAttr(cell, ATTR_TEAM_GARDEN_MODULE) === gardenId; })[0] || null; // NEW
    } // NEW

    function findTeamForGarden(gardenCell) { // NEW
        const existing = readOnlyTeamForGarden(gardenCell); // NEW
        if (existing) return existing; // NEW
        const modules = graph && graph.__trellisModules; // NEW
        if (modules && typeof modules.ensureGardenTeamModule === "function") return modules.ensureGardenTeamModule(gardenCell); // NEW
        return null; // NEW
    } // NEW

    function childCells(cell) { // NEW
        if (!cell) return []; // NEW
        if (model.getChildren) return model.getChildren(cell) || []; // NEW
        const count = model.getChildCount ? model.getChildCount(cell) : ((cell.children || []).length); // NEW
        const out = []; // NEW
        for (let i = 0; i < count; i++) out.push(model.getChildAt ? model.getChildAt(cell, i) : cell.children[i]); // NEW
        return out.filter(Boolean); // NEW
    } // NEW

    function roleField(roleCard, flag) { // NEW
        return childCells(roleCard).find(function (child) { return styleFlag(child, flag); }) || null; // NEW
    } // NEW

    function roleFieldTextValue(field) { // NEW
        if (!field) return ""; // NEW
        if (field.value && field.value.nodeType === 1) return String(getAttr(field, "label") || ""); // NEW
        return String(field.value || ""); // NEW
    } // NEW

    function setRoleFieldText(roleCard, flag, text) { // NEW
        const field = roleField(roleCard, flag); // NEW
        if (!field) return false; // NEW
        if (field.value && field.value.nodeType === 1) setAttr(field, "label", text || ""); // NEW
        else if (model.setValue) model.setValue(field, text || ""); // NEW
        else field.value = text || ""; // NEW
        return true; // NEW
    } // NEW

    function setRoleFieldDefault(roleCard, flag, text) { // NEW
        const field = roleField(roleCard, flag); // NEW
        if (!field || roleFieldTextValue(field).trim()) return false; // NEW
        return setRoleFieldText(roleCard, flag, text); // NEW
    } // NEW

    function roleTitleForGrant(grant) { // NEW
        return presetLabel((grant && grant.preset) || "visitor"); // NEW
    } // NEW

    function makeRoleStatusCell(id, text) { // NEW
        const style = "rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor=#FEF3C7;strokeColor=#D97706;fontColor=#92400E;fontSize=10;align=center;verticalAlign=middle;spacing=2;role_status=1;"; // NEW
        if (typeof mxCell !== "undefined" && typeof mxGeometry !== "undefined") { // NEW
            const cell = new mxCell(text, new mxGeometry(10, 10, 96, 18), style); // NEW
            cell.vertex = true; // NEW
            if (typeof cell.setConnectable === "function") cell.setConnectable(false); // NEW
            return cell; // NEW
        } // NEW
        return { // NEW
            id, value: text, style, vertex: true, children: [], // NEW
            getId: function () { return this.id; }, // NEW
            getAttribute: function (key) { return this.value && this.value.nodeType === 1 ? this.value.getAttribute(key) : null; }, // NEW
            setAttribute: function (key, value) { if (this.value && this.value.nodeType === 1) this.value.setAttribute(key, value); }, // NEW
            removeAttribute: function (key) { if (this.value && this.value.nodeType === 1) this.value.removeAttribute(key); } // NEW
        }; // NEW
    } // NEW

    function addChildCell(parent, child) { // NEW
        if (!parent || !child) return; // NEW
        if (!child.id) child.id = cellId(parent) + "-role-status"; // NEW
        if (model.add) model.add(parent, child); // NEW
        else { child.parent = parent; parent.children = parent.children || []; parent.children.push(child); if (model.index) model.index(child); } // NEW
    } // NEW

    function removeChildCell(child) { // NEW
        if (!child) return; // NEW
        if (model.remove) { model.remove(child); return; } // NEW
        const parent = parentOf(child); // NEW
        if (parent && parent.children) parent.children = parent.children.filter(function (candidate) { return candidate !== child; }); // NEW
        child.parent = null; // NEW
    } // NEW

    function markRoleCardInactive(roleCard) { // NEW
        if (!roleCard) return; // NEW
        let status = roleField(roleCard, "role_status"); // NEW
        if (!status) { status = makeRoleStatusCell(cellId(roleCard) + "-role-status", "Inactive - restorable"); addChildCell(roleCard, status); } // NEW
        setRoleFieldText(roleCard, "role_status", "Inactive - restorable"); // NEW
    } // NEW

    function clearRoleCardInactiveMarker(roleCard) { // NEW
        const status = roleField(roleCard, "role_status"); // NEW
        if (status) removeChildCell(status); // NEW
    } // NEW

    function normalizeTeamRoleArchive(raw) { // NEW
        const source = raw && typeof raw === "object" ? raw : {}; // NEW
        const roles = source.roles && typeof source.roles === "object" ? source.roles : {}; // NEW
        const normalizedRoles = {}; // NEW
        Object.keys(roles).forEach(function (userId) { // NEW
            const entry = roles[userId] || {}; // NEW
            const cleanUserId = String(userId || "").trim(); // NEW
            const roleCardId = String(entry.roleCardId || "").trim(); // NEW
            if (!cleanUserId || !roleCardId) return; // NEW
            normalizedRoles[cleanUserId] = { // NEW
                roleCardId, // NEW
                preset: normalizePreset(entry.preset || "visitor"), // NEW
                archivedAt: Number(entry.archivedAt) || 0, // NEW
                archivedBy: String(entry.archivedBy || "") // NEW
            }; // NEW
        }); // NEW
        return { schemaVersion: 1, roles: normalizedRoles }; // NEW
    } // NEW

    function readTeamRoleArchive(teamCell) { // NEW
        return normalizeTeamRoleArchive(parseJson(getAttr(teamCell, ATTR_TEAM_ROLE_ARCHIVE), null)); // NEW
    } // NEW

    function writeTeamRoleArchive(teamCell, archive) { // NEW
        const normalized = normalizeTeamRoleArchive(archive); // NEW
        setAttr(teamCell, ATTR_TEAM_ROLE_ARCHIVE, Object.keys(normalized.roles).length ? JSON.stringify(normalized) : ""); // NEW
    } // NEW

    function archivedRoleEntry(teamCell, userId) { // NEW
        const archive = readTeamRoleArchive(teamCell); // NEW
        return archive.roles[String(userId || "").trim()] || null; // NEW
    } // NEW

    function archiveGardenRoleCard(teamCell, userId, roleCard, grant) { // NEW
        const cleanUserId = String(userId || "").trim(); // NEW
        const roleCardId = cellId(roleCard); // NEW
        if (!teamCell || !cleanUserId || !roleCardId) return; // NEW
        const archive = readTeamRoleArchive(teamCell); // NEW
        const actor = currentUser(); // NEW
        archive.roles[cleanUserId] = { // NEW
            roleCardId, // NEW
            preset: normalizePreset((grant && grant.preset) || (archive.roles[cleanUserId] && archive.roles[cleanUserId].preset) || "visitor"), // NEW
            archivedAt: nowMs(), // NEW
            archivedBy: actor && actor.id || "" // NEW
        }; // NEW
        writeTeamRoleArchive(teamCell, archive); // NEW
    } // NEW

    function archivedRoleCardForUser(gardenCell, teamCell, userId) { // NEW
        const entry = archivedRoleEntry(teamCell, userId); // NEW
        const roleCard = entry && model.getCell ? model.getCell(entry.roleCardId) : null; // NEW
        if (!roleCard || !isRoleCard(roleCard)) return null; // NEW
        if (getAttr(roleCard, ATTR_ROLE_GARDEN_MODULE) !== cellId(gardenCell)) return null; // NEW
        if (getAttr(roleCard, ATTR_ROLE_TEAM_MODULE) !== cellId(teamCell)) return null; // NEW
        return roleCard; // NEW
    } // NEW

    function inactiveGardenRoleCardsForArchivedUser(gardenCell, userId) { // NEW
        const gardenId = cellId(gardenCell); // NEW
        const cleanUserId = String(userId || "").trim(); // NEW
        if (!gardenId || !cleanUserId) return []; // NEW
        return allCellsMatching(function (cell) { // NEW
            return isRoleCard(cell) && getAttr(cell, ATTR_ROLE_GARDEN_MODULE) === gardenId && getAttr(cell, ATTR_ROLE_ARCHIVED_USER) === cleanUserId; // NEW
        }); // NEW
    } // NEW

    function fillGardenRoleCard(roleCard, user, gardenCell, teamCell, grant) { // NEW
        if (!roleCard || !user) return; // NEW
        setAttr(roleCard, ATTR_ROLE_USER, user.id); // NEW
        setAttr(roleCard, ATTR_ROLE_ARCHIVED_USER, ""); // NEW
        setAttr(roleCard, ATTR_ROLE_INACTIVE, ""); // NEW
        setAttr(roleCard, ATTR_ROLE_GARDEN_MODULE, cellId(gardenCell)); // NEW
        setAttr(roleCard, ATTR_ROLE_TEAM_MODULE, cellId(teamCell)); // NEW
        clearRoleCardInactiveMarker(roleCard); // NEW
        setRoleFieldDefault(roleCard, "role_name", user.name || ""); // CHANGE
        setRoleFieldDefault(roleCard, "role_title", roleTitleForGrant(grant)); // CHANGE
        setRoleFieldDefault(roleCard, "role_contact", user.email || ""); // CHANGE
    } // NEW

    function taskBoardsInGarden(gardenCell) { // NEW
        const boards = []; // NEW
        traverseCells(gardenCell, function (cell) { if (cell !== gardenCell && isTaskBoard(cell)) boards.push(cell); }); // NEW
        return boards; // NEW
    } // NEW

    function linkRoleCardToGardenBoards(roleCard, gardenCell) { // NEW
        if (!roleCard || !gardenCell) return; // NEW
        taskBoardsInGarden(gardenCell).forEach(function (board) { addReciprocalLink(roleCard, board); }); // NEW
    } // NEW

    function nextRoleCardPoint(teamCell) { // NEW
        const geo = graph.getCellGeometry ? graph.getCellGeometry(teamCell) : (teamCell && teamCell.geometry); // NEW
        const count = childCells(teamCell).filter(isRoleCard).length; // NEW
        return { x: (geo && Number(geo.x) || 0) + 20 + ((count % 2) * 200), y: (geo && Number(geo.y) || 0) + 50 + (Math.floor(count / 2) * 84) }; // NEW
    } // NEW

    function createGardenRoleCard(gardenCell, teamCell) { // NEW
        const modules = graph && graph.__trellisModules; // NEW
        if (!modules || typeof modules.createRoleCard !== "function") return null; // NEW
        const pt = nextRoleCardPoint(teamCell); // NEW
        return modules.createRoleCard(teamCell, pt.x, pt.y); // NEW
    } // NEW

    function resizeTeamModuleForGardenRole(teamCell) { // NEW
        const modules = graph && graph.__trellisModules; // NEW
        if (teamCell && modules && typeof modules.applyModuleMargins === "function") modules.applyModuleMargins(teamCell, { allowShrink: false }); // NEW
    } // NEW

    function ensureGardenRoleCardForUser(gardenCell, userId, grant) { // NEW
        const user = userById(userId); // NEW
        if (!gardenCell || !isGardenModule(gardenCell) || !user) return null; // NEW
        const team = findTeamForGarden(gardenCell); // NEW
        if (!team) return null; // NEW
        let roleCard = roleCardsForGardenUser(gardenCell, user.id)[0] || null; // NEW
        if (!roleCard) roleCard = archivedRoleCardForUser(gardenCell, team, user.id); // NEW
        if (!roleCard) roleCard = inactiveGardenRoleCardsForArchivedUser(gardenCell, user.id)[0] || null; // NEW
        if (!roleCard) roleCard = createGardenRoleCard(gardenCell, team); // NEW
        if (!roleCard) return null; // NEW
        fillGardenRoleCard(roleCard, user, gardenCell, team, grant); // NEW
        addReciprocalLink(gardenCell, team); // NEW
        linkRoleCardToGardenBoards(roleCard, gardenCell); // NEW
        resizeTeamModuleForGardenRole(team); // NEW
        return roleCard; // NEW
    } // NEW

    function clearGardenRoleCardUser(gardenCell, userId, grant) { // NEW
        const team = findTeamForGarden(gardenCell); // NEW
        roleCardsForGardenUser(gardenCell, userId).forEach(function (roleCard) { // NEW
            if (team) archiveGardenRoleCard(team, userId, roleCard, grant); // NEW
            setAttr(roleCard, ATTR_ROLE_ARCHIVED_USER, userId); // CHANGE
            setAttr(roleCard, ATTR_ROLE_INACTIVE, "1"); // NEW
            setAttr(roleCard, ATTR_ROLE_USER, ""); // NEW
            markRoleCardInactive(roleCard); // NEW
        }); // NEW
    } // NEW

    function ensureGardenRoleCardsForUser(userId) { // NEW
        const cleanUserId = String(userId || "").trim(); // NEW
        if (!cleanUserId || !userById(cleanUserId)) return; // NEW
        allGardenModules().forEach(function (garden) { // NEW
            const grant = grantsFromAttr(garden).find(function (entry) { return entry.userId === cleanUserId; }); // NEW
            if (grant) ensureGardenRoleCardForUser(garden, cleanUserId, grant); // NEW
        }); // NEW
    } // NEW

    function syncGardenRoleCardsForGrantChange(gardenCell, previousGrants, nextGrants) { // NEW
        if (!isGardenModule(gardenCell)) return; // NEW
        const before = new Map((previousGrants || []).map(function (grant) { return [grant.userId, grant]; })); // NEW
        const after = new Map((nextGrants || []).map(function (grant) { return [grant.userId, grant]; })); // NEW
        before.forEach(function (grant, userId) { if (!after.has(userId)) clearGardenRoleCardUser(gardenCell, userId, grant); }); // CHANGE
        after.forEach(function (grant, userId) { if (userById(userId)) ensureGardenRoleCardForUser(gardenCell, userId, grant); }); // NEW
    } // NEW

    function autoLinkGardenBoardMemberships(board) { // NEW
        const garden = findGardenModuleAncestor(board); // NEW
        if (!garden || !isTaskBoard(board)) return; // NEW
        const gardenId = cellId(garden); // NEW
        allCellsMatching(function (cell) { return isRoleCard(cell) && getAttr(cell, ATTR_ROLE_GARDEN_MODULE) === gardenId && !!getAttr(cell, ATTR_ROLE_USER); }).forEach(function (roleCard) { addReciprocalLink(roleCard, board); }); // NEW
    } // NEW

    function roleLinkedBoardGrantsForUser(userId, targetCell) { // NEW
        const roleCards = roleCardsForUser(userId); // NEW
        const boards = []; // NEW
        const root = model.getRoot && model.getRoot(); // NEW
        traverseCells(root, function (cell) { // NEW
            if (!isTaskBoard(cell)) return; // NEW
            if (roleCards.some(function (roleCard) { return hasLink(cell, cellId(roleCard)) && hasLink(roleCard, cellId(cell)); })) boards.push(cell); // CHANGE
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
        return normalizeCapabilityList(Array.from(caps)); // CHANGE
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
            setScopeGrantInternal(cell, { userId, preset: source.preset || "visitor", capabilities: source.capabilities }); // CHANGE
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

    function syncCompanionAccessIfGarden(cell) { // NEW
        if (!isGardenModule(cell)) return; // NEW
        const modules = graph && graph.__trellisModules; // NEW
        if (!modules) return; // NEW
        const team = typeof modules.findExistingCompanionTeam === "function" ? modules.findExistingCompanionTeam(cell) : null; // CHANGE
        const task = typeof modules.findExistingCompanionTask === "function" ? modules.findExistingCompanionTask(cell) : null; // CHANGE
        if (team && typeof modules.syncCompanionModuleAccess === "function") modules.syncCompanionModuleAccess(cell, team); // NEW
        if (task && typeof modules.syncCompanionModuleAccess === "function") modules.syncCompanionModuleAccess(cell, task); // NEW
    } // NEW

    function setScopeGrant(cell, grant) { // NEW
        if (!cell || !canManageScopeGrants(cell)) return { ok: false, reason: "Select a module, garden bed, or task board to manage access." }; // CHANGE
        const normalized = normalizeGrant(grant); // NEW
        if (!normalized || !storedOrPendingUserById(normalized.userId)) return { ok: false, reason: "Unknown user." }; // NEW
        const previousGrants = grantsFromAttr(cell); // NEW
        graph[INTERNAL_FLAG] = true; // NEW
        model.beginUpdate(); // NEW
        try { setScopeGrantInternal(cell, normalized); syncGardenRoleCardsForGrantChange(cell, previousGrants, grantsFromAttr(cell)); syncCompanionAccessIfGarden(cell); } finally { model.endUpdate(); graph[INTERNAL_FLAG] = false; } // CHANGE
        refreshPanel(); // NEW
        return { ok: true, grant: publicGrant(normalized) }; // NEW
    } // NEW

    function removeScopeGrant(cell, userId) { // NEW
        if (!cell || !canManageScopeGrants(cell)) return { ok: false, reason: "Select a module, garden bed, or task board to manage access." }; // CHANGE
        const previousGrants = grantsFromAttr(cell); // NEW
        graph[INTERNAL_FLAG] = true; // NEW
        model.beginUpdate(); // NEW
        try { setGrantsAttr(cell, grantsFromAttr(cell).filter(function (grant) { return grant.userId !== userId; })); syncGardenRoleCardsForGrantChange(cell, previousGrants, grantsFromAttr(cell)); syncCompanionAccessIfGarden(cell); } finally { model.endUpdate(); graph[INTERNAL_FLAG] = false; } // CHANGE
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

    function nearestInheritedAccessGrant(cell, userId) { // NEW
        return nearestAccessGrant(parentOf(cell), userId); // NEW
    } // NEW

    function isOwnerOfNearestScope(cell, userId) {
        const owner = nearestOwnedAncestor(cell);
        return !!(owner && owner.ownerUserId === userId);
    }

    function isOwnerOfNearestAccessScope(cell, userId) { // NEW
        const owner = nearestOwnedAncestor(cell); // NEW
        return !!(owner && owner.ownerUserId === userId && !isTilerGroup(owner.cell)); // NEW
    } // NEW

    function isUnownedModuleCell(cell) { // NEW
        return isModuleCell(cell) && !getAttr(cell, ATTR_OWNER); // NEW
    } // NEW

    function canClaimUnownedModule(cell, userId) { // NEW
        return !!(userId && isUnownedModuleCell(cell)); // NEW
    } // NEW

    function canDeleteModuleBoundary(cell, user) { // NEW
        return !!(cell && isModuleCell(cell) && user && (user.admin || getAttr(cell, ATTR_OWNER) === user.id)); // NEW
    } // NEW

    function canEditCell(cell) {
        if (!isEnabled()) return true; // NEW
        const user = currentUser();
        if (!user || !cell || cell === model.getRoot()) return false;
        if (user.admin) return true;
        if (canClaimUnownedModule(cell, user.id)) return true; // NEW
        if (canClaimUnownedModule(nearestUnownedModuleAncestor(cell), user.id)) return true; // NEW
        if (isOwnerOfNearestScope(cell, user.id)) return true;
        if (isTaskCard(cell)) return canEditTaskDetails(cell); // CHANGE
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
        if (canClaimUnownedModule(parent, user.id)) return true; // NEW
        return isOwnerOfNearestScope(parent, user.id) || hasCapability(parent, CAP_MANAGE_SCOPE_CONTENT); // CHANGE
    }

    function canDeleteCell(cell) {
        if (!isEnabled()) return true; // NEW
        const user = currentUser();
        if (!user || !cell || cell === model.getRoot() || cell === graph.getDefaultParent()) return false;
        if (isModuleCell(cell)) return canDeleteModuleBoundary(cell, user); // NEW
        if (user.admin) return true;
        if (canClaimUnownedModule(nearestUnownedModuleAncestor(parentOf(cell)), user.id)) return true; // NEW
        return isOwnerOfNearestScope(cell, user.id) || canManagePlanting(cell) || hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT); // CHANGE
    }

    function canDeleteFromPreviousParent(cell, previousParent) { // NEW
        if (!isEnabled()) return true; // NEW
        const user = currentUser(); // NEW
        if (!user || !cell || cell === model.getRoot() || cell === graph.getDefaultParent()) return false; // NEW
        if (isModuleCell(cell)) return canDeleteModuleBoundary(cell, user); // NEW
        if (user.admin) return true; // NEW
        if (canClaimUnownedModule(previousParent, user.id)) return true; // NEW
        if (isOwnerOfNearestScope(cell, user.id)) return true; // NEW
        if (canManagePlanting(cell)) return true; // NEW
        return !!(previousParent && (isOwnerOfNearestScope(previousParent, user.id) || hasCapability(previousParent, CAP_MANAGE_SCOPE_CONTENT))); // CHANGE
    } // NEW

    function canMoveCell(cell) { // NEW
        if (!isEnabled()) return true; // NEW
        const user = currentUser(); // NEW
        if (!user || !cell || cell === model.getRoot() || cell === graph.getDefaultParent()) return false; // NEW
        if (user.admin) return true; // NEW
        if (canClaimUnownedModule(cell, user.id)) return true; // NEW
        if (canClaimUnownedModule(nearestUnownedModuleAncestor(cell), user.id)) return true; // NEW
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
        if (hasCapability(planting, CAP_MANAGE_SCOPE_CONTENT)) return true; // CHANGE
        return getAttr(planting, ATTR_OWNER) === user.id && hasCapability(planting, CAP_MANAGE_OWN_PLANTINGS); // NEW
    } // NEW

    function canMoveTask(cell) { // NEW
        if (!isEnabled()) return true; // NEW
        const user = currentUser(); // NEW
        if (!user || !cell) return false; // NEW
        if (user.admin || isOwnerOfNearestScope(cell, user.id) || hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT)) return true; // CHANGE
        const board = nearestTaskBoard(cell); // NEW
        return !!board && hasCapability(board, CAP_MOVE_TASKS) && userCanWorkOwnTask(cell, user.id); // CHANGE
    } // NEW

    function canEditTaskDetails(cell) { // NEW
        if (!isEnabled()) return true; // NEW
        const user = currentUser(); // NEW
        if (!user || !cell) return false; // NEW
        if (user.admin || isOwnerOfNearestScope(cell, user.id) || hasCapability(cell, CAP_MANAGE_SCOPE_CONTENT)) return true; // CHANGE
        const board = nearestTaskBoard(cell); // NEW
        return !!board && hasCapability(board, CAP_EDIT_TASK_DETAILS) && userCanWorkOwnTask(cell, user.id); // CHANGE
    } // NEW

    function canManageAccess(cell) {
        if (!isEnabled()) return false; // NEW
        const user = currentUser();
        if (!user || !cell || cell === model.getRoot()) return false;
        if (user.admin) return true;
        return isOwnerOfNearestAccessScope(cell, user.id) || hasCapability(cell, CAP_MANAGE_ACCESS); // CHANGE
    }

    function canManageScopeGrants(cell) { // NEW
        return !!eligibleScopeType(cell) && canManageAccess(cell); // NEW
    } // NEW

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

    function nearestAccessRequestScope(cell) { // NEW
        return nearestAncestorMatching(cell, function (candidate) { return !!eligibleScopeType(candidate); }); // NEW
    } // NEW

    function accessRequestScopeSummary(cell) { // NEW
        const scopeCell = nearestAccessRequestScope(cell); // NEW
        if (!scopeCell) return null; // NEW
        return { id: cellId(scopeCell), type: eligibleScopeType(scopeCell), label: cellLabel(scopeCell), cell: scopeCell }; // NEW
    } // NEW

    function accessRequestMatches(request, userId, scopeCellId) { // NEW
        return request && request.requesterUserId === userId && request.scopeCellId === scopeCellId && (request.status === "pending" || request.status === "denied"); // NEW
    } // NEW

    function getAccessRequestForCurrentUser(cell) { // NEW
        const user = currentUser(); // NEW
        if (!isEnabled() || !user) return null; // NEW
        const scope = accessRequestScopeSummary(cell); // NEW
        if (!scope) return null; // NEW
        const request = readStore().accessRequests.find(function (entry) { return accessRequestMatches(entry, user.id, scope.id); }); // NEW
        return publicAccessRequest(request); // NEW
    } // NEW

    function requestAccess(cell, options) { // NEW
        const source = options || {}; // NEW
        if (!isEnabled()) return { ok: false, reason: "Users are not enabled for this diagram." }; // NEW
        const user = currentUser(); // NEW
        if (!user) return { ok: false, reason: "Log in before requesting access." }; // NEW
        if (!cell) return { ok: false, reason: "Select a cell before requesting access." }; // NEW
        if (canEditCell(cell)) return { ok: false, reason: "You already have edit access to this cell." }; // NEW
        const scope = accessRequestScopeSummary(cell); // NEW
        if (!scope || !scope.id) return { ok: false, reason: "Select a module, garden bed, or task board to request access." }; // NEW
        const store = readStore(); // NEW
        const existing = store.accessRequests.find(function (entry) { return accessRequestMatches(entry, user.id, scope.id); }); // NEW
        const timestamp = nowMs(); // NEW
        if (existing) { // NEW
            existing.scopeType = scope.type; // NEW
            existing.scopeLabel = scope.label; // NEW
            existing.requestedPreset = normalizePreset(source.requestedPreset || source.preset || existing.requestedPreset); // NEW
            existing.note = String(source.note || ""); // NEW
            existing.status = "pending"; // NEW
            existing.updatedAt = timestamp; // NEW
            existing.decidedBy = ""; // NEW
            existing.decidedAt = 0; // NEW
            existing.decisionNote = ""; // NEW
        } else { // NEW
            store.accessRequests.push({ // NEW
                id: makeId(ACCESS_REQUEST_ID_PREFIX), // NEW
                requesterUserId: user.id, // NEW
                scopeCellId: scope.id, // NEW
                scopeType: scope.type, // NEW
                scopeLabel: scope.label, // NEW
                requestedPreset: normalizePreset(source.requestedPreset || source.preset), // NEW
                note: String(source.note || ""), // NEW
                status: "pending", // NEW
                createdAt: timestamp, // NEW
                updatedAt: timestamp, // NEW
                decidedBy: "", // NEW
                decidedAt: 0, // NEW
                decisionNote: "" // NEW
            }); // NEW
        } // NEW
        writeStore(store); // NEW
        showStatus("Access request sent for " + scope.label + "."); // NEW
        return { ok: true, request: getAccessRequestForCurrentUser(cell) }; // NEW
    } // NEW

    function cellContainsCell(rootCell, targetCell) { // NEW
        if (!rootCell || !targetCell) return false; // NEW
        let cursor = targetCell; // NEW
        while (cursor) { // NEW
            if (cursor === rootCell) return true; // NEW
            cursor = parentOf(cursor); // NEW
        } // NEW
        return false; // NEW
    } // NEW

    function scopeFilterCell(options) { // NEW
        const source = options || {}; // NEW
        if (source.scopeCell) return source.scopeCell; // NEW
        if (source.moduleCell) return source.moduleCell; // NEW
        const id = String(source.scopeCellId || source.moduleCellId || "").trim(); // NEW
        return id && model.getCell ? model.getCell(id) : null; // NEW
    } // NEW

    function accessRequestScopeIsAvailable(cell) { // NEW
        return !!(cell && cell !== model.getRoot() && cell !== graph.getDefaultParent() && parentOf(cell)); // NEW
    } // NEW

    function accessRequestInScope(request, filterCell) { // NEW
        if (!filterCell) return true; // NEW
        const scopeCell = model.getCell && model.getCell(request.scopeCellId); // NEW
        return accessRequestScopeIsAvailable(scopeCell) && cellContainsCell(filterCell, scopeCell); // NEW
    } // NEW

    function canReviewAccessRequest(request) { // NEW
        const user = currentUser(); // NEW
        if (!isEnabled() || !user || !request || request.status !== "pending") return false; // NEW
        const scopeCell = model.getCell && model.getCell(request.scopeCellId); // NEW
        if (!accessRequestScopeIsAvailable(scopeCell)) return false; // NEW
        if (user.admin) return true; // NEW
        return accessRequestScopeIsAvailable(scopeCell) && isOwnerOfNearestAccessScope(scopeCell, user.id); // NEW
    } // NEW

    function listIncomingAccessRequests(options) { // NEW
        if (!isEnabled() || !isLoggedIn()) return []; // NEW
        const filterCell = scopeFilterCell(options); // NEW
        return readStore().accessRequests.filter(function (request) { // NEW
            return request.status === "pending" && accessRequestInScope(request, filterCell) && canReviewAccessRequest(request); // NEW
        }).map(publicAccessRequest).filter(Boolean); // NEW
    } // NEW

    function incomingAccessRequestCount(options) { // NEW
        return listIncomingAccessRequests(options).length; // NEW
    } // NEW

    function cellAncestorIds(cell) { // NEW
        const ids = []; // NEW
        let cursor = cell; // NEW
        while (cursor) { // NEW
            const id = cellId(cursor); // NEW
            if (id) ids.push(id); // NEW
            cursor = parentOf(cursor); // NEW
        } // NEW
        return ids; // NEW
    } // NEW

    function accessMessageInScope(message, filterCell) { // NEW
        if (!filterCell) return true; // NEW
        const filterId = cellId(filterCell); // NEW
        const scopeCell = model.getCell && model.getCell(message.scopeCellId); // NEW
        if (accessRequestScopeIsAvailable(scopeCell)) return cellContainsCell(filterCell, scopeCell); // NEW
        return !!(filterId && (message.scopeCellId === filterId || (message.scopeAncestorCellIds || []).indexOf(filterId) >= 0)); // NEW
    } // NEW

    function addAccessDecisionMessage(store, request, decision, preset, note, actor) { // NEW
        const scopeCell = model.getCell && model.getCell(request.scopeCellId); // NEW
        const reviewer = actor || currentUser(); // NEW
        store.accessMessages = store.accessMessages || []; // NEW
        store.accessMessages.push({ // NEW
            id: makeId(ACCESS_MESSAGE_ID_PREFIX), // NEW
            requestId: request.id, // NEW
            requesterUserId: request.requesterUserId, // NEW
            reviewerUserId: reviewer ? reviewer.id : "", // NEW
            reviewerName: reviewer ? reviewer.name : "", // NEW
            scopeCellId: request.scopeCellId, // NEW
            scopeAncestorCellIds: cellAncestorIds(scopeCell), // NEW
            scopeType: scopeCell ? (eligibleScopeType(scopeCell) || request.scopeType) : request.scopeType, // NEW
            scopeLabel: scopeCell ? cellLabel(scopeCell) : request.scopeLabel, // NEW
            decision: decision === "denied" ? "denied" : "approved", // NEW
            preset: normalizePreset(preset || request.requestedPreset), // NEW
            note: String(note || ""), // NEW
            createdAt: nowMs(), // NEW
            readAt: 0, // NEW
            dismissedAt: 0 // NEW
        }); // NEW
    } // NEW

    function listAccessMessages(options) { // NEW
        const user = currentUser(); // NEW
        if (!isEnabled() || !user) return []; // NEW
        const filterCell = scopeFilterCell(options); // NEW
        return readStore().accessMessages.filter(function (message) { // NEW
            return message.requesterUserId === user.id && !message.dismissedAt && accessMessageInScope(message, filterCell); // NEW
        }).map(publicAccessMessage).filter(Boolean); // NEW
    } // NEW

    function unreadAccessMessageCount(options) { // NEW
        return listAccessMessages(options).filter(function (message) { return !message.readAt; }).length; // NEW
    } // NEW

    function updateCurrentUserAccessMessage(messageId, updater) { // NEW
        const user = currentUser(); // NEW
        if (!isEnabled() || !user) return { ok: false, reason: "Log in before updating messages." }; // NEW
        const store = readStore(); // NEW
        const message = (store.accessMessages || []).find(function (entry) { return entry.id === messageId && entry.requesterUserId === user.id; }); // NEW
        if (!message) return { ok: false, reason: "Access message was not found." }; // NEW
        updater(message, nowMs()); // NEW
        writeStore(store); // NEW
        return { ok: true, message: publicAccessMessage(message) }; // NEW
    } // NEW

    function markAccessMessageRead(messageId) { // NEW
        return updateCurrentUserAccessMessage(messageId, function (message, timestamp) { if (!message.readAt) message.readAt = timestamp; }); // NEW
    } // NEW

    function dismissAccessMessage(messageId) { // NEW
        return updateCurrentUserAccessMessage(messageId, function (message, timestamp) { message.dismissedAt = timestamp; if (!message.readAt) message.readAt = timestamp; }); // NEW
    } // NEW

    function requesterAlreadyHasRequestedAccess(scopeCell, requester, requestedPreset) { // NEW
        if (!scopeCell || !requester) return false; // NEW
        if (requester.admin || isOwnerOfNearestAccessScope(scopeCell, requester.id)) return true; // NEW
        const grant = nearestAccessGrant(scopeCell, requester.id); // NEW
        const caps = effectiveCapabilitiesForCell(scopeCell, requester.id); // NEW
        const preset = normalizePreset(requestedPreset); // NEW
        if (preset === "visitor") return !!grant; // NEW
        if (preset === "gardener") return caps.indexOf(CAP_CREATE_PLANTINGS) >= 0 || caps.indexOf(CAP_MOVE_TASKS) >= 0 || caps.indexOf(CAP_EDIT_TASK_DETAILS) >= 0 || caps.indexOf(CAP_MANAGE_SCOPE_CONTENT) >= 0; // NEW
        return caps.indexOf(CAP_MANAGE_SCOPE_CONTENT) >= 0 || caps.indexOf(CAP_MANAGE_ACCESS) >= 0; // NEW
    } // NEW

    function removeAccessRequestFromStore(store, requestId) { // NEW
        store.accessRequests = (store.accessRequests || []).filter(function (entry) { return entry.id !== requestId; }); // NEW
    } // NEW

    function approveAccessRequest(requestId, options) { // NEW
        const source = options || {}; // NEW
        const store = readStore(); // NEW
        const request = store.accessRequests.find(function (entry) { return entry.id === requestId && entry.status === "pending"; }); // NEW
        if (!request) return { ok: false, reason: "No pending access request was found." }; // NEW
        const scopeCell = model.getCell && model.getCell(request.scopeCellId); // NEW
        if (!accessRequestScopeIsAvailable(scopeCell)) return { ok: false, reason: "The requested scope is no longer available." }; // NEW
        if (!canReviewAccessRequest(request)) return { ok: false, reason: "You cannot approve this access request." }; // NEW
        const requester = userById(request.requesterUserId); // NEW
        if (!requester) return { ok: false, reason: "The requester is disabled or unavailable." }; // NEW
        const preset = normalizePreset(source.requestedPreset || source.preset || request.requestedPreset); // NEW
        const actor = currentUser(); // NEW
        if (requesterAlreadyHasRequestedAccess(scopeCell, requester, preset)) { // NEW
            addAccessDecisionMessage(store, request, "approved", preset, source.decisionNote, actor); // CHANGE
            removeAccessRequestFromStore(store, request.id); // NEW
            writeStore(store); // NEW
            return { ok: true, alreadyGranted: true }; // NEW
        } // NEW
        const previousGrants = grantsFromAttr(scopeCell); // NEW
        graph[INTERNAL_FLAG] = true; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            setScopeGrantInternal(scopeCell, { userId: requester.id, preset }); // NEW
            syncGardenRoleCardsForGrantChange(scopeCell, previousGrants, grantsFromAttr(scopeCell)); // NEW
            addAccessDecisionMessage(store, request, "approved", preset, source.decisionNote, actor); // NEW
            removeAccessRequestFromStore(store, request.id); // NEW
            setAttr(metadataCell(), ATTR_STORE, JSON.stringify(normalizeStore(store))); // NEW
        } finally { // NEW
            model.endUpdate(); // NEW
            graph[INTERNAL_FLAG] = false; // NEW
        } // NEW
        refreshPanel(); // NEW
        updateToolbarButton(); // NEW
        dispatchUsersStoreChanged(); // NEW
        showStatus("Access approved for " + requester.name + "."); // NEW
        return { ok: true, request: publicAccessRequest(request), preset }; // NEW
    } // NEW

    function denyAccessRequest(requestId, decisionNote) { // NEW
        const store = readStore(); // NEW
        const request = store.accessRequests.find(function (entry) { return entry.id === requestId && entry.status === "pending"; }); // NEW
        if (!request) return { ok: false, reason: "No pending access request was found." }; // NEW
        if (!canReviewAccessRequest(request)) return { ok: false, reason: "You cannot deny this access request." }; // NEW
        const actor = currentUser(); // NEW
        request.status = "denied"; // NEW
        request.decidedBy = actor ? actor.id : ""; // NEW
        request.decidedAt = nowMs(); // NEW
        request.decisionNote = String(decisionNote || ""); // NEW
        request.updatedAt = request.decidedAt; // NEW
        addAccessDecisionMessage(store, request, "denied", request.requestedPreset, request.decisionNote, actor); // NEW
        writeStore(store); // NEW
        showStatus("Access request denied."); // NEW
        return { ok: true, request: publicAccessRequest(request) }; // NEW
    } // NEW

    function getAccessSummary(cell) {
        const owner = nearestOwnedAncestor(cell);
        const grants = getScopeGrants(cell); // CHANGE
        const current = currentUser(); // NEW
        const currentInheritedGrant = current ? nearestInheritedAccessGrant(cell, current.id) : null; // NEW
        return {
            ownerUserId: owner && owner.ownerUserId || "",
            ownerCellId: owner && owner.cell && owner.cell.id || "",
            directOpen: getAttr(cell, ATTR_ACCESS_OPEN) === "1",
            directUserIds: grants.map(function (grant) { return grant.userId; }), // CHANGE
            directGrants: grants, // NEW
            effectiveCapabilities: current ? effectiveCapabilitiesForCell(cell, current.id) : [], // NEW
            inheritedAccessGrant: currentInheritedGrant ? publicGrant(currentInheritedGrant.grant) : null, // CHANGE
            inheritedAccessSource: currentInheritedGrant ? scopeSummaryForCell(currentInheritedGrant.cell) : null, // NEW
            effectiveOpen: !!nearestAccessGrant(cell, null),
            canEdit: canEditCell(cell),
            canAdd: canAddCell(cell),
            canDelete: canDeleteCell(cell),
            canManageAccess: canManageAccess(cell),
            canManageScopeGrants: canManageScopeGrants(cell), // NEW
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

    function writeActorAttribute(node, key, value) { // NEW
        if (!node || !key) return false; // NEW
        const next = value == null || value === "" ? "" : String(value); // NEW
        const current = node.getAttribute(key) || ""; // NEW
        if (current === next) return false; // NEW
        if (next) node.setAttribute(key, next); // NEW
        else node.removeAttribute(key); // NEW
        return true; // NEW
    } // NEW

    function applyActorStamp(node, user, kind, options) { // NEW
        if (!node || !user) return false; // NEW
        const opts = options || {}; // NEW
        let changed = false; // NEW
        if (opts.owner === true && !node.getAttribute(ATTR_OWNER)) changed = writeActorAttribute(node, ATTR_OWNER, user.id) || changed; // NEW
        if (kind === "created" && !node.getAttribute(ATTR_CREATED_BY)) changed = writeActorAttribute(node, ATTR_CREATED_BY, user.id) || changed; // NEW
        if (kind === "edited") changed = writeActorAttribute(node, ATTR_EDITED_BY, user.id) || changed; // NEW
        changed = writeActorAttribute(node, ATTR_ACTOR_NAME, user.name) || changed; // NEW
        changed = writeActorAttribute(node, ATTR_ACTOR_ROLE, user.admin ? "admin" : "regular") || changed; // NEW
        return changed; // NEW
    } // NEW

    function addChangeToEdit(edit, change) { // NEW
        if (!edit || !change) return false; // NEW
        if (typeof edit.add === "function") edit.add(change); // NEW
        else if (Array.isArray(edit.changes)) edit.changes.push(change); // NEW
        else return false; // NEW
        return true; // NEW
    } // NEW

    function stampActorDirect(cell, kind, options) { // NEW
        const user = currentUser();
        if (!cell || !user) return false;
        const node = ensureXmlValueDirect(cell); // CHANGE
        const changed = applyActorStamp(node, user, kind, options); // NEW
        if (!changed) return false; // NEW
        refreshPanel();
        return true;
    }

    function stampActorIntoEdit(edit, cell, kind, options) { // NEW
        const user = currentUser();
        if (!cell || !user) return false;
        if (!edit || !Array.isArray(edit.changes)) return stampActorDirect(cell, kind, options); // NEW
        const previous = cloneCellValueForUndo(cell.value); // NEW
        const node = ensureXmlValueDirect(cell); // NEW
        if (!applyActorStamp(node, user, kind, options)) return false; // NEW
        const value = cloneCellValueForUndo(cell.value); // NEW
        return addChangeToEdit(edit, new TrellisUsersValueChange(cell, previous, value)); // NEW
    } // NEW

    function activeModelEdit() { // NEW
        return model && model.currentEdit && Array.isArray(model.currentEdit.changes) ? model.currentEdit : null; // NEW
    } // NEW

    function stampCreatedOwner(cell, edit) { // CHANGE
        const targetEdit = edit || activeModelEdit(); // NEW
        const stamped = targetEdit ? stampActorIntoEdit(targetEdit, cell, "created", { owner: true }) : stampActorDirect(cell, "created", { owner: true }); // CHANGE
        if (stamped && graph.refresh) graph.refresh(cell); // NEW
        return stamped; // CHANGE
    }

    function stampActorOnCell(cell, kind, edit) { // CHANGE
        const targetEdit = edit || activeModelEdit(); // NEW
        const stamped = targetEdit ? stampActorIntoEdit(targetEdit, cell, kind) : stampActorDirect(cell, kind); // CHANGE
        if (stamped && graph.refresh) graph.refresh(cell); // NEW
        return stamped; // CHANGE
    }

    function setAccess(cell, options) {
        if (!cell || !canManageScopeGrants(cell)) return { ok: false, reason: "Select a module, garden bed, or task board to manage access." }; // CHANGE
        const source = options || {};
        const previousGrants = grantsFromAttr(cell); // NEW
        graph[INTERNAL_FLAG] = true;
        model.beginUpdate();
        try {
            setAttr(cell, ATTR_ACCESS_OPEN, ""); // CHANGE
            const grants = (source.userIds || []).filter(function (id) { return !!storedOrPendingUserById(id); }).map(function (userId) { return normalizeGrant({ userId, preset: source.preset || "visitor", capabilities: source.capabilities }); }); // CHANGE
            setGrantsAttr(cell, grants); // CHANGE
            syncGardenRoleCardsForGrantChange(cell, previousGrants, grantsFromAttr(cell)); // NEW
            syncCompanionAccessIfGarden(cell); // NEW
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
        try { setAttr(cell, ATTR_OWNER, userId); syncCompanionAccessIfGarden(cell); } finally { model.endUpdate(); graph[INTERNAL_FLAG] = false; } // CHANGE
        refreshPanel();
        return { ok: true };
    }

    function getUserRoleCard(userId) { // NEW
        const matches = roleCardsForUser(String(userId || "")); // NEW
        if (matches.length !== 1) return null; // NEW
        const cell = matches[0]; // NEW
        return { id: cell.id || (cell.getId && cell.getId()) || "", cell, label: cellLabel(cell) }; // NEW
    } // NEW

    function getUserGardenRoleCard(userId, gardenCell) { // NEW
        const matches = roleCardsForGardenUser(gardenCell, String(userId || "")); // NEW
        if (matches.length !== 1) return null; // NEW
        const cell = matches[0]; // NEW
        return { id: cellId(cell), cell, label: cellLabel(cell), gardenId: cellId(gardenCell) }; // NEW
    } // NEW

    function listRoleCards() { // NEW
        const cards = []; // NEW
        traverseCells(model.getRoot && model.getRoot(), function (cell) { // NEW
            if (isRoleCard(cell)) cards.push({ id: cell.id || (cell.getId && cell.getId()) || "", cell, label: cellLabel(cell), userId: getAttr(cell, ATTR_ROLE_USER) || "" }); // NEW
        }); // NEW
        return cards.sort(function (left, right) { return left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id); }); // NEW
    } // NEW

    function listGardenRoleCards(gardenCell) { // NEW
        const gardenId = cellId(gardenCell); // NEW
        return listRoleCards().filter(function (role) { return getAttr(role.cell, ATTR_ROLE_GARDEN_MODULE) === gardenId; }); // NEW
    } // NEW

    function setUserRoleCard(userId, roleCard) { // NEW
        const cleanUserId = String(userId || "").trim(); // NEW
        if (!roleCard || !isRoleCard(roleCard)) return { ok: false, reason: "Select a role card." }; // NEW
        if (!canTransferOwnership(roleCard)) return { ok: false, reason: "Only admins or owners can link users to role cards." }; // NEW
        if (cleanUserId && !userById(cleanUserId)) return { ok: false, reason: "Unknown user." }; // NEW
        graph[INTERNAL_FLAG] = true; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            const gardenId = getAttr(roleCard, ATTR_ROLE_GARDEN_MODULE) || ""; // NEW
            traverseCells(model.getRoot && model.getRoot(), function (cell) { // NEW
                if (isRoleCard(cell) && cleanUserId && getAttr(cell, ATTR_ROLE_USER) === cleanUserId && cell !== roleCard && (gardenId ? getAttr(cell, ATTR_ROLE_GARDEN_MODULE) === gardenId : !getAttr(cell, ATTR_ROLE_GARDEN_MODULE))) setAttr(cell, ATTR_ROLE_USER, ""); // CHANGE
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
        const preset = normalizePreset(source.preset || "visitor"); // CHANGE
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

    function acceptInviteState(options) { // NEW
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
        graph[INTERNAL_FLAG] = true; // NEW
        model.beginUpdate(); // NEW
        try { ensureGardenRoleCardsForUser(user.id); } finally { model.endUpdate(); graph[INTERNAL_FLAG] = false; } // NEW
        return { ok: true, user: publicUser(user) }; // NEW
    } // NEW

    function acceptInvite(options) { // CHANGE
        const hadAuthGate = !!authOverlay; // NEW
        const result = acceptInviteState(options); // NEW
        if (result.ok && result.user) finalizePublicAuthMutation("Invite accepted. Logged in as " + result.user.name + ".", hadAuthGate); // NEW
        return result; // NEW
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

    function isActorStampableEditChange(change) { // NEW
        const name = change && change.constructor && change.constructor.name; // NEW
        return name === "mxStyleChange" || name === "mxValueChange" || name === "mxTerminalChange" || name === "mxGeometryChange" || name === "mxCollapseChange" || name === "mxVisibleChange" || name === "mxCellAttributeChange"; // NEW
    } // NEW

    function stampAcceptedActorMetadata(edit, changes) { // CHANGE
        const sourceChanges = (changes || []).slice(); // NEW
        const stamped = new Set(); // NEW
        sourceChanges.forEach(function (change) { // CHANGE
            if (!change || change.__trellisUsersActorStamp) return; // NEW
            const name = change && change.constructor && change.constructor.name; // NEW
            const cell = cellFromChange(change); // NEW
            if (!cell) return; // NEW
            const keyBase = String(cell.id || (cell.getId && cell.getId()) || ""); // NEW
            [cell, currentParentOfChange(change), previousParentOfChange(change)].forEach(function (moduleCell) { // NEW
                if (!isUnownedModuleCell(moduleCell)) return; // NEW
                const moduleKey = cellStableId(moduleCell) + ":createdOwner"; // NEW
                if (!stamped.has(moduleKey)) { stampCreatedOwner(moduleCell, edit); stamped.add(moduleKey); } // NEW
            }); // NEW
            if (name === "mxChildChange" && currentParentOfChange(change) && !previousParentOfChange(change) && isTilerGroup(cell)) { // CHANGE
                const key = keyBase + ":createdOwner"; // NEW
                if (!stamped.has(key)) { stampCreatedOwner(cell, edit); stamped.add(key); } // CHANGE
                return; // NEW
            } // NEW
            if (isActorStampableEditChange(change)) { // NEW
                const key = keyBase + ":edited"; // NEW
                if (!stamped.has(key)) { stampActorIntoEdit(edit, cell, "edited"); stamped.add(key); } // NEW
            } // NEW
        }); // NEW
    } // NEW

    function isOrphanGeneratedPlantTileChildChange(change) { // NEW
        const name = change && change.constructor && change.constructor.name; // NEW
        if (name !== "mxChildChange") return false; // NEW
        if (currentParentOfChange(change) || previousParentOfChange(change)) return false; // NEW
        return isGeneratedPlantTile(cellFromChange(change)); // NEW
    } // NEW

    function cellStableId(cell) { // NEW
        return cell && (cell.id || (typeof cell.getId === "function" && cell.getId())) || ""; // NEW
    } // NEW

    function collectAllowedCreatedPlantingIds(changes) { // NEW
        const ids = new Set(); // NEW
        (Array.isArray(changes) ? changes : []).forEach(function (change) { // NEW
            const name = change && change.constructor && change.constructor.name; // NEW
            const cell = cellFromChange(change); // NEW
            if (name !== "mxChildChange" || !cell || !isTilerGroup(cell)) return; // NEW
            const currentParent = currentParentOfChange(change); // NEW
            const previousParent = previousParentOfChange(change); // NEW
            if (currentParent && !previousParent && canCreatePlanting(currentParent)) ids.add(cellStableId(cell)); // NEW
        }); // NEW
        return ids; // NEW
    } // NEW

    function isCreatedPlantingInContext(cell, context) { // NEW
        const ids = context && context.createdPlantingIds; // NEW
        return !!(cell && isTilerGroup(cell) && ids && ids.has(cellStableId(cell))); // NEW
    } // NEW

    function isCreatedPlantingInitializationChange(change, context) { // NEW
        const name = change && change.constructor && change.constructor.name; // NEW
        if (name !== "mxCellAttributeChange" && name !== "mxValueChange" && name !== "mxStyleChange" && name !== "mxGeometryChange" && name !== "mxCollapseChange" && name !== "mxVisibleChange") return false; // NEW
        return isCreatedPlantingInContext(cellFromChange(change), context); // NEW
    } // NEW

    function nearestCreatedPlantingForGeneratedTile(cell, context) { // NEW
        if (!isGeneratedPlantTile(cell)) return null; // NEW
        const planting = nearestPlanting(cell); // NEW
        return isCreatedPlantingInContext(planting, context) ? planting : null; // NEW
    } // NEW

    function isGeneratedPlantTileInitializationChange(change, context) { // NEW
        const name = change && change.constructor && change.constructor.name; // NEW
        if (name !== "mxValueChange" && name !== "mxStyleChange" && name !== "mxGeometryChange" && name !== "mxCollapseChange" && name !== "mxVisibleChange") return false; // NEW
        return !!nearestCreatedPlantingForGeneratedTile(cellFromChange(change), context); // NEW
    } // NEW

    function plantingContextAllowsGeneratedTileChurn(change) { // NEW
        const name = change && change.constructor && change.constructor.name; // NEW
        const cell = cellFromChange(change); // NEW
        if (!name || !cell) return false; // NEW
        if (change && change.__trellisUsersActorStamp) return false; // NEW
        if (isOrphanGeneratedPlantTileChildChange(change)) return false; // NEW
        if (name === "mxChildChange") { // NEW
            const currentParent = currentParentOfChange(change); // NEW
            const previousParent = previousParentOfChange(change); // NEW
            if (currentParent && !previousParent && isTilerGroup(cell)) return canCreatePlanting(currentParent); // NEW
            if (nearestPlanting(cell)) return canManagePlanting(cell); // NEW
            return false; // NEW
        } // NEW
        return nearestPlanting(cell) ? canManagePlanting(cell) : false; // NEW
    } // NEW

    function editPermissionContext(changes) { // NEW
        const source = Array.isArray(changes) ? changes : []; // NEW
        const createdPlantingIds = collectAllowedCreatedPlantingIds(source); // NEW
        return { // NEW
            createdPlantingIds, // NEW
            allowGeneratedPlantTileChurn: createdPlantingIds.size > 0 || source.some(plantingContextAllowsGeneratedTileChurn) // CHANGE
        }; // NEW
    } // NEW

    function changeAllowed(change, context) { // CHANGE
        if (change && change.__trellisUsersActorStamp) return true; // NEW
        const name = change && change.constructor && change.constructor.name;
        const cell = cellFromChange(change);
        if (!name || !cell) return true;
        if (roleUserLinkChanged(change)) return canTransferOwnership(cell); // NEW
        const changedAttrs = (name === "mxCellAttributeChange" || name === "mxValueChange") ? changedAttributeNames(change) : []; // NEW
        if (changedAttrs.indexOf(ATTR_OWNER) >= 0) return canTransferOwnership(cell); // NEW
        if (changedAttrs.some(function (attr) { return SCOPE_GRANT_ATTRS.has(attr); })) return canManageScopeGrants(cell); // NEW
        if ((name === "mxCellAttributeChange" || name === "mxValueChange") && PROTECTED_ATTRS.has(String(change.key || "")) && !canManageAccess(cell)) return false; // CHANGE
        if ((name === "mxCellAttributeChange" || name === "mxValueChange") && protectedAttrsChanged(change) && !canManageAccess(cell)) return false; // CHANGE
        if ((name === "mxCellAttributeChange" || name === "mxValueChange") && isModuleCell(cell)) return canEditCell(cell); // NEW
        if (name === "mxChildChange") {
            const currentParent = currentParentOfChange(change);
            const previousParent = previousParentOfChange(change);
            if (!currentParent && !previousParent && isGeneratedPlantTile(cell)) return !!(context && context.allowGeneratedPlantTileChurn); // NEW
            if (currentParent && !previousParent && isTilerGroup(cell)) return canCreatePlanting(currentParent); // NEW
            if (currentParent && !previousParent && isGeneratedPlantTile(cell) && isCreatedPlantingInContext(currentParent, context)) return true; // NEW
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
        if (isCreatedPlantingInitializationChange(change, context)) return true; // NEW
        if (isGeneratedPlantTileInitializationChange(change, context)) return true; // NEW
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

    function rejectEdit(edit, reason, context) { // CHANGE
        logRejectedEdit(edit, reason); // NEW
        if (edit) edit.__trellisUsersRejected = true; // NEW
        graph[REJECT_FLAG] = true;
        graph[INTERNAL_FLAG] = true;
        try {
            if (edit && typeof edit.undo === "function") edit.undo(); // CHANGE
        } finally {
            graph[INTERNAL_FLAG] = false;
            graph[REJECT_FLAG] = false;
        }
        showRejectedEditPopover(reason || "Change rejected.", context); // CHANGE
        if (graph.refresh) graph.refresh();
    }

    function inspectModelChange(_sender, evt) {
        if (!isEnabled()) return; // NEW
        if (graph[INTERNAL_FLAG] || graph[REJECT_FLAG]) return;
        if ((ui && ui.openingFile) || graphXmlLoading > 0) return; // NEW
        const edit = evt && evt.getProperty && evt.getProperty("edit");
        if (edit && (edit.undone || edit.redone)) return; // NEW
        const changes = edit && edit.changes || [];
        if (!changes.length) return;
        if (!isLoggedIn()) { rejectEdit(edit, "Log in before editing this diagram.", { action: "login" }); return; } // CHANGE
        const permissionContext = editPermissionContext(changes); // NEW
        for (let i = 0; i < changes.length; i++) {
            if (!changeAllowed(changes[i], permissionContext)) { // CHANGE
                logDeniedChange(changes[i], i); // NEW
                rejectEdit(edit, "Change rejected by Trellis user permissions.", { cell: cellFromChange(changes[i]) }); // CHANGE
                return;
            }
        }
        stampAcceptedActorMetadata(edit, changes); // CHANGE
    }

    function makeButton(label, onClick, variant) { // CHANGE
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.style.cssText = "padding:4px 8px;border:1px solid #9CA3AF;border-radius:4px;background:#fff;cursor:pointer;font:12px Arial,sans-serif;";
        applyUsersButtonStyle(button, variant || "neutral", { compact: true }); // NEW
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

    function clientPointFromEvent(evt) { // NEW
        const event = evt && typeof evt.getEvent === "function" ? evt.getEvent() : evt; // NEW
        const x = Number(event && event.clientX); // NEW
        const y = Number(event && event.clientY); // NEW
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null; // NEW
    } // NEW

    function rememberGraphPointerPoint(evt) { // NEW
        const point = clientPointFromEvent(evt); // NEW
        if (point) lastGraphPointerPoint = point; // NEW
    } // NEW

    function fallbackRejectedEditPoint() { // NEW
        const size = viewportSize(); // NEW
        return { x: Math.round(size.width / 2), y: Math.round(size.height / 2) }; // NEW
    } // NEW

    function fixedPositionNearPoint(point, width, height, gap) { // NEW
        const size = viewportSize(); // NEW
        const margin = 8; // NEW
        const anchor = point || fallbackRejectedEditPoint(); // NEW
        const offset = gap || 12; // NEW
        let left = anchor.x + offset; // NEW
        let top = anchor.y + offset; // NEW
        if (left + width > size.width - margin) left = anchor.x - width - offset; // NEW
        if (top + height > size.height - margin) top = anchor.y - height - offset; // NEW
        return { // NEW
            left: Math.max(margin, Math.min(left, size.width - width - margin)), // NEW
            top: Math.max(margin, Math.min(top, size.height - height - margin)) // NEW
        }; // NEW
    } // NEW

    function clearRejectedEditDismissTimer() { // NEW
        if (rejectedEditDismissTimer && typeof clearTimeout === "function") clearTimeout(rejectedEditDismissTimer); // NEW
        rejectedEditDismissTimer = 0; // NEW
    } // NEW

    function closeRejectedEditPopover() { // NEW
        clearRejectedEditDismissTimer(); // NEW
        if (typeof document !== "undefined" && rejectedEditKeyHandler && document.removeEventListener) document.removeEventListener("keydown", rejectedEditKeyHandler, true); // NEW
        if (typeof document !== "undefined" && rejectedEditOutsideHandler && document.removeEventListener) document.removeEventListener("mousedown", rejectedEditOutsideHandler, true); // NEW
        rejectedEditKeyHandler = null; // NEW
        rejectedEditOutsideHandler = null; // NEW
        rejectedEditDismissPaused = false; // NEW
        if (rejectedEditPopover && rejectedEditPopover.parentNode) rejectedEditPopover.parentNode.removeChild(rejectedEditPopover); // NEW
        rejectedEditPopover = null; // NEW
    } // NEW

    function scheduleRejectedEditDismiss() { // NEW
        clearRejectedEditDismissTimer(); // NEW
        if (!rejectedEditPopover || rejectedEditDismissPaused || typeof setTimeout !== "function") return; // NEW
        rejectedEditDismissTimer = setTimeout(closeRejectedEditPopover, REJECTED_EDIT_POPOVER_MS); // NEW
    } // NEW

    function rejectedEditPopoverAction(context) { // NEW
        const source = context || {}; // NEW
        if (!isLoggedIn()) return { label: "Log in", run: function () { showAuthDialog({ blocking: false, message: "Log in before editing this diagram." }); } }; // NEW
        const cell = source.cell || selectedCell(); // NEW
        return cell && accessRequestScopeSummary(cell) ? { label: "Request Access", run: function () { openAccessRequestDialog(cell); } } : null; // CHANGE
    } // NEW

    function showRejectedEditPopover(reason, context) { // NEW
        const message = String(reason || "Change rejected."); // NEW
        if (typeof document === "undefined") { showStatus(message); return false; } // NEW
        const host = document.body || graph.container; // NEW
        if (!host || !host.appendChild) { showStatus(message); return false; } // NEW
        closeRejectedEditPopover(); // NEW
        const width = 320; // NEW
        const height = 126; // NEW
        const pos = fixedPositionNearPoint(lastGraphPointerPoint, width, height, 12); // NEW
        const root = document.createElement("div"); // NEW
        root.className = "trellis-users-rejected-edit-popover"; // NEW
        root.setAttribute("role", "status"); // NEW
        root.style.cssText = "position:fixed;left:" + pos.left + "px;top:" + pos.top + "px;z-index:" + USERS_UI_LAYER_Z + ";width:" + width + "px;max-width:calc(100vw - 16px);background:#fff;border:1px solid #B91C1C;border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,.24);padding:10px 12px;box-sizing:border-box;font:12px Arial,sans-serif;color:#1F2937;line-height:16px;"; // NEW
        const title = document.createElement("div"); // NEW
        title.textContent = "Change rejected"; // NEW
        title.style.cssText = "font-weight:700;color:#991B1B;margin-bottom:4px;"; // NEW
        const detail = document.createElement("div"); // NEW
        detail.textContent = message; // NEW
        detail.style.cssText = "color:#374151;"; // NEW
        root.appendChild(title); // NEW
        root.appendChild(detail); // NEW
        const action = rejectedEditPopoverAction(context); // NEW
        if (action) { // NEW
            const actions = document.createElement("div"); // NEW
            actions.style.cssText = "display:flex;justify-content:flex-end;margin-top:8px;"; // NEW
            const button = makeButton(action.label, function () { closeRejectedEditPopover(); action.run(); }, "open"); // CHANGE
            button.className = (button.className || "") + (action.label === "Request Access" ? " trellis-users-rejected-edit-request-access-button" : " trellis-users-rejected-edit-login-button"); // CHANGE
            actions.appendChild(button); // NEW
            root.appendChild(actions); // NEW
        } // NEW
        root.addEventListener("mouseenter", function () { rejectedEditDismissPaused = true; clearRejectedEditDismissTimer(); }); // NEW
        root.addEventListener("mouseleave", function () { rejectedEditDismissPaused = false; scheduleRejectedEditDismiss(); }); // NEW
        root.addEventListener("focusin", function () { rejectedEditDismissPaused = true; clearRejectedEditDismissTimer(); }); // NEW
        root.addEventListener("focusout", function () { // NEW
            setTimeout(function () { // NEW
                if (rejectedEditPopover === root && (!document.activeElement || !root.contains(document.activeElement))) { // NEW
                    rejectedEditDismissPaused = false; // NEW
                    scheduleRejectedEditDismiss(); // NEW
                } // NEW
            }, 0); // NEW
        }); // NEW
        root.addEventListener("mousedown", function (evt) { if (evt) evt.stopPropagation(); }); // NEW
        rejectedEditKeyHandler = function (evt) { if (evt && evt.key === "Escape") closeRejectedEditPopover(); }; // NEW
        rejectedEditOutsideHandler = function (evt) { if (rejectedEditPopover && evt && !rejectedEditPopover.contains(evt.target)) closeRejectedEditPopover(); }; // NEW
        document.addEventListener("keydown", rejectedEditKeyHandler, true); // NEW
        document.addEventListener("mousedown", rejectedEditOutsideHandler, true); // NEW
        host.appendChild(root); // NEW
        rejectedEditPopover = root; // NEW
        scheduleRejectedEditDismiss(); // NEW
        return true; // NEW
    } // NEW

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

    function finishAuthSuccess(keepChecked) { // CHANGE
        const user = currentUser(); // NEW
        if (user) { // NEW
            if (keepChecked) rememberLogin(user.id, true); // NEW
            else forgetRememberedLogin(); // NEW
        } // NEW
        closeAuthOverlay(true); // NEW
        refreshPanel(); // NEW
        updateToolbarButton(); // NEW
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
        const action = makeButton(canBootstrapAdmin() ? "Create Admin" : "Login", function () { // CHANGE
            const result = loginState(name.value, pin.value); // CHANGE
            pin.value = ""; // NEW
            if (!result.ok) { showAuthStatus(result.reason); return; } // NEW
            finishAuthSuccess(keep.checkbox.checked); // CHANGE
        }, canBootstrapAdmin() ? "add" : "open"); // CHANGE
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
        parent.appendChild(makeButton("Enable Users", function () { // CHANGE
            const result = enableUsersState(name.value, pin.value); // CHANGE
            pin.value = ""; // NEW
            if (!result.ok) { showAuthStatus(result.reason); return; } // NEW
            finishAuthSuccess(keep.checkbox.checked); // CHANGE
        }, "add")); // CHANGE
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
        box.appendChild(makeButton("Accept Invite", function () { // CHANGE
            const result = acceptInviteState({ email: email.value, code: code.value, name: name.value, pin: pin.value }); // CHANGE
            pin.value = ""; // NEW
            if (!result.ok) { showAuthStatus(result.reason); return; } // NEW
            finishAuthSuccess(keep.checkbox.checked); // CHANGE
        }, "add")); // CHANGE
        parent.appendChild(box); // NEW
    } // NEW

    function showAuthDialog(options) { // NEW
        if (typeof document === "undefined") return { ok: false, reason: "Document UI is unavailable." }; // NEW
        closeAccountMenu(); // NEW
        const source = options || {}; // NEW
        const blocking = !!source.blocking; // NEW
        if (authOverlay && authOverlay.parentNode) { // NEW
            if (authStatusNode) authStatusNode.textContent = source.message || (isEnabled() ? "Log in to open this diagram." : "Enable users for this diagram."); // NEW
            if (blocking) setGraphAuthBlocked(true); // NEW
            return { ok: true }; // NEW
        } // NEW
        closeAuthOverlay(false); // CHANGE
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
        header.appendChild(makeButton(blocking ? "Close Diagram" : "Cancel", function () { // CHANGE
            if (blocking) closeCurrentDiagramFromAuth(); // NEW
            else closeAuthOverlay(true); // NEW
        }, "add")); // CHANGE
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
        actions.appendChild(makeButton("People & Access", function () { closeAccountMenu(); togglePanel(); }, "open")); // CHANGE
        actions.appendChild(makeButton("Logout", function () { logout(); }, "neutral")); // CHANGE
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
        applyUsersButtonStyle(toolbarButton, "open", { compact: true }); // NEW
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
        header.appendChild(makeButton("Close", function () { if (panel) panel.style.display = "none"; }, "neutral")); // CHANGE
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
        installGardenAccessDismissHandlers(); // NEW
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
        row.appendChild(makeButton(canBootstrapAdmin() ? "Create admin" : "Login", function () { // CHANGE
            const result = login(loginNameInput.value, loginPinInput.value);
            if (!result.ok) showStatus(result.reason);
            loginPinInput.value = "";
        }, canBootstrapAdmin() ? "add" : "open")); // CHANGE
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
        actions.appendChild(makeButton("Accept Invite", function () { // CHANGE
            const result = acceptInvite({ email: email.value, code: code.value, name: name.value, pin: pin.value }); // NEW
            if (!result.ok) showStatus(result.reason); // NEW
            pin.value = ""; // NEW
        }, "add")); // CHANGE
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
        row.appendChild(makeButton("Enable", function () { // CHANGE
            const result = enableUsers(loginNameInput.value, loginPinInput.value); // NEW
            if (!result.ok) showStatus(result.reason); // NEW
            loginPinInput.value = ""; // NEW
        }, "add")); // CHANGE
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
            row.appendChild(makeButton("Resend", function () { // CHANGE
                const result = resendInvite(invite.id, {}); // NEW
                if (!result.ok) { showStatus(result.reason); return; } // NEW
                openEmailDraft(result.emailDraft); // NEW
            }, "open")); // CHANGE
            row.appendChild(makeButton("Revoke", function () { // CHANGE
                const result = revokeInvite(invite.id); // NEW
                if (!result.ok) showStatus(result.reason); // NEW
            }, "danger")); // CHANGE
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
        row.appendChild(makeButton("Logout", logout, "neutral")); // CHANGE
        parent.appendChild(row);
    }

    function appendResetPinRow(parent, user) { // NEW
        const resetRow = document.createElement("div"); // NEW
        resetRow.style.cssText = "display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center;padding:0 0 6px 0;margin-left:12px;"; // NEW
        const pinInput = makeInput("password", "New PIN"); // NEW
        resetRow.appendChild(pinInput); // NEW
        resetRow.appendChild(makeButton("Save", function () { // CHANGE
            const result = resetUserPin(user.id, pinInput.value); // NEW
            if (!result.ok) { showStatus(result.reason); return; } // NEW
            pinInput.value = ""; // NEW
            resetPinUserId = ""; // NEW
            showStatus("PIN reset for " + user.name + "."); // NEW
            refreshPanel(); // NEW
        }, "add")); // CHANGE
        resetRow.appendChild(makeButton("Cancel", function () { // CHANGE
            resetPinUserId = ""; // NEW
            refreshPanel(); // NEW
        }, "neutral")); // CHANGE
        parent.appendChild(resetRow); // NEW
        setTimeout(function () { if (pinInput && typeof pinInput.focus === "function") pinInput.focus(); }, 0); // NEW
    } // NEW

    function appendAdminUserRow(parent, user) { // NEW
        const row = document.createElement("div"); // NEW
        row.style.cssText = "display:grid;grid-template-columns:minmax(80px,1fr) auto auto auto;gap:6px;align-items:center;padding:3px 0;"; // CHANGE
        row.appendChild(document.createTextNode(user.name + (user.admin ? " - admin" : "") + (user.disabled ? " - disabled" : ""))); // NEW
        const adminToggle = makeButton(user.admin ? "Regular" : "Admin", function () { // CHANGE
            const result = setUserAdmin(user.id, !user.admin); // NEW
            if (!result.ok) showStatus(result.reason); // NEW
        }, "neutral"); // CHANGE
        const disableToggle = makeButton(user.disabled ? "Reactivate" : "Disable", function () { // CHANGE
            const result = setUserDisabled(user.id, !user.disabled); // NEW
            if (!result.ok) showStatus(result.reason); // NEW
        }, user.disabled ? "neutral" : "danger"); // CHANGE
        const resetPin = makeButton("PIN", function () { // CHANGE
            resetPinUserId = resetPinUserId === user.id ? "" : user.id; // NEW
            refreshPanel(); // NEW
        }, "open"); // CHANGE
        row.appendChild(adminToggle); // NEW
        row.appendChild(disableToggle); // NEW
        row.appendChild(resetPin); // NEW
        parent.appendChild(row); // NEW
        appendGardenAccessDropdown(parent, user); // CHANGE
        if (resetPinUserId === user.id) appendResetPinRow(parent, user); // NEW
    } // NEW

    function gardenGrantForUser(garden, userId) { // NEW
        return grantsFromAttr(garden).find(function (entry) { return entry.userId === userId; }) || null; // NEW
    } // NEW

    function archivedGardenRoleCardForUi(garden, userId) { // NEW
        const team = readOnlyTeamForGarden(garden); // CHANGE
        return (team && archivedRoleCardForUser(garden, team, userId)) || inactiveGardenRoleCardsForArchivedUser(garden, userId)[0] || null; // NEW
    } // NEW

    function archivedGardenPresetForUi(garden, userId) { // NEW
        const team = readOnlyTeamForGarden(garden); // CHANGE
        const entry = team && archivedRoleEntry(team, userId); // NEW
        return normalizePreset(entry && entry.preset); // NEW
    } // NEW

    function gardenAccessStatusLabel(garden, userId, grant) { // NEW
        if (grant) return getUserGardenRoleCard(userId, garden) ? "Active" : "Missing role"; // NEW
        return archivedGardenRoleCardForUi(garden, userId) ? "Inactive/restorable" : "Missing"; // NEW
    } // NEW

    function gardenAccessMatchesSearch(garden) { // NEW
        const query = String(gardenAccessSearchText || "").trim().toLowerCase(); // NEW
        if (!query) return true; // NEW
        return cellDisplayLabel(garden, "Garden").toLowerCase().indexOf(query) >= 0; // NEW
    } // NEW

    function closeGardenAccessPopover() { // NEW
        if (!openGardenAccessUserId) return; // NEW
        openGardenAccessUserId = ""; // NEW
        refreshPanel(); // NEW
    } // NEW

    function installGardenAccessDismissHandlers() { // NEW
        if (!document || gardenAccessOutsideHandler) return; // NEW
        gardenAccessOutsideHandler = function (evt) { // NEW
            if (!openGardenAccessUserId) return; // NEW
            const target = evt && evt.target; // NEW
            if (target && target.closest && target.closest(".trellis-users-garden-access-dropdown")) return; // NEW
            closeGardenAccessPopover(); // NEW
        }; // NEW
        gardenAccessKeyHandler = function (evt) { // NEW
            if (!openGardenAccessUserId || !evt || evt.key !== "Escape") return; // NEW
            openGardenAccessUserId = ""; // NEW
            refreshPanel(); // NEW
        }; // NEW
        document.addEventListener("mousedown", gardenAccessOutsideHandler, true); // NEW
        document.addEventListener("keydown", gardenAccessKeyHandler, true); // NEW
    } // NEW

    function appendGardenAccessDropdown(parent, user) { // NEW
        const gardens = allGardenModules(); // NEW
        if (!gardens.length) return; // NEW
        const activeCount = gardens.filter(function (garden) { return !!gardenGrantForUser(garden, user.id); }).length; // NEW
        const isOpen = openGardenAccessUserId === user.id; // NEW
        const dropdown = document.createElement("div"); // CHANGE
        dropdown.className = "trellis-users-garden-access-dropdown"; // NEW
        dropdown.setAttribute("data-trellis-users-user-id", user.id); // NEW
        dropdown.style.cssText = "position:relative;margin-left:12px;padding:2px 0 4px 0;color:#374151;"; // CHANGE
        const button = makeButton("Garden access (" + activeCount + ")", function () { // CHANGE
            openGardenAccessUserId = isOpen ? "" : user.id; // NEW
            refreshPanel(); // NEW
        }, "open"); // CHANGE
        button.className = (button.className || "") + " trellis-users-garden-access-button"; // NEW
        button.setAttribute("aria-haspopup", "dialog"); // NEW
        button.setAttribute("aria-expanded", isOpen ? "true" : "false"); // NEW
        dropdown.appendChild(button); // NEW
        if (!isOpen) { parent.appendChild(dropdown); return; } // NEW
        const popover = document.createElement("div"); // NEW
        popover.className = "trellis-users-garden-access-popover"; // NEW
        popover.setAttribute("role", "dialog"); // NEW
        popover.setAttribute("aria-label", "Garden access"); // NEW
        popover.style.cssText = "position:absolute;left:0;top:28px;z-index:" + (USERS_UI_LAYER_Z + 2) + ";width:360px;max-width:calc(100vw - 32px);max-height:360px;overflow:auto;background:#fff;border:1px solid #111;border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,.22);padding:6px;box-sizing:border-box;"; // NEW
        const search = makeInput("search", "Search gardens"); // NEW
        search.className = (search.className || "") + " trellis-users-garden-access-search"; // NEW
        search.setAttribute("aria-label", "Search gardens"); // NEW
        search.value = gardenAccessSearchText; // NEW
        search.style.cssText = "box-sizing:border-box;width:100%;margin-bottom:5px;padding:4px 6px;font:12px Arial,sans-serif;"; // NEW
        search.addEventListener("input", function () { gardenAccessSearchText = search.value || ""; refreshPanel(); }); // NEW
        popover.appendChild(search); // NEW
        const visibleGardens = gardens.filter(gardenAccessMatchesSearch); // NEW
        visibleGardens.forEach(function (garden) { // CHANGE
            const grant = gardenGrantForUser(garden, user.id); // NEW
            const accessRow = document.createElement("div"); // NEW
            accessRow.className = "trellis-users-garden-access-row"; // NEW
            accessRow.setAttribute("data-trellis-users-garden-id", cellId(garden)); // NEW
            accessRow.setAttribute("data-trellis-users-user-id", user.id); // NEW
            accessRow.style.cssText = "display:grid;grid-template-columns:18px minmax(90px,1fr) minmax(104px,128px) minmax(104px,130px);gap:6px;align-items:center;padding:2px 0;"; // CHANGE
            const checkbox = document.createElement("input"); // NEW
            checkbox.type = "checkbox"; // NEW
            checkbox.checked = !!grant; // NEW
            checkbox.setAttribute("aria-label", "Garden access for " + cellDisplayLabel(garden, "Garden")); // NEW
            accessRow.appendChild(checkbox); // NEW
            const gardenName = document.createElement("div"); // NEW
            gardenName.textContent = cellDisplayLabel(garden, "Garden"); // NEW
            accessRow.appendChild(gardenName); // NEW
            const presetSelect = makePresetSelect((grant && grant.preset) || archivedGardenPresetForUi(garden, user.id), function (preset) { // NEW
                if (!checkbox.checked) return; // NEW
                const result = setScopeGrant(garden, { userId: user.id, preset }); // NEW
                if (!result.ok) showStatus(result.reason); // NEW
            }); // NEW
            accessRow.appendChild(presetSelect); // NEW
            const status = document.createElement("div"); // NEW
            status.textContent = gardenAccessStatusLabel(garden, user.id, grant); // NEW
            status.style.cssText = "font-size:11px;color:" + (grant ? "#047857" : (archivedGardenRoleCardForUi(garden, user.id) ? "#92400E" : "#6B7280")) + ";"; // NEW
            accessRow.appendChild(status); // NEW
            checkbox.addEventListener("change", function () { // NEW
                openGardenAccessUserId = user.id; // NEW
                const result = checkbox.checked ? setScopeGrant(garden, { userId: user.id, preset: presetSelect.value }) : removeScopeGrant(garden, user.id); // NEW
                if (!result.ok) showStatus(result.reason); // NEW
            }); // NEW
            popover.appendChild(accessRow); // CHANGE
        }); // NEW
        if (!visibleGardens.length) { // NEW
            const empty = document.createElement("div"); // NEW
            empty.className = "trellis-users-garden-access-empty"; // NEW
            empty.textContent = "No matching gardens"; // NEW
            empty.style.cssText = "color:#6B7280;padding:4px 2px;"; // NEW
            popover.appendChild(empty); // NEW
        } // NEW
        dropdown.appendChild(popover); // NEW
        parent.appendChild(dropdown); // NEW
        setTimeout(function () { if (search && typeof search.focus === "function") search.focus(); }, 0); // NEW
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
        addRow.appendChild(makeButton("Add local user", function () { // CHANGE
            const result = createUser(name.value, pin.value, false); // NEW
            if (!result.ok) showStatus(result.reason); // NEW
            name.value = ""; // NEW
            pin.value = ""; // NEW
        }, "add")); // CHANGE
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

    function grantForUser(summary, userId) { // NEW
        return (summary.directGrants || []).find(function (grant) { return grant.userId === userId; }) || { userId, preset: "visitor", capabilities: [] }; // CHANGE
    } // NEW

    function effectiveAccessLabel(capabilities) { // NEW
        const caps = new Set(capabilities || []); // NEW
        if (caps.has(CAP_MANAGE_SCOPE_CONTENT) || caps.has(CAP_MANAGE_ACCESS)) return presetLabel("coordinator"); // NEW
        if (caps.has(CAP_CREATE_PLANTINGS) || caps.has(CAP_MANAGE_OWN_PLANTINGS) || caps.has(CAP_MOVE_TASKS) || caps.has(CAP_EDIT_TASK_DETAILS)) return presetLabel("gardener"); // NEW
        return presetLabel("visitor"); // NEW
    } // NEW

    function currentAccessGrantForSummary(summary) { // NEW
        const user = currentUser(); // NEW
        if (!user || !summary) return null; // NEW
        return (summary.directGrants || []).find(function (grant) { return grant.userId === user.id; }) || summary.inheritedAccessGrant || null; // NEW
    } // NEW

    function hasEffectiveAccessForSummary(summary) { // NEW
        return !!(currentAccessGrantForSummary(summary) || (summary && summary.effectiveCapabilities && summary.effectiveCapabilities.length)); // NEW
    } // NEW

    function effectiveAccessDisplayLabel(summary) { // NEW
        const grant = currentAccessGrantForSummary(summary); // NEW
        return grant ? presetLabel(grant.preset) : effectiveAccessLabel(summary && summary.effectiveCapabilities); // NEW
    } // NEW

    function selectedAccessDetailText(summary) { // NEW
        if (summary.canManageAccess) return "Select a module, garden bed, or task board to manage grants."; // NEW
        if (summary.canEdit) return "You can edit this cell."; // NEW
        if (hasEffectiveAccessForSummary(summary)) return "You have " + effectiveAccessDisplayLabel(summary) + " access here, but this selected cell is not directly editable."; // NEW
        return "You do not have access to this cell."; // NEW
    } // NEW

    function accessDisplayForUser(cell, summary, user) { // NEW
        const directGrant = grantForUser(summary, user.id); // NEW
        const directlyGranted = summary.directUserIds.indexOf(user.id) >= 0; // NEW
        const inherited = nearestInheritedAccessGrant(cell, user.id); // NEW
        const effectiveCapabilities = effectiveCapabilitiesForCell(cell, user.id); // NEW
        return { // NEW
            userId: user.id, // NEW
            directGrant, // NEW
            directlyGranted, // NEW
            inheritedGrant: inherited ? publicGrant(inherited.grant) : null, // NEW
            inheritedSource: inherited ? scopeSummaryForCell(inherited.cell) : null, // NEW
            preset: directlyGranted ? directGrant.preset : (inherited && inherited.grant ? normalizePreset(inherited.grant.preset) : directGrant.preset), // NEW
            capabilities: effectiveCapabilities // NEW
        }; // NEW
    } // NEW

    function inheritedLabel(source, grant) { // CHANGE
        if (!source) return ""; // CHANGE
        const access = grant ? effectiveAccessLabel(grant.capabilities || normalizeCapabilities(null, grant.preset)) : "Inherited"; // CHANGE
        return access + " in " + source.label; // CHANGE
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

    function appendInheritedBadge(parent, source, grant) { // CHANGE
        const label = inheritedLabel(source, grant); // CHANGE
        if (!label) return; // NEW
        const badge = document.createElement("span"); // NEW
        badge.textContent = label; // NEW
        badge.style.cssText = "display:inline-block;margin-left:6px;padding:1px 5px;border:1px solid #BFDBFE;border-radius:3px;color:#1D4ED8;background:#EFF6FF;font-size:10px;line-height:14px;"; // NEW
        parent.appendChild(badge); // NEW
    } // NEW

    function makeAccessDialogShell(titleText, width) { // NEW
        if (typeof document === "undefined") return null; // NEW
        const overlay = document.createElement("div"); // NEW
        overlay.className = "trellis-users-access-dialog"; // NEW
        overlay.style.cssText = "position:fixed;inset:0;z-index:" + USERS_UI_LAYER_Z + ";background:rgba(0,0,0,.24);display:flex;align-items:flex-start;justify-content:center;padding-top:72px;box-sizing:border-box;font:12px Arial,sans-serif;"; // NEW
        overlay.addEventListener("mousedown", function (evt) { if (evt.target === overlay) closeAccessDialog(overlay); }); // NEW
        const box = document.createElement("div"); // NEW
        box.style.cssText = "width:" + (width || 420) + "px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #111;border-radius:4px;box-shadow:0 12px 32px rgba(0,0,0,.24);padding:14px;box-sizing:border-box;"; // NEW
        const header = document.createElement("div"); // NEW
        header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;"; // NEW
        const title = document.createElement("div"); // NEW
        title.textContent = titleText; // NEW
        title.style.cssText = "font-weight:700;font-size:15px;"; // NEW
        header.appendChild(title); // NEW
        header.appendChild(makeButton("Close", function () { closeAccessDialog(overlay); }, "neutral")); // CHANGE
        box.appendChild(header); // NEW
        overlay.appendChild(box); // NEW
        return { overlay, box }; // NEW
    } // NEW

    function closeAccessDialog(dialog) { // NEW
        if (dialog && dialog.parentNode) dialog.parentNode.removeChild(dialog); // NEW
    } // NEW

    function makeTextArea(placeholder) { // NEW
        const text = document.createElement("textarea"); // NEW
        text.placeholder = placeholder || ""; // NEW
        text.rows = 3; // NEW
        text.style.cssText = "box-sizing:border-box;width:100%;padding:5px 6px;border:1px solid #D1D5DB;border-radius:3px;font:12px Arial,sans-serif;resize:vertical;"; // NEW
        return text; // NEW
    } // NEW

    function openAccessRequestDialog(cell) { // NEW
        const scope = accessRequestScopeSummary(cell); // NEW
        if (!scope) { showStatus("Select a module, garden bed, or task board to request access."); return; } // NEW
        const shell = makeAccessDialogShell("Request access", 420); // NEW
        if (!shell) return; // NEW
        const currentRequest = getAccessRequestForCurrentUser(cell); // NEW
        const scopeText = document.createElement("div"); // NEW
        scopeText.style.cssText = "color:#374151;margin-bottom:8px;line-height:18px;"; // NEW
        scopeText.textContent = titleCaseScopeType(scope.type) + ": " + scope.label; // NEW
        const preset = makePresetSelect(currentRequest && currentRequest.requestedPreset || "gardener", function () { }); // NEW
        preset.style.marginBottom = "8px"; // NEW
        const note = makeTextArea("Optional note"); // NEW
        note.value = currentRequest && currentRequest.status === "pending" ? currentRequest.note : ""; // NEW
        const status = document.createElement("div"); // NEW
        status.style.cssText = "min-height:18px;color:#4B5563;margin:8px 0;"; // NEW
        const actions = document.createElement("div"); // NEW
        actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;"; // NEW
        actions.appendChild(makeButton("Cancel", function () { closeAccessDialog(shell.overlay); }, "neutral")); // CHANGE
        actions.appendChild(makeButton("Send Request", function () { // CHANGE
            const result = requestAccess(cell, { requestedPreset: preset.value, note: note.value }); // NEW
            if (!result.ok) { status.textContent = result.reason; return; } // NEW
            closeAccessDialog(shell.overlay); // NEW
        }, "add")); // CHANGE
        shell.box.appendChild(scopeText); // NEW
        shell.box.appendChild(preset); // NEW
        shell.box.appendChild(note); // NEW
        shell.box.appendChild(status); // NEW
        shell.box.appendChild(actions); // NEW
        (document.body || graph.container).appendChild(shell.overlay); // NEW
        note.focus(); // NEW
    } // NEW

    function appendRequesterAccessRequestStatus(parent, cell, decisionStatusVisible) { // CHANGE
        const request = getAccessRequestForCurrentUser(cell); // NEW
        if (!request) return; // NEW
        if (decisionStatusVisible && request.status === "denied") return; // NEW
        const status = document.createElement("div"); // NEW
        status.className = "trellis-users-access-request-status"; // NEW
        status.style.cssText = "border:1px solid " + (request.status === "denied" ? "#FCA5A5" : "#FDE68A") + ";background:" + (request.status === "denied" ? "#FEF2F2" : "#FFFBEB") + ";color:#374151;border-radius:3px;padding:5px 6px;margin:6px 0;line-height:16px;"; // NEW
        status.textContent = request.status === "denied" ? "Access request denied" : "Access request pending"; // NEW
        status.textContent += " (" + presetLabel(request.requestedPreset) + ")."; // NEW
        if (request.status === "denied" && request.decisionNote) status.textContent += " " + request.decisionNote; // NEW
        parent.appendChild(status); // NEW
    } // NEW

    function latestAccessMessageForCell(cell) { // NEW
        const scope = accessRequestScopeSummary(cell); // NEW
        const messages = listAccessMessages({ scopeCell: scope ? scope.cell : cell }); // NEW
        if (!messages.length) return null; // NEW
        const unread = messages.filter(function (message) { return message.unread; }); // NEW
        const candidates = unread.length ? unread : messages; // NEW
        candidates.sort(function (left, right) { return Number(right.createdAt || 0) - Number(left.createdAt || 0); }); // NEW
        return candidates[0] || null; // NEW
    } // NEW

    function appendRequesterAccessDecisionStatus(parent, cell) { // NEW
        const message = latestAccessMessageForCell(cell); // NEW
        if (!message) return false; // NEW
        const approved = message.decision !== "denied"; // NEW
        const status = document.createElement("div"); // NEW
        status.className = "trellis-users-access-decision-status"; // NEW
        status.style.cssText = "border:1px solid " + (approved ? "#86EFAC" : "#FCA5A5") + ";background:" + (approved ? "#F0FDF4" : "#FEF2F2") + ";color:#374151;border-radius:3px;padding:5px 6px;margin:6px 0;line-height:16px;"; // NEW
        status.textContent = "Access " + (approved ? "approved" : "denied") + " (" + presetLabel(message.preset) + ")."; // NEW
        if (message.note) status.textContent += " " + message.note; // NEW
        parent.appendChild(status); // NEW
        return true; // NEW
    } // NEW

    function openMessagesDialog(options) { // NEW
        if (!isEnabled() || !isLoggedIn()) { // NEW
            showAuthDialog({ blocking: false, message: isEnabled() ? "Log in to review access messages." : "Enable users before reviewing access messages." }); // NEW
            return { ok: false, reason: "Login required." }; // NEW
        } // NEW
        const shell = makeAccessDialogShell("Messages", 560); // NEW
        if (!shell) return { ok: false, reason: "Document UI is unavailable." }; // NEW
        const list = document.createElement("div"); // NEW
        list.className = "trellis-users-messages-list"; // NEW
        const render = function () { // NEW
            clearNode(list); // NEW
            const requests = listIncomingAccessRequests(options); // NEW
            const responses = listAccessMessages(options); // NEW
            if (!requests.length && !responses.length) { // NEW
                const empty = document.createElement("div"); // NEW
                empty.style.cssText = "color:#6B7280;padding:8px 0;"; // NEW
                empty.textContent = "No messages."; // CHANGE
                list.appendChild(empty); // NEW
                return; // NEW
            } // NEW
            if (requests.length) { // NEW
                const requestTitle = document.createElement("div"); // NEW
                requestTitle.className = "trellis-users-messages-section-title"; // NEW
                requestTitle.style.cssText = "font-weight:700;margin:4px 0 6px;"; // NEW
                requestTitle.textContent = "Access requests"; // NEW
                list.appendChild(requestTitle); // NEW
                requests.forEach(function (request) { // NEW
                    const row = document.createElement("div"); // NEW
                    row.className = "trellis-users-message-row"; // NEW
                    row.setAttribute("data-trellis-users-request-id", request.id); // NEW
                    row.style.cssText = "border-top:1px solid #E5E7EB;padding:10px 0;"; // NEW
                    const head = document.createElement("div"); // NEW
                    head.style.cssText = "font-weight:700;margin-bottom:4px;"; // NEW
                    head.textContent = request.requesterName + " requested " + presetLabel(request.requestedPreset) + " access"; // NEW
                    const scope = document.createElement("div"); // NEW
                    scope.style.cssText = "color:#374151;margin-bottom:4px;"; // NEW
                    scope.textContent = titleCaseScopeType(request.scopeType) + ": " + request.scopeLabel; // NEW
                    const note = document.createElement("div"); // NEW
                    note.style.cssText = "color:#6B7280;margin-bottom:6px;white-space:pre-wrap;"; // NEW
                    note.textContent = request.note || "No note."; // NEW
                    const preset = makePresetSelect(request.requestedPreset, function () { }); // NEW
                    const decisionNote = makeTextArea("Optional response note"); // CHANGE
                    const status = document.createElement("div"); // NEW
                    status.style.cssText = "min-height:16px;color:#4B5563;margin-top:6px;"; // NEW
                    const actions = document.createElement("div"); // NEW
                    actions.style.cssText = "display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:start;"; // NEW
                    actions.appendChild(preset); // NEW
                    actions.appendChild(makeButton("Approve", function () { // CHANGE
                        const result = approveAccessRequest(request.id, { preset: preset.value, decisionNote: decisionNote.value }); // CHANGE
                        if (!result.ok) { status.textContent = result.reason; return; } // NEW
                        render(); // NEW
                    }, "add")); // CHANGE
                    actions.appendChild(makeButton("Deny", function () { // CHANGE
                        const result = denyAccessRequest(request.id, decisionNote.value); // NEW
                        if (!result.ok) { status.textContent = result.reason; return; } // NEW
                        render(); // NEW
                    }, "danger")); // CHANGE
                    row.appendChild(head); // NEW
                    row.appendChild(scope); // NEW
                    row.appendChild(note); // NEW
                    row.appendChild(decisionNote); // NEW
                    row.appendChild(actions); // NEW
                    row.appendChild(status); // NEW
                    list.appendChild(row); // NEW
                }); // NEW
            } // NEW
            if (responses.length) { // NEW
                const responseTitle = document.createElement("div"); // NEW
                responseTitle.className = "trellis-users-responses-section-title"; // NEW
                responseTitle.style.cssText = "font-weight:700;margin:12px 0 6px;"; // NEW
                responseTitle.textContent = "Responses"; // NEW
                list.appendChild(responseTitle); // NEW
                responses.forEach(function (message) { // NEW
                    const row = document.createElement("div"); // NEW
                    row.className = "trellis-users-response-message-row"; // NEW
                    row.setAttribute("data-trellis-users-message-id", message.id); // NEW
                    row.style.cssText = "border-top:1px solid #E5E7EB;padding:10px 0;"; // NEW
                    const head = document.createElement("div"); // NEW
                    head.style.cssText = "font-weight:700;margin-bottom:4px;"; // NEW
                    head.textContent = "Access " + (message.decision === "denied" ? "denied" : "approved") + " for " + presetLabel(message.preset); // NEW
                    const scope = document.createElement("div"); // NEW
                    scope.style.cssText = "color:#374151;margin-bottom:4px;"; // NEW
                    scope.textContent = titleCaseScopeType(message.scopeType) + ": " + message.scopeLabel + (message.scopeMissing ? " (unavailable)" : ""); // NEW
                    const reviewer = document.createElement("div"); // NEW
                    reviewer.style.cssText = "color:#6B7280;margin-bottom:4px;"; // NEW
                    reviewer.textContent = message.reviewerName ? "Reviewed by " + message.reviewerName + "." : "Reviewer unavailable."; // NEW
                    const note = document.createElement("div"); // NEW
                    note.style.cssText = "color:#6B7280;margin-bottom:6px;white-space:pre-wrap;"; // NEW
                    note.textContent = message.note || "No response note."; // NEW
                    const actions = document.createElement("div"); // NEW
                    actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;"; // NEW
                    if (message.unread) { // NEW
                        actions.appendChild(makeButton("Mark read", function () { // CHANGE
                            const result = markAccessMessageRead(message.id); // NEW
                            if (!result.ok) { showStatus(result.reason); return; } // NEW
                            render(); // NEW
                        }, "neutral")); // CHANGE
                    } // NEW
                    actions.appendChild(makeButton("Dismiss", function () { // CHANGE
                        const result = dismissAccessMessage(message.id); // NEW
                        if (!result.ok) { showStatus(result.reason); return; } // NEW
                        render(); // NEW
                    }, "neutral")); // CHANGE
                    row.appendChild(head); // NEW
                    row.appendChild(scope); // NEW
                    row.appendChild(reviewer); // NEW
                    row.appendChild(note); // NEW
                    row.appendChild(actions); // NEW
                    list.appendChild(row); // NEW
                }); // NEW
            } // NEW
        }; // NEW
        render(); // NEW
        shell.box.appendChild(list); // NEW
        (document.body || graph.container).appendChild(shell.overlay); // NEW
        return { ok: true }; // NEW
    } // NEW

    function appendAccessSection(parent) {
        if (!isEnabled()) return; // NEW
        const cell = selectedCell();
        if (!cell || cell === model.getRoot()) {
            const empty = document.createElement("div");
            empty.style.cssText = "border-top:1px solid #E5E7EB;padding-top:8px;color:#6B7280;";
            empty.textContent = "Select a module, garden bed, or task board to manage access."; // CHANGE
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
        if (!summary.canManageScopeGrants) { // CHANGE
            const caps = document.createElement("div"); // NEW
            caps.style.cssText = "color:#4B5563;margin:4px 0;"; // NEW
            caps.textContent = "Your effective access: " + (hasEffectiveAccessForSummary(summary) ? effectiveAccessDisplayLabel(summary) : "None"); // CHANGE
            box.appendChild(caps); // NEW
            if (summary.inheritedAccessSource) { // NEW
                const inherited = document.createElement("div"); // NEW
                inherited.style.cssText = "color:#2563EB;margin:4px 0;"; // NEW
                inherited.textContent = inheritedLabel(summary.inheritedAccessSource, summary.inheritedAccessGrant); // CHANGE
                box.appendChild(inherited); // NEW
            } // NEW
            const decisionStatusVisible = appendRequesterAccessDecisionStatus(box, cell); // NEW
            const denied = document.createElement("div");
            denied.style.color = "#6B7280";
            denied.textContent = selectedAccessDetailText(summary); // CHANGE
            box.appendChild(denied);
            if (!summary.canEdit) { // NEW
                appendRequesterAccessRequestStatus(box, cell, decisionStatusVisible); // CHANGE
                const requestButton = makeButton(hasEffectiveAccessForSummary(summary) ? "Request More Access" : "Request Access", function () { openAccessRequestDialog(cell); }, "open"); // CHANGE
                requestButton.className = (requestButton.className || "") + " trellis-users-request-access-button"; // CHANGE
                box.appendChild(requestButton); // NEW
            } // NEW
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
        caps.textContent = "Your effective access: " + effectiveAccessLabel(summary.effectiveCapabilities); // CHANGE
        box.appendChild(caps); // NEW
        if (summary.inheritedAccessSource) { // NEW
            const inherited = document.createElement("div"); // NEW
            inherited.style.cssText = "color:#2563EB;margin:4px 0;"; // NEW
            inherited.textContent = inheritedLabel(summary.inheritedAccessSource, summary.inheritedAccessGrant); // CHANGE
            box.appendChild(inherited); // NEW
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
            const access = accessDisplayForUser(cell, summary, user); // NEW
            const grant = { userId: user.id, preset: access.preset, capabilities: access.capabilities }; // NEW
            const directlyGranted = access.directlyGranted; // NEW
            const row = document.createElement("div"); // NEW
            row.className = "trellis-users-access-row"; // NEW
            row.setAttribute("data-trellis-users-user-id", user.id); // NEW
            row.style.cssText = "border-top:1px solid #F3F4F6;padding:6px 0;"; // NEW
            const head = document.createElement("div"); // NEW
            head.style.cssText = "display:grid;grid-template-columns:minmax(70px,1fr) 130px auto;gap:6px;align-items:center;"; // NEW
            const name = document.createElement("div"); // NEW
            name.textContent = user.name; // NEW
            if (directlyGranted) appendGrantedBadge(name); // NEW
            if (access.inheritedSource) appendInheritedBadge(name, access.inheritedSource, access.inheritedGrant); // CHANGE
            head.appendChild(name); // NEW
            head.appendChild(makePresetSelect(grant.preset, function (preset) { // NEW
                const result = setScopeGrant(cell, { userId: user.id, preset }); // NEW
                if (!result.ok) showStatus(result.reason); // NEW
            })); // NEW
            head.appendChild(makeButton(directlyGranted ? "Remove" : "Apply", function () { // CHANGE
                const result = directlyGranted ? removeScopeGrant(cell, user.id) : setScopeGrant(cell, { userId: user.id, preset: grant.preset || "visitor" }); // CHANGE
                if (!result.ok) showStatus(result.reason); // NEW
            }, directlyGranted ? "danger" : "neutral")); // CHANGE
            row.appendChild(head); // NEW
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

    function installRejectedEditPointerTracking() { // NEW
        const container = graph && graph.container; // NEW
        if (!container || !container.addEventListener) return; // NEW
        container.addEventListener("pointermove", rememberGraphPointerPoint, true); // NEW
        container.addEventListener("mousemove", rememberGraphPointerPoint, true); // NEW
        container.addEventListener("mousedown", rememberGraphPointerPoint, true); // NEW
    } // NEW

    model.addListener(mxEvent.CHANGE, inspectModelChange);
    if (graph.addListener && mxEvent && mxEvent.ADD_CELLS) graph.addListener(mxEvent.ADD_CELLS, function (_sender, evt) { // NEW
        const cells = evt && evt.getProperty ? (evt.getProperty("cells") || []) : []; // NEW
        cells.forEach(autoLinkGardenBoardMemberships); // NEW
    }); // NEW
    if (graph.addListener && mxEvent && mxEvent.CELLS_ADDED) graph.addListener(mxEvent.CELLS_ADDED, function (_sender, evt) { // NEW
        const cells = evt && evt.getProperty ? (evt.getProperty("cells") || []) : []; // NEW
        cells.forEach(autoLinkGardenBoardMemberships); // NEW
    }); // NEW
    installAction();
    installToolbarButton(); // NEW
    installFileLoadedGate(); // NEW
    installGraphXmlLoadGuard(); // NEW
    installRejectedEditPointerTracking(); // NEW
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
        requestAccess, // NEW
        getAccessRequestForCurrentUser, // NEW
        listIncomingAccessRequests, // NEW
        approveAccessRequest, // NEW
        denyAccessRequest, // NEW
        openMessagesDialog, // NEW
        incomingAccessRequestCount, // NEW
        listAccessMessages, // NEW
        unreadAccessMessageCount, // NEW
        markAccessMessageRead, // NEW
        dismissAccessMessage, // NEW
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
        stampActorDirect, // NEW
        stampActorIntoEdit, // NEW
        attrs: {
            owner: ATTR_OWNER,
            accessUsers: ATTR_ACCESS_USERS,
            accessGrants: ATTR_ACCESS_GRANTS, // NEW
            accessOpen: ATTR_ACCESS_OPEN,
            roleUser: ATTR_ROLE_USER, // NEW
            roleArchivedUser: ATTR_ROLE_ARCHIVED_USER, // NEW
            roleInactive: ATTR_ROLE_INACTIVE, // NEW
            roleGardenModule: ATTR_ROLE_GARDEN_MODULE, // NEW
            roleTeamModule: ATTR_ROLE_TEAM_MODULE, // NEW
            gardenTeamModule: ATTR_GARDEN_TEAM_MODULE, // NEW
            teamGardenModule: ATTR_TEAM_GARDEN_MODULE, // NEW
            gardenTaskModule: ATTR_GARDEN_TASK_MODULE, // NEW
            taskGardenModule: ATTR_TASK_GARDEN_MODULE, // NEW
            teamRoleArchive: ATTR_TEAM_ROLE_ARCHIVE, // NEW
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
            ensureGardenRoleCardForUser, // NEW
            ensureGardenRoleCardsForUser, // NEW
            getUserGardenRoleCard, // NEW
            readTeamRoleArchive, // NEW
            archivedRoleEntry, // NEW
            allGardenModules, // NEW
            nearestAccessRequestScope, // NEW
            accessRequestScopeSummary, // NEW
            publicAccessMessage, // NEW
            normalizeAccessMessage, // NEW
            autoLinkGardenBoardMemberships, // NEW
            normalizeCapabilities, // NEW
            changeAllowed,
            composeInviteEmail, // NEW
            getDiagramLoginKey, // NEW
            applyAuthGateIfNeeded, // CHANGE
            stampActorDirect, // NEW
            stampActorIntoEdit, // NEW
            refreshPanel, // CHANGE
            closeRejectedEditPopover, // CHANGE
            showRejectedEditPopover // NEW
        }
    };
    graph.__trellisUsers = window.Trellis.users;
    installTrellisDebugSurface(); // NEW
    consoleGroup("[TrellisUsers] loaded", usersDebugStatus()); // NEW
});
