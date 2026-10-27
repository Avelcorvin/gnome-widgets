import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const INTERVAL_SECONDS = 2;
const NVIDIA_QUERY = [
    'nvidia-smi',
    '--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,clocks.gr,clocks.max.gr,pstate,power.draw',
    '--format=csv,noheader,nounits',
];

// nvidia-smi load is relative to the current clock, so the power state tells whether 30% is a lot.
function describePstate(pstate) {
    const level = Number(pstate.slice(1));
    if (level <= 2)
        return 'full speed';
    return level >= 8 ? 'idle' : 'reduced';
}

// Intel exposes CPU temperature as hwmon "coretemp", AMD as "k10temp".
const CPU_SENSOR_NAMES = ['coretemp', 'k10temp'];

function readText(path) {
    try {
        const [, bytes] = GLib.file_get_contents(path);
        return new TextDecoder().decode(bytes).trim();
    } catch {
        return null;
    }
}

// The hwmon number changes between boots, so the sensor is found by name.
function findCpuSensor() {
    const dir = Gio.File.new_for_path('/sys/class/hwmon');
    const children = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    for (let info; (info = children.next_file(null));) {
        const path = `/sys/class/hwmon/${info.get_name()}`;
        if (CPU_SENSOR_NAMES.includes(readText(`${path}/name`)))
            return `${path}/temp1_input`;
    }
    return null;
}

// NVMe drives with their Composite sensor (temp1) and warning threshold. Other sensors are
// skipped: some firmware (Kingston KC3000) reports a fixed value there.
function findDisks() {
    const disks = [];
    const dir = Gio.File.new_for_path('/sys/class/hwmon');
    const children = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    for (let info; (info = children.next_file(null));) {
        const path = `/sys/class/hwmon/${info.get_name()}`;
        if (readText(`${path}/name`) !== 'nvme')
            continue;
        const warning = Number(readText(`${path}/temp1_max`));
        disks.push({
            model: readText(`${path}/device/model`) ?? info.get_name(),
            sensor: `${path}/temp1_input`,
            warning: warning ? Math.round(warning / 1000) : null,
        });
    }
    return disks.sort((a, b) => a.model.localeCompare(b.model));
}

function cpuFrequencyFiles(name) {
    const files = [];
    for (let i = 0; ; i++) {
        const path = `/sys/devices/system/cpu/cpu${i}/cpufreq/${name}`;
        if (!GLib.file_test(path, GLib.FileTest.EXISTS))
            return files;
        files.push(path);
    }
}

// Reads /proc/stat and turns the delta between two reads into a busy percentage;
// temperature and clock come from sysfs.
class CpuReader {
    constructor() {
        this._last = this._read();
        this._sensor = findCpuSensor();
        this._freqFiles = cpuFrequencyFiles('scaling_cur_freq');
        this._maxClock = Math.max(...cpuFrequencyFiles('cpuinfo_max_freq')
            .map(path => Number(readText(path)) / 1000));
    }

    // Package temperature in °C, or null without a known sensor.
    temperature() {
        const value = this._sensor && readText(this._sensor);
        return value ? Math.round(Number(value) / 1000) : null;
    }

    // Average and highest core clock in MHz, plus the fastest core's rated maximum.
    clock() {
        const mhz = this._freqFiles.map(path => Number(readText(path)) / 1000).filter(Boolean);
        if (mhz.length === 0)
            return null;
        const average = Math.round(mhz.reduce((sum, v) => sum + v, 0) / mhz.length);
        return {average, peak: Math.round(Math.max(...mhz)), max: Math.round(this._maxClock)};
    }

    _read() {
        const [, bytes] = GLib.file_get_contents('/proc/stat');
        const line = new TextDecoder().decode(bytes).split('\n')[0];
        const values = line.trim().split(/\s+/).slice(1).map(Number);
        const idle = values[3] + values[4];
        const total = values.reduce((sum, v) => sum + v, 0);
        return {idle, total};
    }

    percent() {
        const now = this._read();
        const total = now.total - this._last.total;
        const idle = now.idle - this._last.idle;
        this._last = now;
        return total > 0 ? Math.round(100 * (total - idle) / total) : 0;
    }
}

// Asks nvidia-smi for load, memory and temperature; resolves null when it is missing or fails.
class GpuReader {
    read() {
        return new Promise(resolve => {
            let proc;
            try {
                proc = Gio.Subprocess.new(NVIDIA_QUERY,
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            } catch {
                resolve(null);
                return;
            }
            proc.communicate_utf8_async(null, null, (p, result) => {
                try {
                    const [, stdout] = p.communicate_utf8_finish(result);
                    if (!p.get_successful())
                        throw new Error('nvidia-smi failed');
                    const fields = stdout.trim().split('\n')[0].split(',').map(v => v.trim());
                    const [load, memUsed, memTotal, temp, clock, maxClock] = fields.slice(0, 6).map(Number);
                    const pstate = fields[6];
                    const power = Math.round(Number(fields[7]));
                    resolve({load, memUsed, memTotal, temp, clock, maxClock, pstate, power});
                } catch {
                    resolve(null);
                }
            });
        });
    }
}

export default class LoadMonitorExtension extends Extension {
    enable() {
        this._cpu = new CpuReader();
        this._gpu = new GpuReader();

        this._button = new PanelMenu.Button(0.0, this.metadata.name, false);
        this._label = new St.Label({
            text: 'CPU –  GPU –',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'load-monitor-label',
        });
        this._button.add_child(this._label);

        this._cpuItem = this._addInfoItem('CPU');
        this._cpuTempItem = this._addInfoItem('CPU temp');
        this._cpuClockItem = this._addInfoItem('CPU clock');
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._gpuItem = this._addInfoItem('GPU');
        this._vramItem = this._addInfoItem('VRAM');
        this._tempItem = this._addInfoItem('GPU temp');
        this._clockItem = this._addInfoItem('GPU clock');
        this._powerItem = this._addInfoItem('GPU power');

        this._disks = findDisks();
        if (this._disks.length > 0)
            this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        for (const disk of this._disks)
            disk.item = this._addInfoItem(disk.model);

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
        this._cpu = null;
        this._gpu = null;
        this._disks = null;
    }

    _addInfoItem(title) {
        const item = new PopupMenu.PopupMenuItem(`${title}: –`, {reactive: false});
        item._title = title;
        this._button.menu.addMenuItem(item);
        return item;
    }

    _setInfo(item, value) {
        item.label.text = `${item._title}: ${value}`;
    }

    async _update() {
        const cpu = this._cpu.percent();
        const gpu = await this._gpu.read();
        if (!this._label)
            return;

        const gpuText = gpu ? `${gpu.load}%` : 'n/a';
        this._label.text = `CPU ${cpu}%  GPU ${gpuText}`;

        this._setInfo(this._cpuItem, `${cpu}%`);
        const cpuTemp = this._cpu.temperature();
        this._setInfo(this._cpuTempItem, cpuTemp === null ? 'n/a' : `${cpuTemp} °C`);
        const clock = this._cpu.clock();
        this._setInfo(this._cpuClockItem, clock
            ? `${clock.average} MHz avg, ${clock.peak} peak (max ${clock.max})`
            : 'n/a');
        this._setInfo(this._gpuItem, gpuText);
        this._setInfo(this._vramItem, gpu ? `${gpu.memUsed} / ${gpu.memTotal} MiB` : 'n/a');
        this._setInfo(this._tempItem, gpu ? `${gpu.temp} °C` : 'n/a');
        this._setInfo(this._clockItem, gpu
            ? `${gpu.clock} / ${gpu.maxClock} MHz (${gpu.pstate}, ${describePstate(gpu.pstate)})`
            : 'n/a');
        this._setInfo(this._powerItem, gpu ? `${gpu.power} W` : 'n/a');

        for (const disk of this._disks) {
            const value = Number(readText(disk.sensor));
            const temp = value ? `${Math.round(value / 1000)} °C` : 'n/a';
            this._setInfo(disk.item, disk.warning ? `${temp} (warning at ${disk.warning} °C)` : temp);
        }
    }
}
