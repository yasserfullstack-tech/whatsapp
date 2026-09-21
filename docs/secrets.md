# Production secrets

Production secrets belong in host/secret-manager configuration, never in Git, Docker image layers, Compose files, CI logs, issue comments, or shell history. `.env.production.example` contains placeholders only; the populated `.env.production` should be root/operator owned with mode `0600`.

## Secret inventory

Treat these as secrets or security-sensitive configuration:

- `POSTGRES_PASSWORD` and credentials embedded in `DATABASE_URL`,
- `BETTER_AUTH_SECRET`,
- `CREDENTIAL_ENCRYPTION_KEY`, together with `CREDENTIAL_ENCRYPTION_KEY_VERSION` and the decrypt-only `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` used during a rotation window,
- `META_APP_SECRET`, `META_VERIFY_TOKEN`, and any Meta access token,
- `R2_ACCESS_KEY_ID` and especially `R2_SECRET_ACCESS_KEY`,
- `SMTP_PASSWORD` (for Gmail/Google SMTP, use an App Password rather than the account password),
- `GRAFANA_ADMIN_PASSWORD`,
- the private `age` identity used to decrypt database backups,
- rclone/cloud credentials for the off-server backup destination.

A Sentry DSN is not normally a password-equivalent secret, but it is still environment-specific configuration and should not be copied casually between environments.

## Generation

Generate high-entropy values on a trusted system, for example:

```bash
openssl rand -base64 48   # Better Auth/admin/database-style random secret
openssl rand -base64 32   # CREDENTIAL_ENCRYPTION_KEY: exactly 32 random bytes encoded as base64
openssl rand -hex 32      # webhook verify token or other opaque token
```

For database credentials embedded in a URL, percent-encode characters that are not URL-safe or use a generated character set that remains unambiguous in the connection URI.

## Scope and least privilege

Use different secrets in staging and production. R2 credentials should be limited to the required bucket/prefix and operations. The backup destination credential should be dedicated to the backup path. Meta production credentials must not be used by load tests; the existing load harness intentionally redirects sends to a local fake Meta API.

Platform-admin bootstrap values are security-sensitive even though they are identifiers. Keep the allowlist narrow and migrate away from bootstrap entries once normal administrator lifecycle exists.

## Rotation

Document the owner and rotation procedure for each credential. Favor rotations that support overlap:

- database/R2/email credentials: create a new credential, deploy it, verify usage, then revoke the old one,
- Meta webhook verify token/app secret: coordinate rotation with Meta webhook configuration so signatures/verification do not break,
- Better Auth secret: understand session/token invalidation before rotating; an emergency rotation may intentionally sign users out,
- Grafana password: rotate immediately after suspected disclosure,
- backup encryption identity: add a new recipient for new backups and preserve the old identity until every retained backup encrypted to it has expired,
- `CREDENTIAL_ENCRYPTION_KEY`: stored Meta credentials record the key version that encrypted them (`credential_secrets.key_version`; a row without a version is read as version 1, so pre-versioning rows keep decrypting with the original key and need no data migration). Rotate with a rolling window rather than a big-bang replacement:
  1. set `CREDENTIAL_ENCRYPTION_KEY` to the replacement key, set `CREDENTIAL_ENCRYPTION_KEY_VERSION` to the next integer, and keep the outgoing key in `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` so both versions decrypt;
  2. deploy and confirm that new writes use the new version while existing rows still read;
  3. run `bun run credentials:rotate` (optionally with an organization id to rotate one tenant) to decrypt each row with its recorded key and re-encrypt it under the current version;
  4. confirm no rows still reference the previous version, then remove `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` and retire the old key.
  Do not remove the previous key before step 3 has completed for every row, and keep an independently secured recovery copy of every key in the ring: losing all copies of a key can make the credentials encrypted under it unrecoverable.

After any suspected leak, rotate rather than merely deleting the value from the repository history.

## Backups of secrets

A database backup alone is not enough for recovery. Keep independently secured recovery copies of the credential-encryption key, database backup decryption identity, DNS access, R2 recovery credentials, and any other keys needed to interpret restored data. Do not store the only copies on the same VPS being protected.

## Logging

The existing structured logger redacts token/secret/password/credential/key-like fields and strips sensitive URL/query data before logs or Sentry reporting. Do not rely on redaction as permission to log secrets; application code should avoid placing secret material in log fields in the first place.
