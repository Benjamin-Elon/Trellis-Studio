/** Transform the same host palette builder in source and shipped bundles without rebuilding unrelated work. */ // NEW
import fs from 'node:fs/promises'; // NEW
import { parse } from '@babel/parser'; // NEW
import traverseModule from '@babel/traverse'; // NEW
const traverse = traverseModule.default || traverseModule; // NEW
for (const name of ['diagramly/sidebar/Sidebar.js', 'app.min.js', 'integrate.min.js']) { // NEW
    const filename = 'drawio/src/main/webapp/js/' + name, source = await fs.readFile(filename, 'utf8'), edits = []; // NEW
    traverse(parse(source, { sourceType: 'script' }), { AssignmentExpression(path) { // NEW
        const n = path.node, left = n.left; // NEW
        if (left?.property?.name !== 'initPalettes' || left.object?.property?.name !== 'prototype' || left.object.object?.name !== 'Sidebar' || n.right.type !== 'FunctionExpression') return; // NEW
        if (source.slice(n.right.start, n.right.end).includes('trellisPaletteSteps')) { // CHANGE
            const body = source.slice(n.right.body.start + 1, n.right.body.end - 1), marked = body.replace(/^var [^\r\n]+;$/gm, '$& // CHANGE').replace(/^var trellisPaletteSteps = \[$/gm, '$& // CHANGE').replace(/^function\(\) \{$/gm, '$& // CHANGE').replace(/^\},?$/gm, '$& // CHANGE'); // NEW: annotate moved declarations and generated boundaries without changing existing builders.
            if (marked !== body) edits.push({ start: n.right.body.start + 1, end: n.right.body.end - 1, body: marked }); return; // NEW
        } // NEW
        const statements = n.right.body.body, variables = []; let first = 0; // NEW
        while (statements[first]?.type === 'VariableDeclaration') { variables.push(source.slice(statements[first].start, statements[first].end) + ' // CHANGE'); first++; } // CHANGE
        const steps = statements.slice(first).map((statement, index, all) => 'function() { // CHANGE\n' + source.slice(statement.start, statement.end) + '\n}' + (index < all.length - 1 ? ',' : '') + ' // CHANGE'); // CHANGE
        const body = '\n' + variables.join('\n') + '\nvar trellisPaletteSteps = [ // CHANGE\n' + steps.join('\n') + '\n]; // CHANGE: yield between existing palette builders.\nif (window.TrellisStartupUI) return window.TrellisStartupUI.registerPalettes(this, trellisPaletteSteps); // NEW\nfor (var trellisPaletteIndex = 0; trellisPaletteIndex < trellisPaletteSteps.length; trellisPaletteIndex++) trellisPaletteSteps[trellisPaletteIndex].call(this); // NEW\n'; // CHANGE
        edits.push({ start: n.right.body.start + 1, end: n.right.body.end - 1, body }); // NEW
    } }); // NEW
    if (edits.length > 1) throw new Error('Ambiguous palette builder: ' + name); // NEW
    let updated = source; for (const edit of edits.sort((a,b) => b.start-a.start)) updated = updated.slice(0,edit.start) + edit.body + updated.slice(edit.end); // NEW
    parse(updated, { sourceType: 'script' }); if (updated !== source) await fs.writeFile(filename, updated); // NEW
    console.log(name + ': deferred palette steps checked'); // NEW
} // NEW
