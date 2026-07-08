const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const readableRenderer = path.join(repoRoot, 'drawio', 'src', 'main', 'webapp', 'mxgraph', 'src', 'view', 'mxCellRenderer.js');
const runtimeBundles = [
    path.join(repoRoot, 'drawio', 'src', 'main', 'webapp', 'js', 'app.min.js'),
    path.join(repoRoot, 'drawio', 'src', 'main', 'webapp', 'js', 'viewer.min.js'),
    path.join(repoRoot, 'drawio', 'src', 'main', 'webapp', 'js', 'viewer-static.min.js'),
    path.join(repoRoot, 'drawio', 'src', 'main', 'webapp', 'js', 'integrate.min.js')
];

const marker = 'TRELLIS CHANGE: fixed-size fold controls';

test('mxGraph fold controls use the Trellis fixed-size renderer patch', () => {
    const source = fs.readFileSync(readableRenderer, 'utf8');

    assert.match(source.slice(0, 200), new RegExp(marker));
    assert.match(source, /var fixedControlSize = 18; \/\/ CHANGE: Keep fold controls usable at every zoom level\./);
    assert.match(source, /Math\.round\(controlWidth\)/);
    assert.doesNotMatch(source, /Math\.round\(w \* s\), Math\.round\(h \* s\)/);
});

test('built draw.io bundles carry the fixed-size fold-control patch and top marker', () => {
    for (const bundle of runtimeBundles) {
        const source = fs.readFileSync(bundle, 'utf8');
        assert.match(source.slice(0, 200), new RegExp(marker), path.basename(bundle));
        assert.match(source, /g=18,k=0!=c\?b\/c:1,l=1<=k\?g:g\*k,m=1<=k\?g\/k:g/, path.basename(bundle));
        assert.match(source, /new mxRectangle\(Math\.round\(e-l\/2\),Math\.round\(f-m\/2\),Math\.round\(l\),Math\.round\(m\)\)/, path.basename(bundle));
    }
});
