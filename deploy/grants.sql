-- Grants the application role exactly the access it needs on iRedMail's vmail
-- database, and nothing more. No DDL rights are given: the application's own
-- tables live in a separate database.
--
--   sudo -u postgres psql -v app_role=pulsemail -d vmail -f deploy/grants.sql
--
-- The table lists below are the complete set referenced by the mail-side
-- models. Regenerate them with:
--
--   rg -oiN "(?:FROM|JOIN|INTO|UPDATE|DELETE FROM)\s+([a-z_][a-z0-9_]*)" -r '$1' \
--      backend/src/models/{Mailbox,Domain,Alias,User}.js backend/src/routes/admin.js | sort -u
--
-- Tables absent from a given iRedMail version are skipped rather than erroring,
-- so this is safe to run against any release and safe to re-run.

\set ON_ERROR_STOP on

\if :{?app_role}
\else
\echo 'ERROR: run with -v app_role=<role>, for example -v app_role=pulsemail'
\quit
\endif

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_role')
\gexec

SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_role')
\gexec

-- Read and write: provisioning changes these.
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO %I',
              c.relname, :'app_role')
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'p')
   AND c.relname = ANY (ARRAY[
        'mailbox',
        'domain',
        'domain_admins',
        'alias',
        'alias_domain',
        'forwardings',
        'deleted_mailboxes',
        -- Per-user and per-domain BCC rules, edited from the mailbox screens.
        'sender_bcc_user',
        'recipient_bcc_user',
        'sender_bcc_domain',
        'recipient_bcc_domain',
        -- Cleaned up when a mailbox or domain is removed.
        'moderators',
        'maillists',
        'maillist_owners',
        'share_folder'
   ])
\gexec

-- Read only: Dovecot owns these, we merely report them.
SELECT format('GRANT SELECT ON public.%I TO %I', c.relname, :'app_role')
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'p', 'v')
   AND c.relname = ANY (ARRAY['used_quota', 'last_login'])
\gexec

-- Deleting a mailbox or a domain must also drop its usage row, otherwise a
-- recreated address inherits the previous occupant's usage figures. DELETE
-- only: the values themselves stay Dovecot's to write.
SELECT format('GRANT DELETE ON public.%I TO %I', c.relname, :'app_role')
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'p')
   AND c.relname = 'used_quota'
\gexec

-- Serial columns on the writable tables need their sequences.
SELECT format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO %I',
              c.relname, :'app_role')
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind = 'S'
\gexec

-- Report anything the application references that this database does not have,
-- so a version difference shows up here rather than as a runtime 500.
SELECT 'missing from this iRedMail schema: ' || t AS notice
  FROM unnest(ARRAY[
        'mailbox','domain','domain_admins','alias','alias_domain','forwardings',
        'deleted_mailboxes','sender_bcc_user','recipient_bcc_user',
        'sender_bcc_domain','recipient_bcc_domain','moderators','maillists',
        'maillist_owners','share_folder','used_quota','last_login'
       ]) AS t
 WHERE to_regclass('public.' || t) IS NULL;
