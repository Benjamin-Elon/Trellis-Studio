/** Patch only inventory startup registrations and dependency loading in shipped runtime bundles. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import vm from 'node:vm'; // NEW
import { fileURLToPath } from 'node:url'; // NEW
import { parse } from '@babel/parser'; // NEW
import traverseModule from '@babel/traverse'; // NEW
const traverse = traverseModule.default || traverseModule; // NEW
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drawio/src/main/webapp/js'); // NEW
const app = await fs.readFile(path.join(directory, 'diagramly/App.js'), 'utf8'); // NEW
const helper = app.slice(app.indexOf('App.loadInventoryPlugin ='), app.indexOf('App.loadPlugins =')); // NEW
const resolver = app.slice(app.indexOf('App.inventoryPluginId ='), app.indexOf('App.loadInventoryPlugin =')); // NEW // NEW
const entries = { trellisAllocationCore: 'Trellis_Allocation_Core.js', trellisSeedsCore: 'Trellis_Seeds_Core.js', trellisExchangeCore: 'Trellis_Exchange_Core.js', trellisInventories: 'Trellis_Inventories.js' }; // NEW
for (const filename of ['app.min.js', 'integrate.min.js']) { // NEW
    const fullPath = path.join(directory, filename), source = await fs.readFile(fullPath, 'utf8'), edits = [], found = new Set(); // NEW
    function register(node, name) { // NEW
        found.add(name); // NEW
        const array = node.type === 'ArrayExpression', items = array ? node.elements : node.properties; // NEW
        const key = item => item.type === 'StringLiteral' ? item.value : item.key?.name || item.key?.value; // NEW
        const anchor = items.find(item => key(item) === 'gardenDashboard'); // NEW
        if (!anchor) throw new Error(filename + ': missing gardenDashboard in ' + name); // NEW
        const additions = Object.entries(entries).filter(([id]) => (!array || id === 'trellisInventories') && !items.some(item => key(item) === id)); // NEW
        if (additions.length) edits.push({ start: anchor.start, end: anchor.start, code: additions.map(([id, file]) => array ? JSON.stringify(id) : id + ':' + JSON.stringify('plugins/garden_planner_plugins/' + file)).join(',') + ',/* NEW: inventories */' }); // NEW
    } // NEW
    traverse(parse(source), { // NEW
        noScope: true, // NEW
        AssignmentExpression({ node }) { // NEW
            const target = node.left; // NEW
            if (target.type !== 'MemberExpression' || target.object.name !== 'App') return; // NEW
            if (['pluginRegistry', 'publicPlugin'].includes(target.property.name)) register(node.right, target.property.name); // NEW
            if (target.property.name === 'inventoryPluginId') return; // NEW
            if (target.property.name === 'loadInventoryPlugin') { if (!source.includes('App.inventoryPluginId =')) edits.push({ start: node.start, end: node.start, code: resolver }); edits.push({ start: node.start, end: node.end, code: helper.slice(0, helper.lastIndexOf('};') + 1) }); return; } // NEW
            if (target.property.name !== 'loadPlugins') return; // NEW
            found.add('loader'); // NEW
            if (!source.includes('App.loadInventoryPlugin=' ) && !source.includes('App.loadInventoryPlugin =')) edits.push({ start: node.start, end: node.start, code: helper }); // NEW
            if (source.slice(node.start, node.end).includes('loadInventoryPlugin')) return; // NEW
            const match = /if\s*\([^;{}]*gardenRoadmapCore[^{}]*\)\s*\{/.exec(source.slice(node.start, node.end)); // NEW
            if (!match) throw new Error(filename + ': missing plugin loop anchor'); // NEW
            const index = /plugins\[([^\]]+)\]/.exec(match[0])?.[1]; // NEW
            if (!index) throw new Error(filename + ': missing plugin index'); // NEW
            const code = 'if(plugins[' + index + ']==="trellisInventories"||plugins[' + index + ']==="gardenPlanner"){App.loadInventoryPlugin(plugins[' + index + ']);continue;}/* NEW: dependency ordering */'; // NEW
            edits.push({ start: node.start + match.index, end: node.start + match.index, code }); // NEW
        }, // NEW
        VariableDeclarator({ node }) { // NEW
            if (node.id.name !== 'mxSettings') return; // NEW
            for (const property of node.init.properties) if (['trellisDefaultPluginIds', 'trellisDefaultPluginPaths'].includes(property.key.name)) register(property.value, property.key.name); // NEW
        } // NEW
    }); // NEW
    if (!source.includes('var inventoryId = App.inventoryPluginId(plugins[i])')) { const anchor = 'plugins[i] = App.normalizePlantingPluginPath(plugins[i]);'; const index = source.indexOf(anchor); if (index >= 0) edits.push({ start: index + anchor.length, end: index + anchor.length, code: '\nvar inventoryId = App.inventoryPluginId(plugins[i]); if (inventoryId) { App.loadInventoryPlugin(inventoryId); continue; } // NEW\n' }); } // NEW
    if (found.size !== 5) throw new Error(filename + ': expected five registration and loader anchors'); // NEW
    let updated = source; // NEW
    for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) updated = updated.slice(0, edit.start) + edit.code + updated.slice(edit.end); // NEW
    new vm.Script(updated, { filename }); // NEW
    if (updated !== source) await fs.writeFile(fullPath, updated); // NEW
    console.log(filename + ': inventory registrations checked.'); // NEW
} // NEW
