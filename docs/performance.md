# Performance

Measured on the development machine (Windows 11, Node 24). Numbers are indicative, not a benchmark suite.

| Measure | Result | How |
|---|---|---|
| Scan of a 2,000-file repository | about 3 s (gate: 30 s) | `npm run eval` |
| Layout of a 300-node, 404-edge sheet | about 1.2 s; drawing 5 ms; 445 KiB of SVG | `packages/sheets/src/perf.test.ts` |
| Landing page, Lighthouse (mobile emulation, local production build) | performance 93 to 94, accessibility 100, best practices 100 | `lighthouse@12` against `next start` |
| Onboarding, sign-up to first PDF export (mocked GitHub) | under 10 s of wall time; the test asserts under 10 minutes | `e2e/04-onboarding.spec.ts` |

Largest contentful paint on the landing page is about 3 s under Lighthouse's throttled mobile profile; it is the first paragraph waiting on the web font, so fonts are self-hosted, only three Plex Sans weights are preloaded, and the other families load lazily.
