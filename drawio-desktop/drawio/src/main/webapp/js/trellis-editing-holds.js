/** Request-driven editor lifetimes and the non-modal handoff countdown. */ // NEW
(function (root) { // NEW
    'use strict'; // NEW
    const intersects = (a, b) => a.includes('*') || b.includes('*') || a.some(key => b.includes(key)); // NEW
    /** Freeze the original surface without disabling text selection or allowing its event handlers to submit. */ // CHANGE
    function freezeElement(element, reason) { // CHANGE
        if (!element) return null; // CHANGE
        if (element.__trellisFrozenView) return element.__trellisFrozenView; // CHANGE
        element.dataset.trellisFrozen = 'true'; // CHANGE
        const alert = element.ownerDocument.createElement('div'); alert.setAttribute('role', 'alert'); alert.dataset.trellisFrozenAlert = ''; alert.style.cssText = 'flex-shrink:0;padding:10px;margin:6px 0;border:2px solid #a65b00;background:#fff4d6;color:#452700;white-space:normal;font:13px/1.4 system-ui'; // CHANGE
        const message = element.ownerDocument.createElement('span'); alert.appendChild(message); // CHANGE
        if (element.matches('input,textarea,[contenteditable]')) element.parentElement.insertBefore(alert, element); else element.prepend(alert); // CHANGE
        const allowed = control => control?.closest?.('[data-trellis-review-allow]') || control?.closest?.('button,[role="button"]')?.textContent.trim().match(/^(?:close|cancel|copy(?: all)?|export(?: draft)?|retry preservation)$/i); // CHANGE
        function protect() { // CHANGE
            for (const field of [element, ...element.querySelectorAll('input,textarea,select,button,[contenteditable],[role="button"]')]) { // CHANGE
                if (alert.contains(field) || allowed(field)) continue; // CHANGE
                if (field.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="button"]):not([type="submit"]),textarea')) { if (!field.readOnly) field.readOnly = true; } // CHANGE
                else if (field.matches('button,input,select') && !field.disabled) field.disabled = true; // CHANGE
                if (field.hasAttribute('contenteditable') && field.getAttribute('contenteditable') !== 'false') { field.contentEditable = 'false'; field.setAttribute('contenteditable', 'false'); } // CHANGE
            } // CHANGE
        } // CHANGE
        const block = event => { // CHANGE
            if (alert.contains(event.target) || allowed(event.target)) return; // CHANGE
            const copy = (event.ctrlKey || event.metaKey) && ['c', 'a'].includes(event.key?.toLowerCase()); // CHANGE
            if (event.type === 'keydown' && (copy || ['Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Shift', 'Control', 'Meta'].includes(event.key))) { if (event.key !== 'Escape' && event.key !== 'Tab') event.stopImmediatePropagation(); return; } // CHANGE
            if (event.type === 'click' && !event.target.closest('button,[role="button"],a,input[type="checkbox"],input[type="radio"]')) { event.stopImmediatePropagation(); return; } // CHANGE
            event.preventDefault(); event.stopImmediatePropagation(); // CHANGE
        }; // CHANGE
        const events = ['beforeinput', 'input', 'change', 'compositionstart', 'compositionend', 'paste', 'cut', 'drop', 'submit', 'blur', 'focusout', 'keydown', 'click', 'dblclick']; // CHANGE
        for (const type of events) element.addEventListener(type, block, true); // CHANGE
        protect(); const observer = root.MutationObserver ? new root.MutationObserver(protect) : null; observer?.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'readonly', 'contenteditable'] }); // CHANGE
        const view = { element, reason, // CHANGE
            update(saved = false, error, retry) { // CHANGE
                message.textContent = reason + ' This editor is frozen for review and copying only. ' + (saved ? 'A private recovery draft has been saved.' + (error ? ' Reconciliation failed: ' + error : '') : error ? 'The private draft could not be saved: ' + error : 'Preserving a private recovery draft…'); // CHANGE
                alert.querySelector('button')?.remove(); // CHANGE
                if (retry) { const button = element.ownerDocument.createElement('button'); button.type = 'button'; button.textContent = 'Retry preservation'; button.dataset.trellisReviewAllow = ''; button.addEventListener('click', () => retry()); alert.appendChild(button); } // CHANGE
            }, // CHANGE
            dispose() { observer?.disconnect(); for (const type of events) element.removeEventListener(type, block, true); alert.remove(); }, // CHANGE
        }; // CHANGE
        element.__trellisFrozenView = view; view.update(); return view; // CHANGE
    } // CHANGE
    function create(ui, options) { // NEW
        const document = root.document, entries = new Set(), rows = new Map(), expiring = new Set(); // NEW
        let popup = null, drag = null, position = null, holds = [], sessionId = null, generation = 0; // NEW
        const note = (parent, text) => { const node = document.createElement('div'); node.textContent = text; parent.appendChild(node); return node; }; // NEW
        const targetsOf = entry => [...new Set([...(typeof entry.targets === 'function' ? entry.targets() : entry.targets).map(key => options.logicalTarget ? options.logicalTarget(key) : key), ...(entry.heldTargets || [])])]; // CHANGE: normalize bound child editors while preserving already-observed claim identities.
        function matching(targets) { return [...entries].filter(entry => intersects(targetsOf(entry), targets)); } // NEW
        let transitionTask = null, resolving = null, nextEditorId = 0, closeDecision = null; // CHANGE: one dirty section owns the window, independently of registration and persistence.
        const elementOf = entry => typeof entry.element === 'function' ? entry.element() : entry.element; // CHANGE
        const snapshot = entry => JSON.parse(JSON.stringify(entry.capture?.() || {})); // CHANGE
        const dirty = entry => !entry.frozen && (entry.isDirty ? !!entry.isDirty() : entry.baseline != null ? JSON.stringify(snapshot(entry)) !== JSON.stringify(entry.baseline) : entry.changed); // CHANGE
        /** Keep the model baseline until an actual Commit; a tab refresh cannot bless stale controls. */ // CHANGE
        function checkpoint(entry, refreshTarget = false) { // CHANGE
            try { // CHANGE
                entry.baseline = snapshot(entry); // CHANGE
                if (refreshTarget || !entry.targetState) { // CHANGE
                    const targets = typeof entry.targets === 'function' ? entry.targets() : entry.targets; // CHANGE
                    entry.targetState = new Map((targets || []).map(key => [key, options.targetState?.(key)])); // CHANGE
                } // CHANGE
                entry.changed = false; // CHANGE
            } catch (_) { entry.baseline = null; } // CHANGE: lazy editors explicitly checkpoint after mounting their controls.
        } // CHANGE
        /** The prompt never submits or discards a draft merely because focus changed. */ // CHANGE
        function decide(entry) { // CHANGE
            if (options.decide) return options.decide({ kind: entry.kind, title: entry.title, targets: targetsOf(entry) }); // CHANGE
            return new Promise(resolve => { // CHANGE
                const previous = entry.lastFocus?.isConnected ? entry.lastFocus : document.activeElement, selection = previous && 'selectionStart' in previous ? [previous.selectionStart, previous.selectionEnd] : null, panel = document.createElement('section'); panel.dataset.trellisEditDecision = ''; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Uncommitted changes'); // CHANGE
                panel.style.cssText = 'position:fixed;z-index:2147483200;left:50%;top:30%;transform:translateX(-50%);max-width:430px;padding:18px;background:var(--ge-dialog-bg-color,#fff);color:var(--ge-dialog-color,#172033);border:1px solid #888;border-radius:8px;box-shadow:0 0 0 100vmax #0005;font:13px Arial'; // CHANGE
                const backdrop = document.createElement('div'); backdrop.dataset.trellisEditDecisionBackdrop = ''; backdrop.style.cssText = 'position:fixed;inset:0;z-index:2147483199;background:#0005'; // CHANGE
                backdrop.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); }); // CHANGE
                note(panel, 'Commit or discard changes to ' + (entry.title || entry.kind || 'this editor') + ' before continuing.'); // CHANGE
                let settled = false; const finish = choice => { if (settled) return; settled = true; closeDecision = null; panel.remove(); backdrop.remove(); if (previous?.isConnected) { previous.focus?.(); if (selection) try { previous.setSelectionRange(...selection); } catch (_) { /* Non-text controls do not expose a text selection. */ } } resolve(choice); }; closeDecision = () => finish('stay'); // CHANGE // CHANGE
                for (const [choice, label] of [['commit', 'Commit changes'], ['discard', 'Discard changes'], ['stay', 'Stay here']]) { const button = document.createElement('button'); button.type = 'button'; button.className = 'geBtn'; button.textContent = label; button.onclick = () => finish(choice); panel.appendChild(button); } // CHANGE
                panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); finish('stay'); } if (event.key === 'Tab') { const buttons = [...panel.querySelectorAll('button')], index = buttons.indexOf(document.activeElement); event.preventDefault(); buttons[(index + (event.shiftKey ? 2 : 1)) % 3].focus(); } event.stopPropagation(); }); // CHANGE
                for (const type of ['pointerdown', 'mousedown', 'click', 'input', 'change']) panel.addEventListener(type, event => event.stopPropagation()); // CHANGE
                document.body.append(backdrop, panel); panel.querySelector('button:last-child').focus(); // CHANGE
            }); // CHANGE
        } // CHANGE
        function activeTargets() { return [...new Set([...entries].filter(entry => !entry.frozen && entry.editing).flatMap(targetsOf))]; } // CHANGE
        /** Wait for an in-flight claim and release only when no newer editor owns its targets. */ // CHANGE
        function finish(entry, applied = true, refreshTarget = true) { // CHANGE
            entry.editing = false; if (applied) checkpoint(entry, refreshTarget); // CHANGE
            const epoch = ++entry.epoch, pending = entry.pending, initialTargets = targetsOf(entry); // CHANGE
            const release = async () => { // CHANGE
                if (pending) { try { await pending; } catch (_) { /* A refused claim cannot create a hold to release. */ } } // CHANGE
                if (entry.frozen || entry.handingOff || entry.epoch !== epoch || entry.generation !== generation) return; // CHANGE
                const targets = [...new Set([...initialTargets, ...entry.heldTargets])], claims = new Map(entry.heldClaims); entry.held = false; entry.heldTargets = []; entry.heldClaims.clear(); // CHANGE
                if (!targets.length || !claims.size) return; // CHANGE
                await options.release(targets, { automatic: true, claims, shouldRelease: key => entry.epoch === epoch && !activeTargets().includes(key) }); // CHANGE
            }; // CHANGE
            return release().catch(error => options.status(error.message)); // CHANGE: persistence failure retains the renderer's pending hold and modified data.
        } // CHANGE
        /** Resolve a dirty section before any tab or object transition; repeated requests share one decision. */ // CHANGE
        function transition(next, operation, sectionChange = false) { // CHANGE
            if (resolving) return Promise.resolve(operation?.()); // CHANGE: a Commit command may acquire its own editor without recursively prompting.
            if (transitionTask) return transitionTask; // CHANGE
            const epoch = generation; // CHANGE
            const run = async () => { // CHANGE
                for (const entry of [...entries]) { // CHANGE
                    if (entry.frozen || entry === next && !sectionChange || !dirty(entry)) continue;
                    if (entry.composing) { options.status('Finish composing text before changing editors.'); return false; } // CHANGE // CHANGE
                    const choice = await decide(entry); if (epoch !== generation || !entries.has(entry) || entry.frozen || choice === 'stay') return false; // CHANGE
                    resolving = entry; // CHANGE
                    try { // CHANGE
                        if (choice === 'commit') { if (await entry.handle.commit({ closeAfter: false }) === false) return false; } // CHANGE
                        else if (choice === 'discard') { if (!entry.restore) { options.status('This editor cannot discard in place. Cancel it before continuing.'); return false; } await entry.restore(entry.baseline); } // CHANGE
                        else return false; // CHANGE
                        if (choice === 'discard') void finish(entry, true, false); // CHANGE: Commit already completed; navigation never waits for the quiet queue.
                    } finally { resolving = null; } // CHANGE
                } // CHANGE
                if (epoch !== generation) return false; // CHANGE
                return operation ? await operation() : true; // CHANGE
            }; // CHANGE
            const task = run().catch(error => { options.status(error.message); return false; }).finally(() => { if (transitionTask === task) transitionTask = null; }); transitionTask = task; return task; // CHANGE // CHANGE
        } // CHANGE
        /** Registration describes an editor; actual edit activity, rather than an open panel, pins targets. */ // CHANGE
        function register(config) { // CHANGE
            if (!['planting', 'year-planner', 'inventory', 'details', 'label', 'object-form'].includes(config.kind)) throw new Error('Unsupported recoverable editor.'); // CHANGE
            const entry = { ...config, id: ++nextEditorId, generation, epoch: 0, changed: false, editing: false, pending: null, held: false, heldTargets: [], heldClaims: new Map(), handingOff: false, frozen: false }; entries.add(entry); checkpoint(entry); // CHANGE
            const registered = () => entries.has(entry) && entry.generation === generation, active = () => registered() && !entry.frozen; // CHANGE
            if (entry.element && typeof entry.element !== 'function') entry.element.dataset.trellisCollaborativeEditor = config.kind; // CHANGE
            async function acquire() { // CHANGE
                if (!active()) throw new Error(entry.frozen ? 'This editor is frozen for review and copying only.' : 'This editor is closed.'); // CHANGE
                if (!resolving && [...entries].some(other => other !== entry && dirty(other))) { const permitted = await transition(entry); if (permitted === false) throw new Error('Finish the current edit before continuing.'); } // CHANGE
                if (!active()) throw new Error('The editor changed before editing could begin.'); // CHANGE
                if (!entry.editing && options.targetState && [...(entry.targetState || [])].some(([key, state]) => targetsOf(entry).includes(key) && state !== options.targetState(key))) throw new Error('This object changed while the editor was clean. Reopen it before editing.'); // CHANGE
                if (!entry.editing) { entry.editing = true; entry.epoch++; } // CHANGE
                if (!options.isCollaborative()) return true; // CHANGE
                if (options.validate) await options.validate(targetsOf(entry)); // CHANGE: a clean panel cannot resume against stale incoming objects.
                if (!active()) throw new Error('The editor changed before editing access arrived.'); // CHANGE
                if (entry.held) { // CHANGE
                    let live = holds.filter(hold => hold.sessionId === sessionId && targetsOf(entry).includes(hold.key)); // CHANGE
                    const missing = () => entry.heldTargets.some(key => !live.some(hold => hold.key === key && hold.claimId === entry.heldClaims.get(key) && (!Number.isFinite(hold.expiresAt) || hold.expiresAt > Date.now()))); // CHANGE
                    if (missing() && options.refresh) { await options.refresh(); if (!active()) throw new Error('This editor is closed or frozen.'); live = holds.filter(hold => hold.sessionId === sessionId && targetsOf(entry).includes(hold.key)); } // CHANGE
                    if (missing()) { await options.lose(targetsOf(entry), 'The editing hold ended.', entry.heldClaims); throw new Error('The editing hold ended.'); } // CHANGE
                    if (targetsOf(entry).every(key => live.some(hold => hold.key === key))) return true; // CHANGE
                } // CHANGE
                if (!entry.pending) entry.pending = (async () => { // CHANGE
                    const requested = targetsOf(entry), result = await options.claim(requested); // CHANGE
                    if (!result?.ok) { if (active()) await options.lose(requested, result?.reason || 'Editing access was refused.'); throw new Error(result?.reason || 'Editing access was refused.'); } // CHANGE
                    entry.held = true; entry.heldTargets = requested; entry.heldClaims = new Map(holds.filter(hold => hold.sessionId === sessionId && requested.includes(hold.key)).map(hold => [hold.key, hold.claimId])); // CHANGE
                    if (!active()) { void finish(entry, false); throw new Error('The editor changed before editing access arrived.'); } return true; // CHANGE
                })().finally(() => { entry.pending = null; }); // CHANGE
                return entry.pending; // CHANGE
            } // CHANGE
            entry.handle = { // CHANGE
                /** Domain validation/application succeeds before the editor becomes clean. */ // CHANGE
                commit: saveOptions => { // CHANGE: button, navigation and handoff share the same in-flight submission.
                    if (entry.committing) return entry.committing; // CHANGE
                    const task = Promise.resolve().then(async () => { // CHANGE
                        try { // CHANGE
                            await acquire(); // CHANGE
                            if (!active()) throw new Error('This editor is closed or frozen.'); // CHANGE
                            if (entry.prepare) { // CHANGE: prepared domain editors use the shared graph owner.
                                const context = ui.editor.graph.__trellisEditContext || root.TrellisEditContext.install(ui); // CHANGE
                                const outcome = await context.commit({ editor: entry.handle, id: 'editor:' + entry.id, capture: () => snapshot(entry), isCurrent: active, prepare: input => entry.prepare(input, saveOptions || {}) }); // CHANGE
                                entry.outcome = outcome; if (!['applied', 'unchanged'].includes(outcome.status)) throw outcome.error; // CHANGE
                            } else { const result = await entry.save(saveOptions || {}); if (result === false || result?.draftRetained) return false; } // CHANGE: successful older work cannot mark newer fields clean or close their editor.
                            if (entry.editing) void finish(entry); return true; // CHANGE
                        } catch (error) { options.status(error.message); return false; } // CHANGE
                    }).finally(() => { if (entry.committing === task) entry.committing = null; }); // CHANGE
                    entry.committing = task; return task; // CHANGE
                }, // CHANGE
                outcome: () => entry.outcome, // CHANGE: a local commit outcome is never a durable-save acknowledgement.
                freeze: reason => freeze(targetsOf(entry), reason), // CHANGE: failed compensation uses the existing recoverable frozen surface.
                acquire, active, frozen: () => entry.frozen, dirty: () => dirty(entry), checkpoint: () => checkpoint(entry), complete: () => finish(entry), // CHANGE
                transition: operation => transition(entry, operation, true), // CHANGE
                touch() { entry.changed = true; acquire().catch(error => options.status(error.message)); }, // CHANGE
                dispose(release = false) { if (!registered()) return; entries.delete(entry); entry.frozenView?.dispose(); if (release && !entry.frozen && !entry.handingOff) void finish(entry, false); }, // CHANGE
            }; return entry.handle; // CHANGE
        } // CHANGE
        /** Adapt known object-bound forms to baseline restoration without serializing unrelated dialogs. */ // CHANGE
        function registerForm(config) { // CHANGE
            const fields = () => [...config.element.querySelectorAll('input,textarea,select,[contenteditable="true"]')].filter(field => !['password', 'file', 'hidden'].includes(field.type) && !/password|secret|token|credential/i.test(field.name + ' ' + field.id)); // CHANGE
            const handle = register({ ...config, kind: 'object-form', capture: config.capture || (() => ({ controls: fields().map(field => ({ value: field.value ?? field.innerHTML, checked: field.checked })) })), restore: config.restore || (draft => { // CHANGE
                draft?.controls.forEach((saved, index) => { const field = fields()[index]; if (!field) return; if ('value' in field) field.value = saved.value; else field.innerHTML = saved.value; field.checked = saved.checked; field.dispatchEvent(new root.Event('change', { bubbles: true })); }); // CHANGE
            }) }); // CHANGE
            const touch = () => handle.touch(); config.element.addEventListener('input', touch); config.element.addEventListener('change', touch); // CHANGE
            const dispose = handle.dispose; handle.dispose = release => { config.element.removeEventListener('input', touch); config.element.removeEventListener('change', touch); dispose(release); }; return handle; // CHANGE
        } // CHANGE
        /** Resolve before focus/blur can submit another panel; toolbar actions stay within their editor. */ // CHANGE
        function guardEditorFocus(event) { // CHANGE
            if (resolving || event.target.closest?.('[data-trellis-edit-decision]')) return; // CHANGE
            const next = [...entries].find(entry => elementOf(entry)?.contains(event.target)); // CHANGE
            if (!next || ![...entries].some(entry => entry !== next && dirty(entry))) return; // CHANGE
            event.preventDefault(); event.stopImmediatePropagation(); // CHANGE
            void transition(next, () => { event.target.focus?.(); if (event.target.matches?.('button,[role="button"]')) event.target.click(); }).catch(error => options.status(error.message)); // CHANGE
        } // CHANGE
        function rememberFocus(event) { // CHANGE: Stay restores the actual field/caret rather than a tab button.
            if (!event.target.matches?.('input,textarea,select,[contenteditable="true"]')) return; // CHANGE
            for (const entry of entries) if (elementOf(entry)?.contains(event.target)) entry.lastFocus = event.target; // CHANGE
        } // CHANGE
        function guardKeyboardFocus(event) { // CHANGE: keyboard navigation must resolve a draft before its blur handler can write.
            if (resolving) return; // CHANGE
            const current = [...entries].find(entry => elementOf(entry)?.contains(event.target)), next = [...entries].find(entry => elementOf(entry)?.contains(event.relatedTarget)); // CHANGE
            if (!current || !next || current === next || !dirty(current)) return; // CHANGE
            event.stopImmediatePropagation(); void transition(next, () => event.relatedTarget?.focus?.()); // CHANGE
        } // CHANGE
        document.addEventListener('focusin', rememberFocus, true); document.addEventListener('blur', guardKeyboardFocus, true); // CHANGE
        document.addEventListener('pointerdown', guardEditorFocus, true); // CHANGE
        root.addEventListener('beforeunload', () => { document.removeEventListener('pointerdown', guardEditorFocus, true); document.removeEventListener('focusin', rememberFocus, true); document.removeEventListener('blur', guardKeyboardFocus, true); }); // CHANGE
        const composition = event => { for (const entry of entries) if (elementOf(entry)?.contains(event.target)) entry.composing = event.type === 'compositionstart'; }; // CHANGE
        document.addEventListener('compositionstart', composition, true); document.addEventListener('compositionend', composition, true); // CHANGE
        function capture(targets) { // NEW
            return matching(targets).filter(entry => entry.frozen || entry.editing || dirty(entry)).map(entry => entry.frozenCapture || ({ kind: entry.kind, targets: targetsOf(entry), ...entry.capture() })); // CHANGE
        } // NEW
        /** Capture once before editor callbacks or graph reconciliation can change its draft. */ // CHANGE
        function freeze(targets, reason) { // CHANGE
            for (const entry of matching(targets)) { // CHANGE
                if (entry.frozen) continue; // CHANGE
                entry.frozenCapture = JSON.parse(JSON.stringify({ kind: entry.kind, targets: targetsOf(entry), ...entry.capture() })); entry.frozen = true; // CHANGE
                entry.freeze?.(reason); const element = typeof entry.element === 'function' ? entry.element() : entry.element; entry.frozenView = freezeElement(element, reason); // CHANGE
            } // CHANGE
        } // CHANGE
        function preservation(targets, saved, error, retry) { for (const entry of matching(targets)) entry.frozenView?.update(saved, error, retry); } // CHANGE
        function discard(targets) { // NEW
            for (const entry of matching(targets)) { entries.delete(entry); entry.discard(); } // NEW
        } // NEW
        async function handoff(targets) { // NEW
            const capturedGeneration = generation, editors = matching(targets); // NEW
            const claims = new Map(holds.filter(hold => hold.sessionId === sessionId && targets.includes(hold.key)).map(hold => [hold.key, hold.claimId])); // CHANGE
            if (editors.some(entry => entry.frozen)) throw new Error('This editor is frozen for review and copying only.'); // CHANGE
            editors.forEach(entry => { entry.handingOff = true; }); // NEW
            try { // NEW
                for (const entry of editors) { if (entry.frozen) throw new Error('This editor is frozen for review and copying only.'); if (await entry.save() === false) throw new Error('Finish or correct the affected editor before releasing.'); } // CHANGE
                if (generation !== capturedGeneration) return; // NEW
                if (editors.some(entry => entry.frozen)) throw new Error('This editor is frozen for review and copying only.'); // CHANGE
                await options.release(targets, { automatic: false, claims }); // CHANGE: an explicit handoff flushes edits and releases only the captured generation.
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
                const targets = group.map(hold => hold.key), deadline = Math.min(...group.map(hold => hold.requestDeadline ?? hold.expiresAt)); // CHANGE: ownership expires only at a requested handoff deadline.
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
                    Promise.resolve(options.lose(targets, 'The requested editing deadline ended.', new Map(group.map(hold => [hold.key, hold.claimId])))).catch(error => { row.error.textContent = error.message; }).finally(() => { expiring.delete(id); }); // CHANGE
                } // NEW
            } // NEW
        } // NEW
        const timer = root.setInterval(render, 1000), resize = () => { if (popup) { const box = popup.getBoundingClientRect(); clamp(box.left, box.top); } }; // NEW
        root.addEventListener('resize', resize); // NEW
        function reset() { generation++; closeDecision?.(); transitionTask = null; resolving = null; for (const entry of entries) if (entry.frozen) { entry.frozenView?.dispose(); entry.discard(); entry.frozenView?.element.remove(); } entries.clear(); holds = []; sessionId = null; expiring.clear(); removePopup(); } // CHANGE
        root.addEventListener('beforeunload', () => { reset(); root.clearInterval(timer); root.removeEventListener('resize', resize); }); // NEW
        return { register, registerForm, capture, freeze, preservation, discard, handoff, frozenTargets: () => [...new Set([...entries].filter(entry => entry.frozen).flatMap(targetsOf))], pinnedTargets: activeTargets, transition: operation => transition(null, operation), activeTargets, update(next, session) { holds = next || []; sessionId = session; render(); }, reset }; // CHANGE
    } // NEW
    root.TrellisEditingHolds = { create, freezeElement }; // CHANGE
})(typeof window !== 'undefined' ? window : globalThis); // NEW
