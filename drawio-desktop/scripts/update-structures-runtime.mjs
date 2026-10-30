/** Mirror only garden structure registrations into shipped bundles, preserving all other runtime code. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import vm from 'node:vm'; // NEW
import { fileURLToPath } from 'node:url'; // NEW
import { parse } from '@babel/parser'; // NEW
import traverseModule from '@babel/traverse'; // NEW
const traverse = traverseModule.default || traverseModule; // NEW
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drawio/src/main/webapp/js'); // NEW
for (const filename of ['app.min.js', 'integrate.min.js']) { // NEW
    const fullPath = path.join(directory, filename), source = await fs.readFile(fullPath, 'utf8'), edits = [], found = new Set(); // NEW
    function register(node, name) { // NEW
        found.add(name); // NEW
        const items = node.type === 'ArrayExpression' ? node.elements : node.properties; // NEW
        const key = item => item.type === 'StringLiteral' ? item.value : item.key?.name || item.key?.value; // NEW
        if (items.some(item => key(item) === 'gardenStructures')) return; // NEW
        const anchor = items.find(item => key(item) === 'gardenBeds'); // NEW
        if (!anchor) throw new Error(filename + ': missing gardenBeds registration in ' + name); // NEW
        const code = node.type === 'ArrayExpression' ? ',"gardenStructures"' : ',gardenStructures:"plugins/garden_planner_plugins/Garden_Structures.js"'; // NEW
        edits.push({ position: anchor.end, code: code + '/* NEW: garden structures */' }); // NEW
    } // NEW
    traverse(parse(source), { // NEW
        noScope: true, // NEW
        AssignmentExpression({ node }) { // NEW
            const target = node.left; // NEW
            if (target.type === 'MemberExpression' && target.object.name === 'App' && ['pluginRegistry', 'publicPlugin'].includes(target.property.name)) register(node.right, target.property.name); // NEW
        }, // NEW
        VariableDeclarator({ node }) { // NEW
            if (node.id.name !== 'mxSettings') return; // NEW
            for (const property of node.init.properties) if (['trellisDefaultPluginIds', 'trellisDefaultPluginPaths'].includes(property.key.name)) register(property.value, property.key.name); // NEW
        } // NEW
    }); // NEW
    if (found.size !== 4) throw new Error(filename + ': expected four startup registration anchors.'); // NEW
    let updated = source; // NEW
    for (const edit of edits.sort((a, b) => b.position - a.position)) updated = updated.slice(0, edit.position) + edit.code + updated.slice(edit.position); // NEW
    new vm.Script(updated, { filename }); // NEW
    if (updated !== source) await fs.writeFile(fullPath, updated); // NEW
    console.log(filename + ': garden structures registered.'); // NEW
} // NEW
