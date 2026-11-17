# Risk Register

Likelihood / impact: L / M / H. Status: Open, Mitigating, Closed.

| ID | Risk | L | I | Trigger / early warning | Mitigation | Status |
| --- | --- | :-: | :-: | --- | --- | --- |
| R01 | Wildcard DNS/TLS harder than planned | M | H | One random host cannot get HTTPS on staging | Develop with `*.localhost`; get a staging domain early in Sprints 3–4; never fall back to platform-origin hosting | Open |
| R02 | Relative-path / token-prefix breakage | M | M | F01 links or CSS `url()` 404 under `/_t/` | Path-resolution unit tests; F01 regression; FR-15 warning for root-absolute paths | Open |
| R03 | Strict CSP breaks legitimate coursework | M | M | External MDN samples mostly fail | Record restriction cost (SRD 3.10); policy changes only via ADR + SRD update | Open |
| R04 | Unsafe ZIP handling (Zip Slip, bombs) | L | H | Validator writes outside temp dir; memory spikes | ADR-003; malicious ZIP fixtures; running byte counter | Open |
| R05 | DB pointer switched but objects missing | L | H | Fault-injection test fails | ADR-004 order; verify before commit; orphan cleanup | Open |
| R06 | Close races with a publish | L | M | Version changes after close | ADR-005 row locks; race test | Open |
| R07 | No interview/questionnaire data before 29 Nov | M | M | SRD 3.4.2 still TODO | Report real numbers only; mark NOT CONDUCTED; continue collecting | Open (user action) |
| R08 | Local hostnames do not reproduce production site boundaries | M | M | `127.0.0.1` vs `*.localhost` behaves differently from two real domains | Repeat ST-01/02/18 on staging with real domains | Open |
| R09 | Toolchain churn (TypeScript 7 broke typescript-eslint; MinIO images gone) | M | L | Install or lint failure after an upgrade | Pin TypeScript 6.0, SeaweedFS 4.54; lockfile committed (ADR-012) | Mitigating |
| R10 | Port clashes with other local projects | H | L | Compose fails to bind | Web Cove uses 55432 / 59000 | Closed |
| R11 | Phishing abuse if deployed publicly | L | M | Reports of abuse | Access needs a course membership + token; take-down (FR-29); `noindex` | Open |
| R12 | Lost context between Claude sessions | M | M | Duplicate files or reversed decisions | `CLAUDE.md`, `docs/EXECUTION_STATUS.md`, ADRs, small commits | Mitigating |
