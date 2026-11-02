/** Desktop Home does not need shape libraries; initialize the existing palette builders when editing starts. */ // NEW
(function (root) { // NEW
    'use strict'; // NEW
    const states = new WeakMap(); let installed = false; // NEW
    function ensure(sidebar) { // NEW
        const state = states.get(sidebar); if (!state || state.ready) return Promise.resolve(); if (state.promise) return state.promise; // NEW
        const generation = state.generation; // NEW
        state.promise = new Promise((resolve, reject) => { // NEW
            state.finish = resolve; // NEW
            function batch() { // NEW
                if (state.disposed || generation !== state.generation) { resolve(); return; } // NEW
                const started = performance.now(); // NEW
                try { // NEW
                    do { state.executing = true; state.steps[state.index].call(sidebar); state.index++; state.executing = false; } while (state.index < state.steps.length && performance.now() - started < 16); // NEW
                    if (state.index < state.steps.length) { root.setTimeout(batch, 0); return; } // NEW
                    state.ready = true; state.loading?.remove(); resolve(); // NEW
                } catch (error) { state.executing = false; state.promise = null; state.loading.textContent = 'Shapes could not be loaded. Click to retry.'; state.loading.onclick = () => { state.loading.onclick = null; void ensure(sidebar).catch(() => {}); }; reject(error); } // NEW
            } // NEW
            root.setTimeout(batch, 0); // NEW
        }); // NEW
        return state.promise; // NEW
    } // NEW
    function registerPalettes(sidebar, steps) { // NEW
        if (!installed) { for (const step of steps) step.call(sidebar); return; } // NEW
        let state = states.get(sidebar); // NEW
        if (!state) { // NEW
            state = { generation: 0, index: 0, ready: false, disposed: false }; states.set(sidebar, state); // NEW
            state.fileLoaded = () => { if (sidebar.editorUi.getCurrentFile?.()) void ensure(sidebar).catch(error => sidebar.editorUi.handleError(error)); }; // NEW
            sidebar.editorUi.editor.addListener('fileLoaded', state.fileLoaded); // NEW
        } // NEW
        state.finish?.(); state.generation++; state.steps = steps; state.index = 0; state.ready = false; state.promise = null; state.loading?.remove(); // NEW
        state.loading = document.createElement('div'); state.loading.setAttribute('role', 'status'); state.loading.textContent = 'Loading shapes…'; state.loading.style.cssText = 'padding:12px;'; sidebar.wrapper.appendChild(state.loading); // NEW
        if (sidebar.editorUi.getCurrentFile?.()) void ensure(sidebar).catch(error => sidebar.editorUi.handleError(error)); // NEW
    } // NEW
    function install() { // NEW
        if (installed || !root.Sidebar) return; installed = true; // NEW
        const show = Sidebar.prototype.showEntries; // NEW
        Sidebar.prototype.showEntries = function () { // NEW
            const state = states.get(this); // NEW
            if (!state || state.ready) return show.apply(this, arguments); // NEW
            if (state.executing) { const args = state.showArguments || arguments; state.showArguments = null; return show.apply(this, args); } // NEW
            state.showArguments = arguments; if (this.editorUi.getCurrentFile?.()) void ensure(this).catch(error => this.editorUi.handleError(error)); // NEW
        }; // NEW
        const search = Sidebar.prototype.searchEntries; // NEW
        Sidebar.prototype.searchEntries = function () { // NEW
            const state = states.get(this); if (!state || state.ready || state.executing) return search.apply(this, arguments); // NEW
            const args = arguments; ensure(this).then(() => { if (!state.disposed) search.apply(this, args); }, error => { if (typeof args[4] === 'function') args[4](error); else this.editorUi.handleError(error); }); // NEW
        }; // NEW
        const destroy = Sidebar.prototype.destroy; // NEW
        Sidebar.prototype.destroy = function () { const state = states.get(this); if (state) { state.disposed = true; state.generation++; state.finish?.(); this.editorUi.editor.removeListener(state.fileLoaded); states.delete(this); } return destroy.apply(this, arguments); }; // NEW
    } // NEW
    root.TrellisStartupUI = { install, registerPalettes, ensurePalettes: ensure }; // NEW
})(window); // NEW
