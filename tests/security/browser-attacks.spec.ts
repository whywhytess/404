/**
 * Browser-enforced security cases ST-01 – ST-12 (SRD Table 3.22, Section 3.10).
 *
 * Evidence has three parts (execution plan 9.1):
 *  1. the attack script really ran — it must set window.__wc.done, otherwise the test fails;
 *  2. the control had the expected effect — no request reached the intercepted attacker
 *     domain AND the browser reported a `securitypolicyviolation` naming the directive;
 *  3. positive controls — the same attack run with CSP bypassed (Chromium `bypassCSP`)
 *     DOES reach the attacker, proving the test can detect a working attack.
 * Requests to https://attacker.test are intercepted by Playwright; nothing leaves the machine.
 */
import { expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { PLATFORM_URL } from '../../playwright.config.js';
import { ATTACKER, getWorld, signInUi, type AttackResult, type World } from './world.js';

test.describe.configure({ mode: 'serial' });

let world: World;
test.beforeAll(async () => {
  world = await getWorld();
});

/** Intercept everything sent to the attacker domain and record it. */
/** Referer headers seen by the attacker (must never contain an access token). */
const attackerReferers: string[] = [];

async function trapAttacker(context: BrowserContext): Promise<string[]> {
  const hits: string[] = [];
  await context.route(`${ATTACKER}/**`, async (route) => {
    hits.push(route.request().url());
    const referer = await route.request().headerValue('referer');
    if (referer) attackerReferers.push(referer);
    const url = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: url.endsWith('.js') ? 'text/javascript' : 'text/html',
      body: url.endsWith('.js') ? 'window.__evilRan = true;' : '<h1>attacker</h1>',
    });
  });
  return hits;
}

async function result(target: Page | Frame): Promise<AttackResult> {
  // A missing result (crashed or blocked script) times out here and fails the test.
  await target.waitForFunction(
    () => (window as unknown as { __wc?: { done: boolean } }).__wc?.done === true,
    null,
    {
      timeout: 10_000,
    },
  );
  return target.evaluate(() => (window as unknown as { __wc: AttackResult }).__wc);
}

const directives = (r: AttackResult) => r.violations.map((v) => v.directive);
const pageUrl = (student: number, file: string, query = '') =>
  `${world.students[student]!.link}${file}${query}`;

async function openDirect(context: BrowserContext, student: number, file: string, query = '') {
  const page = await context.newPage();
  // The attack scripts signal completion themselves (window.__wc.done); do not wait for 'load',
  // which a blocked form navigation (ST-08) can hold open in Chromium.
  const response = await page.goto(pageUrl(student, file, query), { waitUntil: 'commit' });
  return { page, response };
}

/** Open the real review page as the instructor and point the sandboxed iframe at a case page. */
async function openInReviewIframe(
  page: Page,
  file: string,
  opts: { removeSandbox?: boolean } = {},
) {
  await signInUi(page, world.instructor.email, world.instructor.password);
  await page.goto(`${PLATFORM_URL}/assignments/${world.assignmentId}/review`);
  await page.getByRole('button', { name: 'Student A' }).click();
  const iframe = page.locator('iframe.preview-frame');
  await expect(iframe).toHaveAttribute('src', /\/_t\//);
  const base = (await iframe.getAttribute('src'))!;
  await page.evaluate(
    ({ src, removeSandbox }) => {
      const el = document.querySelector('iframe.preview-frame') as HTMLIFrameElement;
      if (removeSandbox) el.removeAttribute('sandbox');
      el.src = src;
    },
    { src: `${base}${file}`, removeSandbox: !!opts.removeSandbox },
  );
  const frame = await waitForFrame(page, file);
  return { frame };
}

async function waitForFrame(page: Page, file: string): Promise<Frame> {
  for (let i = 0; i < 100; i++) {
    const f = page.frames().find((fr) => fr.url().endsWith(`/${file}`));
    if (f) return f;
    await page.waitForTimeout(50);
  }
  throw new Error(`frame ${file} did not load`);
}

test('ST-01 student code cannot read the platform session cookie', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInUi(page, world.students[0]!.email, world.students[0]!.password);
  // Positive evidence: the platform session cookie exists in this browser, HttpOnly.
  const platformCookie = (await context.cookies(PLATFORM_URL)).find((c) => c.name === 'wc.sid');
  expect(platformCookie?.httpOnly).toBe(true);

  const contentCookies: string[] = [];
  context.on('request', (r) => {
    if (r.url().includes('.localhost:')) contentCookies.push(r.headers()['cookie'] ?? '');
  });
  const { page: site } = await openDirect(
    context,
    0,
    'st01.html',
    `?platform=${encodeURIComponent(PLATFORM_URL)}`,
  );
  const r = await result(site);
  expect(r.hasPlatformCookie).toBe(false);
  expect(r.fetchBlocked).toBe(true); // credentialed fetch to the platform API blocked
  expect(directives(r)).toContain('connect-src');
  expect(contentCookies.every((c) => !c.includes('wc.sid'))).toBe(true); // never sent to the content origin
  await context.close();
});

test(
  'ST-02 one submission cannot read or write another submission’s storage or cookies',
  { tag: '@cross' },
  async ({ browser }) => {
    const context = await browser.newContext();
    const a = await openDirect(context, 0, 'st02.html', '?mode=write');
    expect((await result(a.page)).wrote).toBe(true);
    // Positive control: the same origin does see the data it wrote.
    const again = await openDirect(context, 0, 'st02.html', '?mode=read');
    expect((await result(again.page)).storage).toBe('from-A');
    // Another submission (different subdomain) does not.
    const b = await openDirect(context, 1, 'st02.html', '?mode=read');
    const rb = await result(b.page);
    expect(rb.storage).toBeNull();
    expect(String(rb.cookie)).not.toContain('wcA=1');
    await context.close();
  },
);

test('ST-03 code in the review iframe cannot access the platform page’s DOM', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const { frame } = await openInReviewIframe(page, 'st03.html');
  const r = await result(frame);
  expect(r.readDom).toBe(false);
  expect(r.readUrl).toBe(false);
  expect(r.errors).toContain('SecurityError');
  await context.close();
});

test('ST-04 opened directly (no review iframe), the CSP sandbox still applies', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const hits = await trapAttacker(context);
  const popups: Page[] = [];
  context.on('page', (p) => popups.push(p));
  const { page, response } = await openDirect(context, 0, 'st04.html');
  expect(response!.headers()['content-security-policy']).toContain(
    'sandbox allow-scripts allow-forms allow-same-origin allow-modals',
  );
  const r = await result(page);
  expect(r.isTop).toBe(true);
  expect(r.popupOpened).toBe(false);
  expect(popups).toHaveLength(1); // only the page we opened
  expect(hits).toEqual([]);
  await context.close();
});

/** ST-05/07/08/09: positive control with CSP bypassed, then the real policy. */
async function exfiltrationCase(
  browser: import('@playwright/test').Browser,
  file: string,
  expected: string[],
  attackerPath: RegExp,
) {
  // Positive control: CSP disabled → the attack reaches the attacker.
  const control = await browser.newContext({ bypassCSP: true });
  const controlHits = await trapAttacker(control);
  const cp = await control.newPage();
  // 'commit': a successful attack may navigate away (ST-08), so do not wait for 'load'.
  await cp.goto(pageUrl(0, file), { waitUntil: 'commit' });
  await expect
    .poll(() => controlHits.some((h) => attackerPath.test(h)), { timeout: 10_000 })
    .toBe(true);
  await control.close();

  // Real policy: nothing reaches the attacker and the browser reports the directive.
  const context = await browser.newContext();
  const hits = await trapAttacker(context);
  const { page } = await openDirect(context, 0, file);
  const r = await result(page);
  for (const d of expected) expect(directives(r), `violation for ${d}`).toContain(d);
  expect(hits).toEqual([]);
  await context.close();
  return r;
}

test('ST-05 an external script is blocked by script-src', async ({ browser }) => {
  const r = await exfiltrationCase(browser, 'st05.html', ['script-src-elem'], /evil\.js/);
  expect(r.evilRan).toBe(false);
});

test('ST-06 inline scripts, event-handler attributes and eval() are blocked', async ({
  browser,
}) => {
  // Positive control: with CSP bypassed every form of injected code runs.
  const control = await browser.newContext({ bypassCSP: true });
  const cp = await control.newPage();
  await cp.goto(pageUrl(0, 'st06.html'));
  const rc = await result(cp);
  expect([rc.inlineRan, rc.handlerRan, rc.evalRan, rc.fnRan]).toEqual([true, true, true, true]);
  await control.close();

  const context = await browser.newContext();
  const { page } = await openDirect(context, 0, 'st06.html');
  const r = await result(page);
  expect([r.inlineRan, r.handlerRan, r.evalRan, r.fnRan]).toEqual([false, false, false, false]);
  expect(directives(r)).toEqual(
    expect.arrayContaining(['script-src-elem', 'script-src-attr', 'script-src']),
  );
  await context.close();
});

test(
  'ST-07 fetch() and image requests to an external server are blocked',
  { tag: '@cross' },
  async ({ browser }) => {
    await exfiltrationCase(browser, 'st07.html', ['connect-src', 'img-src'], /\/(steal|pixel)/);
  },
);

test('ST-08 a form cannot submit to an external server', async ({ browser }) => {
  await exfiltrationCase(browser, 'st08.html', ['form-action'], /\/collect\?password=hunter2/);
});

test('ST-09 an external frame cannot be embedded', async ({ browser }) => {
  await exfiltrationCase(browser, 'st09.html', ['frame-src'], /frame\.html/);
});

test.describe('ST-10 pop-up windows', () => {
  test('inside the review iframe: no pop-up, nothing reaches the attacker', async ({ browser }) => {
    const context = await browser.newContext();
    const hits = await trapAttacker(context);
    const page = await context.newPage();
    const { frame } = await openInReviewIframe(page, 'st10.html');
    const pagesBefore = context.pages().length;
    const r = await result(frame);
    expect(r.popupOpened).toBe(false);
    expect(context.pages().length).toBe(pagesBefore);
    expect(hits).toEqual([]);
    await context.close();
  });

  test('opened directly: no pop-up, nothing reaches the attacker', async ({ browser }) => {
    // Positive control: without the CSP sandbox the pop-up opens.
    const control = await browser.newContext({ bypassCSP: true });
    const controlHits = await trapAttacker(control);
    const cp = await control.newPage();
    await cp.goto(pageUrl(0, 'st10.html'));
    expect((await result(cp)).popupOpened).toBe(true);
    await expect.poll(() => controlHits.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await control.close();

    const context = await browser.newContext();
    const hits = await trapAttacker(context);
    const { page } = await openDirect(context, 0, 'st10.html');
    const r = await result(page);
    expect(r.popupOpened).toBe(false);
    expect(context.pages()).toHaveLength(1);
    expect(hits).toEqual([]);
    await context.close();
  });
});

test.describe('ST-11 top-level navigation', { tag: '@cross' }, () => {
  test('inside the review iframe: the platform page cannot be redirected', async ({
    browser,
    browserName,
  }) => {
    // Positive control: an unsandboxed iframe with CSP bypassed CAN redirect the top window.
    const control = await browser.newContext({ bypassCSP: true });
    const controlHits = await trapAttacker(control);
    const cpage = await control.newPage();
    const c = await openInReviewIframe(cpage, 'st11.html', { removeSandbox: true });
    await c.frame.waitForFunction(
      () => (window as unknown as { __wc: { ready?: boolean } }).__wc.ready === true,
    );
    await c.frame.click('#go');
    if (browserName === 'webkit') {
      // WebKit did not perform the top-level navigation even without the sandbox, so the
      // positive control cannot be demonstrated there; the result is recorded, not asserted.
      await cpage.waitForTimeout(2000);
      test.info().annotations.push({
        type: 'positive-control',
        description: `webkit: top navigation without sandbox reached attacker = ${controlHits.some((h) => h.includes('phish-top'))}`,
      });
    } else {
      await expect
        .poll(() => controlHits.some((h) => h.includes('phish-top')), { timeout: 10_000 })
        .toBe(true);
    }
    await control.close();

    const context = await browser.newContext();
    const hits = await trapAttacker(context);
    const page = await context.newPage();
    const { frame } = await openInReviewIframe(page, 'st11.html');
    await frame.waitForFunction(
      () => (window as unknown as { __wc: { ready?: boolean } }).__wc.ready === true,
    );
    await frame.click('#go'); // with user activation
    await frame.waitForFunction(
      () => (window as unknown as { __wc: { navError?: unknown } }).__wc.navError !== undefined,
    );
    await page.waitForLoadState('networkidle');
    expect(page.url()).toBe(`${PLATFORM_URL}/assignments/${world.assignmentId}/review`);
    expect(hits).toEqual([]);
    await context.close();
  });

  test('opened directly: the page can navigate its OWN tab (documented residual risk)', async ({
    browser,
  }) => {
    // SRD 3.10 runs ST-11 in both contexts because browsers treat them differently. A sandboxed
    // top-level document may still navigate itself; the sandbox only stops it from navigating
    // OTHER browsing contexts. The platform tab is not affected: links open with
    // rel="noopener noreferrer" and the content sets Cross-Origin-Opener-Policy: same-origin.
    const context = await browser.newContext();
    const hits = await trapAttacker(context);
    const { page } = await openDirect(context, 0, 'st11.html', '?mode=self');
    await expect
      .poll(() => hits.some((h) => h.includes('phish-self')), { timeout: 10_000 })
      .toBe(true);
    expect(page.url()).toContain('attacker.test/phish-self');
    // Referrer-Policy: no-referrer — the access token in the URL is not leaked to the target.
    expect(attackerReferers.filter((r) => r.includes('/_t/'))).toEqual([]);
    await context.close();
  });
});

test(
  'ADR-014 blob: works for images but not for scripts or workers',
  { tag: '@cross' },
  async ({ browser }) => {
    const context = await browser.newContext();
    const { page } = await openDirect(context, 0, 'stblob.html');
    const r = await result(page);
    expect(r.imageLoaded).toBe(true);
    expect(r.scriptRan).toBe(false);
    expect(directives(r)).toEqual(expect.arrayContaining(['script-src-elem', 'worker-src']));
    await context.close();
  },
);

test('ST-12 a service worker cannot be registered', async ({ browser }) => {
  const context = await browser.newContext();
  const { page } = await openDirect(context, 0, 'st12.html');
  const r = await result(page);
  expect(r.registered).toBe(false);
  expect(r.registrations).toBe(0);
  await context.close();
});

test('no request that reached the attacker carried the access token in a Referer header', () => {
  // Collected from every positive control and attack above (Referrer-Policy: no-referrer).
  expect(attackerReferers.filter((r) => r.includes('/_t/'))).toEqual([]);
});
