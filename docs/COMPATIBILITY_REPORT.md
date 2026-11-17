# Compatibility Report (NFR-C1, SRD 3.10)

Measured 2026-11-17 on the local stack in Chromium, Firefox and WebKit (Playwright 1.65).
Commands: `pnpm fixtures:external && pnpm test:compatibility`. Raw results:
`docs/evidence/compatibility/external-samples-{chromium,firefox,webkit}.json`.

## 1. Rule-compliant samples F01–F04 (written for this project)

A site passes if it loads, its key behaviour works, and there are **no JavaScript errors and
no CSP violations**.

| ID | What it checks | Chromium | Firefox | WebKit |
| --- | --- | :-: | :-: | :-: |
| F01 | 4 pages linked by relative paths (incl. `projects/` folder), SVG/PNG images, local WOFF2 font; every navigation keeps the `/_t/<token>/` prefix | PASS | PASS | PASS |
| F02 | Local JS, DOM updates, `localStorage` persists across reload, `confirm()` and `alert()` | PASS | PASS | PASS |
| F03 | `fetch('data/courses.json')`, a form handled by JavaScript, a GET form to `results.html` (no server-side POST — SRD limitation 1) | PASS | PASS | PASS |
| F04 | Bootstrap 5.3.9 included locally: modal and collapse work; no request leaves the site | PASS | PASS | PASS |

Result: **4/4 in all three engines** (12/12). All four upload with zero rule warnings.

Third-party material inside F01–F04: Atkinson Hyperlegible font (`@fontsource/atkinson-hyperlegible`
5.3.0, OFL-1.1, licence file included) and Bootstrap 5.3.9 (MIT, licence file included).
All other files were written for this project.

## 2. Unmodified external samples (restriction cost)

Source: MDN Learning Area, <https://github.com/mdn/learning-area>, commit
`21973263ba859ff3477919087b488157f9d618a6`, licence CC0-1.0. Files are downloaded at test time
and verified by SHA-256 (`tests/fixtures/external-samples.json`); they are **not stored in this
repository**, because some assets (photos, icons, a film clip, an icon font) have their own or
unstated licences.

Each folder was uploaded exactly as published. Results were identical in all three engines.

| ID | Sample | Upload | Rule warnings | Blocked at run time | Runs unchanged? | What would have to change |
| --- | --- | --- | --- | --- | :-: | --- |
| X1 | Can store (fetch JSON + images) | Accepted | `EXTERNAL_STYLE`, `BLOB_URL` | Google Fonts stylesheet (`style-src`); 12 product images shown via `blob:` URLs (`img-src`) | **No** | Self-host the fonts (1 file + 1 link); set `img.src` to the image path instead of fetching a blob (≈ 5 lines in `can-script.js`) |
| X2 | Bouncing balls (canvas) | Accepted | — | — | **Yes** | — |
| X3 | Document and website structure | Accepted | `EXTERNAL_STYLE` | Google Fonts stylesheet (`style-src`) | **No** (page works, fonts fall back) | Self-host the fonts or remove the link (1 line) |
| X4 | Web Storage greeting | Accepted | — | — | **Yes** | — |
| X5 | Web Workers (prime generator) | Accepted | `WORKER` | `new Worker()` (`worker-src 'none'`) | **No** | Move the computation into the main script (structural change; slower UI) |
| X6 | Custom video player | **Rejected** (`ARCHIVE_TOO_LARGE`, 26 MB > 20 MB; video 21 MB > 5 MB per file) | — | (not published) | **No** | Re-encode or shorten the video below 5 MB |

Summary: **2 of 6 run unchanged.** Three need small, mechanical changes (fonts, blob images,
video size); one (X5) needs a structural change because the policy forbids workers.

The adapted versions have **not yet been built and re-tested**; the "what would have to change"
column is an analysis of the measured failures, not a measured result.

## 3. Findings and follow-up

1. **Every run-time block was predicted at upload.** After this measurement, two warnings were
   added to the validator — `WORKER` (`new Worker`, `serviceWorker.register`) and `BLOB_URL`
   (`URL.createObjectURL`) — so that X1 and X5 now warn the student before publishing.
2. **`blob:` images (X1) are a common tutorial pattern.** Allowing `blob:` in `img-src` and
   `media-src` would make X1 work unchanged. `blob:` URLs can only be created by the page's own
   script from data it already holds, so the change would not open a new exfiltration path,
   but it changes the uniform policy (SRD Appendix D) and therefore needs a decision, an ADR and
   an SRD update before it is made. **Not changed.**
3. **Size limits** reject typical video coursework (X6). This is the intended trade-off of
   Table 3.21 and is reported here as a cost, not a defect.
4. These samples support claims about *these* sites only, not about all coursework.
