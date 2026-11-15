#!/bin/sh
# Stop writes while copying SQLite and covers as one consistent snapshot.
set -eu
DEST="${1:-/var/backups/simmusic}"
mkdir -p "$DEST"
chmod 700 "$DEST"
FILE="$DEST/simmusic-$(date +%Y%m%d-%H%M%S).tar.gz"
systemctl stop simmusic
trap 'systemctl start simmusic' EXIT
umask 077
tar -czf "$FILE" -C /var/lib simmusic
echo "$FILE"
