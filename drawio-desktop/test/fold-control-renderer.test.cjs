const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm'); // CHANGE

const repoRoot = path.resolve(__dirname, '..');
const readableRenderer = path.join(repoRoot, 'drawio', 'src', 'main', 'webapp', 'mxgraph', 'src', 'view', 'mxCellRenderer.js');
const runtimeBundles = [
    path.join(repoRoot, 'drawio', 'src', 'main', 'webapp', 'js', 'app.min.js'),
    path.join(repoRoot, 'drawio', 'src', 'main', 'webapp', 'js', 'viewer.min.js'),
    path.join(repoRoot, 'drawio', 'src', 'main', 'webapp', 'js', 'viewer-static.min.js'),
    path.join(repoRoot, 'drawio', 'src', 'main', 'webapp', 'js', 'integrate.min.js')
];

const marker = 'TRELLIS CHANGE: fixed-size fold controls';

function loadReadableControlClickHandler() {
    const source = fs.readFileSync(readableRenderer, 'utf8');
    const start = source.indexOf('mxCellRenderer.prototype.createControlClickHandler = function(state)');
    const nextHeader = source.indexOf('Function: initControl', start);
    const end = source.lastIndexOf('/**', nextHeader);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);

    const context = {
        mxCellRenderer: function () {},
        mxEvent: { consume(evt) { evt.consumed = true; } },
        mxUtils: {
            bind(scope, fn) { return fn.bind(scope); },
            indexOf(cells, cell) { return cells.indexOf(cell); }
        }
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    return context.mxCellRenderer.prototype.createControlClickHandler;
}

function makeCell(id, parent, foldable) {
    return {
        id,
        parent,
        foldable: foldable !== false,
        collapsed: false,
        getId() { return this.id; }
    };
}

function makeFoldGraph(selection) {
    const foldCalls = [];
    return {
        foldCalls,
        model: { getParent(cell) { return cell && cell.parent; } },
        isEnabled() { return true; },
        isCellCollapsed(cell) { return !!(cell && cell.collapsed); },
        getSelectionCells() { return selection; },
        getFoldableCells(cells) { return (cells || []).filter(cell => cell && cell.foldable); },
        foldCells(collapse, recurse, cells, checkFoldable, evt) {
            foldCalls.push({ collapse, recurse, cells, checkFoldable, evt });
            (cells || []).forEach(cell => { cell.collapsed = !!collapse; });
        }
    };
}

test('mxGraph fold controls use the Trellis fixed-size renderer patch', () => {
    const source = fs.readFileSync(readableRenderer, 'utf8');

    assert.match(source.slice(0, 200), new RegExp(marker));
    assert.match(source, /var fixedControlSize = 18; \/\/ CHANGE: Keep fold controls usable at every zoom level\./);
    assert.match(source, /var controlGap = 2; \/\/ CHANGE: Keep fold controls directly above the top-left corner\./);
    assert.match(source, /cx = state\.x \+ 4; \/\/ CHANGE: Move fold control 4px right\./);
    assert.match(source, /cy = state\.y - controlGap - 2 - controlHeight \/ 2; \/\/ CHANGE: Move fold control 2px up\./);
    assert.match(source, /Math\.round\(controlWidth\)/);
    assert.match(source, /var targets = \[\]; \/\/ CHANGE: Native fold controls apply to the clicked cell plus selected foldable cells\./); // CHANGE
    assert.match(source, /var model = graph\.model; \/\/ CHANGE: Batch folding is scoped to the clicked cell's immediate parent\./); // CHANGE
    assert.match(source, /var clickedParent = \(model != null && model\.getParent != null\) \? model\.getParent\(state\.cell\) : null; \/\/ CHANGE/); // CHANGE
    assert.match(source, /addTarget\(state\.cell\); \/\/ CHANGE/); // CHANGE
    assert.match(source, /var selectionCells = state\.__trellisFoldSelectionCells \|\|/); // CHANGE
    assert.match(source, /var selectedTargets = graph\.getFoldableCells\(selectionCells, collapse\);/); // CHANGE
    assert.match(source, /state\.__trellisFoldSelectionCells = \(cells != null && cells\.slice != null\) \? cells\.slice\(\) : cells;/); // CHANGE
    assert.match(source, /model\.getParent\(selectedTargets\[i\]\) == clickedParent\) \/\/ CHANGE/); // CHANGE
    assert.match(source, /mxUtils\.indexOf\(targets, cell\) >= 0/); // CHANGE
    assert.match(source, /graph\.foldCells\(collapse, false, targets, null, evt\)/); // CHANGE
    assert.match(source, /state\.__trellisFoldSelectionCells = null; \/\/ CHANGE/); // CHANGE
    assert.match(source, /scheduleFoldSelectionSnapshotClear\(\); \/\/ CHANGE/); // CHANGE
    assert.doesNotMatch(source, /state\.x - controlGap - controlWidth \/ 2/);
    assert.doesNotMatch(source, /state\.x \+ w \* s/);
    assert.doesNotMatch(source, /state\.y \+ h \* s/);
    assert.doesNotMatch(source, /graph\.foldCells\(collapse, false, \[state\.cell\], null, evt\)/); // CHANGE
});

test('native fold controls batch only selected foldable siblings in the clicked scope', () => {
    const createHandler = loadReadableControlClickHandler();
    const root = makeCell('root', null);
    const module = makeCell('module', root);
    const siblingParent = makeCell('siblingParent', root);
    const clicked = makeCell('clicked', module);
    const selectedSibling = makeCell('selectedSibling', module);
    const selectedAncestor = module;
    const selectedDescendant = makeCell('selectedDescendant', clicked);
    const selectedOtherScope = makeCell('selectedOtherScope', siblingParent);
    const graph = makeFoldGraph([selectedAncestor, clicked, selectedSibling, selectedDescendant, selectedOtherScope]);
    const evt = {};

    const handler = createHandler.call({ forceControlClickHandler: false }, { cell: clicked, view: { graph } });
    handler(evt);

    assert.deepEqual(Array.from(graph.foldCalls.at(-1).cells, cell => cell.id), ['clicked', 'selectedSibling']);
    assert.equal(clicked.collapsed, true);
    assert.equal(selectedSibling.collapsed, true);
    assert.equal(selectedAncestor.collapsed, false);
    assert.equal(selectedDescendant.collapsed, false);
    assert.equal(selectedOtherScope.collapsed, false);
    assert.equal(evt.consumed, true);
});

test('native fold controls use the mousedown selection snapshot after live selection narrows', () => {
    const createHandler = loadReadableControlClickHandler();
    const root = makeCell('root', null);
    const module = makeCell('module', root);
    const clicked = makeCell('clicked', module);
    const selectedSibling = makeCell('selectedSibling', module);
    const selectedAncestor = module;
    const selectedOtherScope = makeCell('selectedOtherScope', root);
    const state = {
        cell: clicked,
        view: { graph: makeFoldGraph([clicked]) },
        __trellisFoldSelectionCells: [selectedAncestor, clicked, selectedSibling, selectedOtherScope]
    };

    const handler = createHandler.call({ forceControlClickHandler: false }, state);
    handler({});

    assert.deepEqual(Array.from(state.view.graph.foldCalls.at(-1).cells, cell => cell.id), ['clicked', 'selectedSibling']);
    assert.equal(clicked.collapsed, true);
    assert.equal(selectedSibling.collapsed, true);
    assert.equal(selectedAncestor.collapsed, false);
    assert.equal(selectedOtherScope.collapsed, false);
    assert.equal(state.__trellisFoldSelectionCells, null);
});

test('clicking a parent fold control still folds the parent without selected children', () => {
    const createHandler = loadReadableControlClickHandler();
    const root = makeCell('root', null);
    const module = makeCell('module', root);
    const selectedChild = makeCell('selectedChild', module);
    const graph = makeFoldGraph([module, selectedChild]);

    const handler = createHandler.call({ forceControlClickHandler: false }, { cell: module, view: { graph } });
    handler({});

    assert.deepEqual(Array.from(graph.foldCalls.at(-1).cells, cell => cell.id), ['module']);
    assert.equal(module.collapsed, true);
    assert.equal(selectedChild.collapsed, false);
});

test('built draw.io bundles carry the fixed-size fold-control patch and top marker', () => {
    for (const bundle of runtimeBundles) {
        const source = fs.readFileSync(bundle, 'utf8');
        assert.match(source.slice(0, 200), new RegExp(marker), path.basename(bundle));
        assert.match(source, /g=18,k=0!=c\?b\/c:1,l=1<=k\?g:g\*k,m=1<=k\?g\/k:g,n=2/, path.basename(bundle));
        assert.match(source, /e=a\.x\+4,f=a\.y-n-2-m\/2/, path.basename(bundle));
        assert.match(source, /new mxRectangle\(Math\.round\(e-l\/2\),Math\.round\(f-m\/2\),Math\.round\(l\),Math\.round\(m\)\)/, path.basename(bundle));
        assert.match(source, /m\(a\.cell\);if\(null!=b\.getFoldableCells\)for\(var n=a\.__trellisFoldSelectionCells\|\|\(null!=b\.getSelectionCells\?b\.getSelectionCells\(\):null\),p=b\.getFoldableCells\(n,d\),q=0;null!=p&&q<p\.length;q\+\+\)null!=e&&null!=e\.getParent&&e\.getParent\(p\[q\]\)==f&&m\(p\[q\]\);try\{b\.foldCells\(d,!1,g,null,c\)\}finally\{a\.__trellisFoldSelectionCells=null\}/, path.basename(bundle)); // CHANGE
        assert.match(source, /a\.__trellisFoldSelectionCells=null!=l&&null!=l\.slice\?l\.slice\(\):l/, path.basename(bundle)); // CHANGE
        assert.match(source, /window\.setTimeout\(g,0\):g\(\)/, path.basename(bundle)); // CHANGE
        assert.doesNotMatch(source, /e=a\.x,f=a\.y-n-m\/2/, path.basename(bundle));
        assert.doesNotMatch(source, /e=a\.x-n-l\/2,f=a\.y-n-m\/2/, path.basename(bundle));
        assert.doesNotMatch(source, /e=a\.x\+b\*d,f=a\.y\+c\*d/, path.basename(bundle));
        assert.doesNotMatch(source, /b\.foldCells\(d,!1,\[a\.cell\],null,c\)/, path.basename(bundle)); // CHANGE
        assert.doesNotMatch(source, /for\(var h=b\.getFoldableCells\(b\.getSelectionCells\(\),d\),m=0;null!=h&&m<h\.length;m\+\+\)g\(h\[m\]\)/, path.basename(bundle)); // CHANGE
        if (path.basename(bundle) === 'integrate.min.js') {
            assert.match(source, /x\(b\.cell\);if\(null!=c\.getFoldableCells\)for\(var u=b\.__trellisFoldSelectionCells\|\|\(null!=c\.getSelectionCells\?c\.getSelectionCells\(\):null\),y=c\.getFoldableCells\(u,e\),C=0;null!=y&&C<y\.length;C\+\+\)null!=f&&null!=f\.getParent&&f\.getParent\(y\[C\]\)==g&&x\(y\[C\]\);try\{c\.foldCells\(e,!1,m,null,d\)\}finally\{b\.__trellisFoldSelectionCells=null\}/, path.basename(bundle)); // CHANGE
            assert.doesNotMatch(source, /c\.foldCells\(e,!1,\[b\.cell\],null,d\)/, path.basename(bundle)); // CHANGE
            assert.doesNotMatch(source, /for\(var p=c\.getFoldableCells\(c\.getSelectionCells\(\),e\),u=0;null!=p&&u<p\.length;u\+\+\)m\(p\[u\]\)/, path.basename(bundle)); // CHANGE
        }
    }
});
