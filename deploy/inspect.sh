#!/usr/bin/env bash
#
# Targeted follow-up to preflight.sh, answering the questions needed to write a
# safe deploy script for this specific server.
#
# Read-only. Writes nothing, restarts nothing, installs nothing.
# Deliberately never prints password hashes or secrets - only whether they
# exist and which usernames they belong to.
#
#   ssh -p 777 pulsereal@38.107.236.58 'sudo bash -s' < deploy/inspect.sh

set -uo pipefail

SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO="sudo -n"

section() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
line() { printf '  %s\n' "$1"; }
has()  { command -v "$1" >/dev/null 2>&1; }

CONF=$($SUDO doveconf -n 2>/dev/null)

# ---------------------------------------------------------------------------
section "Dovecot master user"
# ---------------------------------------------------------------------------
# The deployment can skip a Dovecot restart entirely if we can add an entry to
# an existing passwd-file, so establish exactly what is already configured.

printf '%s' "$CONF" | awk '
    /^passdb \{/ { inblock=1; buf=""; ismaster=0 }
    inblock { buf = buf "    " $0 "\n" }
    inblock && /master *= *yes/ { ismaster=1 }
    inblock && /^\}/ {
        if (ismaster) { printf "  master passdb block:\n%s", buf }
        inblock=0
    }
'

MASTER_ARGS=$(printf '%s' "$CONF" | awk '
    /^passdb \{/ { inblock=1; args=""; ismaster=0 }
    inblock && /args *=/ { sub(/^ *args *= */, ""); args=$0 }
    inblock && /master *= *yes/ { ismaster=1 }
    inblock && /^\}/ { if (ismaster && args != "") print args; inblock=0 }
')

if [ -n "$MASTER_ARGS" ]; then
    line "passdb args: $MASTER_ARGS"
    # passwd-file args may carry scheme= and other prefixes; take the path.
    for token in $MASTER_ARGS; do
        case "$token" in
            /*)
                if $SUDO test -f "$token"; then
                    line "file $token exists"
                    line "existing master usernames (hashes not shown):"
                    $SUDO cut -d: -f1 "$token" 2>/dev/null | sed 's/^/               /'
                    line "permissions: $($SUDO stat -c '%a %U:%G' "$token" 2>/dev/null)"
                else
                    line "file $token referenced but not found"
                fi
                ;;
        esac
    done
else
    line "no master passdb args found (it may be a SQL driver, see the block above)"
fi

line ""
line "auth_master_user_separator: $(printf '%s' "$CONF" | awk -F'= *' '/auth_master_user_separator/ {print $2; exit}')"
line "auth_mechanisms:            $(printf '%s' "$CONF" | awk -F'= *' '/^auth_mechanisms/ {print $2; exit}')"

# ---------------------------------------------------------------------------
section "TLS on the local IMAP and Sieve listeners"
# ---------------------------------------------------------------------------
# preflight found an expired iRedMail.crt. If Dovecot presents it and we verify
# certificates, the client cannot connect.

line "ssl:                     $(printf '%s' "$CONF" | awk -F'= *' '/^ssl *=/ {print $2; exit}')"
line "disable_plaintext_auth:  $(printf '%s' "$CONF" | awk -F'= *' '/disable_plaintext_auth/ {print $2; exit}')"

DCERT=$(printf '%s' "$CONF" | awk -F'= *' '/^ssl_cert/ {print $2; exit}' | tr -d '<')
line "ssl_cert:                ${DCERT:-unset}"
if [ -n "$DCERT" ] && $SUDO test -f "$DCERT"; then
    line "  subject: $($SUDO openssl x509 -noout -subject -in "$DCERT" 2>/dev/null | sed 's/^subject= *//')"
    line "  expires: $($SUDO openssl x509 -noout -enddate -in "$DCERT" 2>/dev/null | cut -d= -f2)"
    if $SUDO openssl x509 -checkend 0 -noout -in "$DCERT" >/dev/null 2>&1; then
        line "  status:  valid"
    else
        line "  status:  EXPIRED - set IMAP_TLS_REJECT_UNAUTHORIZED=false or renew"
    fi
fi

# What a plaintext client on 143 actually sees, which decides whether we need
# STARTTLS at all for a loopback connection.
if has openssl; then
    line ""
    line "IMAP 143 greeting and capabilities:"
    printf 'a1 LOGOUT\r\n' | timeout 5 openssl s_client -connect 127.0.0.1:143 -starttls imap -brief 2>/dev/null | head -3 | sed 's/^/               /'
    caps=$( (printf 'a1 CAPABILITY\r\na2 LOGOUT\r\n'; sleep 1) | timeout 5 nc 127.0.0.1 143 2>/dev/null | tr -d '\r' | grep -i '^\* CAPABILITY' | head -1)
    line "               ${caps:-could not read capabilities}"
    case "$caps" in
        *LOGINDISABLED*) line "               LOGINDISABLED is advertised: STARTTLS is mandatory even on loopback" ;;
        *) line "               plaintext login permitted on loopback" ;;
    esac
fi

# ---------------------------------------------------------------------------
section "What maintains used_quota"
# ---------------------------------------------------------------------------
# preflight found 13 populated rows but no quota_clone, so something else is
# writing them. Knowing what tells us whether the figures go stale.

printf '%s' "$CONF" | grep -E 'quota|dict' | sed 's/^/  /' | head -25

# ---------------------------------------------------------------------------
section "nginx: how Roundcube and iRedAdmin are served"
# ---------------------------------------------------------------------------
# preflight only saw a `root` of /var/www/html, so these must be alias or
# fastcgi locations. We need the exact layout before changing anything.

if has nginx; then
    line "server_name and listen directives:"
    $SUDO nginx -T 2>/dev/null | grep -E '^\s*(server_name|listen)\s' | sed 's/^/    /' | sort -u | head -20

    line ""
    line "location blocks mentioning roundcube, iredadmin, mail or php:"
    $SUDO nginx -T 2>/dev/null \
        | grep -nEi 'location|alias|root|fastcgi_pass|include .*php' \
        | grep -Ei 'roundcube|iredadmin|mail|php|alias|/' \
        | sed 's/^/    /' | head -40

    line ""
    line "config files in play:"
    $SUDO nginx -T 2>/dev/null | grep -E '^# configuration file' | sed 's/^# configuration file //' | sed 's/^/    /'
fi

if has php-fpm8.3 || has php-fpm || ls /run/php/*.sock >/dev/null 2>&1; then
    line ""
    line "PHP-FPM sockets present (Roundcube and iRedAdmin depend on these):"
    ls /run/php/*.sock 2>/dev/null | sed 's/^/    /'
fi

# ---------------------------------------------------------------------------
section "Node installation candidates"
# ---------------------------------------------------------------------------

line "apt candidate: $(apt-cache policy nodejs 2>/dev/null | awk '/Candidate/ {print $2}')"
line "Ubuntu 24.04 ships Node 18 in its repos; NodeSource offers 20 or 22 LTS."
line "Either satisfies the requirement of Node 18 or newer."

# ---------------------------------------------------------------------------
section "Firewall and ports"
# ---------------------------------------------------------------------------

if has ufw; then
    line "ufw status: $($SUDO ufw status 2>/dev/null | head -1)"
fi
line "listeners on 80, 443, 3001:"
$SUDO ss -lntp 2>/dev/null | grep -E ':(80|443|3001)\s' | sed 's/^/    /'

# ---------------------------------------------------------------------------
section "Mail store layout"
# ---------------------------------------------------------------------------
# mail_location uses %Lh, so confirm where home directories actually are.

line "sample mailbox rows (username, maildir, quota MB):"
VMAIL_PW=$($SUDO awk -F'= *' '/^password/ {print $2; exit}' /etc/postfix/pgsql/virtual_mailbox_maps.cf 2>/dev/null)
if [ -n "$VMAIL_PW" ]; then
    PGPASSWORD="$VMAIL_PW" psql -h 127.0.0.1 -U vmail -d vmail -tAc \
        "SELECT username || '  |  ' || maildir || '  |  ' || quota FROM mailbox ORDER BY username LIMIT 5" 2>/dev/null \
        | sed 's/^/    /'
fi

line ""
line "actual home directories under /var/vmail:"
$SUDO find /var/vmail -maxdepth 3 -name Maildir -type d 2>/dev/null | head -5 | sed 's/^/    /'

printf '\n\033[1m== Done ==\033[0m\n'
printf '  Nothing was modified.\n\n'
