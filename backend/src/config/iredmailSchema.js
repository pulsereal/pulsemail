/**
 * The subset of iRedMail's `vmail` schema this application reads or writes.
 *
 * Transcribed from samples/iredmail/iredmail.pgsql so that development runs
 * against the same column names, types and defaults as a real deployment. Only
 * used to bootstrap the in-process Postgres used by mock mode — against a live
 * iRedMail these tables already exist and are never created by us.
 */
module.exports = `
CREATE TABLE IF NOT EXISTS domain (
    domain VARCHAR(255) NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    disclaimer TEXT NOT NULL DEFAULT '',
    aliases INT8 NOT NULL DEFAULT 0,
    mailboxes INT8 NOT NULL DEFAULT 0,
    maillists INT8 NOT NULL DEFAULT 0,
    maxquota INT8 NOT NULL DEFAULT 0,
    quota INT8 NOT NULL DEFAULT 0,
    transport VARCHAR(255) NOT NULL DEFAULT 'dovecot',
    settings TEXT NOT NULL DEFAULT '',
    backupmx INT2 NOT NULL DEFAULT 0,
    created TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    modified TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    expired TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT '9999-12-31 01:01:01',
    active INT2 NOT NULL DEFAULT 1,
    PRIMARY KEY (domain)
);

CREATE TABLE IF NOT EXISTS alias_domain (
    alias_domain VARCHAR(255) NOT NULL,
    target_domain VARCHAR(255) NOT NULL,
    created TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    modified TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    active INT2 NOT NULL DEFAULT 1,
    PRIMARY KEY (alias_domain)
);

CREATE TABLE IF NOT EXISTS domain_admins (
    username VARCHAR(255) NOT NULL DEFAULT '',
    domain VARCHAR(255) NOT NULL DEFAULT '',
    created TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    modified TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    expired TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT '9999-12-31 01:01:01',
    active INT2 NOT NULL DEFAULT 1,
    PRIMARY KEY (username, domain)
);

CREATE TABLE IF NOT EXISTS mailbox (
    username VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL DEFAULT '',
    name VARCHAR(255) NOT NULL DEFAULT '',
    language VARCHAR(5) NOT NULL DEFAULT '',
    first_name VARCHAR(255) NOT NULL DEFAULT '',
    last_name VARCHAR(255) NOT NULL DEFAULT '',
    mobile VARCHAR(255) NOT NULL DEFAULT '',
    telephone VARCHAR(255) NOT NULL DEFAULT '',
    recovery_email VARCHAR(255) NOT NULL DEFAULT '',
    birthday DATE NOT NULL DEFAULT '0001-01-01',
    mailboxformat VARCHAR(50) NOT NULL DEFAULT 'maildir',
    mailboxfolder VARCHAR(50) NOT NULL DEFAULT 'Maildir',
    storagebasedirectory VARCHAR(255) NOT NULL DEFAULT '',
    storagenode VARCHAR(255) NOT NULL DEFAULT '',
    maildir VARCHAR(255) NOT NULL DEFAULT '',
    quota INT8 NOT NULL DEFAULT 0,
    domain VARCHAR(255) NOT NULL DEFAULT '',
    transport VARCHAR(255) NOT NULL DEFAULT '',
    department VARCHAR(255) NOT NULL DEFAULT '',
    rank VARCHAR(255) NOT NULL DEFAULT 'normal',
    employeeid VARCHAR(255) NOT NULL DEFAULT '',
    isadmin INT2 NOT NULL DEFAULT 0,
    isglobaladmin INT2 NOT NULL DEFAULT 0,
    enablesmtp INT2 NOT NULL DEFAULT 1,
    enablesmtpsecured INT2 NOT NULL DEFAULT 1,
    enablepop3 INT2 NOT NULL DEFAULT 1,
    enablepop3secured INT2 NOT NULL DEFAULT 1,
    enablepop3tls INT2 NOT NULL DEFAULT 1,
    enableimap INT2 NOT NULL DEFAULT 1,
    enableimapsecured INT2 NOT NULL DEFAULT 1,
    enableimaptls INT2 NOT NULL DEFAULT 1,
    enabledeliver INT2 NOT NULL DEFAULT 1,
    enablelda INT2 NOT NULL DEFAULT 1,
    enablemanagesieve INT2 NOT NULL DEFAULT 1,
    enablemanagesievesecured INT2 NOT NULL DEFAULT 1,
    enablesieve INT2 NOT NULL DEFAULT 1,
    enablesievesecured INT2 NOT NULL DEFAULT 1,
    enablesievetls INT2 NOT NULL DEFAULT 1,
    enableinternal INT2 NOT NULL DEFAULT 1,
    enabledoveadm INT2 NOT NULL DEFAULT 1,
    "enablelib-storage" INT2 NOT NULL DEFAULT 1,
    "enablequota-status" INT2 NOT NULL DEFAULT 1,
    "enableindexer-worker" INT2 NOT NULL DEFAULT 1,
    enablelmtp INT2 NOT NULL DEFAULT 1,
    enabledsync INT2 NOT NULL DEFAULT 1,
    enablesogo INT2 NOT NULL DEFAULT 1,
    enablesogowebmail VARCHAR(1) NOT NULL DEFAULT 'y',
    enablesogocalendar VARCHAR(1) NOT NULL DEFAULT 'y',
    enablesogoactivesync VARCHAR(1) NOT NULL DEFAULT 'y',
    allow_nets TEXT DEFAULT NULL,
    disclaimer TEXT NOT NULL DEFAULT '',
    settings TEXT NOT NULL DEFAULT '',
    passwordlastchange TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    created TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    modified TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    expired TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT '9999-12-31 01:01:01',
    active INT2 NOT NULL DEFAULT 1,
    PRIMARY KEY (username)
);

CREATE TABLE IF NOT EXISTS alias (
    address VARCHAR(255) NOT NULL DEFAULT '',
    name VARCHAR(255) NOT NULL DEFAULT '',
    accesspolicy VARCHAR(30) NOT NULL DEFAULT '',
    domain VARCHAR(255) NOT NULL DEFAULT '',
    created TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    modified TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    expired TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT '9999-12-31 01:01:01',
    active INT2 NOT NULL DEFAULT 1,
    PRIMARY KEY (address)
);

CREATE TABLE IF NOT EXISTS forwardings (
    id SERIAL PRIMARY KEY,
    address VARCHAR(255) NOT NULL DEFAULT '',
    forwarding VARCHAR(255) NOT NULL DEFAULT '',
    domain VARCHAR(255) NOT NULL DEFAULT '',
    dest_domain VARCHAR(255) NOT NULL DEFAULT '',
    is_maillist INT2 NOT NULL DEFAULT 0,
    is_list INT2 NOT NULL DEFAULT 0,
    is_forwarding INT2 NOT NULL DEFAULT 0,
    is_alias INT2 NOT NULL DEFAULT 0,
    active INT2 NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_forwardings_address_forwarding
    ON forwardings (address, forwarding);

CREATE TABLE IF NOT EXISTS moderators (
    id SERIAL PRIMARY KEY,
    address VARCHAR(255) NOT NULL DEFAULT '',
    moderator VARCHAR(255) NOT NULL DEFAULT '',
    domain VARCHAR(255) NOT NULL DEFAULT '',
    dest_domain VARCHAR(255) NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS maillists (
    id SERIAL PRIMARY KEY,
    address VARCHAR(255) NOT NULL DEFAULT '',
    domain VARCHAR(255) NOT NULL DEFAULT '',
    transport VARCHAR(255) NOT NULL DEFAULT '',
    accesspolicy VARCHAR(30) NOT NULL DEFAULT '',
    maxmsgsize INT8 NOT NULL DEFAULT 0,
    name VARCHAR(255) NOT NULL DEFAULT '',
    description TEXT,
    mlid VARCHAR(36) NOT NULL DEFAULT '',
    is_newsletter INT2 NOT NULL DEFAULT 0,
    settings TEXT,
    created TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    modified TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    expired TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT '9999-12-31 01:01:01',
    active INT2 NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS maillist_owners (
    id SERIAL PRIMARY KEY,
    address VARCHAR(255) NOT NULL DEFAULT '',
    owner VARCHAR(255) NOT NULL DEFAULT '',
    domain VARCHAR(255) NOT NULL DEFAULT '',
    dest_domain VARCHAR(255) NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sender_bcc_domain (
    domain VARCHAR(255) NOT NULL DEFAULT '',
    bcc_address VARCHAR(255) NOT NULL DEFAULT '',
    created TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    modified TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    expired TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT '9999-12-31 01:01:01',
    active INT2 NOT NULL DEFAULT 1,
    PRIMARY KEY (domain)
);

CREATE TABLE IF NOT EXISTS sender_bcc_user (
    username VARCHAR(255) NOT NULL DEFAULT '',
    bcc_address VARCHAR(255) NOT NULL DEFAULT '',
    domain VARCHAR(255) NOT NULL DEFAULT '',
    created TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    modified TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    expired TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT '9999-12-31 01:01:01',
    active INT2 NOT NULL DEFAULT 1,
    PRIMARY KEY (username)
);

CREATE TABLE IF NOT EXISTS recipient_bcc_domain (
    domain VARCHAR(255) NOT NULL DEFAULT '',
    bcc_address VARCHAR(255) NOT NULL DEFAULT '',
    created TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    modified TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    expired TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT '9999-12-31 01:01:01',
    active INT2 NOT NULL DEFAULT 1,
    PRIMARY KEY (domain)
);

CREATE TABLE IF NOT EXISTS recipient_bcc_user (
    username VARCHAR(255) NOT NULL DEFAULT '',
    bcc_address VARCHAR(255) NOT NULL DEFAULT '',
    domain VARCHAR(255) NOT NULL DEFAULT '',
    created TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    modified TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    expired TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT '9999-12-31 01:01:01',
    active INT2 NOT NULL DEFAULT 1,
    PRIMARY KEY (username)
);

CREATE TABLE IF NOT EXISTS deleted_mailboxes (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    username VARCHAR(255) NOT NULL DEFAULT '',
    domain VARCHAR(255) NOT NULL DEFAULT '',
    maildir VARCHAR(255) NOT NULL DEFAULT '',
    bytes INT8 NOT NULL DEFAULT 0,
    messages INT8 NOT NULL DEFAULT 0,
    admin VARCHAR(255) NOT NULL DEFAULT '',
    delete_date DATE DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS share_folder (
    from_user VARCHAR(255) NOT NULL,
    to_user VARCHAR(255) NOT NULL,
    dummy CHAR(1),
    PRIMARY KEY (from_user, to_user)
);

CREATE TABLE IF NOT EXISTS anyone_shares (
    from_user VARCHAR(255) NOT NULL,
    dummy CHAR(1),
    PRIMARY KEY (from_user)
);

CREATE TABLE IF NOT EXISTS last_login (
    username VARCHAR(255) NOT NULL DEFAULT '',
    domain VARCHAR(255) NOT NULL DEFAULT '',
    imap BIGINT DEFAULT NULL,
    pop3 BIGINT DEFAULT NULL,
    lda BIGINT DEFAULT NULL,
    PRIMARY KEY (username, domain)
);

-- Maintained by Dovecot's quota_clone dict; we only ever read it.
CREATE TABLE IF NOT EXISTS used_quota (
    username VARCHAR(255) NOT NULL,
    bytes INT8 NOT NULL DEFAULT 0,
    messages INT8 NOT NULL DEFAULT 0,
    domain VARCHAR(255) NOT NULL DEFAULT '',
    PRIMARY KEY (username)
);
`;
