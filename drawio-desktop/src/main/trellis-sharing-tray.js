// NEW: Cross-platform startup registration and reachable background sharing controls.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
/** Build an XDG Exec value using the installed executable, not an AppImage mount. */
export function getLinuxStartupCommand(app, runtime = process) { // NEW: independently validate and escape desktop-entry arguments.
    const executable = app.isPackaged && runtime.env.APPIMAGE || runtime.execPath;
    const argumentsToQuote = [executable, ...(app.isPackaged ? [] : [app.getAppPath()])];
    if (argumentsToQuote.some(value => /[\r\n\0]/.test(value))) throw new Error('Cannot register this executable for startup.');
    return argumentsToQuote.map(value => '"' + value.replace(/%/g, '%%').replace(/(["\\`$])/g, '\\$1') + '"').join(' ') + ' --trellis-background';
}
export async function setSharingStartup(app, enabled, store) {
    if (process.platform === 'linux') {
        const directory = path.join(process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config'), 'autostart');
        const filename = path.join(directory, 'trellis-sharing.desktop');
        if (enabled) {
            const command = getLinuxStartupCommand(app); // CHANGE: AppImage mounts disappear when the running process exits.
            await fs.mkdir(directory, { recursive: true });
            await fs.writeFile(filename, '[Desktop Entry]\nType=Application\nName=Trellis Studio Sharing\nExec=' + command + '\nTerminal=false\nX-GNOME-Autostart-enabled=true\n', { mode: 0o600 }); // CHANGE: validate before creating startup files.
        } else await fs.rm(filename, { force: true });
    } else {
        app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: [...(app.isPackaged ? [] : [app.getAppPath()]), '--trellis-background'] });
        if (enabled && !app.getLoginItemSettings().openAtLogin) throw new Error('The operating system did not enable startup sharing.');
    }
    store?.set('trellisSharingStartup', enabled);
}
export async function createSharingTray({ app, Tray, Menu, nativeImage, iconPath, service, openWindow, store }) {
    if (process.platform === 'linux') {
        // A successful constructor alone does not establish that the desktop displays tray icons.
        await run('gdbus', ['call', '--session', '--dest', 'org.kde.StatusNotifierWatcher', '--object-path', '/StatusNotifierWatcher', '--method', 'org.freedesktop.DBus.Peer.Ping'], { timeout: 2000 });
    }
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('Sharing tray icon is unavailable.');
    const tray = new Tray(icon.resize({ width: 20, height: 20 }));
    function update(statuses = service.listStatus()) {
        tray.setToolTip('Trellis Studio sharing');
        tray.setContextMenu(Menu.buildFromTemplate([
            { label: 'Open Trellis Studio', click: () => openWindow() }, // CHANGE: Electron passes a MenuItem argument to click handlers, not a canvas path.
            { type: 'separator' },
            ...statuses.map(status => ({ label: status.label + ': ' + (status.connectedCollaborators == null ? 'connection count unavailable' : status.connectedCollaborators + ' connected collaborators') + ' (' + status.state + ')', click: () => openWindow(status.diagramPath) })),
            { type: 'separator' },
            { label: 'Pause All Syncing', click: () => service.setPaused({ paused: true }).catch(err => tray.setToolTip(err.message)) },
            { label: 'Resume All Syncing', click: () => service.setPaused({ paused: false }).catch(err => tray.setToolTip(err.message)) },
            { label: 'Restart Sharing', click: () => service.stop().then(() => service.start()).catch(err => tray.setToolTip(err.message)) }, // CHANGE: explicit restart also resets the bounded crash budget.
            { label: 'Start Trellis at Sign-in', type: 'checkbox', checked: !!store?.get('trellisSharingStartup'), click: item => setSharingStartup(app, item.checked, store).then(() => update()).catch(err => tray.setToolTip(err.message)) },
            { label: 'Quit Trellis Studio', click: () => app.quit() }
        ]));
    }
    tray.on('double-click', () => openWindow());
    const unsubscribe = service.onStatus(update);
    update();
    return { tray, dispose() { unsubscribe(); tray.destroy(); } };
}
