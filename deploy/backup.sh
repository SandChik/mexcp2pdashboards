#!/bin/sh
# Daily backup of the dashboard's runtime data + its encryption keys (v80).
#
# Install ONCE on the VPS as root — a root-owned COPY, never a cron entry that
# runs this file from /opt/mexc-dashboard (that tree is writable by the
# `deployer` user, so running it as root would hand deployer root):
#
#   sudo install -o root -g root -m 755 /opt/mexc-dashboard/deploy/backup.sh /usr/local/bin/mexc-dashboard-backup
#   echo '0 3 * * * root /usr/local/bin/mexc-dashboard-backup' | sudo tee /etc/cron.d/mexc-dashboard-backup
#   sudo /usr/local/bin/mexc-dashboard-backup      # first run + check
#
# Both paths are required: backend/data holds the API secrets ENCRYPTED, and
# /home/mexc/.mexc-dashboard holds the key that decrypts them (+ JWT, VAPID).
# One without the other is useless.
#
# This protects against a bad deploy, a corrupted JSON file or an accidental
# delete. It does NOT survive losing the VPS — copy an archive off the box for
# that (see DEPLOY.md → Backup).
set -eu

DEST=/var/backups/mexc-dashboard
KEEP_DAYS=14

umask 077
mkdir -p "$DEST"
chmod 700 "$DEST"

OUT="$DEST/mexc-backup-$(date +%F).tar.gz"
tar czf "$OUT.tmp" -C / opt/mexc-dashboard/backend/data home/mexc/.mexc-dashboard
mv "$OUT.tmp" "$OUT"

find "$DEST" -maxdepth 1 -name 'mexc-backup-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "backup OK: $OUT ($(du -h "$OUT" | cut -f1))"
