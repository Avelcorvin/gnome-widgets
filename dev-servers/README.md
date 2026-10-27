# Dev Servers

GNOME Shell extension (45+) that shows local servers and Docker containers in the top panel.

The panel shows `<servers> · <running containers>`. The menu lists:

- **Servers**: TCP ports your own processes listen on (`ss -ltnp`), without ephemeral
  ports (32768+) and desktop apps such as Steam or Chrome. Click to open `http://localhost:<port>`.
- **Docker**: running containers with their published port. Click to open it in the browser.
- **Stopped**: click a container to `docker start` it.

Refreshes every 5 seconds and when the menu opens.

## Install

```bash
./install.sh
```

Then restart GNOME Shell: on X11 press Alt+F2, type `r`, Enter; on Wayland log out and back in.
