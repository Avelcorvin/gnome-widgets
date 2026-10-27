#!/usr/bin/env bash
# Links this folder into the GNOME extensions directory and enables the extension.
set -euo pipefail

uuid="load-monitor@viltal"
src="$(cd "$(dirname "$0")" && pwd)"
dest="$HOME/.local/share/gnome-shell/extensions/$uuid"

mkdir -p "$(dirname "$dest")"
ln -sfn "$src" "$dest"
gnome-extensions enable "$uuid" 2>/dev/null \
  || gsettings set org.gnome.shell enabled-extensions \
       "$(gsettings get org.gnome.shell enabled-extensions | sed "s/]$/, '$uuid']/; s/\[, /[/")"

echo "Linked $dest. Restart GNOME Shell (X11: Alt+F2, r, Enter) to load changes."
