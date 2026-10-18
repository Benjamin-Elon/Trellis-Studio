/** Synchronize only the details toolbar and startup registrations into committed production bundles. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import vm from 'node:vm'; // NEW
import { fileURLToPath } from 'node:url'; // NEW
import { parse } from '@babel/parser'; // NEW
import traverseModule from '@babel/traverse'; // NEW
import generatorModule from '@babel/generator'; // NEW
const traverse = traverseModule.default || traverseModule, generate = generatorModule.default || generatorModule; // NEW
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drawio/src/main/webapp/js'); // NEW
const assignments = new Map(), settings = new Map(); // NEW
/** Stable member names identify the small set of source definitions mirrored in shipped bundles. */ // NEW
function memberName(node) { // NEW
    if (node.type === 'Identifier') return node.name; // NEW
    if (node.type === 'MemberExpression' && !node.computed) return memberName(node.object) + '.' + node.property.name; // NEW
    return ''; // NEW
} // NEW
for (const name of ['grapheditor/Toolbar.js', 'diagramly/App.js', 'diagramly/Settings.js']) { // NEW
    const source = await fs.readFile(path.join(directory, name), 'utf8'); // NEW
    traverse(parse(source), { // NEW
        noScope: true, // NEW
        AssignmentExpression({ node }) { // NEW
            const key = memberName(node.left); // NEW
            if (['Toolbar.prototype.createTextToolbar', 'Toolbar.prototype.addItem', 'App.pluginRegistry', 'App.publicPlugin'].includes(key)) assignments.set(key, node.right); // NEW
        }, // NEW
        VariableDeclarator({ node }) { // NEW
            if (node.id.name !== 'mxSettings') return; // NEW
            for (const property of node.init.properties) if (['trellisDefaultPluginIds', 'trellisDefaultPluginPaths'].includes(property.key.name)) settings.set(property.key.name, property.value); // NEW
        } // NEW
    }); // NEW
} // NEW
for (const filename of ['app.min.js', 'integrate.min.js']) { // NEW
    const fullPath = path.join(directory, filename), source = await fs.readFile(fullPath, 'utf8'), edits = [], found = new Set(); // NEW
    function replace(node, replacement, key) { // NEW
        found.add(key); // NEW
        if (!key.startsWith('Toolbar.')) { // NEW
            const items = node.type === 'ArrayExpression' ? node.elements : node.properties; // NEW
            const candidates = replacement.type === 'ArrayExpression' ? replacement.elements : replacement.properties; // NEW
            const name = item => item.type === 'StringLiteral' ? item.value : item.key.name || item.key.value; // NEW
            const item = candidates.find(item => name(item) === 'trellisObjectDetails'); // NEW
            const existing = items.find(item => name(item) === 'trellisObjectDetails'); // NEW
            if (existing) { // NEW
                const code = generate(item, { compact: true, comments: false }).code; // NEW
                if (generate(existing, { compact: true, comments: false }).code !== code) edits.push({ start: existing.start, end: existing.end, code }); // NEW
            } else { // NEW
                const anchor = items.find(item => name(item) === 'trellisContextMenu'); if (!anchor || !item) throw new Error(key + ': registration anchor is missing.'); // NEW
                edits.push({ start: anchor.end, end: anchor.end, code: ',' + generate(item, { compact: true, comments: false }).code + '/* NEW: object details */' }); // NEW
            } // NEW
            return; // NEW
        } // NEW
        const code = generate(replacement, { compact: true, comments: false }).code; // NEW
        if (source.slice(node.start, node.end) !== code) edits.push({ start: node.start, end: node.end, code }); // NEW
    } // NEW
    traverse(parse(source), { // NEW
        noScope: true, // NEW
        AssignmentExpression({ node }) { const key = memberName(node.left); if (assignments.has(key)) replace(node.right, assignments.get(key), key); }, // NEW
        VariableDeclarator({ node }) { // NEW
            if (node.id.name !== 'mxSettings') return; // NEW
            for (const property of node.init.properties) if (settings.has(property.key.name)) replace(property.value, settings.get(property.key.name), property.key.name); // NEW
        } // NEW
    }); // NEW
    if (found.size !== assignments.size + settings.size) throw new Error(filename + ': runtime anchors are missing.'); // NEW
    let updated = source; for (const edit of edits.sort((a, b) => b.start - a.start)) updated = updated.slice(0, edit.start) + edit.code + updated.slice(edit.end); // NEW
    new vm.Script(updated, { filename }); // NEW
    if (updated !== source) await fs.writeFile(fullPath, updated); // NEW
    console.log(filename + ': details toolbar and registrations synchronized.'); // NEW
} // NEW
