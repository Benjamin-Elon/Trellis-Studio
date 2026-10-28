/** Request-driven editor lifetimes and the non-modal handoff countdown. */ // NEW
(function (root) { // NEW
    'use strict'; // NEW
    const intersects = (a, b) => a.includes('*') || b.includes('*') || a.some(key => b.includes(key)); // NEW
    function create(ui, options) { // NEW
        const document = root.document, entries = new Set(), rows = new Map(), expiring = new Set(); // NEW
        let popup = null, drag = null, position = null, holds = [], sessionId = null, generation = 0; // NEW
        const note = (parent, text) => { const node = document.createElement('div'); node.textContent = text; parent.appendChild(node); return node; }; // NEW
        const targetsOf = entry => [...new Set([...(typeof entry.targets === 'function' ? entry.targets() : entry.targets), ...(entry.heldTargets || [])])]; // CHANGE: applied spacing rows retain ownership until their editor releases.
        function matching(targets) { return [...entries].filter(entry => intersects(targetsOf(entry), targets)); } // NEW
        /** Editors expose domain state, rather than arbitrary DOM or credential fields. */ // NEW
        function register(config) { // NEW
            if (!['planting', 'year-planner'].includes(config.kind)) throw new Error('Unsupported recoverable editor.'); // NEW
            const entry = { ...config, generation, pending: null, held: false, heldTargets: [], heldClaims: new Map(), handingOff: false }; entries.add(entry); // CHANGE
            const active = () => entries.has(entry) && entry.generation === generation; // NEW
            async function acquire() { // NEW
                if (!active()) throw new Error('This editor is closed.'); // NEW
                if (!options.isCollaborative()) return true; // NEW
                if (entry.held) { // NEW: an expired generation cannot silently reacquire authority for its old draft.
                    const live = holds.filter(hold => hold.sessionId === sessionId && targetsOf(entry).includes(hold.key)); // CHANGE
                    if (entry.heldTargets.some(key => !live.some(hold => hold.key === key && hold.claimId === entry.heldClaims.get(key) && (!Number.isFinite(hold.expiresAt) || hold.expiresAt > Date.now())))) { await options.lose(targetsOf(entry), 'The editing hold ended.'); throw new Error('The editing hold ended.'); } // CHANGE
                    if (targetsOf(entry).every(key => live.some(hold => hold.key === key))) return true; // NEW: newly edited rows still need their own claims.
                } // NEW
                if (!entry.pending) entry.pending = (async () => { // NEW
                    const requested = targetsOf(entry), result = await options.claim(requested); // CHANGE
                    if (!active()) throw new Error('The editor changed before editing access arrived.'); // NEW
                    if (!result?.ok) { await options.lose(targetsOf(entry), result?.reason || 'Editing access was refused.'); throw new Error(result?.reason || 'Editing access was refused.'); } // NEW
                    entry.held = true; entry.heldTargets = requested; entry.heldClaims = new Map(holds.filter(hold => hold.sessionId === sessionId && requested.includes(hold.key)).map(hold => [hold.key, hold.claimId])); return true; // CHANGE
                })().finally(() => { entry.pending = null; }); // NEW
                return entry.pending; // NEW
            } // NEW
            return { // NEW
                acquire, active, // NEW
                touch() { acquire().catch(error => options.status(error.message)); }, // NEW
                dispose(release = false) { // NEW
                    if (!active()) return; entries.delete(entry); // NEW
                    if (release && entry.held && !entry.handingOff) options.release(targetsOf(entry)).catch(error => options.status(error.message)); // NEW
                } // NEW
            }; // NEW
        } // NEW
        function capture(targets) { // NEW
            return matching(targets).map(entry => ({ kind: entry.kind, targets: targetsOf(entry), ...entry.capture() })); // NEW
        } // NEW
        function discard(targets) { // NEW
            for (const entry of matching(targets)) { entries.delete(entry); entry.discard(); } // NEW
        } // NEW
        async function handoff(targets) { // NEW
            const capturedGeneration = generation, editors = matching(targets); // NEW
            editors.forEach(entry => { entry.handingOff = true; }); // NEW
            try { // NEW
                for (const entry of editors) if (await entry.save() === false) throw new Error('Finish or correct the affected editor before releasing.'); // NEW
                if (generation !== capturedGeneration) return; // NEW
                await options.release(targets); // NEW: release waits for the diagram's durable save.
                if (generation !== capturedGeneration) return; // NEW
                for (const entry of editors) if (entries.has(entry)) { entries.delete(entry); entry.discard(); } // NEW
            } finally { editors.forEach(entry => { entry.handingOff = false; }); } // NEW
        } // NEW
        function clamp(x, y) { // NEW
            const box = popup.getBoundingClientRect(); // NEW
            position = { x: Math.max(8, Math.min(x, Math.max(8, root.innerWidth - box.width - 8))), y: Math.max(8, Math.min(y, Math.max(8, root.innerHeight - box.height - 8))) }; // NEW
            popup.style.left = position.x + 'px'; popup.style.top = position.y + 'px'; // NEW
        } // NEW
        function finishDrag(cancelled = false) { // NEW
            if (!drag) return; const previous = drag; drag = null; previous.cleanup(); // NEW
            if (cancelled && popup) clamp(previous.x, previous.y); // NEW
        } // NEW
        /** Same small move-image button and document gesture ownership as module/Quickstart handles. */ // NEW
        function installHandle(header) { // NEW
            const handle = document.createElement('button'); handle.type = 'button'; handle.dataset.trellisHoldDragHandle = '1'; // NEW
            handle.title = 'Drag to move; arrow keys move the countdown'; handle.setAttribute('aria-label', 'Move editing countdown'); // NEW
            handle.style.cssText = 'flex:0 0 auto;width:18px;height:18px;padding:0;border:1px solid #9ca3af;border-radius:4px;background:#fff;box-shadow:0 1px 4px #0003;cursor:move;display:flex;align-items:center;justify-content:center;touch-action:none'; // NEW
            if (root.Editor?.moveImage) { const icon = document.createElement('img'); icon.src = root.Editor.moveImage; icon.alt = ''; icon.style.cssText = 'width:16px;height:16px;pointer-events:none'; handle.appendChild(icon); } else handle.textContent = '+'; // NEW
            const begin = event => { // NEW
                if (drag || event.button != null && event.button !== 0 || event.isPrimary === false || event.touches?.length > 1) return; // NEW
                const box = popup.getBoundingClientRect(), x = event.clientX ?? event.touches?.[0]?.clientX, y = event.clientY ?? event.touches?.[0]?.clientY; // NEW
                const matches = next => event.pointerId == null || next.pointerId === event.pointerId; // NEW
                const move = next => { if (!popup || !drag || !matches(next)) return; clamp(box.left + (next.clientX ?? next.touches?.[0]?.clientX) - x, box.top + (next.clientY ?? next.touches?.[0]?.clientY) - y); next.preventDefault(); next.stopPropagation(); }; // NEW
                const end = next => { if (matches(next)) { finishDrag(); next.preventDefault(); next.stopPropagation(); } }; // NEW
                const cancel = () => finishDrag(true), escape = next => { if (next.key === 'Escape') { next.preventDefault(); next.stopPropagation(); cancel(); } }; // NEW
                drag = { x: box.left, y: box.top, cleanup() { // NEW
                    for (const type of ['pointermove', 'mousemove', 'touchmove']) document.removeEventListener(type, move, true); // CHANGE
                    for (const type of ['pointerup', 'mouseup', 'touchend']) document.removeEventListener(type, end, true); // NEW
                    root.removeEventListener('blur', cancel); document.removeEventListener('pointercancel', cancel, true); document.removeEventListener('touchcancel', cancel, true); document.removeEventListener('keydown', escape, true); // NEW
                } }; // NEW
                for (const type of ['pointermove', 'mousemove', 'touchmove']) document.addEventListener(type, move, { capture: true, passive: false }); // CHANGE: capture release before popup/modal event isolation consumes it.
                for (const type of ['pointerup', 'mouseup', 'touchend']) document.addEventListener(type, end, true); // NEW
                root.addEventListener('blur', cancel); document.addEventListener('pointercancel', cancel, true); document.addEventListener('touchcancel', cancel, true); document.addEventListener('keydown', escape, true); // NEW
                event.preventDefault(); event.stopPropagation(); // NEW
            }; // NEW
            if (root.mxEvent?.addGestureListeners) root.mxEvent.addGestureListeners(handle, begin); else { handle.addEventListener('pointerdown', begin); handle.addEventListener('mousedown', begin); } // NEW
            handle.addEventListener('keydown', event => { // NEW
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; // NEW
                const box = popup.getBoundingClientRect(); clamp(box.left + (event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0), box.top + (event.key === 'ArrowUp' ? -16 : event.key === 'ArrowDown' ? 16 : 0)); event.preventDefault(); event.stopPropagation(); // NEW
            }); header.appendChild(handle); // NEW
        } // NEW
        function removePopup() { finishDrag(); popup?.remove(); popup = null; rows.clear(); } // NEW
        function ensurePopup() { // NEW
            if (popup) return; popup = document.createElement('section'); popup.dataset.trellisHoldCountdown = '1'; // NEW
            popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', 'Editing release requested'); // NEW
            popup.style.cssText = 'position:fixed;z-index:2147483100;box-sizing:border-box;width:350px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;padding:12px;background:var(--ge-dialog-bg-color,#fff);color:var(--ge-dialog-color,#172033);border:1px solid #b56a00;border-radius:8px;box-shadow:0 4px 18px #0003;font:13px/1.4 Arial,sans-serif'; // NEW
            const header = document.createElement('header'); header.style.cssText = 'display:flex;gap:8px;align-items:center'; installHandle(header); note(header, 'Editing release requested').style.fontWeight = '700'; popup.appendChild(header); // NEW
            note(popup, 'Save before the timer runs out. Remaining unsaved edits will be recovered and reverted.').setAttribute('role', 'status'); // NEW
            for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keypress', 'keyup']) popup.addEventListener(type, event => event.stopPropagation()); // NEW
            document.body.appendChild(popup); clamp(position?.x ?? root.innerWidth - 374, position?.y ?? 90); // NEW
        } // NEW
        function render() { // NEW
            const groups = new Map(); // NEW
            for (const hold of holds) if (hold.sessionId === sessionId && hold.requested && Number.isFinite(hold.expiresAt)) { const group = groups.get(hold.claimId) || []; group.push(hold); groups.set(hold.claimId, group); } // NEW
            if (!groups.size) { removePopup(); return; } ensurePopup(); // NEW
            for (const [id, row] of rows) if (!groups.has(id)) { row.element.remove(); rows.delete(id); } // NEW
            for (const [id, group] of groups) { // NEW
                const targets = group.map(hold => hold.key), deadline = Math.min(...group.map(hold => hold.expiresAt)); // NEW
                let row = rows.get(id); // NEW
                if (!row) { // NEW
                    const element = document.createElement('div'); element.style.cssText = 'margin-top:10px;padding-top:8px;border-top:1px solid #ddd'; popup.appendChild(element); // NEW
                    const names = note(element, ''), timer = note(element, ''), error = note(element, ''); error.setAttribute('role', 'status'); // NEW
                    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Save & release'; button.className = 'geBtn'; root.Trellis?.ui?.applyButtonStyle?.(button, 'add'); element.appendChild(button); // NEW
                    row = { element, names, timer, error, button, targets }; rows.set(id, row); // NEW
                    button.addEventListener('click', async () => { // NEW
                        button.disabled = true; error.textContent = ''; // NEW
                        try { await handoff(row.targets); } catch (failure) { error.textContent = failure.message; } finally { if (button.isConnected) button.disabled = false; } // NEW
                    }); // NEW
                } row.targets = targets; // NEW
                const requesters = [...new Set(group.flatMap(hold => hold.requesters || []).map(person => person.name || person.userId))]; // NEW
                row.names.textContent = (requesters.join(', ') || 'Another editor') + ' requested ' + [...new Set(group.map(hold => hold.objectLabel || 'this object'))].join(', '); // NEW
                const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); row.timer.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') + ' remaining'; // NEW
                if (!seconds && !expiring.has(id)) { // NEW
                    expiring.add(id); row.button.disabled = true; // NEW
                    Promise.resolve(options.lose(targets, 'The requested editing deadline ended.')).catch(error => { row.error.textContent = error.message; }).finally(() => { expiring.delete(id); }); // NEW
                } // NEW
            } // NEW
        } // NEW
        const timer = root.setInterval(render, 1000), resize = () => { if (popup) { const box = popup.getBoundingClientRect(); clamp(box.left, box.top); } }; // NEW
        root.addEventListener('resize', resize); // NEW
        function reset() { generation++; entries.clear(); holds = []; sessionId = null; expiring.clear(); removePopup(); } // NEW
        root.addEventListener('beforeunload', () => { reset(); root.clearInterval(timer); root.removeEventListener('resize', resize); }); // NEW
        return { register, capture, discard, handoff, pinnedTargets: () => [...new Set([...entries].flatMap(targetsOf))], update(next, session) { holds = next || []; sessionId = session; render(); }, reset }; // NEW
    } // NEW
    root.TrellisEditingHolds = { create }; // NEW
})(typeof window !== 'undefined' ? window : globalThis); // NEW
