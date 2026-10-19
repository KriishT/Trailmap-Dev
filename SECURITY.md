# Security and data handling

## What is stored

| Stored | Not stored |
|---|---|
| The architecture graph: nodes, connections, data-class tags, scope and decisions | Repository contents, files, history |
| Evidence references: file path, line number and a snippet of at most 120 characters, with secrets masked | Anything beyond those snippets |
| Scan logs, drift events, attestations, exports (hash and metadata, not the file) | Exported files |
| API keys as SHA-256 hashes, share-link passwords as bcrypt hashes, visitor addresses as salted hashes | Plain API keys, passwords, IP addresses |

"Source code is never stored" would overstate it, because evidence snippets are short excerpts of real lines. The accurate statement is: no repository contents are retained; the graph carries at most one 120-character excerpt per cited line, and the scanner masks URI credentials, secret-named values and well-known token formats before an excerpt is kept.

## How a scan handles code

1. The worker claims a job atomically (`FOR UPDATE SKIP LOCKED`), so two workers never run the same scan.
2. It clones the repository (shallow) into a freshly created temporary directory.
3. It scans, writes the graph, and deletes the directory in a `finally` block, so the copy is removed whether the scan succeeds or fails. Tests cover both paths.
4. Web routes and the webhook only enqueue work. They never clone or scan.

CI-only mode avoids even that: `npx trailmap scan --upload` and the GitHub Action scan on your own runner and send only the graph. The CLI run without `--upload` sends nothing.

## Access control

- Authorization is enforced by the database. Every table has row-level security, and routes query through the signed-in user's own client, so a missing check in a route cannot expose another organisation's rows. Cross-tenant ids return 404. The service-role client is used only for writes the user is allowed to cause.
- Owners and admins can change scopes, decisions, vendor records, policy and API keys; members can read. This is tested for every table and route with a user from another organisation.
- Anonymous visitors cannot list shared maps or read password hashes. A share link resolves a single slug through a security-definer function that hides expired and revoked links.
- `audit_events` is append-only (a trigger rejects updates and deletes) and automatic row auditing excludes secrets. Attestations are immutable.

## Webhooks, keys and links

- The GitHub webhook verifies `X-Hub-Signature-256` with a constant-time comparison. A missing or wrong signature gets 401. If `GITHUB_WEBHOOK_SECRET` is unset the route answers 500 and does nothing; it never fails open.
- API keys look like `tmk_<prefix>_<secret>`, are shown once, and are stored only as a hash. Revocation is immediate.
- Share links use random slugs, optional bcrypt-protected passwords, expiry, revocation and an access log. Password attempts are rate limited per instance, and a correct password sets a signed, expiring cookie.
- Exported SVG, PDF and JSON contain no credentials. Every export is recorded with the SHA-256 of the file.

## Local sandbox

`TRAILMAP_LOCAL=1` runs the app on an embedded database with a mocked GitHub. It exists for development and tests and refuses to start under `NODE_ENV=production` unless `TRAILMAP_LOCAL_SANDBOX=i-understand-this-uses-no-real-data` is also set. Its local-only routes answer 404 everywhere else.

## Checks that run in CI

- `gitleaks` over the full history (`.gitleaks.toml` allowlists only the fixtures that contain deliberately fake keys).
- `npm audit --omit=dev --audit-level=high`.
- `scripts/check-client-bundle.mjs` fails the build if the browser bundle mentions a server-only secret.
- Database tests for isolation on every table, route tests for membership on every route, webhook signature tests (including an unset secret), and concurrency and cleanup tests for the worker.

## Reporting a vulnerability

Email the maintainers privately instead of opening a public issue. Include steps to reproduce and the affected version. We aim to acknowledge within three working days.

## Known gaps

- API-key and share-link rate limiting is per instance, not shared across instances.
- The multi-connection race on job claiming is proven by the SQL (`FOR UPDATE SKIP LOCKED`) and tested sequentially on the embedded database; a concurrent test needs a real Postgres service.
- Evidence snippets can still contain sensitive but unrecognisable text. If that matters for a repository, run in CI-only mode and review the graph before uploading.
