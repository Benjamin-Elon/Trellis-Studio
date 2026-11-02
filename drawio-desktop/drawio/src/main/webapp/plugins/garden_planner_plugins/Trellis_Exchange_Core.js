/** Exchange domain transitions. Transport supplies verified identity, permissions and durable receipts. */ // NEW
(function (root) { // NEW
    'use strict'; // NEW
    const clone = value => JSON.parse(JSON.stringify(value)); // NEW
    const S = () => root.TrellisSeedsCore; // NEW
    const A = () => root.TrellisAllocationCore; // NEW
    const sameGarden = (a, b) => JSON.stringify([a?.diagramId, a?.pageId || '', a?.gardenId]) === JSON.stringify([b?.diagramId, b?.pageId || '', b?.gardenId]); // NEW
    const assert = (condition, message) => { if (!condition) throw new Error(message); }; // NEW
    const safeId = value => { assert(typeof value === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value), 'Invalid Exchange record identity.'); return value; }; // NEW
    const positive = value => Number.isFinite(Number(value)) && Number(value) > 0; // NEW
    const garden = value => { assert(value && ['diagramId', 'gardenId'].every(key => typeof value[key] === 'string' && value[key]), 'Choose a source or receiving garden.'); return clone(value); }; // NEW
    function empty() { return { version: 1, offers: {}, wants: {}, trades: {}, programs: {}, enrollments: {}, threads: {}, events: [], operations: {} }; } // NEW
    function actorCan(context, ref, capability) { assert(context.can?.(ref, capability), 'You do not have ' + capability + ' access to this garden.'); } // NEW
    function member(context) { assert(context.member, 'Current community membership is required for new listings and requests.'); } // NEW
    function money(value) { // NEW
        assert(value && /^[A-Z]{3}$/.test(value.currency) && Number.isFinite(value.amount) && value.amount >= 0, 'An explicit currency and nonnegative amount are required.'); // NEW
        return { amount: value.amount, currency: value.currency }; // NEW
    } // NEW
    function tradeAccess(trade, context) { // NEW
        return trade.parties.includes(context.identityId) || trade.lines.some(line => context.can?.(line.from, 'manage_seed_exchange') || context.can?.(line.to, 'manage_seed_exchange')); // NEW
    } // NEW
    function csaManager(program, context) { return !!program && (context.identityId === program.operator && context.operatorHasAccess?.(program) === true || context.can?.(program.garden, 'manage_csa')); } // NEW // NEW
    function event(state, operation, recipients, message) { // NEW
        state.events.push({ id: operation.id, recipients: [...new Set(recipients)], message, recordId: operation.target || operation.data?.id, at: operation.at }); // NEW
    } // NEW
    function validateProgram(program) { // NEW
        safeId(program.id); garden(program.garden); assert(program.operator && positive(program.capacity), 'Choose an operator and positive share capacity.'); // NEW
        assert(Number.isSafeInteger(program.year) && program.year >= 1900 && program.year <= 9999, 'Choose a numeric source-plan year.'); // NEW
        assert(typeof program.start === 'string' && typeof program.end === 'string', 'Choose season dates.'); // NEW
        assert(Number(program.start.slice(0, 4)) === Number(program.year), 'The season must be in the source plan year.'); // NEW
        A().pickupDates(program.start, program.end, program.weekday); // NEW
        assert(Array.isArray(program.sizes) && program.sizes.length > 0 && new Set(program.sizes.map(size => size.id)).size === program.sizes.length, 'Define distinct share sizes.'); // NEW
        program.sizes.forEach(size => { assert(size.id && positive(size.multiplier), 'Invalid share multiplier.'); money({ amount: size.price, currency: program.currency }); }); // NEW
        assert(Array.isArray(program.components) && program.components.length > 0, 'Add base-basket components to the plan.'); // NEW
        const cropUnits = new Map(); // NEW
        program.components.forEach(component => { assert(component.cropKey && positive(component.qty) && ['kg', 'plant'].includes(component.unit), 'Convert basket components to kg or plant base units.'); assert(!cropUnits.has(component.cropKey) || cropUnits.get(component.cropKey) === component.unit, 'A crop needs one consistent base unit.'); cropUnits.set(component.cropKey, component.unit); }); // NEW
        assert(typeof program.pickup?.location === 'string' && program.pickup.location.trim() && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(program.pickup.start || '') && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(program.pickup.end || '') && program.pickup.start < program.pickup.end, 'Provide the weekly pickup location and time window.'); // NEW // NEW
        return program; // NEW
    } // NEW
    const programFields = ['name', 'capacity', 'start', 'end', 'weekday', 'sizes', 'components', 'pickup', 'publicPickup', 'area', 'exceptions']; // NEW
    /** Projections originate in the coordinator, never in renderer-supplied allocation arrays. */ // NEW
    function reviseDistributions(program, state, operation, context) { // NEW
        const projection = context.projectCsa?.(clone(program)); // NEW
        assert(projection && typeof projection.sourceRevision === 'string' && projection.supplyByDate && typeof projection.supplyByDate === 'object', 'Expected-yield projection is unavailable.'); // NEW
        for (const [day, crops] of Object.entries(projection.supplyByDate)) { // NEW
            assert(/^\d{4}-\d{2}-\d{2}$/.test(day) && Number(day.slice(0, 4)) === program.year && crops && typeof crops === 'object' && !Array.isArray(crops), 'Invalid expected-yield date.'); // NEW
            for (const quantity of Object.values(crops)) assert(typeof quantity === 'number' && Number.isFinite(quantity) && quantity >= 0, 'Invalid expected-yield quantity.'); // NEW
        } // NEW
        const members = Object.values(state.enrollments).filter(row => row.programId === program.id), today = new Date(operation.at).toISOString().slice(0, 10); // NEW
        const fixed = { ...Object.fromEntries(Object.entries(program.distributions || {}).filter(([day]) => day < today)), ...program.completed }; // NEW
        const distributions = Object.fromEntries(A().schedule(program, projection.supplyByDate, members, fixed).filter(row => row.date >= today || fixed[row.date]).map(row => [row.date, row])); // NEW
        const changed = JSON.stringify(program.distributions || {}) !== JSON.stringify(distributions); // NEW
        program.distributions = distributions; program.sourceRevision = projection.sourceRevision; return { changed, members }; // NEW
    } // NEW
    /** Preserve the entire term snapshot and pickup quote before each accepted prospective revision. */ // NEW
    function updateTerms(program, state, data, operation, context) { // NEW
        const today = new Date(operation.at).toISOString().slice(0, 10); // NEW
        assert(typeof data.effectiveDate === 'string' && data.effectiveDate > today && Number(data.effectiveDate.slice(0, 4)) === program.year, 'Choose a future effective date in the source plan year.'); // NEW
        A().pickupDates(data.effectiveDate, data.effectiveDate, 0); // NEW: validate date-only input without local timezone conversion.
        assert(data.terms && typeof data.terms === 'object' && Object.keys(data.terms).every(key => programFields.includes(key)) && Object.keys(data).every(key => ['effectiveDate', 'terms', 'notify'].includes(key)), 'Unsupported CSA term change.'); // NEW
        const before = A().programAt(program, data.effectiveDate), candidate = validateProgram({ ...before, ...data.terms }); // NEW
        const changed = Object.keys(data.terms).some(key => JSON.stringify(before[key]) !== JSON.stringify(candidate[key])); // NEW
        if (!changed) return; // NEW
        assert(!(program.termChanges || []).some(row => row.effectiveDate >= data.effectiveDate), 'Apply revisions in increasing effective-date order.'); // NEW
        assert(!Object.keys(program.completed).some(day => day >= data.effectiveDate), 'Completed pickups cannot be revised.'); // NEW
        const members = Object.values(state.enrollments).filter(row => row.programId === program.id && row.status === 'accepted'); // NEW
        const previousQuotes = Object.fromEntries(members.map(row => [row.id, A().quote(program, row)])); // NEW
        program.termChanges ||= []; program.termChanges.push({ effectiveDate: data.effectiveDate, actor: context.identityId, at: operation.at, terms: clone(data.terms), previousTerms: Object.fromEntries(programFields.map(key => [key, before[key]])), previousQuotes }); // NEW
        assert(A().capacity(program, members).valid, 'CSA capacity cannot be lower than confirmed commitments.'); // NEW
        for (const member of members) { member.quoteHistory ||= []; member.quoteHistory.push({ at: operation.at, effectiveDate: data.effectiveDate, quote: clone(member.quote) }); member.quote = A().quote(program, member); } // NEW
        reviseDistributions(program, state, operation, context); // NEW
        if (data.notify !== false) event(state, operation, members.map(row => row.member), 'Future CSA terms updated'); // NEW
    } // NEW
    /** Operators approve member requests or apply their own future changes without a member countersignature. */ // NEW
    function commitEnrollmentChange(enrollment, program, amendment, state, operation, context) { // NEW
        const change = clone(amendment); delete change.approvals; delete change.notify; // NEW
        assert(!(enrollment.changes || []).some(row => row.effectiveDate >= change.effectiveDate), 'Apply enrollment changes in increasing effective-date order.'); // NEW
        const amended = { ...enrollment, changes: [...(enrollment.changes || []), change] }; // NEW
        assert(A().capacity(program, Object.values(state.enrollments).filter(row => row.programId === program.id), amended, enrollment.id).valid, 'CSA capacity exceeded.'); // NEW
        assert(context.capacityVerified?.(program, amended), 'Waiting for amended capacity confirmation.'); // NEW
        enrollment.quoteHistory ||= []; enrollment.quoteHistory.push({ at: operation.at, effectiveDate: change.effectiveDate, quote: clone(enrollment.quote) }); // NEW
        enrollment.changes = amended.changes; enrollment.quote = A().quote(program, enrollment); delete enrollment.amendment; // NEW
        reviseDistributions(program, state, operation, context); // NEW
        if (amendment.notify !== false) event(state, operation, [enrollment.member, program.operator], 'Future CSA enrollment updated'); // NEW
    } // NEW
    /** Inputs are copied; an invalid transition cannot partially mutate accepted domain state. */ // NEW
    function apply(input, operation, context) { // NEW
        assert(input?.version === 1 && operation?.id && context?.identityId, 'Invalid Exchange operation.'); // NEW
        const state = clone(input), data = clone(operation.data || {}), actor = context.identityId; // NEW
        safeId(operation.id); if (operation.target != null) safeId(operation.target); // NEW
        for (const name of ['id', 'programId', 'wantId', 'offerId']) if (data[name] != null) safeId(data[name]); // NEW
        const fingerprint = JSON.stringify(operation); // NEW
        if (state.operations[operation.id]) { assert(state.operations[operation.id] === fingerprint, 'Conflicting operation ID.'); return state; } // NEW
        const target = operation.target; // NEW
        switch (operation.kind) { // NEW
        case 'offer.publish': { // NEW
            member(context); actorCan(context, garden(data.garden), 'manage_seed_exchange'); // NEW
            assert(data.id && S().key(data) && Number.isSafeInteger(data.seeds) && data.seeds > 0, 'Offer a positive whole seed count.'); // NEW
            assert(['sale', 'barter', 'gift'].includes(data.terms?.kind), 'Choose sale, barter or gift.'); // NEW
            if (data.terms.kind === 'sale') data.terms.price = money(data.terms.price); // NEW
            const prior = state.offers[data.id]; // NEW
            if (prior) assert(sameGarden(prior.garden, data.garden), 'An offer cannot change its source garden.'); // NEW
            state.offers[data.id] = { ...data, owner: prior?.owner || actor, visible: true }; break; // NEW
        } // NEW
        case 'offer.withdraw': // NEW
            assert(state.offers[target], 'Offer not found.'); actorCan(context, state.offers[target].garden, 'manage_seed_exchange'); state.offers[target].visible = false; break; // NEW
        case 'want.publish': // NEW
            member(context); actorCan(context, garden(data.garden), 'manage_seed_exchange'); // NEW
            assert(data.id && data.cropRef && Number.isSafeInteger(data.seeds) && data.seeds > 0, 'Choose a crop and requested seed quantity.'); // NEW
            if (state.wants[data.id]) assert(sameGarden(state.wants[data.id].garden, data.garden), 'A request cannot change its receiving garden.'); // NEW // NEW
            state.wants[data.id] = { ...data, owner: state.wants[data.id]?.owner || actor, visible: true }; break; // NEW
        case 'want.withdraw': // NEW
            assert(state.wants[target]?.owner === actor || context.can?.(state.wants[target]?.garden, 'manage_seed_exchange'), 'Only an authorized requester may withdraw this request.'); // NEW
            state.wants[target].visible = false; break; // NEW
        case 'trade.propose': { // NEW
            member(context); // NEW
            assert(data.id && Array.isArray(data.lines) && data.lines.length && Array.isArray(data.parties) && data.parties.includes(actor) && new Set(data.parties).size === 2, 'A trade needs two parties and seed lines.'); // NEW
            assert(!state.trades[data.id], 'Trade already exists.'); // NEW
            for (const line of data.lines) { // NEW
                garden(line.from); garden(line.to); S().key(line); // NEW
                assert(!sameGarden(line.from, line.to) && Number.isSafeInteger(line.seeds) && line.seeds > 0, 'Invalid seed handover.'); // NEW
            } // NEW
            assert(data.lines.some(line => context.can?.(line.from, 'manage_seed_exchange') || context.can?.(line.to, 'manage_seed_exchange')), 'Choose an authorized receiving garden.'); // NEW
            if (data.price) data.price = money(data.price); // NEW
            state.trades[data.id] = { ...data, approvals: [actor], status: 'delivered', handovers: [], receipts: [] }; // NEW
            state.threads[data.id] = []; event(state, operation, data.parties, 'Seed trade proposed'); break; // NEW
        } // NEW
        case 'trade.accept': { // NEW
            const trade = state.trades[target]; assert(trade && tradeAccess(trade, context), 'Trade not found or access denied.'); // NEW
            assert(['delivered', 'awaiting-validation'].includes(trade.status), 'This trade cannot be accepted.'); // NEW
            const party = data.party || actor; // NEW
            assert(trade.parties.includes(party) && (party === actor || context.canRepresent?.(trade, party) === true), 'Only a participant or their verified garden manager may approve.'); // NEW
            if (!trade.approvals.includes(party)) trade.approvals.push(party); // NEW
            trade.status = 'awaiting-validation'; event(state, operation, trade.parties, 'Trade awaiting stock validation'); break; // NEW
        } // NEW
        case 'trade.commit': { // NEW
            const trade = state.trades[target]; assert(trade && trade.status === 'awaiting-validation', 'No trade awaiting acceptance.'); // NEW
            assert(trade.parties.every(party => trade.approvals.includes(party)), 'Both participants must approve these terms.'); // NEW
            if (trade.wantId) { const want = state.wants[trade.wantId]; assert(want, 'Requested seeds are unavailable.'); const incoming = trade.lines.filter(line => sameGarden(line.to, want.garden) && line.cropRef === want.cropRef).reduce((sum, line) => sum + line.seeds, 0); assert(incoming > 0 && incoming <= matches(state, want).remaining, 'This partial trade exceeds the remaining request.'); assert(trade.lines.every((line, index) => !sameGarden(line.to, want.garden) || !want.varietyRef || line.varietyRef === want.varietyRef || trade.substitutions?.includes(index)), 'Approve each variety substitution explicitly.'); } // NEW
            assert(context.reservationsVerified?.(trade), 'Waiting for durable reservations from every source garden.'); // NEW
            trade.status = 'accepted'; event(state, operation, trade.parties, 'Seed trade accepted'); break; // NEW
        } // NEW
        case 'trade.cancel': { // NEW
            const trade = state.trades[target]; assert(trade && tradeAccess(trade, context), 'Trade access denied.'); // NEW
            if (trade.status === 'cancelled') break; // NEW
            assert(!trade.handovers.length && trade.status !== 'completed', 'Handover has begun; resolve the existing agreement.'); // NEW
            assert(context.releaseVerified?.(trade), 'Waiting for reservation release.'); // NEW
            trade.status = 'cancelled'; event(state, operation, trade.parties, 'Seed trade cancelled'); break; // NEW
        } // NEW
        case 'trade.handover': // NEW
        case 'trade.receive': { // NEW
            const trade = state.trades[target], receive = operation.kind === 'trade.receive', index = Number(data.line); // NEW
            assert(trade && ['accepted', 'handing-over', 'completed'].includes(trade.status) && trade.lines[index], 'No accepted seed line.'); // NEW
            actorCan(context, trade.lines[index][receive ? 'to' : 'from'], 'manage_seed_exchange'); // NEW
            assert(context.inventoryReceiptVerified?.(trade, index, receive), 'Waiting for the garden inventory receipt.'); // NEW
            const list = receive ? trade.receipts : trade.handovers; // NEW
            if (receive) assert(trade.handovers.includes(index), 'The source has not recorded handover.'); // NEW
            if (list.includes(index)) break; // NEW: repeated observations do not create another activity event.
            list.push(index); // NEW
            trade.status = trade.receipts.length === trade.lines.length ? 'completed' : 'handing-over'; // NEW
            event(state, operation, trade.parties, receive ? 'Seeds received' : 'Seeds handed over'); break; // NEW
        } // NEW
        case 'csa.publish': { // NEW
            member(context); actorCan(context, garden(data.garden), 'publish_csa'); validateProgram(data); // NEW
            assert(Object.keys(data).every(key => ['id', 'garden', 'year', 'operator', 'currency', ...programFields].includes(key)), 'Unsupported program publication field.'); // NEW
            const existing = Object.values(state.programs).find(program => sameGarden(program.garden, data.garden) && program.year === data.year); // NEW
            assert(!existing || existing.id === data.id, 'This plan already has a CSA program.'); // NEW
            assert(!state.programs[data.id] || existing?.id === data.id, 'Program identity is already in use.'); // NEW
            assert(context.operatorAuthorized?.(data) === true, 'The designated operator needs current garden access.'); // NEW
            assert(A().capacity(data, Object.values(state.enrollments).filter(row => row.programId === data.id)).valid, 'CSA capacity cannot be lower than confirmed commitments.'); // NEW
            if (existing) { assert(existing.status !== 'ended', 'An ended program cannot be reopened.'); assert(existing.operator === data.operator, 'Changing the operator requires ending the program.'); for (const name of ['currency', ...programFields.filter(key => key !== 'capacity')]) assert(JSON.stringify(existing[name]) === JSON.stringify(data[name]), 'Use a prospective terms revision to change this program.'); if (existing.capacity !== data.capacity) assert(!(existing.termChanges || []).length, 'Use a prospective terms revision to change this program.'); } // CHANGE
            if (existing && existing.capacity === data.capacity && existing.visible) break; // NEW
            state.programs[data.id] = { ...existing, ...data, status: 'active', visible: true, completed: existing?.completed || {} }; // NEW
            event(state, operation, [data.operator], 'CSA season published'); break; // NEW
        } // NEW
        case 'csa.withdraw': { // NEW
            const program = state.programs[target]; assert(program && csaManager(program, context), 'CSA access denied.'); // NEW
            program.visible = false; break; // NEW
        } // NEW
        case 'csa.update': { // NEW
            const program = state.programs[target]; assert(program?.status === 'active' && csaManager(program, context), 'CSA management access required.'); // NEW
            updateTerms(program, state, data, operation, context); break; // NEW
        } // NEW
        case 'csa.request': { // NEW
            member(context); const program = state.programs[data.programId]; assert(program?.status === 'active', 'This CSA is not accepting requests.'); // NEW
            assert(data.id && !state.enrollments[data.id] && !state.threads[data.id], 'Enrollment identity is already in use.'); // NEW: a request cannot replace an accepted member or another agreement thread.
            assert(data.id && !Object.values(state.enrollments).some(row => row.programId === program.id && row.member === actor && !['ended', 'denied'].includes(row.status)), 'Change your existing enrollment instead.'); // NEW
            assert(Object.keys(data).every(key => ['id', 'programId', 'sizeId', 'count', 'from', 'to', 'contribution'].includes(key)), 'Share requests use the published distribution price.'); // CHANGE
            const terms = A().quote(program, data); // NEW
            state.enrollments[data.id] = { ...data, currency: program.currency, member: actor, status: 'requested', quote: terms }; // CHANGE
            state.threads[data.id] = []; event(state, operation, [program.operator], 'CSA share requested'); break; // NEW
        } // NEW
        case 'csa.decide': { // NEW
            const enrollment = state.enrollments[target], program = state.programs[enrollment?.programId]; // NEW
            assert(program?.status === 'active' && csaManager(program, context), 'CSA management access required.'); // NEW
            assert(enrollment.status === 'requested', 'This request has already been decided.'); // NEW
            if (data.accept) { // NEW
                assert(A().capacity(program, Object.values(state.enrollments).filter(row => row.programId === program.id), enrollment).valid, 'CSA capacity exceeded.'); // NEW
                assert(context.capacityVerified?.(program, enrollment), 'Waiting for authoritative capacity confirmation.'); // NEW
            } // NEW
            enrollment.status = data.accept ? 'accepted' : 'denied'; // NEW
            enrollment.acceptedTerms = clone({ quote: enrollment.quote, sizeId: enrollment.sizeId, count: enrollment.count, from: enrollment.from || program.start, to: enrollment.to || program.end, contribution: enrollment.contribution || '' }); // NEW
            event(state, operation, [enrollment.member], data.accept ? 'CSA share accepted' : 'CSA request declined'); break; // NEW
        } // NEW
        case 'csa.amend': { // NEW
            const enrollment = state.enrollments[target], program = state.programs[enrollment?.programId]; // NEW
            assert(enrollment?.status === 'accepted' && (enrollment.member === actor || csaManager(program, context)), 'Enrollment access denied.'); // NEW
            const future = A().programAt(program, data.effectiveDate); // NEW
            assert(typeof data.effectiveDate === 'string' && data.effectiveDate > new Date(operation.at).toISOString().slice(0, 10) && data.effectiveDate >= future.start && data.effectiveDate <= future.end, 'Choose a future effective date within this season.'); // CHANGE
            A().pickupDates(data.effectiveDate, data.effectiveDate, 0); // NEW
            assert(Object.keys(data).every(key => ['effectiveDate', 'sizeId', 'count', 'from', 'to', 'contribution', 'cancel', 'distributionPrice', 'notify'].includes(key)), 'Unsupported enrollment change.'); // CHANGE
            assert(!Object.keys(program.completed).some(day => day >= data.effectiveDate), 'Completed pickups cannot be revised.'); // NEW
            const priorTerms = A().enrollmentAt(enrollment, data.effectiveDate), from = [data.effectiveDate, data.from || priorTerms.from || program.start].sort().at(-1); // NEW
            const proposal = { ...priorTerms, ...data, from }, replaces = A().quote(program, { ...priorTerms, from }); // NEW
            const quote = data.cancel ? { dates: [], amount: 0, currency: program.currency, equivalents: 0 } : A().quote(program, proposal); // NEW
            const amendment = { ...data, actor, at: operation.at, quote, replaces, priceDifference: quote.amount - replaces.amount }; // NEW
            if (csaManager(program, context)) commitEnrollmentChange(enrollment, program, amendment, state, operation, context); // NEW
            else { enrollment.amendment = amendment; event(state, operation, [program.operator], 'CSA amendment requested'); } break; // CHANGE
        } // NEW
        case 'csa.amend.accept': { // NEW
            const enrollment = state.enrollments[target], program = state.programs[enrollment?.programId], amendment = enrollment?.amendment; // NEW
            assert(amendment && csaManager(program, context), 'The operator approves enrollment requests.'); // CHANGE
            assert(amendment.effectiveDate > new Date(operation.at).toISOString().slice(0, 10), 'Choose a future effective date before approving this request.'); // NEW
            commitEnrollmentChange(enrollment, program, amendment, state, operation, context); break; // CHANGE
        } // NEW
        case 'csa.revise': { // NEW
            const program = state.programs[target]; assert(program?.status === 'active' && csaManager(program, context), 'CSA access denied.'); // NEW
            assert(Object.keys(data).every(key => ['notify'].includes(key)), 'CSA allocations require a trusted expected-yield projection; use the terms command for program changes.'); // CHANGE
            const { changed, members } = reviseDistributions(program, state, operation, context); // CHANGE
            if (changed && data.notify !== false) event(state, operation, members.filter(row => row.status === 'accepted').map(row => row.member), 'Future CSA allocations updated'); break; // CHANGE
        } // NEW
        case 'csa.collect': { // NEW
            const enrollment = state.enrollments[target], program = state.programs[enrollment?.programId]; // NEW
            assert(enrollment?.status === 'accepted' && program.distributions?.[data.date] && A().quote(program, A().enrollmentAt(enrollment, data.date)).dates.includes(data.date) && !A().enrollmentAt(enrollment, data.date).cancel && (program.status === 'active' || data.date <= program.endedDate), 'No allocation for this pickup.'); // CHANGE: a quote alone is not a scheduled expected distribution.
            assert(actor === enrollment.member || csaManager(program, context), 'Collection access denied.'); // NEW
            assert(!data.confirm || csaManager(program, context), 'The operator confirms collection.'); // NEW
            program.collections ||= {}; // NEW
            const id = enrollment.id + ':' + data.date; // NEW
            if (program.collections[id] === 'confirmed' || program.collections[id] === 'reported' && !data.confirm) break; // NEW
            program.collections[id] = data.confirm ? 'confirmed' : 'reported'; // NEW
            if (data.confirm && program.distributions?.[data.date]) program.completed[data.date] = clone(program.distributions[data.date]); // NEW
            event(state, operation, [enrollment.member, program.operator], data.confirm ? 'CSA collection confirmed' : 'CSA collection reported'); break; // NEW
        } // NEW
        case 'csa.end': { // NEW
            const program = state.programs[target]; assert(program && (csaManager(program, context) || context.operatorDepartureVerified?.(program)), 'CSA access denied.'); // NEW
            if (program.status === 'ended') break; // NEW: closure's original effective date and announcement are immutable.
            program.status = 'ended'; program.visible = false; program.endedDate = new Date(operation.at).toISOString().slice(0, 10); // NEW
            if (program.distributions) program.distributions = Object.fromEntries(Object.entries(program.distributions).filter(([day]) => day <= program.endedDate || program.completed[day])); // NEW // NEW
            event(state, operation, Object.values(state.enrollments).filter(row => row.programId === program.id).map(row => row.member), 'CSA program ended'); break; // NEW
        } // NEW
        case 'message': { // NEW
            const trade = state.trades[target], enrollment = state.enrollments[target], program = state.programs[enrollment?.programId]; // NEW
            assert(trade && tradeAccess(trade, context) || enrollment && (enrollment.member === actor || program.operator === actor || csaManager(program, context)), 'Private thread access denied.'); // NEW
            assert(typeof data.text === 'string' && data.text.trim() && data.text.length <= 10000, 'Enter a message of at most 10,000 characters.'); // NEW
            state.threads[target].push({ id: operation.id, actor, text: data.text, at: operation.at }); // NEW
            event(state, operation, trade?.parties || [enrollment.member, program.operator], 'New private message'); break; // NEW
        } // NEW
        default: throw new Error('Unsupported Exchange operation.'); // NEW
        } // NEW
        state.operations[operation.id] = fingerprint; return state; // NEW
    } // NEW
    function matches(state, want) { // NEW
        let committed = 0, received = 0; // NEW
        for (const trade of Object.values(state.trades).filter(trade => trade.wantId === want.id)) for (let index = 0; index < trade.lines.length; index++) { // NEW
            const line = trade.lines[index]; if (!sameGarden(line.to, want.garden) || line.cropRef !== want.cropRef) continue; // NEW
            if (trade.receipts.includes(index)) received += line.seeds; // NEW
            else if (['accepted', 'handing-over'].includes(trade.status)) committed += line.seeds; // NEW
        } // NEW
        const remaining = Math.max(0, want.seeds - committed - received); // NEW
        return { remaining, committed, received, offers: remaining ? Object.values(state.offers).filter(offer => offer.visible && offer.cropRef === want.cropRef && !sameGarden(offer.garden, want.garden)).map(offer => ({ ...offer, substitution: !!want.varietyRef && offer.varietyRef !== want.varietyRef })).sort((a, b) => Number(a.substitution) - Number(b.substitution) || a.id.localeCompare(b.id, 'en')) : [] }; // NEW
    } // NEW
    /** Never expose financial terms, member lists or private threads through discovery. */ // NEW
    function discovery(state) { // NEW
        return { offers: Object.values(state.offers).filter(row => row.visible).map(row => { const copy = clone(row); if (!copy.publicPickup) delete copy.pickup; return copy; }), // NEW
            wants: Object.values(state.wants).filter(row => row.visible), // NEW
            programs: Object.values(state.programs).filter(row => row.visible && row.status === 'active').map(row => { // NEW
                const { id, name, garden, year, start, end, weekday, currency, sizes, capacity, area, operator, publicPickup, pickup } = row; // NEW
                return { id, name, garden, year, start, end, weekday, currency, sizes, capacity, area, operator, ...(publicPickup ? { pickup } : {}) }; // NEW
            }) }; // NEW
    } // NEW
    root.TrellisExchangeCore = Object.freeze({ empty, apply, matches, discovery, validateProgram, sameGarden }); // NEW
})(typeof window !== 'undefined' ? window : globalThis); // NEW
