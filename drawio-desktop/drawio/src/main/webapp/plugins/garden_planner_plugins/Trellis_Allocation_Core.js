/** Pure harvest allocation and CSA arithmetic; shared by planning and distribution views. */ // NEW
(function (root) { // NEW
    'use strict'; // NEW
    const positive = value => Math.max(0, Number(value) || 0); // NEW
    const clone = value => JSON.parse(JSON.stringify(value)); // NEW
    function level(value, fallback = 3) { // NEW
        return Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback; // NEW
    } // NEW
    /** Stable channel keys keep user-created channel IDs separate from built-in channels. */ // NEW
    function priorities(plan) { // NEW
        const saved = plan.channelPriorityLevels || {}; // NEW
        return Object.fromEntries([['self', level(saved.self, 1)], ['csa', level(saved.csa, 2)], // NEW
            ...(plan.demandChannels || []).map(channel => ['sales:' + channel.id, level(saved['sales:' + channel.id])])]); // NEW
    } // NEW
    /** Proportionally fill each priority level, preserving mass and each request's ceiling. */ // NEW
    function allocate(supply, requests) { // NEW
        let remaining = positive(supply); // NEW
        const rows = requests.map(request => ({ ...request, demand: positive(request.demand), level: level(request.level), allocated: 0 })); // NEW
        for (const rank of [...new Set(rows.map(row => row.level))].sort((a, b) => a - b)) { // NEW
            const peers = rows.filter(row => row.level === rank), demand = peers.reduce((sum, row) => sum + row.demand, 0); // NEW
            const used = Math.min(remaining, demand), ratio = demand > 0 ? used / demand : 0; // NEW
            peers.forEach(row => { row.allocated = row.demand * ratio; }); // NEW
            remaining = Math.max(0, remaining - used); // NEW
        } // NEW
        return { rows, remaining }; // NEW
    } // NEW
    /** Rounding applies after combining a member's shares, before combining members. */ // NEW
    function memberQuantity(quantity, multiplier, count, unit) { // NEW
        const total = positive(quantity) * positive(multiplier) * positive(count); // NEW
        return unit === 'plant' ? Math.ceil(total - 1e-9) : total; // NEW
    } // NEW
    /** Whole units go to the most under-served eligible member; stable IDs break equal deficits. */ // NEW
    function fairWhole(supply, requests, previous = {}) { // NEW
        const rows = requests.map(row => ({ ...row, demand: Math.ceil(positive(row.demand)), allocated: 0 })); // NEW
        const target = rows.reduce((sum, row) => sum + row.demand, 0), available = Math.min(Math.floor(positive(supply)), target); // NEW
        for (let unit = 0; unit < available; unit++) { // NEW
            const eligible = rows.filter(row => row.allocated < row.demand); // NEW
            eligible.sort((a, b) => { // NEW
                const deficit = row => positive(previous[row.id]?.requested) + row.demand - positive(previous[row.id]?.received) - row.allocated; // NEW
                return deficit(b) / Math.max(1, positive(previous[b.id]?.requested) + b.demand) // NEW
                    - deficit(a) / Math.max(1, positive(previous[a.id]?.requested) + a.demand) || String(a.id).localeCompare(String(b.id), 'en'); // NEW
            }); // NEW
            eligible[0].allocated++; // NEW
        } // NEW
        const history = Object.assign(Object.create(null), clone(previous)); // NEW: member IDs are data, never object prototypes. // NEW
        rows.forEach(row => { history[row.id] = { requested: positive(previous[row.id]?.requested) + row.demand, received: positive(previous[row.id]?.received) + row.allocated }; }); // NEW
        return { rows, history, remaining: Math.max(0, Math.floor(positive(supply)) - available) }; // NEW
    } // NEW
    function date(value) { // NEW
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error('Use a calendar date.'); // NEW
        const result = new Date(value + 'T12:00:00Z'); // NEW
        if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date.'); // NEW
        return result; // NEW
    } // NEW
    /** UTC arithmetic avoids daylight-saving shifts while retaining date-only pickup identities. */ // NEW
    function pickupDates(start, end, weekday) { // NEW
        const first = date(start), last = date(end); // NEW
        if (start > end || start.slice(0, 4) !== end.slice(0, 4)) throw new Error('A CSA season must stay within one plan year.'); // NEW
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error('Choose a pickup weekday.'); // NEW
        first.setUTCDate(first.getUTCDate() + (weekday - first.getUTCDay() + 7) % 7); // NEW
        const dates = []; // NEW
        for (let cursor = first; cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 7)) dates.push(cursor.toISOString().slice(0, 10)); // NEW
        return dates; // NEW
    } // NEW
    /** Accepted changes apply prospectively; the original enrollment remains available for historical dates. */ // NEW
    function enrollmentAt(enrollment, day) { // NEW
        let result = { ...enrollment }; // NEW
        for (const change of [...(enrollment.changes || [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))) if (change.effectiveDate <= day) result = { ...result, ...change }; // NEW
        return result; // NEW
    } // NEW
    /** Operator revisions are prospective views; accepted history is never rewritten in place. */ // NEW
    function programAt(program, day) { // NEW
        let result = { ...program }; // NEW
        for (const revision of [...(program.termChanges || [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))) { // NEW
            if (revision.effectiveDate <= day) result = { ...result, ...revision.terms }; // NEW
        } // NEW
        return result; // NEW
    } // NEW
    /** Union revised calendars, then retain only dates that belong to the applicable version. */ // NEW
    function programDates(program) { // NEW
        const candidates = new Set(); let version = program; // NEW
        for (const revision of [null, ...(program.termChanges || [])]) { // NEW
            if (revision) version = { ...version, ...revision.terms }; // NEW
            pickupDates(version.start, version.end, version.weekday).forEach(day => candidates.add(day)); // NEW
        } // NEW
        return [...candidates].sort().filter(day => { const terms = programAt(program, day); return day >= terms.start && day <= terms.end && date(day).getUTCDay() === terms.weekday && (!program.endedDate || day <= program.endedDate); }); // NEW
    } // NEW
    function quote(program, enrollment) { // NEW
        if (enrollment.from) date(enrollment.from); if (enrollment.to) date(enrollment.to); // NEW
        const versions = [program, ...(program.termChanges || []).map(row => programAt(program, row.effectiveDate))]; // NEW
        const start = versions.map(row => row.start).sort()[0], end = versions.map(row => row.end).sort().at(-1); // NEW
        if (enrollment.from && enrollment.from < start || enrollment.to && enrollment.to > end || (enrollment.from || start) > (enrollment.to || end)) throw new Error('Enrollment dates must stay within this season.'); // CHANGE
        const dates = [], prices = []; let equivalents = 0; // NEW
        for (const day of programDates(program)) { // NEW
            const terms = programAt(program, day), member = enrollmentAt(enrollment, day), size = terms.sizes.find(row => row.id === member.sizeId); // NEW
            if (member.cancel || day < (member.from || start) || day > (member.to || end) || terms.exceptions?.[day]?.cancelled) continue; // NEW
            if (!size || !Number.isSafeInteger(member.count) || member.count < 1) throw new Error('Choose a share size and whole share count.'); // NEW
            const price = Number(member.distributionPrice ?? size.price); if (!Number.isFinite(price) || price < 0) throw new Error('Choose a nonnegative distribution price.'); // NEW
            dates.push(day); prices.push(price * member.count); equivalents = Math.max(equivalents, positive(size.multiplier) * member.count); // NEW
        } // NEW
        if (!dates.length) { const size = programAt(program, enrollment.from || start).sizes.find(row => row.id === enrollment.sizeId); if (!size || !Number.isSafeInteger(enrollment.count) || enrollment.count < 1) throw new Error('Choose a share size and whole share count.'); equivalents = positive(size.multiplier) * enrollment.count; } // NEW
        return { dates, currency: enrollment.currency || program.currency, amount: Math.round(prices.reduce((sum, price) => sum + price, 0) * 1e8) / 1e8, equivalents }; // CHANGE
    } // NEW
    /** Evaluate dated capacity commitments without combining them with the capacity planning target. */ // NEW
    function capacity(program, enrollments, candidate, replacingId) { // NEW
        const accepted = enrollments.filter(row => row.status === 'accepted' && row.id !== replacingId); // NEW
        if (candidate) accepted.push({ ...candidate, status: 'accepted' }); // NEW
        const dates = programDates(program).map(day => { // CHANGE
            const terms = programAt(program, day); // NEW
            const equivalents = accepted.map(row => enrollmentAt(row, day)).filter(row => !row.cancel && day >= (row.from || terms.start) && day <= (row.to || terms.end) && !terms.exceptions?.[day]?.cancelled).reduce((sum, row) => { const size = terms.sizes.find(size => size.id === row.sizeId); if (!size) throw new Error('An accepted share size is missing.'); return sum + positive(size.multiplier) * row.count; }, 0); // CHANGE
            return { date: day, equivalents, over: Math.max(0, equivalents - positive(terms.capacity)) }; // CHANGE
        }); // NEW
        return { dates, maximum: Math.max(0, ...dates.map(row => row.equivalents)), valid: dates.every(row => row.over < 1e-9) }; // NEW
    } // NEW
    /** Generate a fresh prospective schedule, retaining operator-confirmed distributions verbatim. */ // NEW
    function schedule(program, supplyByDate, enrollments, completed = {}) { // NEW
        const history = Object.create(null), distributions = []; // NEW // NEW
        for (const day of [...new Set([...programDates(program), ...Object.keys(completed)])].sort()) { // CHANGE: completed pickups survive calendar revisions and closure.
            if (completed[day]) { // NEW
                const prior = clone(completed[day]); // NEW
                for (const item of prior.items || []) for (const row of item.allocations || []) { // NEW
                    const key = item.cropKey, previous = (history[key] ||= {})[row.id] || { requested: 0, received: 0 }; // NEW
                    history[key][row.id] = { requested: previous.requested + row.demand, received: previous.received + row.allocated }; // NEW
                } // NEW
                distributions.push(prior); continue; // NEW
            } // NEW
            const terms = programAt(program, day); // NEW
            if (terms.exceptions?.[day]?.cancelled) { distributions.push({ date: day, cancelled: true, items: [] }); continue; } // CHANGE
            const eligible = enrollments.map(row => enrollmentAt(row, day)).filter(row => row.status === 'accepted' && !row.cancel && day >= (row.from || terms.start) && day <= (row.to || terms.end)); // CHANGE
            const components = new Map(); // NEW
            for (const component of terms.components) { // CHANGE
                if (day < (component.start || terms.start) || day > (component.end || terms.end)) continue; // CHANGE
                const relativeWeek = Math.floor((date(day) - date(component.start || terms.start)) / 604800000); // CHANGE
                if (relativeWeek % Math.max(1, Number(component.everyNWeeks) || 1)) continue; // NEW
                const key = component.cropKey + ':' + component.unit; // NEW
                const combined = components.get(key) || { ...component, qty: 0 }; // NEW
                combined.qty += positive(component.qty); components.set(key, combined); // NEW
            } // NEW
            const items = [...components.values()].map(component => { // NEW
                const requests = eligible.map(member => { // NEW
                    const size = terms.sizes.find(row => row.id === member.sizeId); // CHANGE
                    return { id: member.id, demand: memberQuantity(component.qty, size?.multiplier, member.count, component.unit), level: 1 }; // NEW
                }); // NEW
                const available = positive(supplyByDate[day]?.[component.cropKey]); // NEW
                const allocated = component.unit === 'plant' ? fairWhole(available, requests, history[component.cropKey] || {}) : allocate(available, requests); // NEW
                if (allocated.history) history[component.cropKey] = allocated.history; // NEW
                return { ...component, allocations: allocated.rows }; // NEW
            }); // NEW
            distributions.push({ date: day, basis: 'scheduled-plantings', items, collection: {} }); // NEW
        } // NEW
        return distributions; // NEW
    } // NEW
    root.TrellisAllocationCore = Object.freeze({ priorities, allocate, fairWhole, memberQuantity, pickupDates, programDates, programAt, enrollmentAt, quote, capacity, schedule }); // CHANGE
})(typeof window !== 'undefined' ? window : globalThis); // NEW
