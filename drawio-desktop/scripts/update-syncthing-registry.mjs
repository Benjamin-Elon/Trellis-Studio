// NEW: narrowly update committed production bundles without rebuilding unrelated upstream code.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drawio/src/main/webapp/js');
for (const filename of ['app.min.js', 'integrate.min.js']) {
    const fullPath = path.join(directory, filename);
    const source = await fs.readFile(fullPath, 'utf8');
    const ast = parse(source, { sourceType: 'script' });
    const edits = [];
    const found = new Set();
    traverse(ast, {
        noScope: true, // NEW: registry edits do not need expensive whole-bundle binding analysis.
        AssignmentExpression({ node }) {
            const target = node.left;
            if (target.type !== 'MemberExpression' || target.object.type !== 'Identifier' || target.object.name !== 'App' || target.computed) return;
            const field = target.property.name;
            if (!['pluginRegistry', 'publicPlugin'].includes(field)) return;
            found.add(field);
            if (field === 'pluginRegistry') {
                const properties = node.right.properties;
                if (properties.some(property => (property.key.name || property.key.value) === 'trellisSyncthing')) return;
                const anchor = properties.find(property => (property.key.name || property.key.value) === 'trellisUsers');
                if (!anchor) throw new Error(filename + ': Users registry anchor is missing.');
                edits.push({ position: anchor.end, text: ',trellisSyncthing:"plugins/garden_planner_plugins/Trellis_Syncthing.js"/* NEW */' });
            } else {
                const elements = node.right.elements;
                if (elements.some(element => element.value === 'trellisSyncthing')) return;
                const anchor = elements.find(element => element.value === 'trellisUsers');
                if (!anchor) throw new Error(filename + ': Users default anchor is missing.');
                edits.push({ position: anchor.end, text: ',"trellisSyncthing"/* NEW */' });
            }
        }
    });
    if (found.size !== 2) throw new Error(filename + ': Expected production registry assignments were not found.');
    let updated = source;
    for (const edit of edits.sort((a, b) => b.position - a.position)) updated = updated.slice(0, edit.position) + edit.text + updated.slice(edit.position);
    new vm.Script(updated, { filename });
    if (updated !== source) await fs.writeFile(fullPath, updated);
    console.log(filename + ': Syncthing registry/defaults verified.');
}
