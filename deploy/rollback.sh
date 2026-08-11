#!/usr/bin/env bash
#
# Removes everything deploy/install.sh created, returning the server to its
# previous state.
#
# Roundcube, iRedAdmin, SOGo, dovecot.conf and every iRedMail table are
# untouched by both scripts, so there is nothing to restore for them.
#
#   sudo bash deploy/rollback.sh            # stop and unhook, keep data
#   sudo PURGE_DATA=yes bash deploy/rollback.sh   # also drop the database

set -uo pipefail

APP_DIR="${APP_DIR:-/opt/pulsemail-client}"
SERVICE_USER="${SERVICE_USER:-pulsemail}"
APP_DB="${APP_DB:-pulsemail}"
MASTER_USER="${MASTER_USER:-pulsemail-master}"
MASTER_FILE="/etc/dovecot/dovecot-master-users"
NGINX_CONF="/etc/nginx/sites-enabled/pulsemail-client.conf"
PURGE_DATA="${PURGE_DATA:-no}"

step() { printf '\n\033[1m>> %s\033[0m\n' "$1"; }
say()  { printf '   %s\n' "$1"; }

[ "$(id -u)" -eq 0 ] || { echo "run this with sudo" >&2; exit 1; }

step "Stopping the service"
if systemctl list-unit-files | grep -q '^pulsemail-client'; then
    systemctl disable --now --quiet pulsemail-client 2>/dev/null || true
    rm -f /etc/systemd/system/pulsemail-client.service
    systemctl daemon-reload
    say "service stopped and removed"
else
    say "no service installed"
fi

step "Removing the nginx server block"
if [ -f "$NGINX_CONF" ]; then
    rm -f "$NGINX_CONF"
    if nginx -t >/dev/null 2>&1; then
        systemctl reload nginx
        say "removed and nginx reloaded"
    else
        say "WARNING: nginx -t fails after removal; inspect the configuration manually"
    fi
else
    say "no server block present"
fi

# certbot leaves the TLS block it added inside the file we just deleted, so
# nothing further is needed. The certificate itself is harmless if left.

step "Removing the Dovecot master user"
if [ -f "$MASTER_FILE" ] && grep -q "^${MASTER_USER}:" "$MASTER_FILE" 2>/dev/null; then
    cp -a "$MASTER_FILE" "${MASTER_FILE}.bak.$(date +%Y%m%d%H%M%S)"
    tmp="$(mktemp)"
    grep -v "^${MASTER_USER}:" "$MASTER_FILE" > "$tmp" || true
    cat "$tmp" > "$MASTER_FILE"
    rm -f "$tmp"
    chown dovecot:dovecot "$MASTER_FILE"
    chmod 500 "$MASTER_FILE"
    doveadm reload
    say "removed $MASTER_USER and reloaded Dovecot"
else
    say "no master user entry to remove"
fi

step "Application files"
if [ -d "$APP_DIR" ]; then
    rm -rf "$APP_DIR"
    say "removed $APP_DIR"
else
    say "nothing at $APP_DIR"
fi

step "Database"
if [ "$PURGE_DATA" = "yes" ]; then
    sudo -u postgres psql -q -d vmail -c "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM $APP_DB" 2>/dev/null || true
    sudo -u postgres psql -q -d vmail -c "REVOKE ALL ON SCHEMA public FROM $APP_DB" 2>/dev/null || true
    sudo -u postgres psql -q -d vmail -c "REVOKE ALL ON DATABASE vmail FROM $APP_DB" 2>/dev/null || true
    sudo -u postgres dropdb --if-exists "$APP_DB"
    sudo -u postgres psql -q -c "DROP ROLE IF EXISTS $APP_DB"
    rm -f /etc/pulsemail-client.dbpw /etc/pulsemail-client.masterpw
    say "dropped the $APP_DB database and role"
else
    say "kept the $APP_DB database; re-run with PURGE_DATA=yes to drop it"
fi

step "Service account"
if id -u "$SERVICE_USER" >/dev/null 2>&1 && [ "$PURGE_DATA" = "yes" ]; then
    userdel "$SERVICE_USER" 2>/dev/null || true
    say "removed user $SERVICE_USER"
else
    say "kept user $SERVICE_USER"
fi

printf '\n\033[1m>> Done\033[0m\n'
printf '   Roundcube, iRedAdmin, SOGo and all iRedMail data were never modified.\n\n'
