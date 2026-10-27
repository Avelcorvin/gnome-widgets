import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const INTERVAL_SECONDS = 5;
// Ports from 32768 up are ephemeral (VS Code, Steam, browsers), not dev servers.
const EPHEMERAL_PORT_START = 32768;
// Desktop apps that keep a fixed port open; not interesting here.
const IGNORED_PROCESSES = new Set(['steam', 'chrome', 'kdeconnectd', 'gjs', 'sunshine', 'code']);

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

// Runs a command and returns its stdout, or null when it is missing or fails.
async function run(argv) {
    try {
        const proc = Gio.Subprocess.new(argv,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        const [stdout] = await proc.communicate_utf8_async(null, null);
        return proc.get_successful() ? stdout : null;
    } catch {
        return null;
    }
}

// Listening TCP ports owned by the user's processes, one entry per port.
async function listServers() {
    const out = await run(['ss', '-ltnpH']);
    if (out === null)
        return [];

    const byPort = new Map();
    for (const line of out.split('\n')) {
        const process = line.match(/users:\(\("([^"]+)"/)?.[1];
        const port = Number(line.trim().split(/\s+/)[3]?.split(':').pop());
        if (!process || !port || port >= EPHEMERAL_PORT_START || IGNORED_PROCESSES.has(process))
            continue;
        byPort.set(port, {port, process});
    }
    return [...byPort.values()].sort((a, b) => a.port - b.port);
}

// All containers with their state and the first published host port.
async function listContainers() {
    const out = await run(['docker', 'ps', '-a', '--format', '{{.Names}}\t{{.State}}\t{{.Ports}}']);
    if (out === null)
        return null;

    return out.trim().split('\n').filter(Boolean).map(line => {
        const [name, state, ports] = line.split('\t');
        const port = Number(ports?.match(/:(\d+)->/)?.[1]) || null;
        return {name, running: state === 'running', port};
    });
}

function openUrl(port) {
    Gio.AppInfo.launch_default_for_uri(`http://localhost:${port}`, null);
}

export default class DevServersExtension extends Extension {
    enable() {
        this._button = new PanelMenu.Button(0.0, this.metadata.name, false);
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        box.add_child(new St.Icon({icon_name: 'network-server-symbolic', style_class: 'system-status-icon'}));
        this._label = new St.Label({text: '–', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._label);
        this._button.add_child(box);

        this._button.menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this._rendered = false;
                this._update();
            }
        });
        Main.panel.addToStatusArea(this.uuid, this._button);

        this._update();
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, INTERVAL_SECONDS, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        this._button?.destroy();
        this._button = null;
        this._label = null;
    }

    async _update() {
        const [servers, containers] = await Promise.all([listServers(), listContainers()]);
        if (!this._button)
            return;

        const running = containers?.filter(c => c.running) ?? [];
        const stopped = containers?.filter(c => !c.running) ?? [];
        this._label.text = ` ${servers.length} · ${running.length}`;

        // Rebuilding while the user is in the menu would close their submenu.
        if (this._button.menu.isOpen && this._rendered)
            return;
        this._render(servers, containers, running, stopped);
    }

    _render(servers, containers, running, stopped) {
        const menu = this._button.menu;
        menu.removeAll();
        this._rendered = true;

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Servers'));
        if (servers.length === 0)
            menu.addMenuItem(this._infoItem('none'));
        for (const s of servers)
            menu.addMenuItem(this._actionItem(`:${s.port}   ${s.process}`, () => openUrl(s.port)));

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Docker'));
        if (containers === null) {
            menu.addMenuItem(this._infoItem('docker is not available'));
            return;
        }
        if (running.length === 0)
            menu.addMenuItem(this._infoItem('no running containers'));
        for (const c of running) {
            const text = c.port ? `${c.name}   :${c.port}` : c.name;
            menu.addMenuItem(this._actionItem(text, c.port ? () => openUrl(c.port) : null));
        }

        if (stopped.length > 0) {
            const sub = new PopupMenu.PopupSubMenuMenuItem(`Stopped (${stopped.length}), click to start`);
            for (const c of stopped)
                sub.menu.addMenuItem(this._actionItem(c.name, () => this._start(c.name)));
            menu.addMenuItem(sub);
        }
    }

    async _start(name) {
        await run(['docker', 'start', name]);
        this._rendered = false;
        this._update();
    }

    _infoItem(text) {
        return new PopupMenu.PopupMenuItem(text, {reactive: false});
    }

    _actionItem(text, onActivate) {
        const item = new PopupMenu.PopupMenuItem(text, {reactive: !!onActivate});
        if (onActivate)
            item.connect('activate', onActivate);
        return item;
    }
}
