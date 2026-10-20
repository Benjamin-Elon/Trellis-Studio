/** Paste into the affected renderer's DevTools console before creating a garden. // NEW
 * Records no input values, typed characters, diagram text, or database contents. // NEW
 * Inspect with trellisGardenFocusTrace.snapshot(); stop/restore with .stop(). // NEW
 * This opt-in observer is test tooling; the application never loads it. */ // NEW
(function recordGardenSettingsFocus() { // NEW
    'use strict'; // NEW
    if (window.trellisGardenFocusTrace) window.trellisGardenFocusTrace.stop(); // NEW
    Draw.loadPlugin(function (ui) { // NEW
        const graph = ui.editor.graph, records = [], disposers = []; // NEW
        const startedAt = performance.now(); // NEW
        let stopped = false, dropped = 0; // NEW
        /** Deliberately omit text, IDs and values, including names embedded in attributes. */ // NEW
        function describe(node) { // NEW
            if (node === window) return { tag: 'WINDOW' }; // NEW
            if (!node) return null; // NEW
            if (!node.nodeType) return { tag: '#object' }; // NEW: method receivers such as EditorUi and Graph are not DOM nodes.
            const layer = node.closest?.('.geDialog') ? 'dialog' : node.closest?.('.geBackground') ? 'modal-background' : graph.container?.contains(node) ? 'canvas' : 'other'; // NEW
            return { tag: node.tagName || '#document', type: node.tagName === 'INPUT' ? node.type : undefined, connected: !!node.isConnected, layer, disabled: !!node.disabled }; // NEW
        } // NEW
        function record(kind, details) { // NEW
            if (stopped) return; // NEW
            if (records.length === 500) { dropped++; return; } // NEW
            records.push({ ms: Math.round(performance.now() - startedAt), kind, documentFocus: document.hasFocus(), active: describe(document.activeElement), dialogDepth: ui.dialogs?.length || 0, insideTopDialog: !!ui.dialog?.container?.contains(document.activeElement), graphMouseDown: !!graph.isMouseDown, graphEditing: !!graph.isEditing?.(), closing: !!window.__trellisClosing, ...details }); // NEW
        } // NEW
        /** Observe calls without scheduling focus, cancelling events, or changing return values. */ // NEW
        function observeCall(target, key, kind) { // NEW
            const original = target[key], descriptor = Object.getOwnPropertyDescriptor(target, key); // NEW
            if (typeof original !== 'function') return; // NEW
            function observed() { // NEW
                record(kind, { target: describe(this), stack: new Error().stack.split('\n').slice(2, 9).join('\n') }); // NEW
                return original.apply(this, arguments); // NEW
            } // NEW
            target[key] = observed; // NEW
            disposers.push(function () { // NEW
                if (target[key] !== observed) return; // NEW
                if (descriptor) Object.defineProperty(target, key, descriptor); else delete target[key]; // NEW
            }); // NEW
        } // NEW
        function listen(target, name, handler) { // NEW
            target.addEventListener(name, handler, true); // NEW
            disposers.push(() => target.removeEventListener(name, handler, true)); // NEW
        } // NEW
        function graphEvent(source, name) { // NEW
            const handler = () => record(name); // NEW
            source.addListener(name, handler); disposers.push(() => source.removeListener(handler)); // NEW
        } // NEW
        observeCall(HTMLElement.prototype, 'focus', 'element-focus-call'); // NEW
        observeCall(window, 'focus', 'window-focus-call'); // NEW
        observeCall(graph, 'startEditingAtCell', 'start-editing-call'); // NEW
        observeCall(ui, 'showDialog', 'show-dialog-call'); // NEW
        observeCall(ui, 'hideDialog', 'hide-dialog-call'); // NEW
        graphEvent(graph, 'usl:gardenModuleNeedsSettings'); // NEW
        graphEvent(graph, 'usl:taskModuleReady'); // NEW
        graphEvent(ui.editor, 'showDialog'); graphEvent(ui.editor, 'hideDialog'); // NEW
        for (const name of ['focus', 'blur', 'focusin', 'focusout', 'pointercancel']) { // NEW
            listen(window, name, event => record(name, { target: describe(event.target) })); // NEW
        } // NEW
        for (const name of ['pointerdown', 'mousedown', 'mouseup', 'click', 'keydown']) { // NEW
            listen(window, name, function (event) { // NEW
                const target = describe(event.target); // NEW
                const point = name === 'keydown' ? null : describe(document.elementFromPoint(event.clientX, event.clientY)); // NEW
                const key = name === 'keydown' && ['Escape', 'Enter', 'Tab'].includes(event.key) ? event.key : undefined; // NEW
                record(name, { target, hit: point, key }); // NEW
                // A timer observes cancellation after the complete native event dispatch. // NEW
                window.setTimeout(() => record(name + '-settled', { target, prevented: event.defaultPrevented, consumed: !!event.isConsumed }), 0); // NEW
            }); // NEW
        } // NEW
        function snapshot() { return { version: 1, stopped, dropped, records: records.slice() }; } // NEW
        window.trellisGardenFocusTrace = { // NEW
            snapshot, // NEW
            stop() { // NEW
                if (!stopped) { record('stop'); stopped = true; disposers.reverse().forEach(dispose => dispose()); } // NEW
                return snapshot(); // NEW
            } // NEW
        }; // NEW
        const expiry = window.setTimeout(() => window.trellisGardenFocusTrace.stop(), 120000); // NEW: temporary tracing expires even if the operator forgets to stop it.
        disposers.push(() => window.clearTimeout(expiry)); // NEW
        record('start'); // NEW
    }); // NEW
})(); // NEW
