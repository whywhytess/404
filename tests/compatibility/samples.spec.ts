/**
 * NFR-C1: the four rule-compliant sample sites F01–F04 (written for this project, SRD 3.10)
 * work under the uniform policy. A site passes if it loads, its key behaviour works, it
 * reports no JavaScript errors and triggers no CSP violation.
 */
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { StudentSession, watch, zipFolder } from './platform.js';

const SAMPLES = path.resolve(import.meta.dirname, '../fixtures/samples');
test.describe.configure({ mode: 'serial' });

let session: StudentSession;
const links: Record<string, string> = {};
test.beforeAll(async ({ browserName }) => {
  session = await StudentSession.create(`samples-${browserName}`);
  for (const id of ['F01', 'F02', 'F03', 'F04']) {
    const out = await session.publish(id, zipFolder(path.join(SAMPLES, id)));
    expect(out.status, `${id} upload`).toBe(201);
    expect(out.warnings, `${id} should be rule-compliant`).toEqual([]);
    links[id] = out.link!;
  }
});

const tokenPrefix = (url: string) => new URL(url).pathname.split('/').slice(0, 3).join('/');

test(
  'F01 multi-page site: relative links keep the token path; images and the local font load',
  { tag: '@cross' },
  async ({ page }) => {
    const w = await watch(page);
    await page.goto(links.F01!);
    const prefix = tokenPrefix(page.url());
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('16px "Atkinson Hyperlegible"'))).toBe(
      true,
    );
    expect(
      await page.locator('header img').evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBeGreaterThan(0);

    await page.getByRole('link', { name: 'About' }).click();
    await expect(page.locator('#about-text')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`${prefix}/about.html`);

    await page.getByRole('link', { name: 'Projects' }).click();
    expect(new URL(page.url()).pathname).toBe(`${prefix}/projects/`);
    const imgs = page.locator('main img');
    await expect(imgs).toHaveCount(2);
    for (const width of await imgs.evaluateAll((els) =>
      els.map((e) => (e as HTMLImageElement).naturalWidth),
    )) {
      expect(width).toBeGreaterThan(0);
    }
    await page.getByRole('link', { name: 'Weather dashboard' }).click();
    await expect(page.locator('#project-detail')).toBeVisible();
    await page.getByRole('link', { name: 'Home' }).click();
    expect(new URL(page.url()).pathname).toBe(`${prefix}/index.html`);

    expect(await w.violations()).toEqual([]);
    expect(w.pageErrors).toEqual([]);
  },
);

test(
  'F02 interactive site: DOM updates, localStorage persists, alert() and confirm() work',
  { tag: '@cross' },
  async ({ page }) => {
    const w = await watch(page);
    await page.goto(links.F02!);
    for (const t of ['Read chapter 3', 'Submit lab 2']) {
      await page.getByLabel('New task').fill(t);
      await page.getByRole('button', { name: 'Add' }).click();
    }
    await expect(page.locator('#count')).toHaveText('2');
    await page.getByText('Read chapter 3').click();
    await expect(page.getByText('Read chapter 3')).toHaveClass(/done/);
    await page.reload();
    await expect(page.locator('#count')).toHaveText('2'); // persisted in localStorage

    const dialogs: string[] = [];
    page.on('dialog', async (d) => {
      dialogs.push(`${d.type()}:${d.message()}`);
      await d.accept();
    });
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.locator('#count')).toHaveText('0');
    expect(dialogs).toEqual(['confirm:Delete all tasks?', 'alert:All tasks deleted.']);

    expect(await w.violations()).toEqual([]);
    expect(w.pageErrors).toEqual([]);
  },
);

test(
  'F03 data and forms: fetch() of local JSON, a JavaScript-handled form and a GET form',
  { tag: '@cross' },
  async ({ page }) => {
    const w = await watch(page);
    await page.goto(links.F03!);
    const prefix = tokenPrefix(page.url());
    await expect(page.locator('#courses li')).toHaveCount(4);
    await page.getByLabel('Filter (handled by JavaScript)').fill('database');
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.locator('#courses li')).toHaveText(['CAT203 Database Systems (4 credits)']);

    await page.getByLabel('Course code').fill('cat404');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.locator('#result')).toHaveText('CAT404: Software Engineering Major Project');
    const url = new URL(page.url());
    expect(url.pathname).toBe(`${prefix}/results.html`);
    expect(url.searchParams.get('code')).toBe('cat404');

    expect(await w.violations()).toEqual([]);
    expect(w.pageErrors).toEqual([]);
  },
);

test(
  'F04 local library: Bootstrap modal and collapse work without a CDN',
  { tag: '@cross' },
  async ({ page }) => {
    const w = await watch(page);
    const external: string[] = [];
    page.on('request', (r) => {
      if (!r.url().includes('.localhost:')) external.push(r.url());
    });
    await page.goto(links.F04!);
    await page.getByRole('button', { name: 'Details' }).click();
    await expect(page.getByText('Saturday, 9 am')).toBeVisible();
    await page.getByRole('button', { name: 'Sign up' }).click();
    const modal = page.getByRole('dialog', { name: 'Sign up' });
    await expect(modal).toBeVisible();
    await modal.getByLabel('Name').fill('Nurul');
    await modal.getByRole('button', { name: 'Register' }).click();
    await expect(modal.locator('#thanks')).toHaveText('Thank you, Nurul!');

    expect(external).toEqual([]);
    expect(await w.violations()).toEqual([]);
    expect(w.pageErrors).toEqual([]);
  },
);
