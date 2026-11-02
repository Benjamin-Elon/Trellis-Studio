/** Compact native-save transport; the coordinator independently reconstructs and validates every object effect. */ // NEW
(function (root) { // NEW
    const localView = new Set(['dx', 'dy', 'grid', 'gridSize', 'guides', 'tooltips', 'connect', 'arrows']); // NEW
    const attributes = node => Object.fromEntries(Array.from(node?.attributes || []).map(item => [item.name, item.value])); // NEW
    const normalized = node => node.nodeType === 1 ? { name: node.nodeName, attrs: attributes(node), children: Array.from(node.childNodes).filter(n => n.nodeType === 1 || n.nodeType === 3 && n.nodeValue.trim()).map(normalized) } : node.nodeValue; // NEW
    function create() { // NEW
        let savedXml, saved; // NEW
        function capture(xml) { // NEW
            if (savedXml === xml) return saved; const C = root.TrellisReferenceCore, serializer = new root.XMLSerializer(), outer = new root.DOMParser().parseFromString(xml, 'text/xml'), objects = new Map(), pages = []; // NEW
            if (outer.getElementsByTagName('parsererror').length) throw new Error('Invalid diagram XML.'); // NEW
            const containers = outer.documentElement.nodeName === 'mxGraphModel' ? [null] : Array.from(outer.getElementsByTagName('diagram')); // NEW
            for (const container of containers) { // NEW
                let model = container ? Array.from(container.childNodes).find(n => n.nodeType === 1 && n.nodeName === 'mxGraphModel') : outer.documentElement; // NEW
                if (!model) { const decoded = root.Graph?.decompress(container.textContent); if (!decoded) throw new Error('Compressed project capture is unavailable.'); model = new root.DOMParser().parseFromString(decoded, 'text/xml').documentElement; } // NEW
                const pageId = container?.getAttribute('id') || ''; pages.push({ id: pageId, page: attributes(container), model: Object.fromEntries(Object.entries(attributes(model)).filter(([key]) => !localView.has(key))) }); // NEW
                const parent = model.getElementsByTagName('root')[0]; if (!parent) throw new Error('Canvas model has no root.'); // NEW
                for (const node of Array.from(parent.childNodes).filter(n => n.nodeType === 1)) { const cell = node.nodeName === 'mxCell' ? node : node.getElementsByTagName('mxCell')[0], id = node.getAttribute('id') || cell?.getAttribute('id'); if (!id || !cell) throw new Error('Invalid project object.'); const key = JSON.stringify([pageId, id]); if (objects.has(key)) throw new Error('Duplicate project object.'); objects.set(key, { key, hash: C.snapshotDigest(C.canonical(normalized(node))), xml: serializer.serializeToString(node) }); } // NEW
            } // NEW
            const result = { objects, envelope: C.canonical(pages) }; result.hash = C.snapshotDigest(C.canonical([result.envelope, [...objects].map(([key, value]) => [key, value.hash]).sort((a, b) => a[0].localeCompare(b[0]))])); savedXml = xml; saved = result; return result; // NEW
        } // NEW
        function transaction(baseXml, xml) { // NEW
            const before = capture(baseXml), after = capture(xml); if (before.envelope !== after.envelope) return null; // NEW: structural page changes retain the existing validated full-capture path.
            const changes = []; for (const key of new Set([...before.objects.keys(), ...after.objects.keys()])) { const a = before.objects.get(key), b = after.objects.get(key); if (a?.hash !== b?.hash) changes.push({ key, before: a?.hash || null, xml: b?.xml || null }); } // NEW
            return { version: 1, baseHash: before.hash, changes }; // NEW
        } // NEW
        return { capture, transaction, reset() { savedXml = null; saved = null; } }; // NEW
    } // NEW
    root.TrellisObjectTransactions = { create }; // NEW
})(globalThis); // NEW
