/** Pure Users policy. Inputs are plain snapshots; decisions never read sessions, clocks, DOM, storage, or activity. */ // NEW
(function (root) { // NEW
  'use strict'; // NEW

  const COMMENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // NEW
  function parseComments(raw) { // NEW
    if (!raw) return []; // CHANGE
    const value = JSON.parse(raw), // NEW
      ids = new Set(); // CHANGE
    if (!value || Object.keys(value).length !== 2 || ![1, 2].includes(value.version) || !Array.isArray(value.comments)) throw new Error('Unsupported or damaged comments data.'); // CHANGE
    return value.comments.map(record => { // NEW
      const timestamp = number => Number.isSafeInteger(number) && number >= 0; // CHANGE
      const keys = ['id', 'authorUserId', 'authorName', 'html', 'createdAt', 'updatedAt', 'resolvedAt', 'resolvedByUserId', 'resolvedByName']; // CHANGE
      if (value.version === 2) keys.push('isAlert'); // CHANGE: version 1 remains readable without rewriting saved discussion.
      if (!record || Object.keys(record).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(record, key)) || // NEW
      !['id', 'authorUserId', 'authorName', 'html'].every(key => typeof record[key] === 'string' && record[key].trim()) || ids.has(record.id) || // NEW
      !timestamp(record.createdAt) || !timestamp(record.updatedAt) || record.updatedAt < record.createdAt || value.version === 2 && typeof record.isAlert !== 'boolean' || // NEW
      !(record.resolvedAt === null && record.resolvedByUserId === null && record.resolvedByName === null || // NEW
      timestamp(record.resolvedAt) && record.resolvedAt >= record.updatedAt && typeof record.resolvedByUserId === 'string' && record.resolvedByUserId && typeof record.resolvedByName === 'string' && record.resolvedByName)) throw new Error('Unsupported or damaged comments data.'); // CHANGE
      ids.add(record.id); // NEW
      return { // NEW
        ...Object.fromEntries(keys.map(key => [key, record[key]])), // NEW
        isAlert: value.version === 2 ? record.isAlert : false // NEW
      }; // CHANGE
    }); // CHANGE
  } // CHANGE

  /** A single policy shared by the UI and Users model guard; history replay remains the host's responsibility. */ // CHANGE
  function commentsChangeAllowed(beforeRaw, afterRaw, actor, now, normalizeHtml, maximumAge = 60000) { // NEW
    try { // NEW
      if (!actor || !actor.enabled || !actor.editable || !actor.user || !actor.user.id) return false; // CHANGE
      const before = parseComments(beforeRaw), // NEW
        after = parseComments(afterRaw), // NEW
        previous = new Map(before.map(item => [item.id, item])); // CHANGE
      if (beforeRaw && afterRaw && JSON.parse(beforeRaw).version === 2 && JSON.parse(afterRaw).version !== 2) return false; // CHANGE: old writers must not downgrade alert-aware discussion.
      const moderator = item => item.authorUserId === actor.user.id || actor.user.admin || actor.ownerUserId === actor.user.id; // CHANGE
      const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right); // CHANGE
      const recent = time => time <= now && now - time < maximumAge; // CHANGE: allow synchronous model listeners to run milliseconds after the command timestamp.
      let changes = 0; // CHANGE
      for (const item of after) { // NEW
        const old = previous.get(item.id); // NEW
        previous.delete(item.id); // CHANGE
        if (old && equal(old, item)) continue; // CHANGE
        changes++; // CHANGE
        if (item.html !== normalizeHtml(item.html)) return false; // CHANGE
        if (!old) { // NEW
          if (item.authorUserId !== actor.user.id || item.authorName !== actor.user.name || !recent(item.createdAt) || item.updatedAt !== item.createdAt || item.resolvedAt !== null) return false; // CHANGE
          continue; // CHANGE
        } // CHANGE
        if (item.authorUserId !== old.authorUserId || item.authorName !== old.authorName || item.createdAt !== old.createdAt) return false; // CHANGE
        if (item.html !== old.html) { // NEW
          if (old.authorUserId !== actor.user.id || !recent(item.updatedAt) || item.updatedAt < old.updatedAt || item.resolvedAt !== null) return false; // CHANGE
        } else if (item.isAlert !== old.isAlert) { // NEW
          if (!moderator(old) || !equal({ // NEW
            ...old, // NEW
            isAlert: item.isAlert // NEW
          }, item)) return false; // CHANGE: moderation cannot change text, timestamps or resolution alongside a flag.
        } else { // NEW
          if (!moderator(old) || item.updatedAt !== old.updatedAt) return false; // CHANGE
          if (old.resolvedAt === null) { // NEW
            if (!recent(item.resolvedAt) || item.resolvedByUserId !== actor.user.id || item.resolvedByName !== actor.user.name) return false; // CHANGE
          } else if (item.resolvedAt !== null) return false; // CHANGE
        } // CHANGE
      } // CHANGE
      for (const old of previous.values()) { // NEW
        changes++; // NEW
        if (!moderator(old) || old.resolvedAt === null || now - old.resolvedAt < COMMENT_RETENTION_MS) return false; // NEW
      } // CHANGE
      return changes === 1; // CHANGE: one user action cannot smuggle unrelated comment changes.
    } catch (_) { // NEW
      return false; // NEW
    } // CHANGE
  } // CHANGE

  const OWNER = 'trellis_owner_user_id', // NEW
    GRANTS = 'trellis_access_grants_json', // NEW
    STORE = 'trellis_users_json'; // NEW
  /** @typedef {{key:string,id:string,pageId:string,parent:string|null,attributes:Object,style:string,root?:boolean,layer?:boolean,vertex?:boolean,edge?:boolean}} PermissionCell Plain facts produced by a host adapter. */ // NEW
  /** @typedef {{store:Object,cells:PermissionCell[],memberships?:Object,provisionalUsers?:Object[]}} SnapshotInput The host supplies proven session context separately from stored policy. */ // NEW
  const CAPABILITIES = Object.freeze(['create_plantings', 'manage_own_plantings', 'move_tasks', 'edit_task_details', 'manage_scope_content', 'manage_access']); // NEW
  const PRESETS = Object.freeze({ // NEW
    visitor: [], // NEW
    gardener: CAPABILITIES.slice(0, 4), // NEW
    coordinator: CAPABILITIES // NEW
  }); // NEW
  const ACCESS = new Set(['trellis_access_user_ids_json', GRANTS, 'trellis_access_open']); // NEW
  const PROTECTED = new Set([STORE, OWNER, ...ACCESS, 'trellis_role_user_id', 'trellis_role_garden_module_id', 'trellis_role_team_module_id', 'trellis_role_archived_user_id', 'trellis_role_inactive', 'trellis_team_module_id', 'trellis_garden_module_id', 'trellis_team_role_archive_json', 'trellis_team_section', 'trellis_team_id', 'trellis_team_archived', 'trellis_team_unassigned']); // NEW
  const TASK_DETAILS = new Set(['label', 'title', 'notes', 'card_note', 'task_instruction_override', 'trellis_details_html', 'trellis_comments_json', 'start', 'end', 'due', 'assigned_day', 'task_estimated_hours', 'scheduler_dates_locked']); // NEW
  const AUDIT = new Set(['lastEditedByUserId', 'trellis_actor_name', 'trellis_actor_role']); // NEW
  const PRESENTATION = new Set(['lod_collapsed', 'lod_layout_snapshot_v1', 'lod_layout_snapshot_at', 'plant_count', 'plant_count_capacity', 'plant_count_actual', 'planting_expected_yield_kg']); // NEW
  const decision = (allowed, reason = 'This action is not permitted.') => ({ // NEW
    allowed: !!allowed, // NEW
    reason: allowed ? '' : reason // NEW
  }); // NEW
  const equal = (a, b) => canonical(a) === canonical(b); // NEW
  function canonical(value) { // NEW
    return JSON.stringify(value, function (_key, item) { // NEW
      return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item; // NEW
    }); // NEW
  } // NEW
  function freeze(value) { // NEW
    if (value && typeof value === 'object' && !Object.isFrozen(value)) { // NEW
      Object.values(value).forEach(freeze); // NEW
      Object.freeze(value); // NEW
    } // NEW
    return value; // NEW
  } // NEW
  function parse(value, fallback) { // NEW
    if (!value) return fallback; // NEW
    return JSON.parse(value); // NEW
  } // NEW
  function preset(value) { // NEW
    const name = String(value || 'visitor').toLowerCase().trim(); // NEW
    return { // NEW
      viewer: 'visitor', // NEW
      grower: 'gardener', // NEW
      task: 'gardener', // NEW
      manager: 'coordinator' // NEW
    }[name] || (Object.hasOwn(PRESETS, name) ? name : 'visitor'); // NEW
  } // NEW
  /** Presets are the renderer's existing source of capability semantics; derived mirrors are never grants. */ // NEW
  function grants(cell) { // NEW
    const values = parse(cell?.attributes[GRANTS], []); // NEW
    if (!Array.isArray(values)) throw new Error('Invalid permission grants.'); // NEW
    return values.filter(value => value && value.derived !== true && value.derived !== '1').map(value => ({ // NEW
      ...value, // NEW
      capabilities: value.preset === undefined ? Array.isArray(value.capabilities) ? value.capabilities.filter(cap => CAPABILITIES.includes(cap)) : [] : PRESETS[preset(value.preset)] // NEW
    })); // NEW
  } // NEW
  function flag(cell, name) { // NEW
    return !!cell && (cell.attributes[name] === '1' || new RegExp('(?:^|;)' + name + '=1(?:;|$)').test(cell.style || '')); // NEW
  } // NEW
  function type(cell, name) { // NEW
    if (!cell) return false; // NEW
    if (name === 'module') return flag(cell, 'module') || ['garden_module', 'team_module', 'task_module'].some(key => flag(cell, key)); // NEW
    if (name === 'bed') return ['garden_bed', 'gardenBed', 'is_garden_bed'].some(key => flag(cell, key)); // NEW
    if (name === 'board') return ['KANBAN_BOARD', 'MAIN_KANBAN_BOARD'].includes(cell.attributes.board_key) || cell.attributes.roadmap_type === 'board'; // NEW
    if (name === 'planting') return flag(cell, 'tiler_group'); // NEW
    if (name === 'task') return flag(cell, 'kanban_card'); // NEW
    if (name === 'tile') return flag(cell, 'plant_tiler') && (flag(cell, 'auto') || !!cell.attributes.tile_r || !!cell.attributes.tile_c); // NEW
    if (name === 'summary') return flag(cell, 'lod_summary'); // NEW
    return flag(cell, name); // NEW
  } // NEW
  function chain(snapshot, key) { // NEW
    const result = [], // NEW
      seen = new Set(); // NEW
    for (let cell = snapshot.cells[key]; cell; cell = snapshot.cells[cell.parent]) { // NEW
      if (seen.has(cell.key)) throw new Error('Cyclic permission ancestry.'); // NEW
      seen.add(cell.key); // NEW
      result.push(cell); // NEW
    } // NEW
    return result; // NEW
  } // NEW
  const nearest = (snapshot, key, name) => chain(snapshot, key).find(cell => type(cell, name)); // NEW
  const owner = (snapshot, key) => chain(snapshot, key).find(cell => cell.attributes[OWNER]); // NEW
  const owns = (snapshot, key, actor, access = false) => { // NEW
    const cell = owner(snapshot, key); // NEW
    return !!cell && cell.attributes[OWNER] === actor && (!access || !type(cell, 'planting')); // NEW
  }; // NEW
  const links = cell => String(cell?.attributes.linkedTo || '').split(',').map(id => id.trim()).filter(Boolean); // NEW
  const related = (snapshot, cell, id) => snapshot.cells[JSON.stringify([cell.pageId || '', id])] || Object.values(snapshot.cells).find(candidate => candidate.pageId === cell.pageId && candidate.id === id); // NEW
  /** Membership is derived only from active role cards and active teams on the same page. */ // NEW
  function activeTeams(snapshot, actor) { // NEW
    const cells = Object.values(snapshot.cells), // NEW
      roles = cells.filter(cell => type(cell, 'role_card') && cell.attributes.trellis_role_user_id === actor && cell.attributes.trellis_role_inactive !== '1'); // NEW
    return cells.filter(cell => flag(cell, 'trellis_team_section') && !flag(cell, 'trellis_team_archived') && !flag(cell, 'trellis_team_unassigned') && roles.some(role => role.pageId === cell.pageId && (role.parent === cell.key || links(role).includes(cell.id) && links(cell).includes(role.id)))).map(cell => cell.attributes.trellis_team_id || cell.id); // NEW
  } // NEW
  /** Copy and freeze caller data. A snapshot contains no mutable references to its graph/XML source. */ // NEW
  function snapshot(input) { // NEW
    const data = JSON.parse(JSON.stringify(input)), // NEW
      cells = Object.create(null); // NEW
    for (const cell of data.cells || []) { // NEW
      if (!cell.key || Object.hasOwn(cells, cell.key)) throw new Error('Duplicate permission object.'); // NEW
      cells[cell.key] = { // NEW
        ...cell, // NEW
        attributes: cell.attributes || {}, // NEW
        style: cell.style || '' // NEW
      }; // NEW
      grants(cells[cell.key]); // NEW
    } // NEW
    const result = { // NEW
      store: data.store || {}, // NEW
      cells, // NEW
      memberships: data.memberships || null, // NEW
      provisionalUsers: data.provisionalUsers || [] // NEW
    }; // NEW
    for (const key of Object.keys(cells)) chain(result, key); // NEW
    if (!result.memberships) result.memberships = Object.fromEntries([...(result.store.users || []), ...(result.store.pendingUsers || []), ...result.provisionalUsers].map(account => [account.id, activeTeams(result, account.id)])); // NEW: membership is evaluated once per immutable snapshot. // NEW
    return freeze(result); // NEW
  } // NEW
  /** Resolve a proven provisional invite without accepting caller-supplied administrator privileges. */ // NEW
  function user(snapshot, actor, at) { // NEW
    const stored = (snapshot.store.users || []).find(entry => entry.id === actor); // NEW
    if (stored) return stored.disabled ? null : stored; // NEW
    const invitation = (snapshot.store.invites || []).find(entry => entry.pendingUserId === actor && entry.status === 'pending' && entry.expiresAt > at); // NEW
    return invitation ? snapshot.provisionalUsers.find(entry => entry.id === actor && !entry.admin && !entry.disabled) || null : null; // NEW
  } // NEW
  function directCapabilities(snapshot, actor, key) { // NEW
    const teams = new Set(snapshot.memberships?.[actor] || activeTeams(snapshot, actor)), // NEW
      result = new Set(); // NEW
    for (const cell of chain(snapshot, key)) for (const grant of grants(cell)) if (grant.userId === actor || grant.subjectType === 'team' && teams.has(grant.teamId)) grant.capabilities.forEach(cap => result.add(cap)); // NEW
    if (result.has('manage_scope_content')) CAPABILITIES.slice(0, 4).forEach(cap => result.add(cap)); // NEW
    return [...result].sort(); // NEW
  } // NEW
  function effectiveCapabilities(snapshot, actor, key, at) { // NEW
    const account = user(snapshot, actor, at); // NEW
    if (!snapshot.store.usersEnabled || account && (account.admin || owns(snapshot, key, actor, true))) return [...CAPABILITIES].sort(); // NEW
    return account ? directCapabilities(snapshot, actor, key) : []; // NEW
  } // NEW
  function ownTask(snapshot, actor, cell) { // NEW
    const plantings = links(cell).map(id => related(snapshot, cell, id)).filter(candidate => type(candidate, 'planting') && links(candidate).includes(cell.id)); // NEW
    return plantings.some(planting => planting.attributes[OWNER] === actor) || !plantings.length && cell.attributes.createdByUserId === actor; // NEW
  } // NEW
  /** Action permissions exclude freshness, activity reservations, document locks and UI state. */ // NEW
  function authorize(snapshot, actor, action, key, at) { // NEW
    try { // NEW
      if (!['edit', 'move', 'add', 'delete', 'createPlanting', 'managePlanting', 'moveTask', 'editTaskDetails', 'manageContent', 'manageAccess', 'manageScopeGrants', 'transferOwnership', 'configureCircleLimits'].includes(action)) return decision(false, 'Unknown permission action.'); // NEW
      const accessAction = ['manageAccess', 'transferOwnership', 'manageScopeGrants'].includes(action); // NEW
      if (!snapshot.store.usersEnabled) return decision(!accessAction); // NEW
      const account = user(snapshot, actor, at), // NEW
        cell = snapshot.cells[key]; // NEW
      if (!account) return decision(false, 'Log in as an active project user.'); // NEW
      if (action === 'add' && (!cell || cell.root || cell.layer)) return decision(true); // NEW
      if (!cell || cell.root || ['move', 'delete'].includes(action) && cell.layer) return decision(false); // NEW
      const caps = new Set(effectiveCapabilities(snapshot, actor, key, at)), // NEW
        has = cap => caps.has(cap), // NEW
        unowned = chain(snapshot, key).some(candidate => type(candidate, 'module') && !candidate.attributes[OWNER]); // NEW
      if (action === 'configureCircleLimits') return decision(flag(cell, 'garden_module') && (account.admin || cell.attributes[OWNER] === actor)); // NEW
      if (action === 'transferOwnership') return decision(account.admin || owns(snapshot, key, actor, true)); // NEW
      if (action === 'manageAccess' || action === 'manageScopeGrants') return decision((action !== 'manageScopeGrants' || !cell.layer && (type(cell, 'module') || type(cell, 'board') || type(cell, 'bed'))) && (account.admin || owns(snapshot, key, actor, true) || has('manage_access'))); // NEW
      if (action === 'delete' && type(cell, 'module')) return decision(account.admin || cell.attributes[OWNER] === actor); // NEW
      if (account.admin) return decision(true); // NEW
      if (action === 'createPlanting') return decision(owns(snapshot, key, actor) || has('create_plantings')); // NEW
      if (action === 'managePlanting') { // NEW
        const planting = nearest(snapshot, key, 'planting'); // NEW
        return decision(planting && (owns(snapshot, planting.key, actor) || has('manage_scope_content') || planting.attributes[OWNER] === actor && has('manage_own_plantings'))); // NEW
      } // NEW
      if (action === 'moveTask' || action === 'editTaskDetails') return decision(owns(snapshot, key, actor) || has('manage_scope_content') || nearest(snapshot, key, 'board') && has(action === 'moveTask' ? 'move_tasks' : 'edit_task_details') && ownTask(snapshot, actor, cell)); // NEW
      if (action === 'manageContent') return decision(owns(snapshot, key, actor, true) || has('manage_scope_content')); // NEW
      if (action === 'add') return decision(type(cell, 'module') && !cell.attributes[OWNER] || owns(snapshot, key, actor) || has('manage_scope_content')); // NEW
      if (action === 'delete') return decision(unowned || owns(snapshot, key, actor) || authorize(snapshot, actor, 'managePlanting', key, at).allowed || has('manage_scope_content')); // NEW
      if (action === 'edit' || action === 'move') { // NEW
        if (unowned || owns(snapshot, key, actor)) return decision(true); // NEW
        if (type(cell, 'task')) return authorize(snapshot, actor, action === 'move' ? 'moveTask' : 'editTaskDetails', key, at); // NEW
        if (nearest(snapshot, key, 'planting')) return authorize(snapshot, actor, 'managePlanting', key, at); // NEW
        return decision(has('manage_scope_content')); // NEW
      } // NEW
      return decision(false, 'Unknown permission action.'); // NEW
    } catch (_) { // NEW
      return decision(false, 'Invalid permission data.'); // NEW
    } // NEW
  } // NEW
  /** Coordination rank is intentionally broader than authorization of a particular content change. */ // NEW
  function authority(snapshot, actor, key, at) { // NEW
    const account = user(snapshot, actor, at) || (snapshot.store.invites || []).some(invite => invite.pendingUserId === actor && invite.status === 'pending' && invite.expiresAt > at) && { // NEW
      id: actor // NEW
    }; // NEW
    if (!account) return 0; // NEW
    if (account.admin) return 4; // NEW
    if (key === '*') return 0; // NEW
    if (owns(snapshot, key, actor)) return 3; // NEW
    const caps = directCapabilities(snapshot, actor, key); // NEW
    if (caps.includes('manage_scope_content')) return 2; // NEW
    const cell = snapshot.cells[key]; // NEW
    return caps.some(cap => CAPABILITIES.slice(0, 4).includes(cap)) || chain(snapshot, key).some(candidate => type(candidate, 'module') && !candidate.attributes[OWNER]) || cell && !cell.vertex && !cell.edge ? 1 : 0; // NEW
  } // NEW
  const changedAttributes = (before, after) => [...new Set([...Object.keys(before?.attributes || {}), ...Object.keys(after?.attributes || {})])].filter(name => before?.attributes[name] !== after?.attributes[name]); // NEW
  /** Compute actual object effects instead of trusting a command label or an internal-change flag. */ // NEW
  function changes(before, after) { // NEW
    return [...new Set([...Object.keys(before.cells), ...Object.keys(after.cells)])].map(key => ({ // NEW
      key, // NEW
      before: before.cells[key], // NEW
      after: after.cells[key] // NEW
    })).filter(change => !equal(change.before, change.after)); // NEW
  } // NEW
  /** Validate roster transitions using prior authority, including the narrow invitation bootstrap. */ // NEW
  function rosterChangeAllowed(before, after, actor, at) { // NEW
    const a = before.store, // NEW
      b = after.store; // NEW
    if (equal(a, b)) return true; // NEW
    if (!(a.users || []).length && !(a.pendingUsers || []).length && !(a.invites || []).length && (b.users || []).length <= 1 && (b.users || []).every(entry => entry.admin && !entry.disabled) && !(b.pendingUsers || []).length && !(b.invites || []).length) return true; // NEW: the existing local first-admin bootstrap. // NEW
    if ((a.users || []).some(entry => entry.id === actor && entry.admin && !entry.disabled)) return !(a.users || []).some(entry => entry.admin && !entry.disabled) || (b.users || []).some(entry => entry.admin && !entry.disabled); // NEW
    const fields = new Set(['users', 'pendingUsers', 'invites', 'accessRequests', 'accessMessages']), // NEW
      other = store => Object.fromEntries(Object.entries(store).filter(([key]) => !fields.has(key))); // NEW
    if (!equal(other(a), other(b))) return false; // NEW
    const invite = (a.invites || []).find(entry => entry.pendingUserId === actor && entry.status === 'pending' && entry.expiresAt > at); // NEW
    if (invite && !(a.users || []).some(entry => entry.id === actor)) { // NEW
      const added = (b.users || []).find(entry => entry.id === actor), // NEW
        accepted = (b.invites || []).find(entry => entry.id === invite.id); // NEW
      return !!added && !added.admin && !added.disabled && added.email === invite.email && equal((b.users || []).filter(entry => entry.id !== actor), a.users || []) && equal(b.pendingUsers || [], (a.pendingUsers || []).filter(entry => entry.id !== actor)) && equal((b.invites || []).filter(entry => entry.id !== invite.id), (a.invites || []).filter(entry => entry.id !== invite.id)) && !!accepted && accepted.status === 'accepted' && equal({ // NEW
        ...accepted, // NEW
        status: invite.status // NEW
      }, invite); // NEW
    } // NEW
    const own = (a.users || []).find(entry => entry.id === actor && !entry.disabled), // NEW
      next = (b.users || []).find(entry => entry.id === actor); // NEW
    if (own && !own.portableIdentityId && next?.portableIdentityId && typeof next.portableIdentityId === 'string') { // NEW
      const unlinked = { // NEW
        ...next // NEW
      }; // NEW
      if (Object.hasOwn(own, 'portableIdentityId')) unlinked.portableIdentityId = own.portableIdentityId;else delete unlinked.portableIdentityId; // NEW
      if (equal(unlinked, own) && equal({ // NEW
        ...b, // NEW
        users: a.users // NEW
      }, a) && equal((b.users || []).filter(entry => entry.id !== actor), (a.users || []).filter(entry => entry.id !== actor))) return true; // NEW
    } // NEW
    if (!equal(a.users || [], b.users || [])) return false; // NEW
    const oldInvites = new Map((a.invites || []).map(entry => [entry.id, entry])), // NEW
      altered = (b.invites || []).filter(entry => !equal(oldInvites.get(entry.id), entry)); // NEW
    if ((a.invites || []).some(entry => !(b.invites || []).some(next => next.id === entry.id))) return false; // NEW
    const canManageId = id => Object.values(before.cells).some(cell => cell.id === id && authorize(before, actor, 'manageAccess', cell.key, at).allowed); // NEW
    if (altered.some(entry => { // NEW
      const old = oldInvites.get(entry.id); // NEW
      return entry.createdBy !== (old?.createdBy || actor) || !(entry.scopeCellIds || []).length || [...entry.scopeCellIds, ...(old?.scopeCellIds || [])].some(id => !canManageId(id)); // NEW
    })) return false; // NEW
    const pending = new Set(altered.map(entry => entry.pendingUserId)); // NEW
    if (!equal((a.pendingUsers || []).filter(entry => !pending.has(entry.id)), (b.pendingUsers || []).filter(entry => !pending.has(entry.id)))) return false; // NEW
    for (const field of ['accessRequests', 'accessMessages']) { // NEW
      const old = new Map((a[field] || []).map(entry => [entry.id, entry])); // NEW
      if ((b[field] || []).some(entry => !equal(old.get(entry.id), entry) && entry.requesterUserId !== actor && !Object.values(before.cells).some(cell => cell.id === entry.scopeCellId && (user(before, actor, at)?.admin || owns(before, cell.key, actor, true))))) return false; // NEW
      if ((a[field] || []).some(entry => !(b[field] || []).some(next => next.id === entry.id) && entry.requesterUserId !== actor)) return false; // NEW
    } // NEW
    return true; // NEW
  } // NEW
  function invitationAcceptance(before, after, actor, at) { // NEW
    return !(before.store.users || []).some(entry => entry.id === actor) && (before.store.invites || []).some(entry => entry.pendingUserId === actor && entry.status === 'pending' && entry.expiresAt > at) && rosterChangeAllowed(before, after, actor, at); // NEW
  } // NEW
  /** Permission queries derive expiry without performing persistent cleanup. */ // NEW
  function invitationStatus(invite, at) { // NEW
    return invite.status === 'pending' && invite.expiresAt <= at ? 'expired' : invite.status; // NEW
  } // NEW
  /** Validate a whole proposal. All authorization uses the prior snapshot; new grants never authorize sibling effects. */ // NEW
  function transitionContext(before, after, actor, at, options) { // NEW
    const effects = changes(before, after), // NEW
      policy = options.policy || before, // NEW
      account = user(policy, actor, at), // NEW
      setup = !equal(before.store, after.store) && invitationAcceptance(policy, after, actor, at); // NEW
    const created = new Set(), // NEW
      creating = new Set(), // NEW
      can = (action, key) => authorize(policy, actor, action, key, at).allowed; // NEW
    function createAllowed(key) { // NEW
      if (before.cells[key]) return can('add', key); // NEW
      if (created.has(key)) return true; // NEW
      if (creating.has(key)) return false; // NEW
      const cell = after.cells[key]; // NEW
      if (!cell) return false; // NEW
      creating.add(key); // NEW
      const parent = before.cells[cell.parent], // NEW
        container = after.cells[cell.parent]; // NEW
      const permitted = parent ? can(type(cell, 'planting') ? 'createPlanting' : 'add', parent.key) : container ? createAllowed(container.key) : !before.store.usersEnabled || !!account?.admin; // NEW
      creating.delete(key); // NEW
      if (permitted) created.add(key); // NEW
      return permitted; // NEW
    } // NEW
    const createdPlantings = new Set(effects.filter(effect => !effect.before && type(effect.after, 'planting') && createAllowed(effect.key)).map(effect => effect.key)); // NEW
    const presentationGardens = new Set(); // NEW
    for (const effect of effects) if (effect.before && effect.after) { // NEW
      const fields = changedAttributes(effect.before, effect.after), // NEW
        garden = nearest(before, effect.key, 'garden_module'); // NEW
      const budget = can('configureCircleLimits', effect.key) && fields.some(name => /^plant_circle_max_/.test(name)); // NEW
      const layout = type(effect.before, 'planting') && can('managePlanting', effect.key) && (!equal(effect.before.geometry, effect.after.geometry) || fields.some(name => /^(spacing_|plant_count|plant_circle_detail_mode$|disabled_|layout_)/.test(name))); // NEW
      if (garden && (budget || layout)) presentationGardens.add(garden.key); // NEW
    } // NEW
    const derivedPlanting = planting => { // NEW
      const garden = planting && nearest(before, planting.key, 'garden_module'); // NEW
      return !!garden && presentationGardens.has(garden.key); // NEW
    }; // NEW
    const invitation = setup && (policy.store.invites || []).find(invite => invite.pendingUserId === actor && invite.status === 'pending' && invite.expiresAt > at); // NEW
    const invitedScope = id => !!invitation && (invitation.scopeCellIds || []).includes(id); // NEW
    const gardenFor = id => Object.values(policy.cells).find(cell => cell.id === id && flag(cell, 'garden_module')); // NEW
    function roleSynchronization(cell) { // NEW
      const role = cell && chain(after.cells[cell.key] ? after : before, cell.key).find(item => type(item, 'role_card')); // NEW
      if (!role) return false; // NEW
      const oldRole = before.cells[role.key], // NEW
        identity = role.attributes.trellis_role_user_id || oldRole?.attributes.trellis_role_user_id || role.attributes.trellis_role_archived_user_id; // NEW
      const gardenId = role.attributes.trellis_role_garden_module_id || oldRole?.attributes.trellis_role_garden_module_id, // NEW
        garden = gardenFor(gardenId); // NEW
      if (!garden || !identity) return false; // NEW
      if (setup && identity === actor && invitedScope(gardenId)) return true; // NEW
      return can('manageScopeGrants', garden.key) && effects.some(effect => effect.key === garden.key && changedAttributes(effect.before, effect.after).includes(GRANTS) && [...grants(effect.before), ...grants(effect.after)].some(grant => grant.userId === identity)); // NEW
    } // NEW
    function companionSynchronization(cell) { // NEW
      if (!type(cell, 'module')) return false; // NEW
      const garden = gardenFor(cell.attributes.trellis_garden_module_id || cell.attributes.roadmap_garden_module_id); // NEW
      if (!garden || !(setup && invitedScope(garden.id) || effects.some(effect => effect.key === garden.key && changedAttributes(effect.before, effect.after).some(name => name === GRANTS || name === OWNER) && can('manageScopeGrants', garden.key)))) return false; // NEW
      const nextGarden = after.cells[garden.key]; // NEW
      return !!nextGarden && cell.attributes[OWNER] === nextGarden.attributes[OWNER] && equal(parse(cell.attributes[GRANTS], []), parse(nextGarden.attributes[GRANTS], [])); // NEW
    } // NEW
    const removed = new Set(effects.filter(effect => effect.before && !effect.after && can('delete', effect.key)).map(effect => effect.before.id)); // NEW
    return { // NEW
      before, // NEW
      after, // NEW
      actor, // NEW
      at, // NEW
      options, // NEW
      effects, // NEW
      policy, // NEW
      account, // NEW
      setup, // NEW
      can, // NEW
      createAllowed, // NEW
      createdPlantings, // NEW
      derivedPlanting, // NEW
      removed, // NEW
      roleSynchronization, // NEW
      companionSynchronization // NEW
    }; // NEW
  } // NEW

  /** Inspect one object's actual fields; independent concerns cannot bypass each other's checks. */ // NEW
  function validateObjectChange(context, effect) { // NEW
    const { // NEW
      before, // NEW
      after, // NEW
      actor, // NEW
      at, // NEW
      options, // NEW
      effects, // NEW
      policy, // NEW
      account, // NEW
      setup, // NEW
      can, // NEW
      createAllowed, // NEW
      createdPlantings, // NEW
      derivedPlanting, // NEW
      removed, // NEW
      roleSynchronization, // NEW
      companionSynchronization // NEW
    } = context; // NEW
    const { // NEW
        key, // NEW
        before: old, // NEW
        after: next // NEW
      } = effect, // NEW
      cell = old || next, // NEW
      names = changedAttributes(old, next); // NEW
    const ordinary = names.filter(name => !AUDIT.has(name) && name !== STORE && name !== 'createdByUserId'); // NEW
    if (old?.attributes.trellis_project_name !== next?.attributes.trellis_project_name && !account?.admin) return decision(false, 'Only an administrator may rename the project.'); // NEW
    if (next && old?.attributes.trellis_comments_json !== next.attributes.trellis_comments_json && (old?.attributes.trellis_comments_json || next.attributes.trellis_comments_json)) { // NEW
      const editable = old ? can('edit', key) : createAllowed(key), // NEW
        nearestOwner = old && owner(before, key); // NEW
      if (!options.commentsChangeAllowed || !options.commentsChangeAllowed(old?.attributes.trellis_comments_json || '', next?.attributes.trellis_comments_json || '', { // NEW
        enabled: !!policy.store.usersEnabled, // NEW
        user: account, // NEW
        editable, // NEW
        ownerUserId: nearestOwner?.attributes[OWNER] || '' // NEW
      }, at)) return decision(false, 'The comment change is not permitted.'); // NEW
    } // NEW
    if (!policy.store.usersEnabled) return decision(true); // NEW
    if (!account && !setup) return decision(false, 'Log in as an active project user.'); // NEW
    if (!old) { // NEW
      if (!account?.admin && ['plant_circle_max_per_planting', 'plant_circle_max_total'].some(name => cell.attributes[name] != null && cell.attributes[name] !== (name === 'plant_circle_max_per_planting' ? '200' : '1000'))) return decision(false, 'New gardens may initialize only factory circle limits.'); // NEW
      const planting = nearest(after, key, 'planting'), // NEW
        generated = (type(cell, 'tile') || type(cell, 'summary')) && planting && cell.parent === planting.key && cell.vertex && !cell.edge && !cell.source && !cell.target && (createdPlantings.has(planting.key) || can('managePlanting', planting.key) || derivedPlanting(planting)); // NEW
      const invitedRole = roleSynchronization(cell), // NEW
        companion = companionSynchronization(cell); // CHANGE: generated setup is tied to a validated invitation or authorized garden grant change. // NEW
      if (!generated && !invitedRole && !companion && !createAllowed(key)) return decision(false, 'You cannot create this object.'); // NEW
      if (names.some(name => PROTECTED.has(name) && name !== OWNER) && !account?.admin && !invitedRole && !companion && !(type(cell, 'module') && (!cell.attributes[OWNER] || cell.attributes[OWNER] === actor))) return decision(false, 'New object access metadata is not authorized.'); // NEW
      if (cell.attributes[OWNER] && cell.attributes[OWNER] !== actor && !account?.admin && !invitedRole && !companion) return decision(false, 'New objects cannot claim another user as owner.'); // NEW
      return decision(true); // NEW
    } // NEW
    if (!next) { // NEW
      if ((type(old, 'tile') || type(old, 'summary')) && derivedPlanting(nearest(before, key, 'planting'))) return decision(true); // NEW
      if (!can('delete', key)) return decision(false, 'You cannot delete this object.'); // NEW
      return decision(true); // NEW
    } // NEW
    const selfClaim = type(old, 'module') && !policy.cells[key]?.attributes[OWNER] && next.attributes[OWNER] === actor; // NEW
    const roleSync = roleSynchronization(next) && names.every(name => /^trellis_role_/.test(name) || name === 'linkedTo' || AUDIT.has(name)); // NEW
    const companionSync = companionSynchronization(next) && names.every(name => ACCESS.has(name) || name === OWNER || AUDIT.has(name)); // NEW
    const invitationLinks = setup && contentLinksAllowed(old, next); // NEW
    function contentLinksAllowed(oldCell, nextCell) { // NEW
      return names.every(name => name === 'linkedTo' || name === 'trellis_team_module_id' || AUDIT.has(name)) && links(oldCell).every(id => links(nextCell).includes(id)) && links(nextCell).filter(id => !links(oldCell).includes(id)).every(id => { // NEW
        const linked = related(after, nextCell, id); // NEW
        return linked && (roleSynchronization(linked) || companionSynchronization(linked)); // NEW
      }) && (!names.includes('trellis_team_module_id') || companionSynchronization(related(after, nextCell, nextCell.attributes.trellis_team_module_id))); // NEW
    } // NEW
    for (const name of names.filter(name => PROTECTED.has(name) && name !== STORE && !roleSync && !companionSync && !invitationLinks)) { // NEW
      if (name === OWNER || name === 'trellis_role_user_id' ? !selfClaim && !can('transferOwnership', key) : ACCESS.has(name) ? !can('manageScopeGrants', key) : !can('manageAccess', key)) return decision(false, 'Ownership and access changes are not authorized.'); // NEW
      if (name === OWNER && next.attributes[OWNER] && !(after.store.users || []).some(entry => entry.id === next.attributes[OWNER] && !entry.disabled)) return decision(false, 'The new owner must be active.'); // NEW
    } // NEW
    if (names.some(name => name === 'plant_circle_max_per_planting' || name === 'plant_circle_max_total') && !can('configureCircleLimits', key)) return decision(false, 'Only the garden owner or an administrator may configure circle limits.'); // NEW
    if (names.includes('createdByUserId') && !can('manageContent', key)) return decision(false, 'You cannot change task authorship.'); // NEW
    const content = ordinary.filter(name => !PROTECTED.has(name)); // NEW
    const structure = ['style', 'geometry', 'source', 'target', 'collapsed', 'visible', 'order', 'vertex', 'edge', 'root', 'layer', 'model', 'modelContent', 'valueContent'].some(name => !equal(old[name], next[name])); // NEW
    const moved = old.parent !== next.parent; // NEW
    if (moved && !(type(old, 'task') ? can('moveTask', key) : can('delete', key) && (before.cells[next.parent] ? can('add', next.parent) : createAllowed(next.parent)))) return decision(false, 'You cannot move this object between these scopes.'); // NEW
    if (names.includes('lastEditedByUserId') && next.attributes.lastEditedByUserId !== actor || names.includes('trellis_actor_name') && next.attributes.trellis_actor_name !== account?.name || names.includes('trellis_actor_role') && next.attributes.trellis_actor_role !== (account?.admin ? 'admin' : 'regular')) return decision(false, 'Actor metadata does not match the author.'); // NEW
    if (names.some(name => AUDIT.has(name)) && !content.length && !structure && !can('edit', key) && !derivedPlanting(nearest(before, key, 'planting')) && equal(before.store, after.store) && !roleSync && !companionSync && !invitationLinks) return decision(false, 'Actor metadata cannot authorize an otherwise forbidden edit.'); // NEW
    if (!content.length && !structure || !structure && (roleSync || companionSync || invitationLinks)) return decision(true); // CHANGE // NEW
    const planting = nearest(before, key, 'planting'); // NEW
    const navigationCleanup = content.length > 0 && content.every(name => name === 'linkedTo' && links(next).every(id => links(old).includes(id)) && links(old).every(id => links(next).includes(id) || removed.has(id)) || name === 'roadmap_task_ids_json' && parse(next.attributes[name], []).every(id => parse(old.attributes[name], []).includes(id)) && parse(old.attributes[name], []).every(id => parse(next.attributes[name], []).includes(id) || removed.has(id)) || ['roadmap_source_object_id', 'roadmap_source_board_id'].includes(name) && !next.attributes[name] && removed.has(old.attributes.roadmap_source_object_id)); // NEW
    const sourceObject = related(before, old, old.attributes.roadmap_source_object_id), // NEW
      nextSource = sourceObject && after.cells[sourceObject.key]; // NEW
    const oldBoard = sourceObject && nearest(before, sourceObject.key, 'board'), // NEW
      nextBoard = nextSource && nearest(after, nextSource.key, 'board'); // NEW
    const movedSource = sourceObject && effects.some(move => move.before && move.after && move.before.parent !== move.after.parent && chain(before, sourceObject.key).some(ancestor => ancestor.key === move.key) && can('delete', move.key) && can('add', move.after.parent)); // NEW
    const navigationTransfer = content.length === 1 && content[0] === 'roadmap_source_board_id' && oldBoard && nextBoard && oldBoard.key !== nextBoard.key && oldBoard.parent === nextBoard.parent && old.attributes.roadmap_source_board_id === oldBoard.id && next.attributes.roadmap_source_board_id === nextBoard.id && movedSource; // NEW
    const membershipLink = type(old, 'role_card') && content.length === 1 && content[0] === 'linkedTo' && links(old).every(id => links(next).includes(id)) && links(next).filter(id => !links(old).includes(id)).every(id => { // NEW
      const board = related(before, old, id), // NEW
        nextBoard = board && after.cells[board.key]; // NEW
      return type(board, 'board') && can('manageAccess', board.key) && links(nextBoard).includes(old.id); // NEW
    }); // NEW
    if (!structure && content.length && options.referenceChangeAllowed?.(old, next, content) === true) return decision(true); // NEW: the host independently validates these exact domain fields.
    if (!structure && (navigationTransfer || membershipLink)) return decision(true); // NEW
    const derived = planting && derivedPlanting(planting) && content.every(name => PRESENTATION.has(name)) && !structure; // CHANGE
    const generatedStructure = ['parent', 'source', 'target', 'collapsed', 'visible', 'order', 'vertex', 'edge', 'root', 'layer', 'model', 'modelContent', 'valueContent'].every(name => equal(old[name], next[name])); // NEW: generated presentation cannot alter relationships, object types or hidden payloads.
    if ((type(old, 'tile') || type(old, 'summary')) && planting && old.parent === planting.key && generatedStructure && derivedPlanting(planting)) return decision(true); // CHANGE: only direct generated children may receive derived value/style/geometry changes.
    if (!structure && (navigationCleanup || derived)) return decision(true); // NEW
    if (content.length && !(type(old, 'task') ? content.every(name => TASK_DETAILS.has(name)) && can('editTaskDetails', key) || can('manageContent', key) : planting ? can('managePlanting', key) : can('edit', key))) return decision(false, 'You cannot change this object content.'); // NEW
    if (structure && !can('move', key)) return decision(false, 'You cannot change this object structure.'); // NEW

    return decision(true); // NEW
  } // NEW

  /** Orchestrate whole-proposal authorization; a failed object rejects every effect. */ // NEW
  function validateTransition(before, after, actor, at, options = {}) { // NEW
    try { // NEW
      const context = transitionContext(before, after, actor, at, options); // NEW
      if (!equal(before.store, after.store) && !rosterChangeAllowed(context.policy, after, actor, at)) return decision(false, 'The roster change is not authorized.'); // NEW
      for (const effect of context.effects) { // NEW
        const result = validateObjectChange(context, effect); // NEW
        if (!result.allowed) return result; // NEW
      } // NEW
      return decision(true); // NEW
    } catch (_) { // NEW
      return decision(false, 'Invalid permission data or proposal.'); // NEW
    } // NEW
  } // NEW
  root.TrellisPermissionCore = Object.freeze({ // NEW
    CAPABILITIES, // NEW
    parseComments, // NEW
    commentsChangeAllowed, // NEW
    snapshot, // NEW
    authorize, // NEW
    effectiveCapabilities, // NEW
    directCapabilities, // NEW
    activeTeams, // NEW
    authority, // NEW
    changes, // NEW
    validateTransition, // NEW
    rosterChangeAllowed, // NEW
    invitationAcceptance, // NEW
    invitationStatus, // NEW
    type, // NEW
    changedAttributes // NEW
  }); // NEW
})(typeof window !== 'undefined' ? window : globalThis); // NEW
