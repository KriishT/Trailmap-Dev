# Changelog

## 0.2.0: Trailmap Evidence

### Added
- **Evidence workspace**: System, Data flow and Network sheets; vendor inventory; revisions with time travel; review queue; scope editor (click, shift-click, lasso); decisions with reasons; auditor export (PDF, SVG, JSON, CSV, zip with manifest); share links with password, expiry, watermark, access log and revoke; command palette (Ctrl+K); list view as an alternative to the drawing.
- **Sample workspace** at `/demo`, no sign-in, same components as a real repository.
- **Pull request drift check**: GitHub check run plus one upserted comment, `.trailmap.yml` policy, acknowledgement in the app or with `/trailmap ack`, bound to the exact graph hash.
- **Scanner v2**: tokenizer-based extraction, Terraform, CloudFormation, Helm, Kubernetes, vendor and engine catalogs, data classification (PII, PAN, PHI, credentials), evidence with file and line on every edge, stable ids, graph hash.
- **Compliance layer**: PCI DSS 4.0.1, SOC 2 and DORA notes; append-only audit log; API keys; MCP tools; CLI `vendors`, `evidence`, `check`, `--upload`; GitHub Action.
- **Survey sheet design system** (`packages/ui`): drafting-paper and blueprint themes, IBM Plex, title blocks, stamps, hatched scopes, highlighter drift.
- **Local sandbox** (`TRAILMAP_LOCAL=1`): embedded Postgres and mocked GitHub run the real app.
- Playwright end-to-end suite, axe accessibility checks in both themes, screenshots at 1440 and 768 pixels, coverage gates, scanner accuracy gate, client-bundle secret check.

### Fixed
- Every route and page path was treated as public by the proxy (`/` matched as a prefix).
- Scan and share routes could be used across organisations (IDOR); access now flows through row-level security.
- The webhook accepted requests when its secret was unset.
- Anonymous callers could list shared maps and execute the job-claim function.
- Share-link password unlock was blocked for signed-out visitors by the proxy.
- Organisation owners had no membership row, so membership checks failed for them.
- Secrets could leak into evidence snippets.

### Changed
- Scans run only in the worker; web routes enqueue.
- Removed the three.js hero, React Flow map, Tailwind and shadcn styling, and the legacy impact routes in favour of the drift pipeline.

### Security
- Production dependency audit reduced from 29 vulnerabilities (4 critical) to 1 moderate (`qs`, transitive).
