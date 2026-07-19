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
    const ATTR_ACCESS_OPEN = "trellis_access_open";
    const ATTR_CREATED_BY = "createdByUserId";
    const ATTR_EDITED_BY = "lastEditedByUserId";
    const ATTR_ACTOR_NAME = "trellis_actor_name";
    const ATTR_ACTOR_ROLE = "trellis_actor_role";

    const PROTECTED_ATTRS = new Set([ATTR_STORE, ATTR_OWNER, ATTR_ACCESS_USERS, ATTR_ACCESS_OPEN]);
    const USER_ID_PREFIX = "user_";
    const PIN_SALT_PREFIX = "salt_";
    const INVITE_ID_PREFIX = "invite_"; // NEW
    const INVITE_CODE_SALT_PREFIX = "invite_salt_"; // NEW
    const INVITE_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000; // NEW
    const INTERNAL_FLAG = "__trellisUsersInternalChange";
    const REJECT_FLAG = "__trellisUsersRejecting";

    let currentUserId = "";
    let panel = null;
    let statusNode = null;
    let loginNameInput = null;
    let loginPinInput = null;
    let rosterNode = null;
    let accessNode = null;
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
            createdBy: invite.createdBy || "", // NEW
            createdAt: invite.createdAt || 0, // NEW
            expiresAt: invite.expiresAt || 0, // NEW
            status: expired ? "expired" : invite.status // NEW
        }; // NEW
    } // NEW

    function listPendingInvites() { // NEW
        const store = expireInvites(readStore()); // NEW
        return store.invites.filter(function (invite) { return invite.status === "pending" && canManageInvite(invite); }).map(publicInvite); // CHANGE
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
        return { ok: true, user: publicUser(user) }; // NEW
    } // NEW

    function login(name, pin) {
        if (!isEnabled()) return { ok: false, reason: "Users are not enabled for this diagram." }; // NEW
        if (canBootstrapAdmin()) {
            const created = createUser(name, pin, true);
            if (!created.ok) return created;
            currentUserId = created.user.id;
            showStatus("Created first admin: " + created.user.name);
            refreshPanel();
            return { ok: true, user: created.user };
        }
        const user = userByName(name);
        if (!user || user.pinHash !== hashPin(pin, user.pinSalt)) return { ok: false, reason: "Unknown user or incorrect PIN." };
        currentUserId = user.id;
        showStatus("Logged in as " + user.name);
        refreshPanel();
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
        if (user.id === currentUserId && user.disabled) currentUserId = ""; // NEW
        writeStore(store); // NEW
        return { ok: true }; // NEW
    } // NEW

    function logout() {
        currentUserId = "";
        showStatus("Logged out.");
        refreshPanel();
    }

    function userIdsFromAttr(cell) {
        const parsed = parseJson(getAttr(cell, ATTR_ACCESS_USERS), []);
        return Array.isArray(parsed) ? Array.from(new Set(parsed.map(String).filter(Boolean))).sort() : [];
    }

    function setUserIdsAttr(cell, ids) {
        const next = Array.from(new Set((ids || []).map(String).filter(Boolean))).sort();
        setAttr(cell, ATTR_ACCESS_USERS, next.length ? JSON.stringify(next) : "");
    }

    function grantUserToScopes(userId, scopeCellIds) { // NEW
        (scopeCellIds || []).forEach(function (cellId) { // NEW
            const cell = model.getCell && model.getCell(cellId); // NEW
            if (!cell) return; // NEW
            const ids = new Set(userIdsFromAttr(cell)); // NEW
            ids.add(userId); // NEW
            setUserIdsAttr(cell, Array.from(ids)); // NEW
        }); // NEW
    } // NEW

    function removeGrantsForUser(userId, scopeCellIds) { // NEW
        graph[INTERNAL_FLAG] = true; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            (scopeCellIds || []).forEach(function (cellId) { // NEW
                const cell = model.getCell && model.getCell(cellId); // NEW
                if (!cell) return; // NEW
                setUserIdsAttr(cell, userIdsFromAttr(cell).filter(function (id) { return id !== userId; })); // NEW
            }); // NEW
        } finally { // NEW
            model.endUpdate(); // NEW
            graph[INTERNAL_FLAG] = false; // NEW
        } // NEW
    } // NEW

    function writeStoreAndGrant(store, userId, scopeCellIds) { // NEW
        graph[INTERNAL_FLAG] = true; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            grantUserToScopes(userId, scopeCellIds); // NEW
            setAttr(metadataCell(), ATTR_STORE, JSON.stringify(normalizeStore(store))); // NEW
        } finally { // NEW
            model.endUpdate(); // NEW
            graph[INTERNAL_FLAG] = false; // NEW
        } // NEW
        refreshPanel(); // NEW
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
            if (getAttr(cursor, ATTR_ACCESS_OPEN) === "1") return { cell: cursor, open: true };
            if (userId && userIdsFromAttr(cursor).indexOf(userId) >= 0) return { cell: cursor, open: false };
            cursor = parentOf(cursor);
        }
        return null;
    }

    function isOwnerOfNearestScope(cell, userId) {
        const owner = nearestOwnedAncestor(cell);
        return !!(owner && owner.ownerUserId === userId);
    }

    function canEditCell(cell) {
        if (!isEnabled()) return true; // NEW
        const user = currentUser();
        if (!user || !cell || cell === model.getRoot()) return false;
        if (user.admin) return true;
        if (isOwnerOfNearestScope(cell, user.id)) return true;
        return !!nearestAccessGrant(cell, user.id);
    }

    function canAddCell(parent) {
        if (!isEnabled()) return true; // NEW
        const user = currentUser();
        if (!user) return false;
        if (user.admin) return true;
        if (!parent || parent === model.getRoot() || parent === graph.getDefaultParent()) return true;
        return isOwnerOfNearestScope(parent, user.id);
    }

    function canDeleteCell(cell) {
        if (!isEnabled()) return true; // NEW
        const user = currentUser();
        if (!user || !cell || cell === model.getRoot() || cell === graph.getDefaultParent()) return false;
        if (user.admin) return true;
        return isOwnerOfNearestScope(cell, user.id);
    }

    function canDeleteFromPreviousParent(cell, previousParent) { // NEW
        if (!isEnabled()) return true; // NEW
        const user = currentUser(); // NEW
        if (!user || !cell || cell === model.getRoot() || cell === graph.getDefaultParent()) return false; // NEW
        if (user.admin) return true; // NEW
        if (isOwnerOfNearestScope(cell, user.id)) return true; // NEW
        return !!(previousParent && isOwnerOfNearestScope(previousParent, user.id)); // NEW
    } // NEW

    function canMoveCell(cell) { // NEW
        if (!isEnabled()) return true; // NEW
        const user = currentUser(); // NEW
        if (!user || !cell || cell === model.getRoot() || cell === graph.getDefaultParent()) return false; // NEW
        if (user.admin) return true; // NEW
        return isOwnerOfNearestScope(cell, user.id); // NEW
    } // NEW

    function canManageAccess(cell) {
        if (!isEnabled()) return false; // NEW
        const user = currentUser();
        if (!user || !cell || cell === model.getRoot()) return false;
        if (user.admin) return true;
        return isOwnerOfNearestScope(cell, user.id);
    }

    function getStyle(cell) { // NEW
        return cell && typeof cell.getStyle === "function" ? (cell.getStyle() || "") : ((cell && cell.style) || ""); // NEW
    } // NEW

    function styleFlag(cell, key) { // NEW
        return new RegExp("(?:^|;)" + key + "=1(?:;|$)").test(getStyle(cell)); // NEW
    } // NEW

    function eligibleScopeType(cell) { // NEW
        if (!cell || cell === model.getRoot() || cell === graph.getDefaultParent()) return ""; // NEW
        if (styleFlag(cell, "module") || getAttr(cell, "garden_module") === "1" || getAttr(cell, "team_module") === "1") return "module"; // NEW
        const boardKey = String(getAttr(cell, "board_key") || ""); // NEW
        if (boardKey === "KANBAN_BOARD" || boardKey === "MAIN_KANBAN_BOARD") return "task board"; // NEW
        if (getAttr(cell, "garden_bed") === "1" || getAttr(cell, "gardenBed") === "1" || getAttr(cell, "is_garden_bed") === "1") return "garden bed"; // NEW
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
        const grants = userIdsFromAttr(cell);
        return {
            ownerUserId: owner && owner.ownerUserId || "",
            ownerCellId: owner && owner.cell && owner.cell.id || "",
            directOpen: getAttr(cell, ATTR_ACCESS_OPEN) === "1",
            directUserIds: grants,
            effectiveOpen: !!nearestAccessGrant(cell, null),
            canEdit: canEditCell(cell),
            canAdd: canAddCell(cell),
            canDelete: canDeleteCell(cell),
            canManageAccess: canManageAccess(cell)
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
            setAttr(cell, ATTR_ACCESS_OPEN, source.open ? "1" : "");
            setUserIdsAttr(cell, (source.userIds || []).filter(function (id) { return !!userById(id); })); // CHANGE
        } finally {
            model.endUpdate();
            graph[INTERNAL_FLAG] = false;
        }
        refreshPanel();
        return { ok: true };
    }

    function setOwner(cell, userId) {
        if (!cell || !canManageAccess(cell)) return { ok: false, reason: "You cannot change ownership for this cell." };
        if (!userById(userId)) return { ok: false, reason: "Unknown owner." };
        graph[INTERNAL_FLAG] = true;
        model.beginUpdate();
        try { setAttr(cell, ATTR_OWNER, userId); } finally { model.endUpdate(); graph[INTERNAL_FLAG] = false; }
        refreshPanel();
        return { ok: true };
    }

    function composeInviteEmail(invite, code, shareInfo) { // NEW
        const info = shareInfo || {}; // NEW
        const lines = [ // NEW
            "You have been invited to collaborate on a Trellis garden canvas.", // NEW
            "", // NEW
            "1. Add the sender in Syncthing using the device and folder details below.", // NEW
            "2. Wait for the sender to approve your Syncthing device/share.", // NEW
            "3. Open the synced diagram in Trellis Studio.", // NEW
            "4. In Trellis Users, choose Accept Invite and enter your email, invite code, display name, and PIN.", // NEW
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
            "This is a low-security local workflow invite. Access can be revoked from the Trellis Users panel." // NEW
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
            createdBy: actor.id, // NEW
            createdAt: nowMs(), // NEW
            expiresAt: nowMs() + INVITE_EXPIRY_MS, // NEW
            status: "pending" // NEW
        }; // NEW
        store.pendingUsers.push(pendingUser); // NEW
        store.invites.push(invite); // NEW
        writeStoreAndGrant(store, pendingUser.id, invite.scopeCellIds); // NEW
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
        refreshPanel(); // NEW
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

    function changeAllowed(change) {
        const name = change && change.constructor && change.constructor.name;
        const cell = cellFromChange(change);
        if (!name || !cell) return true;
        if (PROTECTED_ATTRS.has(String(change.key || "")) && !canManageAccess(cell)) return false;
        if (protectedAttrsChanged(change) && !canManageAccess(cell)) return false; // NEW
        if (name === "mxChildChange") {
            const currentParent = currentParentOfChange(change);
            const previousParent = previousParentOfChange(change);
            if (currentParent && !canAddCell(currentParent)) return false;
            if (!currentParent && previousParent) return canDeleteFromPreviousParent(cell, previousParent); // CHANGE
            if (currentParent && previousParent && currentParent !== previousParent && !canDeleteFromPreviousParent(cell, previousParent)) return false; // CHANGE
            return !!currentParent;
        }
        if (name === "mxValueChange" && protectedAttrsChanged(change)) return canManageAccess(cell);
        if (name === "mxGeometryChange") return canMoveCell(cell); // NEW
        if (name === "mxStyleChange" || name === "mxValueChange" || name === "mxTerminalChange" || name === "mxCollapseChange" || name === "mxVisibleChange") { // CHANGE
            return canEditCell(cell);
        }
        return true;
    }

    function rejectEdit(edit, reason) {
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
        const edit = evt && evt.getProperty && evt.getProperty("edit");
        const changes = edit && edit.changes || [];
        if (!changes.length) return;
        if (!isLoggedIn()) { rejectEdit(edit, "Log in before editing this diagram."); return; }
        for (let i = 0; i < changes.length; i++) {
            if (!changeAllowed(changes[i])) {
                rejectEdit(edit, "Change rejected by Trellis user permissions.");
                return;
            }
        }
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

    function createPanel() {
        if (panel || typeof document === "undefined") return;
        const host = graph.container && (graph.container.parentNode || graph.container);
        if (!host) return;
        if (host.style && (!host.style.position || host.style.position === "static")) host.style.position = "relative";
        panel = document.createElement("div");
        panel.style.cssText = "position:absolute;top:36px;right:12px;z-index:100000;background:#fff;border:1px solid #111;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,.22);width:320px;max-height:calc(100vh - 72px);overflow:auto;padding:10px;font:12px Arial,sans-serif;display:none;box-sizing:border-box;";
        panel.addEventListener("mousedown", function (evt) { evt.stopPropagation(); });
        const title = document.createElement("div");
        title.textContent = "Trellis Users";
        title.style.cssText = "font-weight:700;font-size:14px;margin-bottom:8px;";
        panel.appendChild(title);
        statusNode = document.createElement("div");
        statusNode.style.cssText = "min-height:16px;color:#4B5563;margin-bottom:8px;";
        panel.appendChild(statusNode);
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
        panel.style.display = panel.style.display === "none" ? "" : "none";
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
        const invites = listPendingInvites(); // NEW
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

    function appendAdminRoster(parent) {
        if (!isEnabled() || !isAdmin()) return; // CHANGE
        const box = document.createElement("div");
        box.style.cssText = "border-top:1px solid #E5E7EB;padding-top:8px;margin-top:8px;";
        const title = document.createElement("div");
        title.textContent = "Users";
        title.style.fontWeight = "700";
        box.appendChild(title);
        listUsers().forEach(function (user) {
            const row = document.createElement("div");
            row.style.cssText = "display:grid;grid-template-columns:minmax(80px,1fr) auto auto auto;gap:6px;align-items:center;padding:3px 0;"; // CHANGE
            row.appendChild(document.createTextNode(user.name + (user.admin ? " - admin" : "") + (user.disabled ? " - disabled" : ""))); // CHANGE
            const adminToggle = makeButton(user.admin ? "Regular" : "Admin", function () { // NEW
                const result = setUserAdmin(user.id, !user.admin); // NEW
                if (!result.ok) showStatus(result.reason); // NEW
            }); // NEW
            const disableToggle = makeButton(user.disabled ? "Reactivate" : "Disable", function () { // NEW
                const result = setUserDisabled(user.id, !user.disabled); // NEW
                if (!result.ok) showStatus(result.reason); // NEW
            }); // NEW
            const resetPin = makeButton("PIN", function () { // NEW
                const pin = window.prompt ? window.prompt("New PIN for " + user.name + ":") : ""; // NEW
                if (pin == null) return; // NEW
                const result = resetUserPin(user.id, pin); // NEW
                if (!result.ok) showStatus(result.reason); // NEW
            }); // NEW
            row.appendChild(adminToggle); // NEW
            row.appendChild(disableToggle); // NEW
            row.appendChild(resetPin); // NEW
            box.appendChild(row);
        });
        const addRow = document.createElement("div");
        addRow.style.cssText = "display:grid;grid-template-columns:1fr 72px 52px;gap:6px;margin-top:6px;";
        const name = makeInput("text", "New user");
        const pin = makeInput("password", "PIN");
        addRow.appendChild(name);
        addRow.appendChild(pin);
        addRow.appendChild(makeButton("Add", function () {
            const result = createUser(name.value, pin.value, false);
            if (!result.ok) showStatus(result.reason);
            name.value = "";
            pin.value = "";
        }));
        box.appendChild(addRow);
        parent.appendChild(box);
    }

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
        const openLabel = document.createElement("label");
        openLabel.style.cssText = "display:flex;gap:6px;align-items:center;margin:6px 0;";
        const open = document.createElement("input");
        open.type = "checkbox";
        open.checked = summary.directOpen;
        open.addEventListener("change", function () {
            setAccess(cell, { open: open.checked, userIds: userIdsFromAttr(cell) });
        });
        openLabel.appendChild(open);
        openLabel.appendChild(document.createTextNode("Open to all logged-in users"));
        box.appendChild(openLabel);
        listUsers().filter(function (user) { return !user.admin && !user.disabled; }).forEach(function (user) { // CHANGE
            const label = document.createElement("label");
            label.style.cssText = "display:flex;gap:6px;align-items:center;margin:4px 0;";
            const input = document.createElement("input");
            input.type = "checkbox";
            input.checked = summary.directUserIds.indexOf(user.id) >= 0;
            input.addEventListener("change", function () {
                const ids = userIdsFromAttr(cell);
                const next = new Set(ids);
                if (input.checked) next.add(user.id);
                else next.delete(user.id);
                setAccess(cell, { open: getAttr(cell, ATTR_ACCESS_OPEN) === "1", userIds: Array.from(next) });
            });
            label.appendChild(input);
            label.appendChild(document.createTextNode(user.name));
            box.appendChild(label);
        });
        parent.appendChild(box);
    }

    function refreshPanel() {
        if (!panel || !rosterNode || !accessNode) return;
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
            if (isEnabled() && !isLoggedIn()) { // CHANGE
                createPanel();
                if (panel) panel.style.display = "";
                showStatus(canBootstrapAdmin() ? "Create the first admin to edit this diagram." : "Log in to edit this diagram.");
            }
        }, 0);
    }

    model.addListener(mxEvent.CHANGE, inspectModelChange);
    installAction();
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
        getAccessSummary,
        withActorMetadata,
        listUsers,
        enableUsers, // NEW
        login,
        logout,
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
        setAccess,
        setOwner,
        stampCreatedOwner,
        stampActorOnCell,
        attrs: {
            owner: ATTR_OWNER,
            accessUsers: ATTR_ACCESS_USERS,
            accessOpen: ATTR_ACCESS_OPEN,
            createdBy: ATTR_CREATED_BY,
            editedBy: ATTR_EDITED_BY
        },
        _test: {
            readStore,
            writeStore,
            hashPin,
            hashInviteCode, // NEW
            nearestOwnedAncestor,
            nearestAccessGrant,
            changeAllowed,
            composeInviteEmail // NEW
        }
    };
    graph.__trellisUsers = window.Trellis.users;
});
