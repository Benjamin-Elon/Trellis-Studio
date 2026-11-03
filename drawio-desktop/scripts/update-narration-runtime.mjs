/** Mirror only SplashDialog into shipped bundles, preserving unrelated runtime work. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import vm from 'node:vm'; // NEW
import { fileURLToPath } from 'node:url'; // NEW
import { parse } from '@babel/parser'; // NEW
import traverseModule from '@babel/traverse'; // NEW
const traverse = traverseModule.default || traverseModule; // NEW
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drawio/src/main/webapp/js'); // NEW
const source = await fs.readFile(path.join(directory, 'diagramly/Dialogs.js'), 'utf8'); // NEW
/** Find exactly one host constructor rather than rebuilding or rewriting unrelated bundles. */ // NEW
function constructor(text) { // NEW
    const found = []; // NEW
    traverse(parse(text), { noScope: true, VariableDeclarator({ node }) { if (node.id.name === 'SplashDialog' && node.init?.type === 'FunctionExpression') found.push(node.init); } }); // NEW
    if (found.length !== 1) throw new Error('Expected exactly one SplashDialog constructor.'); // NEW
    return found[0]; // NEW
} // NEW
const original = constructor(source), replacement = source.slice(original.start, original.end).replace(/^[\t ]+(\r?)$/gm, '$1'); // NEW: retain the shipped bundle's empty-line convention.
for (const name of ['app.min.js']) { // NEW: the embedded integrate runtime has no Trellis license wizard.
    const filename = path.join(directory, name), bundle = await fs.readFile(filename, 'utf8'), target = constructor(bundle); // NEW
    const updated = bundle.slice(0, target.start) + replacement + bundle.slice(target.end); // NEW
    new vm.Script(updated, { filename }); // NEW
    if (updated !== bundle) await fs.writeFile(filename, updated); // NEW
    console.log(name + ': narration integration checked.'); // NEW
} // NEW
