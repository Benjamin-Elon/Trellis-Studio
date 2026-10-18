const assert = require('node:assert/strict'); // CHANGE
const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const { app, BrowserWindow } = require('electron'); // CHANGE

// Render production dialog output in Chromium; graph/event behavior is covered by the integration suite. // CHANGE
app.disableHardwareAcceleration(); // CHANGE
app.commandLine.appendSwitch('disable-gpu'); // CHANGE
app.commandLine.appendSwitch('in-process-gpu'); // CHANGE: match the existing Windows visual fixtures when GPU subprocess DLLs are unavailable.
const profile = path.join(app.getPath('temp'), 'trellis-overlap-visual-' + process.pid); // CHANGE
fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile); // CHANGE
const outputDir = path.resolve(process.argv[2] || path.join(app.getPath('temp'), 'trellis-overlap-visual')); // CHANGE

/** Reflect live form properties so the rendered snapshot matches the actual open dialog. */ // CHANGE
function dialogHTML(dialog) { // CHANGE
    const clone = dialog.cloneNode(true); // CHANGE
    const controls = dialog.querySelectorAll('input, select, textarea'); // CHANGE
    clone.querySelectorAll('input, select, textarea').forEach((control, index) => { // CHANGE
        const source = controls[index]; // CHANGE
        if (control.tagName === 'SELECT') Array.from(control.options).forEach(option => option.toggleAttribute('selected', option.value === source.value)); // CHANGE
        else { control.setAttribute('value', source.value); control.toggleAttribute('checked', source.checked); } // CHANGE
    }); // CHANGE
    return '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:24px;background:#eef2f7}body>.usl-scheduler-dialog{width:1450px!important;height:950px!important;max-height:950px!important;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 8px 24px #0002}</style></head><body>' + clone.outerHTML + '</body></html>'; // CHANGE
} // CHANGE

app.whenReady().then(async () => { // CHANGE
    fs.mkdirSync(outputDir, { recursive: true }); // CHANGE
    const win = new BrowserWindow({ show: false, width: 1500, height: 1000, webPreferences: { sandbox: false, backgroundThrottling: false } }); // CHANGE
    const results = []; // CHANGE
    try { // CHANGE
        const { createSchedulerOverlapFixture } = require('./scheduler-overlap-fixture.cjs'); // CHANGE: report fixture import failures through the normal test diagnostics.
        for (const dense of [false, true]) for (const mode of ['edit', 'allocate']) { // CHANGE
            const f = createSchedulerOverlapFixture(); // CHANGE
            let pending; // CHANGE
            try { // CHANGE
                if (dense) { // CHANGE
                    f.planting('lettuce', { plant_id: '3', plant_name: 'Lettuce with a long variety label for wrapping', variety_name: 'Autumn selection', sow_date: '2026-10-18', harvest_end: '2026-12-01' }); // CHANGE
                    f.planting('carrot', { plant_id: '5', plant_name: 'Carrot', sow_date: '2026-10-20', harvest_end: '2026-12-15' }); // CHANGE
                    f.planting('previous', { plant_id: '3', plant_name: 'Lettuce', sow_date: '2026-08-01', harvest_end: '2026-10-01' }); // CHANGE
                    f.planting('following', { plant_id: '4', plant_name: 'Fennel', sow_date: '2027-02-01', harvest_end: '2027-04-01' }); // CHANGE
                } // CHANGE
                if (mode === 'edit') await f.open(); else ({ pending } = await f.openAllocation()); // CHANGE
                const html = dialogHTML(f.getDialog()); // CHANGE
                const name = `${mode}-${dense ? 'dense' : 'basil'}`; // CHANGE
                const htmlPath = path.join(outputDir, name + '.html'); // CHANGE
                fs.writeFileSync(htmlPath, html); await win.loadFile(htmlPath); // CHANGE
                const measurements = await win.webContents.executeJavaScript(`(() => { // CHANGE
                    const timing = document.querySelector('[data-scheduler-timing]'); // CHANGE
                    const compatibility = document.querySelector('[data-scheduler-compatibility]'); // CHANGE
                    const lanes = Array.from(document.querySelectorAll('[data-scheduler-context-date]')); // CHANGE
                    return {timing:timing.textContent,compatibility:compatibility.textContent,lanes:lanes.map(lane=>({id:lane.dataset.schedulerContextDate,text:lane.textContent,overflow:lane.scrollWidth>lane.clientWidth+1,marker:!!lane.querySelector('[data-scheduler-context-marker]')})),bodyOverflow:document.querySelector('.usl-scheduler-body').scrollWidth>document.querySelector('.usl-scheduler-body').clientWidth+1}; // CHANGE
                })()`); // CHANGE
                assert.match(measurements.timing, /Basil|Lettuce/); // CHANGE
                assert.match(measurements.compatibility, /Companion overlap|Compatibility unknown/); // CHANGE: dense text may show the two nearest crops instead of Basil.
                assert.equal(measurements.bodyOverflow, false); // CHANGE
                assert.ok(measurements.lanes.every(lane => !lane.overflow)); // CHANGE
                assert.equal(measurements.lanes.find(lane => lane.id === 'basil').marker, false); // CHANGE
                fs.writeFileSync(path.join(outputDir, name + '.png'), (await win.webContents.capturePage()).toPNG()); // CHANGE
                results.push({ name, ...measurements }); // CHANGE
            } finally { // CHANGE
                f.button('Cancel')?.click(); if (pending) await pending; f.close(); // CHANGE
            } // CHANGE
        } // CHANGE
        console.log('OVERLAP_VISUAL_RESULT:' + JSON.stringify({ outputDir, results })); // CHANGE
    } catch (error) { console.error(error); process.exitCode = 1; } // CHANGE
    finally { win.destroy(); app.exit(process.exitCode || 0); } // CHANGE
}); // CHANGE
