# Load Monitor

GNOME Shell extension (45+) that shows CPU and NVIDIA GPU load in the top panel.
The menu adds CPU temperature and clock (average, busiest core, rated max), VRAM usage, GPU temperature, clock with power state (P0 full speed, P8 idle), power draw and NVMe temperatures (Composite sensor with the warning threshold). Refreshes every 2 seconds.

- CPU: `/proc/stat`, hwmon `coretemp`/`k10temp`, `cpufreq`
- GPU: `nvidia-smi` (shows `n/a` when it is missing)
- Disks: hwmon `nvme`

## Install

```bash
./install.sh
```

Then restart GNOME Shell: on X11 press Alt+F2, type `r`, Enter; on Wayland log out and back in.

## Develop

Edit `extension.js`, restart the shell, check errors with:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```
