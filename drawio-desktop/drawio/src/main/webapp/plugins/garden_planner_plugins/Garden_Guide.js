/** Task-scoped guidance. Local edits autosave; reusable recipes require an explicit action. */ // CHANGE
(function () {
    'use strict';
    const OVERRIDE = 'task_instruction_override'; // CHANGE

    /** Read XML attributes from mxCells and lightweight test hosts without collapsing empty values. */ // CHANGE
    function attr(cell, key) {
        const source = cell && cell.value && typeof cell.value.getAttribute === 'function' ? cell.value : cell;
        return source && typeof source.getAttribute === 'function' ? source.getAttribute(key) : null;
    }

    /** One synchronous, undoable commit per typing burst; history invalidation cancels stale writes. */ // CHANGE
    function createAutosave(options) {
        let text = options.read(), committed = text, timer = null, composing = false, disposed = false;
        const schedule = options.schedule || setTimeout, cancelTimer = options.cancelTimer || clearTimeout;
        function cancel() { if (timer != null) cancelTimer(timer); timer = null; }
        function notify(state, error) { if (options.onState) options.onState(state, error); }
        function flush() {
            cancel();
            if (disposed) return false;
            if (text === committed) return true;
            if (composing) { notify('pending'); return false; }
            try {
                options.write(text);
                committed = text;
                notify('saved');
                return true;
            } catch (error) { notify('failed', error); return false; }
        }
        function edit(value) {
            if (disposed) return;
            text = value; cancel();
            if (text === committed) { notify('saved'); return; }
            notify('pending');
            if (!composing) timer = schedule(flush, 500);
        }
        function reload() { cancel(); composing = false; text = committed = options.read(); notify('saved'); return text; }
        return {
            edit, flush, reload,
            beginComposition() { composing = true; cancel(); },
            endComposition(value) { if (!composing || disposed) return; composing = false; edit(value); }, // CHANGE: a history reset invalidates the old composition session.
            dirty: () => text !== committed,
            value: () => text,
            dispose() { cancel(); disposed = true; }
        };
    }

    /** Patch exactly one rule on a deep copy, preserving all timing and unrelated guidance. */ // CHANGE
    function withInstructions(template, ruleId, instructions, provenance) {
        const copy = JSON.parse(JSON.stringify(template));
        const matches = (copy.rules || []).filter(rule => String(rule.id) === String(ruleId) && ruleId);
        if (matches.length !== 1) throw new Error('This task must match exactly one recipe rule.');
        matches[0].instructions = instructions;
        matches[0].instructionProvenance = { ...(provenance || {}), status: 'customized' };
        return copy;
    }

    /** Only ordinary web source links are rendered; text is always inserted through textContent. */ // CHANGE
    function sourceUrl(value) {
        try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch (_) { return null; }
    }

    if (typeof window !== 'undefined' && window.__TRELLIS_GUIDE_TEST__) window.__TRELLIS_GUIDE_TEST_HOOKS__ = { createAutosave, withInstructions, sourceUrl }; // CHANGE

    Draw.loadPlugin(function (ui) {
        const graph = ui && ui.editor && ui.editor.graph;
        if (!graph || !graph.getModel || graph.__trellisGuideInstalled) return;
        graph.__trellisGuideInstalled = true;
        const model = graph.getModel();
        let active = null;

        function exists(cell) { return graph.getModel() === model && !!cell && model.getCell(String(cell.id || cell.getId && cell.getId())) === cell; } // CHANGE: a replaced drawing cannot receive stale dialog writes.
        function users() { return graph.__trellisUsers || window.Trellis && window.Trellis.users; }
        function canEdit(card) { const policy = users(); return exists(card) && (!graph.isEnabled || graph.isEnabled()) && (!policy || !policy.canEditTaskDetails || policy.canEditTaskDetails(card)); } // CHANGE: read-only drawings expose guidance without allowing edits.
        function assertEditable(card) {
            if (!exists(card)) throw new Error('This task is no longer available. Your text has been retained.');
            if (!canEdit(card)) throw new Error('You no longer have permission to edit this task. Your text has been retained.');
        }
        function commit(card, value) {
            assertEditable(card);
            if (attr(card, OVERRIDE) === value) return;
            const commands = window.Trellis && window.Trellis.taskCommands;
            if (!commands || !commands.commitCardPatch) throw new Error('Task editing is unavailable. Your text has been retained.');
            commands.commitCardPatch(card, { [OVERRIDE]: value }, { reflow: false });
            if (attr(card, OVERRIDE) !== value) throw new Error('Changes could not be saved. Your text has been retained.');
        }
        function plantingLinks(card) {
            return Array.from(new Set(String(attr(card, 'linkedTo') || '').split(',').map(id => id.trim()).filter(Boolean))).map(id => model.getCell(id)).filter(cell => attr(cell, 'tiler_group') === '1'); // CHANGE: legacy whitespace cannot create duplicate planting choices.
        }

        /** A dialog remains bound to its opening task; asynchronous context cannot overwrite typing. */ // CHANGE
        function open(card) {
            if (!exists(card) || attr(card, 'kanban_card') !== '1') return;
            if (active) ui.hideDialog();
            if (active) return; // CHANGE: a failed flush vetoes replacing the current dialog.
            const root = document.createElement('div');
            root.className = 'trellis-task-guide';
            root.style.cssText = 'box-sizing:border-box;padding:16px;font:13px Arial,sans-serif;display:flex;flex-direction:column;gap:10px;max-height:80vh;overflow:hidden;overflow-wrap:anywhere;'; // CHANGE: long names wrap and the footer remains accessible.
            const heading = document.createElement('h2'); heading.textContent = 'Guide — ' + (attr(card, 'title') || 'Task'); heading.style.margin = '0'; root.appendChild(heading);
            const crop = document.createElement('div'); crop.textContent = [attr(card, 'plant_name'), attr(card, 'variety_name'), attr(card, 'scheduler_method_id') || attr(card, 'method')].filter(Boolean).join(' · '); root.appendChild(crop);
            const label = document.createElement('label'); label.textContent = 'Task instructions — changes save automatically'; root.appendChild(label);
            const textarea = document.createElement('textarea'); textarea.rows = 10; textarea.setAttribute('aria-label', 'Task instructions'); textarea.style.cssText = 'box-sizing:border-box;width:100%;min-height:160px;resize:vertical;font:13px/1.5 Arial,sans-serif;'; label.appendChild(textarea);
            const status = document.createElement('div'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); root.appendChild(status);
            const provenanceNode = document.createElement('div'); root.appendChild(provenanceNode);
            const contextNotice = document.createElement('div'); contextNotice.setAttribute('role', 'status'); root.appendChild(contextNotice);
            const references = document.createElement('div'); root.appendChild(references);
            const recipeNotice = document.createElement('div'); recipeNotice.setAttribute('role', 'status'); root.appendChild(recipeNotice); // CHANGE: disabled recipe actions have a visible explanation.
            const actions = document.createElement('div'); actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;'; root.appendChild(actions);
            const recipePanel = document.createElement('div'); recipePanel.style.display = 'none'; root.appendChild(recipePanel);
            let context = null, inherited = attr(card, 'task_instructions'), disposed = false, discardUnsaved = false, requestId = 0, editingStarted = false, writing = false;
            if (inherited == null) inherited = attr(card, 'notes') || '';
            let provenance = {};
            try { const stored = JSON.parse(attr(card, 'task_instruction_provenance_json') || '{}'); provenance = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}; } catch (_) { } // CHANGE: malformed legacy metadata never prevents reading instructions.
            function read() { const local = attr(card, OVERRIDE); return local != null ? local : inherited; }
            function button(text, fn, variant = 'neutral', parent = actions) {
                const node = mxUtils.button(text, fn);
                const shared = graph.__trellisTaskUi;
                if (shared && shared.applyButtonStyle) shared.applyButtonStyle(node, variant);
                parent.appendChild(node); return node;
            }
            function renderProvenance() {
                provenanceNode.replaceChildren();
                const note = document.createElement('div');
                note.textContent = attr(card, OVERRIDE) != null ? 'Customized on this task' : provenance.status === 'draft' ? 'Draft instructions — review for your garden' : 'Inherited instructions';
                provenanceNode.appendChild(note);
                if (provenance.sourceNote) { const sourceNote = document.createElement('div'); sourceNote.textContent = String(provenance.sourceNote); provenanceNode.appendChild(sourceNote); }
                (Array.isArray(provenance.sourceUrls) ? provenance.sourceUrls : []).forEach(value => {
                    const href = sourceUrl(value); if (!href) return;
                    const link = document.createElement('a'); link.href = href; link.textContent = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.style.cssText = 'display:block;overflow-wrap:anywhere;'; provenanceNode.appendChild(link); // CHANGE
                });
            }
            const autosave = createAutosave({
                read,
                write(value) { writing = true; try { commit(card, value); } finally { writing = false; } renderProvenance(); },
                onState(state, error) {
                    status.textContent = state === 'pending' ? 'Saving…' : state === 'failed' ? error.message : !canEdit(card) ? 'Read only — you do not have permission to edit this task.' : attr(card, OVERRIDE) != null ? 'Saved to task' : 'Using inherited instructions'; // CHANGE
                    status.style.color = state === 'failed' ? '#b91c1c' : '#555';
                    retry.style.display = discard.style.display = state === 'failed' ? '' : 'none';
                }
            });
            textarea.value = read(); textarea.disabled = !canEdit(card);
            if (textarea.disabled) status.textContent = 'Read only — you do not have permission to edit this task.';
            const retry = button('Retry save', () => autosave.flush(), 'open'); retry.style.display = 'none';
            const discard = button('Discard unsaved text and close', () => { discardUnsaved = true; ui.hideDialog(); }, 'danger'); discard.style.display = 'none';
            textarea.addEventListener('input', () => { editingStarted = true; autosave.edit(textarea.value); });
            textarea.addEventListener('compositionstart', () => { editingStarted = true; autosave.beginComposition(); }); // CHANGE: delayed references cannot replace an active composition.
            textarea.addEventListener('compositionend', () => autosave.endComposition(textarea.value));
            textarea.addEventListener('blur', () => autosave.flush());
            button('Reset to inherited instructions', () => {
                try {
                    assertEditable(card); writing = true;
                    if (attr(card, OVERRIDE) == null) { textarea.value = autosave.reload(); editingStarted = false; renderProvenance(); return; } // CHANGE: reset cancels unsaved typing without creating a redundant undo edit.
                    const commands = window.Trellis && window.Trellis.taskCommands;
                    if (!commands || !commands.commitCardPatch) throw new Error('Task editing is unavailable.');
                    commands.commitCardPatch(card, { [OVERRIDE]: null }, { reflow: false });
                    if (attr(card, OVERRIDE) != null) throw new Error('Instructions could not be reset.');
                    textarea.value = autosave.reload(); editingStarted = false; renderProvenance();
                } catch (error) { status.textContent = error.message; } finally { writing = false; }
            }, 'neutral').disabled = !canEdit(card);

            function recipeReason() {
                if (!context) return 'Choose a linked planting with an available task template.';
                if (!exists(selectedPlanting()) || !plantingLinks(card).includes(selectedPlanting())) return 'The linked planting is no longer available.'; // CHANGE
                if (!exists(context.moduleCell)) return 'The linked garden is unavailable.';
                const policy = users(); // CHANGE
                if (policy && policy.canEditCell && !policy.canEditCell(context.moduleCell)) return 'You do not have permission to save recipes in this garden.'; // CHANGE
                if (!context.rule || !context.template || !context.template.rules.length) return 'This task does not match exactly one rule in its planting template.';
                if (!context.plantId || !context.methodId) return 'Recipe saving requires a crop and planting method.';
                return '';
            }
            const newRecipe = button('Save as new recipe', () => showRecipeForm(false), 'add');
            const updateRecipe = button('Update existing recipe', () => showRecipeForm(true), 'open');
            function refreshRecipeActions() {
                const reason = recipeReason();
                [newRecipe, updateRecipe].forEach(node => { node.disabled = !!reason || !canEdit(card); node.title = reason || ''; });
                recipeNotice.textContent = context ? reason : ''; // CHANGE: loading/manual-task notices already explain missing context.
            }
            function compatibleRecipes() {
                const api = window.USL && window.USL.scheduler && window.USL.scheduler.taskGuide;
                if (!api || !context) return [];
                return api.readRecipes(context.moduleCell).filter(recipe => recipe.plantId === context.plantId && recipe.methodIds.includes(context.methodId) && recipe.growthStageKeys.includes(context.growthStageKey) && api.canUpdateRecipe(recipe) && recipe.template.rules.filter(rule => String(rule.id) === String(context.rule.id)).length === 1);
            }
            function showRecipeForm(update) {
                if (!autosave.flush()) return;
                recipePanel.replaceChildren(); recipePanel.style.display = '';
                const message = document.createElement('div'); message.textContent = 'Recipe changes affect future use. Existing tasks retain their instructions.'; recipePanel.appendChild(message);
                const input = document.createElement(update ? 'select' : 'input'); input.setAttribute('aria-label', update ? 'Recipe to update' : 'New recipe name'); recipePanel.appendChild(input);
                if (update) {
                    compatibleRecipes().forEach(recipe => { const option = document.createElement('option'); option.value = recipe.id; option.textContent = recipe.name; input.appendChild(option); });
                    if (!input.options.length) { message.textContent = 'No compatible recipe you can update was found in this garden.'; return; }
                } else { input.value = (attr(card, 'plant_name') || 'Plant') + ' — my recipe'; }
                const feedback = document.createElement('div'); feedback.setAttribute('role', 'status'); recipePanel.appendChild(feedback);
                button(update ? 'Update recipe instructions' : 'Create recipe', async () => { // CHANGE
                    try {
                        if (!autosave.flush()) return;
                        assertEditable(card);
                        if (recipeReason()) throw new Error(recipeReason());
                        const api = window.USL && window.USL.scheduler && window.USL.scheduler.taskGuide;
                        if (!api) throw new Error('Recipe saving is unavailable.');
                        const group = selectedPlanting(); // CHANGE: re-resolve the current full template before copying it.
                        const fresh = await api.resolveContext(group, card); // CHANGE
                        if (disposed || group !== selectedPlanting()) return; // CHANGE
                        context = fresh; assertEditable(card); // CHANGE
                        if (recipeReason()) throw new Error(recipeReason()); // CHANGE
                        if (!autosave.flush()) return; // CHANGE: include edits made during the lookup.
                        const target = update ? compatibleRecipes().find(recipe => recipe.id === input.value) : null;
                        if (update && !target) throw new Error('The selected recipe is no longer editable or compatible.');
                        const recipe = target ? { ...target } : { name: input.value.trim(), plantId: context.plantId, plantName: attr(card, 'plant_name') || attr(selectedPlanting(), 'plant_name') || '', methodIds: [context.methodId], growthStageKeys: [context.growthStageKey], growthStageLabels: [attr(selectedPlanting(), 'growth_stage_label') || context.growthStageKey] };
                        recipe.template = withInstructions(target ? target.template : context.template, context.rule.id, textarea.value, provenance);
                        api.saveRecipe(context.moduleCell, recipe, target ? { allowUpdateId: target.id } : {});
                        feedback.textContent = 'Recipe saved.';
                    } catch (error) { feedback.textContent = error.message; }
                }, 'add', recipePanel);
            }

            const links = plantingLinks(card);
            const plantingSelect = document.createElement('select'); plantingSelect.setAttribute('aria-label', 'Linked planting');
            if (links.length > 1) {
                const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose linked planting…'; plantingSelect.appendChild(placeholder);
                links.forEach(group => { const option = document.createElement('option'); option.value = String(group.id); option.textContent = attr(group, 'plant_name') || attr(group, 'label') || String(group.id); plantingSelect.appendChild(option); });
                root.insertBefore(plantingSelect, label);
            }
            function selectedPlanting() { return links.length === 1 ? links[0] : links.find(group => String(group.id) === plantingSelect.value); }
            async function loadContext() {
                const token = ++requestId, group = selectedPlanting(); context = null; refreshRecipeActions(); references.replaceChildren(); recipePanel.style.display = 'none';
                inherited = attr(card, 'task_instructions'); // CHANGE: reread current inheritance after history or scheduler updates.
                if (inherited == null) inherited = attr(card, 'notes') || ''; // CHANGE
                if (!editingStarted && attr(card, OVERRIDE) == null) textarea.value = autosave.reload(); // CHANGE: switching linked plantings cannot retain another group's fallback text.
                const api = window.USL && window.USL.scheduler && window.USL.scheduler.taskGuide;
                if (!group) { contextNotice.textContent = links.length ? 'Choose a linked planting for recipe and crop references.' : 'This task has no linked planting. You can still customize its instructions.'; return; }
                if (!api) { contextNotice.textContent = 'The scheduler is unavailable. Saved instructions remain available.'; return; }
                contextNotice.textContent = 'Loading crop and recipe references…';
                try {
                    const result = await api.resolveContext(group, card);
                    if (disposed || token !== requestId || !exists(card)) return;
                    context = result; contextNotice.textContent = (result.warnings || []).join(' ');
                    if (attr(card, 'task_instructions') == null && result.rule && typeof result.rule.instructions === 'string') {
                        inherited = result.rule.instructions; provenance = result.rule.instructionProvenance && typeof result.rule.instructionProvenance === 'object' ? result.rule.instructionProvenance : {}; // CHANGE
                        if (!editingStarted && attr(card, OVERRIDE) == null) textarea.value = autosave.reload();
                    }
                    const refs = document.createElement('strong'); refs.textContent = 'Plant reference — general information'; references.appendChild(refs);
                    const fields = { prep: ['preferred_soil', 'fertilizer_notes'], sow: ['planting_depth', 'spacing_cm', 'water'], start: ['planting_depth', 'water', 'temp_range'], harden: ['general_care', 'sun_hours'], transplant: ['spacing_cm', 'water', 'sun_hours'], thin: ['spacing_cm', 'maintenance_pruning_thinning'], harvest: ['harvest_notes', 'storage'] };
                    (fields[result.rule && result.rule.id] || ['general_care', 'water', 'sun_hours']).forEach(key => {
                        const value = result.plant && result.plant[key]; if (value == null || value === '') return;
                        const line = document.createElement('div'); line.textContent = key.replace(/_/g, ' ') + ': ' + String(value); references.appendChild(line);
                    });
                    renderProvenance(); refreshRecipeActions();
                } catch (error) { if (!disposed && token === requestId) contextNotice.textContent = 'References unavailable: ' + error.message; }
            }
            plantingSelect.addEventListener('change', loadContext);
            function historyChanged() { if (disposed) return; editingStarted = false; textarea.value = autosave.reload(); renderProvenance(); recipePanel.style.display = 'none'; void loadContext(); }
            function modelChanged() {
                if (writing || disposed) return;
                if (!exists(card)) { autosave.dispose(); textarea.disabled = true; status.textContent = 'This task was removed. Your text has been retained.'; discard.style.display = ''; refreshRecipeActions(); }
                else { textarea.disabled = !canEdit(card); refreshRecipeActions(); }
            }
            const history = ui.editor.undoManager;
            if (history && history.addListener) { history.addListener(mxEvent.UNDO, historyChanged); history.addListener(mxEvent.REDO, historyChanged); }
            if (model.addListener) model.addListener(mxEvent.CHANGE, modelChanged);
            window.addEventListener('trellisUsersSessionChanged', modelChanged); // CHANGE: permission loss is visible before the next attempted write.
            window.addEventListener('trellisTeamPermissionModeChanged', modelChanged); // CHANGE
            function cleanup() {
                disposed = true; requestId++; autosave.dispose();
                if (model.removeListener) model.removeListener(modelChanged);
                if (history && history.removeListener) history.removeListener(historyChanged);
                window.removeEventListener('trellisUsersSessionChanged', modelChanged); window.removeEventListener('trellisTeamPermissionModeChanged', modelChanged); // CHANGE
                if (active && active.root === root) active = null;
            }
            button('Close', () => ui.hideDialog(), 'close');
            const body = document.createElement('div'); // CHANGE: scroll instructions and references independently of the action footer.
            body.style.cssText = 'display:flex;flex-direction:column;gap:10px;flex:1 1 auto;min-height:0;overflow:auto;'; // CHANGE
            Array.from(root.childNodes).filter(node => node !== actions).forEach(node => body.appendChild(node)); // CHANGE
            root.insertBefore(body, actions); actions.style.flexShrink = '0'; // CHANGE
            active = { root, card, autosave };
            renderProvenance(); refreshRecipeActions();
            ui.showDialog(root, Math.min(640, Math.max(280, window.innerWidth - 80)), Math.min(640, Math.max(300, window.innerHeight - 100)), true, true, () => {
                if (!discardUnsaved && !autosave.flush()) return false;
                cleanup(); return true;
            });
            if (ui.dialog) { // CHANGE: use the existing Task dialog backdrop and content layers.
                if (ui.dialog.bg) ui.dialog.bg.style.zIndex = '1999999999'; // CHANGE
                if (ui.dialog.container) ui.dialog.container.style.zIndex = '2000000000'; // CHANGE
            } // CHANGE
            void loadContext();
        }
        window.USL = window.USL || {};
        window.USL.guide = { open };
    });
})();
