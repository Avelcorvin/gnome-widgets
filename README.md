# GNOME widgets

Personal GNOME Shell extensions (GNOME 45+) for the top panel.

| Folder | Extension | Shows |
|---|---|---|
| [`load-monitor`](load-monitor) | `load-monitor@viltal` | CPU and NVIDIA GPU load; menu with temperatures, clocks, VRAM, power, NVMe temperatures |
| [`dev-servers`](dev-servers) | `dev-servers@viltal` | Local listening servers and Docker containers; click to open or start |

## Install

Each folder has its own `install.sh`, which symlinks it into
`~/.local/share/gnome-shell/extensions/` and enables it:

```bash
./load-monitor/install.sh
./dev-servers/install.sh
```

Then restart GNOME Shell: on X11 press Alt+F2, type `r`, Enter; on Wayland log out and back in.
The symlinks point at this checkout, so after moving it run the install scripts again.

Errors show up in `journalctl -o cat -b /usr/bin/gnome-shell`.
