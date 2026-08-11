#!/usr/bin/env bash
#
# Installs pulsemail-client alongside an existing iRedMail deployment.
#
# This is deliberately additive. It does not modify dovecot.conf, does not
# restart Dovecot, does not touch the Roundcube, iRedAdmin, SOGo or netdata
# nginx blocks, and does not alter any iRedMail table. Everything it creates is
# removable with deploy/rollback.sh.
#
# The one change to an existing file is appending a master user to
# /etc/dovecot/dovecot-master-users, which is currently empty. That is picked up
# with `doveadm reload`, a configuration reload that does not drop connections
# or interrupt delivery.
#
# Usage, from a checkout copied onto the server:
#
#   rsync -az -e 'ssh -p 777' --exclude node_modules --exclude .git --exclude dist \
#         ./ pulsereal@38.107.236.58:/tmp/pulsemail-client/
#   ssh -p 777 pulsereal@38.107.236.58 \
#         'sudo WEBMAIL_HOST=webmail.pulsereal.com bash /tmp/pulsemail-client/deploy/install.sh'

set -euo pipefail

WEBMAIL_HOST="${WEBMAIL_HOST:-webmail.pulsereal.com}"
APP_DIR="${APP_DIR:-/opt/pulsemail-client}"
SERVICE_USER="${SERVICE_USER:-pulsemail}"
APP_DB="${APP_DB:-pulsemail}"
MASTER_USER="${MASTER_USER:-pulsemail-master}"
MASTER_FILE="/etc/dovecot/dovecot-master-users"
NODE_MAJOR="${NODE_MAJOR:-20}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step()  { printf '\n\033[1m>> %s\033[0m\n' "$1"; }
say()   { printf '   %s\n' "$1"; }
die()   { printf '\n\033[31mFAILED: %s\033[0m\n\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this with sudo"
[ -f "$SRC_DIR/backend/package.json" ] || die "no backend/package.json under $SRC_DIR; copy the whole repository"

printf '\033[1mpulsemail-client installer\033[0m\n'
say "source:   $SRC_DIR"
say "target:   $APP_DIR"
say "hostname: $WEBMAIL_HOST"

# ---------------------------------------------------------------------------
step "Preconditions"
# ---------------------------------------------------------------------------

command -v dovecot >/dev/null || die "dovecot not found; this is meant for an iRedMail host"
command -v psql    >/dev/null || die "psql not found"
command -v nginx   >/dev/null || die "nginx not found"

[ -f "$MASTER_FILE" ] || die "$MASTER_FILE does not exist; the master passdb is not configured as expected"

# Our own service holding the port is the normal case when re-running, so stop
# it first and only complain if something else is listening.
if systemctl is-active --quiet pulsemail-client 2>/dev/null; then
    say "stopping the running pulsemail-client for this upgrade"
    systemctl stop pulsemail-client
    sleep 1
fi

if ss -lnt | grep -q ':3001 '; then
    die "port 3001 is held by something other than pulsemail-client"
fi

# Only certbot needs the name to resolve, so a missing record downgrades to
# HTTP rather than blocking the install.
#
# The local resolver is consulted last. systemd-resolved caches NXDOMAIN, so a
# lookup made before the record existed keeps failing here long after the name
# is live on the public internet.
resolve_host() {
    local host="$1" ip=""

    if command -v dig >/dev/null 2>&1; then
        ip="$(dig +short +time=3 +tries=1 A "$host" @1.1.1.1 2>/dev/null \
              | grep -E '^[0-9]+(\.[0-9]+){3}$' | head -1 || true)"
    fi
    if [ -z "$ip" ] && command -v host >/dev/null 2>&1; then
        ip="$(host -W 3 "$host" 1.1.1.1 2>/dev/null \
              | awk '/has address/ {print $4; exit}' || true)"
    fi
    if [ -z "$ip" ]; then
        ip="$(getent hosts "$host" | awk '{print $1}' | head -1 || true)"
    fi

    printf '%s' "$ip"
}

CERT_DIR="/etc/letsencrypt/live/$WEBMAIL_HOST"
HAVE_CERT=no
[ -f "$CERT_DIR/fullchain.pem" ] && HAVE_CERT=yes

SKIP_CERTBOT=no
resolved="$(resolve_host "$WEBMAIL_HOST")"
myip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"

if [ "$HAVE_CERT" = yes ]; then
    say "certificate already present at $CERT_DIR, it will be used directly"
    SKIP_CERTBOT=yes
elif [ -z "$resolved" ]; then
    SKIP_CERTBOT=yes
    say "NOTE: $WEBMAIL_HOST does not resolve yet."
    say "      Installing anyway and serving over HTTP. Once the record exists,"
    say "      run: certbot --nginx -d $WEBMAIL_HOST"
elif [ -n "$myip" ] && [ "$resolved" != "$myip" ]; then
    SKIP_CERTBOT=yes
    say "NOTE: $WEBMAIL_HOST resolves to $resolved but this server is $myip."
    say "      Skipping certificate issuance, which would fail."
else
    say "$WEBMAIL_HOST resolves to $resolved"
fi

# iRedMail keeps the vmail password in the Postfix lookup files.
VMAIL_PW="$(awk -F'= *' '/^password/ {print $2; exit}' /etc/postfix/pgsql/virtual_mailbox_maps.cf 2>/dev/null || true)"
[ -n "$VMAIL_PW" ] || die "could not read the vmail password from /etc/postfix/pgsql/virtual_mailbox_maps.cf"

vmail_sql() { PGPASSWORD="$VMAIL_PW" psql -h 127.0.0.1 -U vmail -d vmail -tAc "$1"; }
[ "$(vmail_sql 'SELECT 1')" = "1" ] || die "cannot connect to the vmail database"
say "vmail database reachable"

# ---------------------------------------------------------------------------
step "Node.js $NODE_MAJOR"
# ---------------------------------------------------------------------------

current_major=""
command -v node >/dev/null && current_major="$(node --version | tr -d 'v' | cut -d. -f1)"

if [ -n "$current_major" ] && [ "$current_major" -ge 18 ]; then
    say "node $(node --version) already present, keeping it"
else
    say "installing Node $NODE_MAJOR from NodeSource"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
    DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs >/dev/null
    say "installed $(node --version)"
fi
command -v npm >/dev/null || die "npm still missing after installation"

# ---------------------------------------------------------------------------
step "Service account"
# ---------------------------------------------------------------------------

if id -u "$SERVICE_USER" >/dev/null 2>&1; then
    say "user $SERVICE_USER already exists"
else
    useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
    say "created system user $SERVICE_USER"
fi

# ---------------------------------------------------------------------------
step "Application database"
# ---------------------------------------------------------------------------
# Our tables live here so the schema bootstrap never needs DDL rights on vmail.

APP_DB_PW_FILE="/etc/pulsemail-client.dbpw"
if [ -f "$APP_DB_PW_FILE" ]; then
    APP_DB_PW="$(cat "$APP_DB_PW_FILE")"
    say "reusing the existing application database password"
else
    APP_DB_PW="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
    umask 077 && printf '%s' "$APP_DB_PW" > "$APP_DB_PW_FILE"
    chmod 600 "$APP_DB_PW_FILE"
fi

if [ "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$APP_DB'")" = "1" ]; then
    say "role $APP_DB exists, resetting its password to match"
    sudo -u postgres psql -q -c "ALTER ROLE $APP_DB WITH LOGIN PASSWORD '$APP_DB_PW'"
else
    sudo -u postgres psql -q -c "CREATE ROLE $APP_DB WITH LOGIN PASSWORD '$APP_DB_PW'"
    say "created role $APP_DB"
fi

if [ "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$APP_DB'")" = "1" ]; then
    say "database $APP_DB already exists"
else
    sudo -u postgres createdb -O "$APP_DB" "$APP_DB"
    say "created database $APP_DB"
fi

# Read/write on the iRedMail tables we use, and nothing else. No DDL on vmail.
# The list lives in grants.sql so it stays in one place.
say "granting access to the iRedMail tables"
sudo -u postgres psql -q -v app_role="$APP_DB" -d vmail -f "$SRC_DIR/deploy/grants.sql"

PGPASSWORD="$APP_DB_PW" psql -h 127.0.0.1 -U "$APP_DB" -d vmail -tAc "SELECT 1 FROM mailbox LIMIT 1" >/dev/null \
    || die "the $APP_DB role cannot read the mailbox table"
say "verified $APP_DB can read vmail"

# ---------------------------------------------------------------------------
step "Dovecot master user"
# ---------------------------------------------------------------------------
# The passdb block already exists and points at this file. Appending an entry
# and reloading avoids editing dovecot.conf or restarting the service.

MASTER_PW_FILE="/etc/pulsemail-client.masterpw"
if [ -f "$MASTER_PW_FILE" ]; then
    MASTER_PW="$(cat "$MASTER_PW_FILE")"
    say "reusing the existing master password"
else
    MASTER_PW="$(openssl rand -base64 36 | tr -d '/+=' | head -c 36)"
    umask 077 && printf '%s' "$MASTER_PW" > "$MASTER_PW_FILE"
    chmod 600 "$MASTER_PW_FILE"
fi

cp -a "$MASTER_FILE" "${MASTER_FILE}.bak.$(date +%Y%m%d%H%M%S)"
HASH="$(doveadm pw -s SSHA512 -p "$MASTER_PW")"

tmp="$(mktemp)"
grep -v "^${MASTER_USER}:" "$MASTER_FILE" 2>/dev/null > "$tmp" || true
printf '%s:%s\n' "$MASTER_USER" "$HASH" >> "$tmp"
cat "$tmp" > "$MASTER_FILE"
rm -f "$tmp"
chown dovecot:dovecot "$MASTER_FILE"
chmod 500 "$MASTER_FILE"
say "wrote master user $MASTER_USER"

doveadm reload
say "reloaded Dovecot configuration (no restart, no dropped sessions)"

SAMPLE_BOX="$(vmail_sql "SELECT username FROM mailbox WHERE active=1 ORDER BY username LIMIT 1")"
if [ -n "$SAMPLE_BOX" ]; then
    if doveadm auth login "${SAMPLE_BOX}*${MASTER_USER}" "$MASTER_PW" >/dev/null 2>&1; then
        say "verified master login against $SAMPLE_BOX"
    else
        die "master login failed for $SAMPLE_BOX; the client would not be able to read mail"
    fi
fi

# ---------------------------------------------------------------------------
step "Application files"
# ---------------------------------------------------------------------------

mkdir -p "$APP_DIR"
# Preserve .env across redeploys; everything else is replaced from source.
rsync -a --delete \
      --exclude node_modules --exclude .git --exclude 'backend/.env' \
      --exclude 'backend/data/pglite' \
      "$SRC_DIR/" "$APP_DIR/"
say "synced source into $APP_DIR"

say "installing backend dependencies"
(cd "$APP_DIR/backend" && npm ci --omit=dev --no-audit --no-fund >/dev/null)

say "building the frontend (this takes a minute)"
(cd "$APP_DIR/frontend" && npm ci --no-audit --no-fund >/dev/null && npm run build >/dev/null)
[ -f "$APP_DIR/frontend/dist/index.html" ] || die "frontend build produced no dist/index.html"

# ---------------------------------------------------------------------------
step "Configuration"
# ---------------------------------------------------------------------------

ENV_FILE="$APP_DIR/backend/.env"
if [ -f "$ENV_FILE" ]; then
    say "keeping the existing .env (delete it to regenerate)"
else
    JWT_SECRET="$(openssl rand -base64 48)"
    SECRET_ENCRYPTION_KEY="$(openssl rand -base64 48)"
    cat > "$ENV_FILE" <<ENV
NODE_ENV=production
PORT=3001

# iRedMail's database. No DDL rights, only the tables the client reads.
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=vmail
DB_USER=$APP_DB
DB_PASSWORD=$APP_DB_PW

# This application's own tables, created on first boot.
APP_DB_HOST=127.0.0.1
APP_DB_PORT=5432
APP_DB_NAME=$APP_DB
APP_DB_USER=$APP_DB
APP_DB_PASSWORD=$APP_DB_PW

# Loopback IMAP. Dovecot treats 127.0.0.1 as secured and permits plaintext
# auth there, so no TLS is involved and the certificate is irrelevant.
IMAP_HOST=127.0.0.1
IMAP_PORT=143
IMAP_SECURE=false
IMAP_MASTER_USER=$MASTER_USER
IMAP_MASTER_PASS=$MASTER_PW
IMAP_MASTER_SEPARATOR=*

# ManageSieve, for filters and the vacation responder.
SIEVE_HOST=127.0.0.1
SIEVE_PORT=4190
SIEVE_STARTTLS=false

# Outbound goes through Postfix on loopback port 25, which relays via
# permit_mynetworks. Submission on 587 would demand SASL credentials we do not
# have: the client authenticates to Dovecot as a master user and never learns
# a mailbox password.
#
# Certificate verification is off because Postfix presents the
# mail.pulsereal.com certificate while we connect to 127.0.0.1, so the hostname
# will never match. The connection does not leave the machine.
SMTP_HOST=127.0.0.1
SMTP_PORT=25
SMTP_SECURE=false
SMTP_TLS_REJECT_UNAUTHORIZED=false

JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=7d

# Encrypts the LLM API key an administrator saves in the admin panel. Kept
# separate from JWT_SECRET so that rotating sessions does not invalidate it.
SECRET_ENCRYPTION_KEY=$SECRET_ENCRYPTION_KEY

# One nginx in front of the app.
TRUST_PROXY=1
# Served same-origin, so no cross-origin request occurs.
CORS_ORIGINS=

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=3000
AUTH_RATE_LIMIT_MAX=10
SEND_RATE_LIMIT_MAX=20

SPAMASSASSIN_HOST=127.0.0.1
SPAMASSASSIN_PORT=783

APP_NAME=Pulsemail
ENV
    say "wrote $ENV_FILE"
fi

chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
chmod 600 "$ENV_FILE"
chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"

# ---------------------------------------------------------------------------
step "systemd service"
# ---------------------------------------------------------------------------

cat > /etc/systemd/system/pulsemail-client.service <<UNIT
[Unit]
Description=Pulsemail webmail client API
After=network.target postgresql.service dovecot.service
Wants=postgresql.service

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR/backend
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5

# The scheduler and rate limiter are per-process, so exactly one instance.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR/backend
StandardOutput=journal
StandardError=journal
SyslogIdentifier=pulsemail-client

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --quiet pulsemail-client
systemctl restart pulsemail-client
say "started pulsemail-client"

sleep 4
if ! systemctl is-active --quiet pulsemail-client; then
    journalctl -u pulsemail-client -n 30 --no-pager
    die "the service did not stay running; see the log above"
fi

health="$(curl -fsS --max-time 5 http://127.0.0.1:3001/health || true)"
[ -n "$health" ] || { journalctl -u pulsemail-client -n 30 --no-pager; die "health check failed"; }
say "health check passed"

# ---------------------------------------------------------------------------
step "Live integration checks"
# ---------------------------------------------------------------------------
# Everything up to here was also provable in mock mode. These are the parts
# that only a real Dovecot can confirm.

if sudo -u "$SERVICE_USER" env -C "$APP_DIR/backend" node scripts/verify-live.js; then
    say "IMAP and ManageSieve verified against the live server"
else
    say "WARNING: a live check failed. The service is running, but review the output above"
    say "before pointing users at it. Filters failing is survivable; IMAP failing is not."
fi

# ---------------------------------------------------------------------------
step "nginx"
# ---------------------------------------------------------------------------
# A new server block on a new hostname. Existing vhosts serving Roundcube,
# iRedAdmin, SOGo and netdata are not touched.

NGINX_CONF="/etc/nginx/sites-enabled/pulsemail-client.conf"

# The body is identical whether or not TLS is configured, so build it once.
site_body() {
    cat <<CONF
    root $APP_DIR/frontend/dist;
    index index.html;

    client_max_body_size 32m;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }

    location ~* \.(js|css|woff2?|png|jpe?g|gif|svg|ico)\$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
CONF
}

if [ "$HAVE_CERT" = yes ]; then
    # Serve TLS directly from the existing certificate. Port 80 keeps the ACME
    # challenge path unredirected so renewals continue to work.
    {
        cat <<CONF
server {
    listen 80;
    listen [::]:80;
    server_name $WEBMAIL_HOST;

    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $WEBMAIL_HOST;

    ssl_certificate     $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;

    add_header Strict-Transport-Security "max-age=31536000" always;

CONF
        site_body
        printf '}\n'
    } > "$NGINX_CONF"
    say "wrote a TLS server block using the existing certificate"
else
    {
        cat <<CONF
server {
    listen 80;
    listen [::]:80;
    server_name $WEBMAIL_HOST;

    location /.well-known/acme-challenge/ { root /var/www/html; }

CONF
        site_body
        printf '}\n'
    } > "$NGINX_CONF"
    say "wrote an HTTP server block; certbot will add TLS"
fi

nginx -t >/dev/null 2>&1 || { rm -f "$NGINX_CONF"; die "nginx rejected the new configuration; it has been removed and nothing changed"; }

# nginx must be able to traverse into the build directory to read it.
chmod o+x "$APP_DIR" "$APP_DIR/frontend" 2>/dev/null || true
chmod -R o+rX "$APP_DIR/frontend/dist"

systemctl reload nginx
say "added $NGINX_CONF and reloaded nginx"

# ---------------------------------------------------------------------------
step "Confirming the right vhost answers"
# ---------------------------------------------------------------------------
# This host shares nginx with Roundcube, iRedAdmin and SOGo, and iRedMail
# defines a catch-all `server_name _`. If our block is missing on the port the
# browser actually reaches, nginx quietly serves the default vhost instead and
# the symptom is "I still see Roundcube". Assert it rather than assume it.

probe_vhost() {
    local scheme="$1" port="$2"
    curl -fsS --max-time 5 -k \
         --resolve "$WEBMAIL_HOST:$port:127.0.0.1" \
         "$scheme://$WEBMAIL_HOST/" 2>/dev/null || true
}

check_body() {
    local where="$1" body="$2"
    if printf '%s' "$body" | grep -qi 'Pulsemail Custom Client'; then
        say "$where serves the new client"
    elif printf '%s' "$body" | grep -qiE 'roundcube|iredadmin|sogo'; then
        say "PROBLEM: $where is still serving the old interface."
        say "         nginx fell through to the default vhost, which means no"
        say "         matching server block exists on that port."
        return 1
    elif [ -z "$body" ]; then
        say "NOTE: $where returned nothing; it may not be listening."
    else
        say "NOTE: $where returned an unrecognised page."
    fi
    return 0
}

vhost_ok=0
check_body "http://$WEBMAIL_HOST"  "$(probe_vhost http 80)"   || vhost_ok=1
if [ "$HAVE_CERT" = yes ]; then
    check_body "https://$WEBMAIL_HOST" "$(probe_vhost https 443)" || vhost_ok=1
else
    # Even without our own certificate, something answers 443 for this name.
    # If that something is Roundcube, a proxy in front will show the wrong site.
    tls_body="$(probe_vhost https 443)"
    if printf '%s' "$tls_body" | grep -qiE 'roundcube|iredadmin|sogo'; then
        say "WARNING: port 443 for $WEBMAIL_HOST currently serves the old interface,"
        say "         because there is no certificate yet and therefore no TLS block."
        say "         A CDN or proxy in front that talks HTTPS to this server will"
        say "         show Roundcube. Issue the certificate and re-run to fix it."
        vhost_ok=1
    fi
fi

[ "$vhost_ok" -eq 0 ] || say "see the note above before pointing anyone at this hostname"

if [ "$HAVE_CERT" = yes ]; then
    say "TLS already configured from $CERT_DIR"
elif [ "$SKIP_CERTBOT" = "yes" ]; then
    say "skipping certificate issuance until DNS is in place"
elif ! command -v certbot >/dev/null; then
    say "certbot not installed; install it and run: certbot --nginx -d $WEBMAIL_HOST"
elif [ -z "$CERTBOT_EMAIL" ]; then
    say "set CERTBOT_EMAIL to automate this, or run: certbot --nginx -d $WEBMAIL_HOST"
else
    say "requesting a certificate for $WEBMAIL_HOST"
    certbot --nginx -d "$WEBMAIL_HOST" --non-interactive --agree-tos \
            -m "$CERTBOT_EMAIL" --redirect \
        || say "certbot failed; the site is reachable over HTTP and you can retry manually"
fi

# ---------------------------------------------------------------------------
step "Done"
# ---------------------------------------------------------------------------

cat <<SUMMARY

  Installed and running.

    URL          https://$WEBMAIL_HOST/   (http:// until certbot succeeds)
    Service      systemctl status pulsemail-client
    Logs         journalctl -u pulsemail-client -f
    Config       $ENV_FILE
    Rollback     bash $APP_DIR/deploy/rollback.sh

  Untouched: Roundcube at /mail/, iRedAdmin at /iredadmin, SOGo and ActiveSync,
  dovecot.conf, and every iRedMail table.

  Log in with an existing mailbox password and confirm you can read real mail
  before telling anyone else about the new address.

SUMMARY
