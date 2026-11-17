# Security Test Report

SRD Table 3.22 defines 19 cases. This report records what was actually run, where the test
lives, and what it does and does **not** prove. Passing shows that the controls stop these
predefined attacks; it does not show that the system is safe against every possible attack.

- Run date: 2026-11-17 (ST-19 and Referer checks added the same day) · Environment: macOS, local stack (platform `http://127.0.0.1:5173`,
  content `http://<sub>.localhost:4100`), Chromium (Chrome Headless Shell 159); ST-02, ST-07, ST-11 also in Firefox and WebKit 27.2 (Playwright 1.65).
- Commands: `pnpm test:security` (browser cases), `npx vitest run` (API/content/validator cases).
- Local hostnames are different *sites* (IP vs `localhost`) but not two registered domains;
  ST-01, ST-02 and ST-18 must be repeated on staging with the real domains (Risk R08).

## Results

| ST | Attack | Context(s) | Test | Positive control | Result |
| --- | --- | --- | --- | --- | --- |
| ST-01 | Read the platform session cookie | Direct | `tests/security/browser-attacks.spec.ts` ST-01 | Cookie `wc.sid` confirmed present (HttpOnly) in the same browser | **PASS** — not readable via `document.cookie`, never sent to the content origin, credentialed `fetch` to the API blocked (`connect-src`) |
| ST-02 | Read/write another submission's storage or cookies | Direct, two subdomains | ST-02 | Same origin reads back its own data | **PASS** in Chromium, Firefox and WebKit |
| ST-03 | Access the platform DOM from the review iframe | Review iframe | ST-03 | — (cross-origin access cannot be "turned on") | **PASS** — `SecurityError` on `parent.document` and `parent.location.href` |
| ST-04 | Open directly, bypassing the review iframe | Direct | ST-04 | (ST-10 direct positive control) | **PASS** — response carries `sandbox …`; `window.open` returns null |
| ST-05 | Load an external script | Direct | ST-05 | `bypassCSP` → request reaches `attacker.test/evil.js` | **PASS** — `script-src-elem` violation, no request, script did not run |
| ST-06 | Inline script, event handler, `eval()`, `new Function` | Direct | ST-06 | `bypassCSP` → all four run | **PASS** — `script-src-elem`, `script-src-attr`, `script-src` violations; none ran |
| ST-07 | Exfiltrate with `fetch()` and an image | Direct | ST-07 | `bypassCSP` → requests reach attacker | **PASS** in Chromium, Firefox and WebKit — `connect-src`, `img-src` violations, no request |
| ST-08 | Submit a form to an external server | Direct | ST-08 | `bypassCSP` → `attacker.test/collect?password=…` reached | **PASS** — `form-action` violation, no request |
| ST-09 | Embed an external frame | Direct | ST-09 | `bypassCSP` → frame request reached | **PASS** — `frame-src` violation, no request |
| ST-10 | Open a pop-up | Review iframe; direct | ST-10 (2 tests) | Direct: `bypassCSP` → pop-up opens | **PASS** in both contexts — no new window, no request |
| ST-11 | Redirect the top window to a phishing page | Review iframe (with a real click) | ST-11 "inside the review iframe" | Unsandboxed iframe + `bypassCSP` → top window redirected | **PASS** in Chromium, Firefox and WebKit — review page stays, no request. WebKit positive control: top navigation did not happen even without the sandbox, so in WebKit the block cannot be attributed to the sandbox alone (recorded as an annotation) |
| ST-11 | Same, page opened directly in its own tab | Direct | ST-11 "opened directly" | — | **RESIDUAL (documented)** — a sandboxed top-level page can navigate *its own* tab. The platform tab is unaffected (`rel="noopener noreferrer"`, COOP `same-origin`) and no token is sent in `Referer`. Same behaviour in Chromium, Firefox and WebKit |
| ST-12 | Register a service worker | Direct | ST-12 | — (see note) | **PASS** — registration rejected, 0 registrations |
| ST-13 | HTML disguised with an image extension | API | `apps/content/test/integration/content.test.ts` ST-13 | — | **PASS** — served as `image/png` with `nosniff` |
| ST-14 | Zip Slip (`../`, absolute, drive, backslash) and symlinks | API | `packages/zip-validator/test/validator.test.ts` ST-14; e2e upload | — | **PASS** — rejected before extraction; nothing written |
| ST-15 | Oversized, ZIP bomb, too many files, forbidden types | API | `validator.test.ts` ST-15; `upload-limits.test.ts` | — | **PASS** |
| ST-16 | Classmate's URL / token for another subdomain | API | `security.test.ts`, `content.test.ts` ST-16, view-token issuing | — | **PASS** — classmates cannot obtain a token (404); a token is refused on another subdomain (403). Forwarding a valid link works until expiry (accepted residual risk, SRD limitation 5) |
| ST-17 | Expired or modified token | API | `security.test.ts` ST-17, `content.test.ts` ST-17 | — | **PASS** |
| ST-18 | Cookie tossing from a sibling site | API (automated part) | `content.test.ts` ST-18 | — | **PASS (automated part)** — content server never sets cookies; forged parent-domain cookies do not change any decision. Effect on sibling sites: manual demonstration on staging NOT DONE yet (residual risk, SRD limitation 4) |
| ST-19 | Flood uploads or requests | API | `apps/api/test/integration/resource-control.test.ts` ST-19; `apps/content/test/integration/content.test.ts` ST-19 | Requests below the limit succeed | **PASS** — upload attempt over the hourly limit → 429 + `Retry-After`; requests over the per-subdomain limit → 429 with the full security header set; other subdomains and the next second unaffected. Cloudflare edge limit: to verify at deployment |

Summary: all 19 cases have automated results (ST-11 direct documented as a residual risk
alongside its PASS in the review iframe); the ST-18 manual staging demonstration is outstanding. ST-02, ST-07 and ST-11 also pass in
Firefox and WebKit.

## Notes

- **ST-12 positive control.** Not included: the service-worker attempt is checked by its
  outcome (rejected, zero registrations). A `bypassCSP` control was not added because
  registration inside a sandboxed document may fail for reasons other than `worker-src`.
- **ST-11 click.** Chromium already blocks top-level navigation from a cross-origin frame
  *without* user activation. The attack therefore runs on a real click, so that only the
  sandbox (no `allow-top-navigation`) can be what stops it.
- **Additional paths (plan ST-EXT).** `location.assign`, `<meta http-equiv="refresh">`,
  `sendBeacon`, WebSocket and SVG behaviour have not been tested yet. Self-navigation of a
  directly opened page (ST-11 direct) already shows that navigation is not covered by CSP.
