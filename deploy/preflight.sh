#!/usr/bin/env bash
#
# Read-only readiness report for deploying pulsemail-client onto an existing
# iRedMail server.
#
# This script changes nothing. It does not write files, install packages,
# restart services or modify any configuration. Every command is an inspection.
# It is safe to run on a production mail server during business hours.
#
# Usage, without copying anything to the server:
#
#   ssh -p 777 pulsereal@38.107.236.58 'bash -s' < deploy/preflight.sh
#
# Run it as a user with passwordless sudo if you can. Without sudo the Dovecot,
# Postfix and database sections are mostly unreadable and the report will say
# so rather than guessing.

set -uo pipefail

# ---------------------------------------------------------------------------
# Reporting helpers
# ---------------------------------------------------------------------------

if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
    C_OK=$(tput setaf 2); C_WARN=$(tput setaf 3); C_BAD=$(tput setaf 1)
    C_HEAD=$(tput bold); C_DIM=$(tput setaf 8); C_OFF=$(tput sgr0)
else
    C_OK=""; C_WARN=""; C_BAD=""; C_HEAD=""; C_DIM=""; C_OFF=""
fi

blockers=0
warnings=0

section() { printf '\n%s== %s ==%s\n' "$C_HEAD" "$1" "$C_OFF"; }
ok()      { printf '  %s[ ok ]%s   %s\n' "$C_OK" "$C_OFF" "$1"; }
info()    { printf '  %s[ .. ]%s   %s\n' "$C_DIM" "$C_OFF" "$1"; }
warn()    { printf '  %s[warn]%s   %s\n' "$C_WARN" "$C_OFF" "$1"; warnings=$((warnings + 1)); }
bad()     { printf '  %s[STOP]%s   %s\n' "$C_BAD" "$C_OFF" "$1"; blockers=$((blockers + 1)); }

# Non-interactive sudo only, so this never hangs waiting for a password.
SUDO=""
if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
    HAVE_ROOT=yes
elif sudo -n true 2>/dev/null; then
    SUDO="sudo -n"
    HAVE_ROOT=yes
else
    HAVE_ROOT=no
fi

has() { command -v "$1" >/dev/null 2>&1; }

# Reads a file if permitted, printing nothing when it cannot.
peek() { $SUDO cat "$1" 2>/dev/null; }

printf '%spulsemail-client deployment preflight%s\n' "$C_HEAD" "$C_OFF"
printf '%s%s on %s%s\n' "$C_DIM" "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$(hostname -f 2>/dev/null || hostname)" "$C_OFF"
printf '%sread-only: this script modifies nothing%s\n' "$C_DIM" "$C_OFF"

# ---------------------------------------------------------------------------
section "Access"
# ---------------------------------------------------------------------------

info "running as $(id -un) (uid $(id -u))"
if [ "$HAVE_ROOT" = yes ]; then
    ok "root access available, full inspection possible"
else
    warn "no passwordless sudo; Dovecot, Postfix and database checks will be limited"
fi

# ---------------------------------------------------------------------------
section "System"
# ---------------------------------------------------------------------------

if [ -r /etc/os-release ]; then
    . /etc/os-release
    info "${PRETTY_NAME:-unknown} ($(uname -m))"
fi
info "kernel $(uname -r)"

mem_total=$(awk '/MemTotal/ {printf "%.1f", $2/1024/1024}' /proc/meminfo 2>/dev/null)
[ -n "$mem_total" ] && info "memory ${mem_total} GiB total"

disk_avail=$(df -Pk /opt 2>/dev/null | awk 'NR==2 {printf "%.1f", $4/1024/1024}')
if [ -n "$disk_avail" ]; then
    if awk "BEGIN{exit !($disk_avail < 2)}"; then
        warn "only ${disk_avail} GiB free on /opt; the build needs roughly 1 GiB"
    else
        ok "${disk_avail} GiB free on /opt"
    fi
fi

if has node; then
    node_ver=$(node --version | tr -d 'v')
    node_major=${node_ver%%.*}
    if [ "$node_major" -ge 18 ] 2>/dev/null; then
        ok "node $node_ver"
    else
        bad "node $node_ver is too old; version 18 or newer is required"
    fi
else
    bad "node is not installed"
fi

has npm && info "npm $(npm --version 2>/dev/null)" || bad "npm is not installed"
has git && info "git $(git --version 2>/dev/null | awk '{print $3}')" || warn "git is not installed"

if has getenforce; then
    se=$(getenforce 2>/dev/null)
    if [ "$se" = "Enforcing" ]; then
        warn "SELinux is Enforcing; nginx needs 'setsebool -P httpd_can_network_connect 1' to proxy to the API"
    else
        info "SELinux $se"
    fi
fi

# ---------------------------------------------------------------------------
section "PostgreSQL"
# ---------------------------------------------------------------------------

if has psql; then
    info "client $(psql --version | awk '{print $3}')"
else
    warn "psql client not found; database checks will be skipped"
fi

pg_running=no
if has systemctl && $SUDO systemctl is-active --quiet postgresql 2>/dev/null; then
    pg_running=yes
elif pgrep -x postgres >/dev/null 2>&1; then
    pg_running=yes
fi
[ "$pg_running" = yes ] && ok "PostgreSQL is running" || bad "PostgreSQL does not appear to be running"

# iRedMail keeps the vmail credentials in the Postfix lookup files. Read the
# password only to test connectivity; it is never printed.
VMAIL_PW=""
for f in /etc/postfix/pgsql/virtual_mailbox_maps.cf \
         /etc/postfix/pgsql/virtual_mailbox_domains.cf; do
    [ -z "$VMAIL_PW" ] || break
    VMAIL_PW=$(peek "$f" | awk -F'= *' '/^password/ {print $2; exit}')
done

runsql() {
    # Prefer the vmail credentials; fall back to a postgres peer connection.
    if [ -n "$VMAIL_PW" ]; then
        PGPASSWORD="$VMAIL_PW" psql -h 127.0.0.1 -U vmail -d vmail -tAc "$1" 2>/dev/null
    elif [ "$HAVE_ROOT" = yes ]; then
        $SUDO -u postgres psql -d vmail -tAc "$1" 2>/dev/null
    fi
}

if [ -n "$VMAIL_PW" ]; then
    info "found vmail credentials in the Postfix lookup files"
elif [ "$HAVE_ROOT" = yes ]; then
    info "no Postfix lookup password readable; trying a postgres peer connection"
fi

if [ "$(runsql 'SELECT 1')" = "1" ]; then
    ok "connected to the vmail database"

    for t in mailbox domain domain_admins alias forwardings; do
        present=$(runsql "SELECT to_regclass('public.$t') IS NOT NULL")
        if [ "$present" = "t" ]; then
            ok "table $t present"
        else
            bad "table $t is missing; this does not look like an iRedMail vmail database"
        fi
    done

    for t in used_quota last_login; do
        present=$(runsql "SELECT to_regclass('public.$t') IS NOT NULL")
        if [ "$present" = "t" ]; then
            rows=$(runsql "SELECT COUNT(*) FROM $t")
            if [ "${rows:-0}" -gt 0 ] 2>/dev/null; then
                ok "table $t present and populated ($rows rows)"
            else
                warn "table $t exists but is empty; quota and last-login reporting will show zeros until Dovecot's dict is configured"
            fi
        else
            warn "table $t is missing; quota or last-login reporting will be unavailable"
        fi
    done

    domains=$(runsql "SELECT COUNT(*) FROM domain")
    boxes=$(runsql "SELECT COUNT(*) FROM mailbox")
    admins=$(runsql "SELECT COUNT(*) FROM domain_admins")
    info "${domains:-?} domains, ${boxes:-?} mailboxes, ${admins:-?} domain admin entries"

    if [ "${boxes:-0}" -gt 0 ] 2>/dev/null; then
        schemes=$(runsql "SELECT DISTINCT substring(password from '^\{[A-Za-z0-9-]+\}') FROM mailbox WHERE password LIKE '{%'")
        if [ -n "$schemes" ]; then
            info "password schemes in use: $(echo "$schemes" | tr '\n' ' ')"
            for s in $schemes; do
                case "$s" in
                    '{SSHA}'|'{SSHA512}'|'{SSHA256}'|'{BCRYPT}'|'{CRYPT}'|'{PLAIN-MD5}') ;;
                    *) warn "password scheme $s is not implemented by this client; those users could not log in" ;;
                esac
            done
        else
            warn "no scheme prefix found in mailbox.password; verify the hashing format before cutting over"
        fi
    fi

    globals=$(runsql "SELECT COUNT(*) FROM domain_admins WHERE domain='ALL'")
    if [ "${globals:-0}" -gt 0 ] 2>/dev/null; then
        ok "${globals} global admin(s) configured, so the admin UI will be reachable"
    else
        warn "no rows in domain_admins with domain='ALL'; nobody will have global admin in the new UI"
    fi
else
    warn "could not query the vmail database; run this with sudo for a complete report"
fi

# Does our own database already exist from a previous attempt?
if [ "$HAVE_ROOT" = yes ]; then
    exists=$($SUDO -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='pulsemail'" 2>/dev/null)
    if [ "$exists" = "1" ]; then
        warn "a 'pulsemail' database already exists; a redeploy will reuse it rather than start clean"
    else
        info "no 'pulsemail' database yet, as expected for a first deployment"
    fi
fi

# ---------------------------------------------------------------------------
section "Dovecot"
# ---------------------------------------------------------------------------

if has dovecot; then
    ok "dovecot $($SUDO dovecot --version 2>/dev/null | awk '{print $1}')"
else
    bad "dovecot is not installed"
fi

if has doveconf && [ "$HAVE_ROOT" = yes ]; then
    conf=$($SUDO doveconf -n 2>/dev/null)

    protocols=$(printf '%s' "$conf" | awk -F'= *' '/^protocols/ {print $2; exit}')
    info "protocols: ${protocols:-unknown}"

    case "$protocols" in
        *sieve*) ok "the sieve protocol is enabled" ;;
        *) bad "sieve is not in the protocols line; mail filters and vacation replies will not work until Pigeonhole is enabled" ;;
    esac

    if printf '%s' "$conf" | grep -q 'master *= *yes'; then
        ok "a master passdb is already configured"
        sep=$(printf '%s' "$conf" | awk -F'= *' '/auth_master_user_separator/ {print $2; exit}')
        if [ -n "$sep" ]; then
            info "auth_master_user_separator is '$sep'; set IMAP_MASTER_SEPARATOR to match"
        else
            warn "no auth_master_user_separator set; Dovecot defaults to '*', which matches our default"
        fi
    else
        warn "no master passdb found; step 3 of DEPLOYMENT.md must be completed or no mail can be read"
    fi

    maillocation=$(printf '%s' "$conf" | awk -F'= *' '/^ *mail_location/ {print $2; exit}')
    [ -n "$maillocation" ] && info "mail_location: $maillocation"

    if printf '%s' "$conf" | grep -q 'quota_clone'; then
        ok "quota_clone is configured, so used_quota will stay current"
    else
        warn "quota_clone not found; mailbox usage figures will not update"
    fi
else
    warn "cannot read the Dovecot configuration without sudo"
fi

if has ss; then
    if $SUDO ss -lnt 2>/dev/null | grep -q ':4190'; then
        ok "ManageSieve is listening on 4190"
    else
        bad "nothing is listening on 4190; filters and the vacation responder will silently fail"
    fi

    for p in 143 993 587; do
        if $SUDO ss -lnt 2>/dev/null | grep -q ":$p"; then
            ok "port $p is listening"
        else
            warn "nothing is listening on port $p"
        fi
    done

    if $SUDO ss -lnt 2>/dev/null | grep -q ':3001'; then
        bad "port 3001 is already in use; the API cannot bind, choose another PORT"
    else
        ok "port 3001 is free for the API"
    fi
fi

# ---------------------------------------------------------------------------
section "Postfix"
# ---------------------------------------------------------------------------

if has postconf; then
    ok "postfix $($SUDO postconf -h mail_version 2>/dev/null)"
    relay=$($SUDO postconf -h mynetworks 2>/dev/null)
    [ -n "$relay" ] && info "mynetworks: $relay"
else
    warn "postfix does not appear to be installed"
fi

# ---------------------------------------------------------------------------
section "Web server and existing webmail"
# ---------------------------------------------------------------------------

if has nginx; then
    ok "nginx $($SUDO nginx -v 2>&1 | sed 's|.*/||')"

    roots=$($SUDO nginx -T 2>/dev/null | awk '/^\s*root\s/ {gsub(/;/,""); print $2}' | sort -u)
    if [ -n "$roots" ]; then
        info "document roots currently served:"
        printf '%s\n' "$roots" | sed 's/^/             /'
    fi

    certs=$($SUDO nginx -T 2>/dev/null | awk '/ssl_certificate\s/ {gsub(/;/,""); print $2}' | sort -u)
    for c in $certs; do
        if [ -r "$c" ] || [ "$HAVE_ROOT" = yes ]; then
            expiry=$($SUDO openssl x509 -enddate -noout -in "$c" 2>/dev/null | cut -d= -f2)
            [ -n "$expiry" ] && info "certificate $c expires $expiry"
        fi
    done
else
    warn "nginx is not installed; the frontend needs a web server"
fi

for path in /opt/www/roundcubemail /var/www/roundcubemail /usr/share/roundcubemail; do
    if [ -d "$path" ]; then
        warn "Roundcube found at $path; it will be replaced, so back it up before cutover"
    fi
done

for path in /opt/www/iredadmin /var/www/iredadmin /opt/iredadmin; do
    if [ -d "$path" ]; then
        warn "iRedAdmin found at $path; confirm the new admin UI covers your workflows before removing it"
    fi
done

if has systemctl && $SUDO systemctl list-unit-files 2>/dev/null | grep -q '^pulsemail-client'; then
    warn "a pulsemail-client service already exists; this would be an upgrade, not a first install"
else
    info "no existing pulsemail-client service, so this is a first install"
fi

# ---------------------------------------------------------------------------
section "Backups"
# ---------------------------------------------------------------------------

# Replacing a live webmail is only reversible if the mail store and the
# database can be restored.
if has pg_dump; then
    ok "pg_dump available for a pre-deployment database snapshot"
else
    warn "pg_dump not found; take a database backup by other means before cutover"
fi

for d in /var/vmail /home/vmail; do
    if [ -d "$d" ]; then
        size=$($SUDO du -sh "$d" 2>/dev/null | awk '{print $1}')
        info "mail store $d is ${size:-unknown} in size"
    fi
done

# ---------------------------------------------------------------------------
section "Summary"
# ---------------------------------------------------------------------------

printf '\n'
if [ "$blockers" -gt 0 ]; then
    printf '  %s%d blocker(s)%s and %d warning(s).\n' "$C_BAD" "$blockers" "$C_OFF" "$warnings"
    printf '  Resolve every [STOP] line before deploying.\n'
elif [ "$warnings" -gt 0 ]; then
    printf '  %sNo blockers%s, %d warning(s) to review.\n' "$C_OK" "$C_OFF" "$warnings"
else
    printf '  %sNo blockers and no warnings.%s\n' "$C_OK" "$C_OFF"
fi

if [ "$HAVE_ROOT" != yes ]; then
    printf '\n  This report was produced without root, so several sections were skipped.\n'
    printf '  Re-run with sudo for a complete picture.\n'
fi
printf '\n'

exit 0
