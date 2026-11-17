import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { E2E_ADMIN } from './global-setup.js';

const ARCHIVES = path.resolve(import.meta.dirname, '../fixtures/archives');

/**
 * Phase 1 gate: admin creates a staff account and a course and assigns the instructor;
 * the instructor sets a password and creates an assignment; a student registers and joins
 * with the join code; the instructor closes the assignment and the student sees it closed.
 */
test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

const INSTRUCTOR = {
  name: 'Dr Aminah Rahman',
  email: 'aminah@e2e.webcove.test',
  password: 'instructor-own-pw',
};
const STUDENT = {
  name: 'Lee Wei Jie',
  email: 'weijie@e2e.webcove.test',
  password: 'student-own-pw',
};
let tempPassword = '';
let joinCode = '';

test('admin creates a staff account, a course, and assigns the instructor', async ({ page }) => {
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await page.getByRole('link', { name: 'Administration' }).click();

  const staff = page.locator('section', { hasText: 'Instructor and TA accounts' });
  await staff.getByLabel('Full name').fill(INSTRUCTOR.name);
  await staff.getByLabel('E-mail').fill(INSTRUCTOR.email);
  await staff.getByRole('button', { name: 'Create account' }).click();
  const notice = staff.getByRole('status');
  await expect(notice).toContainText(`Temporary password for ${INSTRUCTOR.email}`);
  tempPassword = (await notice.locator('code').innerText()).trim();
  expect(tempPassword).toHaveLength(16);

  const courses = page.locator('section', { hasText: 'New course' });
  await courses.getByLabel('Course code').fill('CAT201');
  await courses.getByLabel('Title').fill('Web Programming');
  await courses.getByRole('button', { name: 'Create course' }).click();
  await page.getByRole('link', { name: /CAT201/ }).click();

  await page
    .getByLabel('Staff account')
    .selectOption({ label: `${INSTRUCTOR.name} (${INSTRUCTOR.email})` });
  await page.getByLabel('Role').selectOption('instructor');
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.locator('section', { hasText: 'Course staff' })).toContainText(INSTRUCTOR.name);
  await signOut(page);
});

test('instructor changes the temporary password and creates an assignment', async ({ page }) => {
  await signIn(page, INSTRUCTOR.email, tempPassword);
  await expect(page).toHaveURL(/change-password/);
  await page.getByLabel('Current password').fill(tempPassword);
  await page.getByLabel('New password', { exact: true }).fill(INSTRUCTOR.password);
  await page.getByLabel('Repeat new password').fill(INSTRUCTOR.password);
  await page.getByRole('button', { name: 'Save password' }).click();

  await page.getByRole('link', { name: /CAT201/ }).click();
  joinCode = (await page.locator('code.join-code').innerText()).trim();
  expect(joinCode).toMatch(/^[A-Z2-9]{8}$/);

  await page.getByLabel('Title').fill('Assignment 1: Portfolio');
  await page.getByLabel('Description').fill('Build a multi-page site.');
  await page.getByRole('button', { name: 'Create assignment' }).click();
  await expect(page.getByRole('link', { name: 'Assignment 1: Portfolio' })).toBeVisible();
  await signOut(page);
});

test('student registers, joins with the code and sees the assignment and rules', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(STUDENT.name);
  await page.getByLabel('E-mail').fill(STUDENT.email);
  await page.getByLabel('Password').fill(STUDENT.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByLabel('Join code from your instructor').fill(joinCode.toLowerCase());
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.getByRole('status')).toContainText('You joined CAT201');
  await page.getByRole('link', { name: /CAT201/ }).click();
  await expect(page.locator('code.join-code')).toHaveCount(0); // students never see the code
  await page.getByRole('link', { name: 'Assignment 1: Portfolio' }).click();
  await expect(page.getByRole('heading', { name: 'Submission rules' })).toBeVisible();

  // Student cannot open the administration page.
  await page.goto('/admin');
  await expect(page.getByText('Administrators only.')).toBeVisible();
  await page.goto('/');
  await signOut(page);
});

test('student uploads: a valid ZIP is published, an unsafe ZIP is rejected, rollback works', async ({
  page,
}) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.getByRole('link', { name: /CAT201/ }).click();
  await page.getByRole('link', { name: 'Assignment 1: Portfolio' }).click();
  const upload = async (file: string) => {
    await page.getByLabel('ZIP file of your website').setInputFiles(path.join(ARCHIVES, file));
    await page.getByRole('button', { name: 'Upload and publish' }).click();
  };

  await upload('valid-site.zip');
  await expect(page.getByText('Published as version 1.')).toBeVisible();

  // ST-14 through the UI: rejected, with the file named, and the published version unchanged.
  await upload('zipslip-parent.zip');
  const rejection = page.getByRole('alert').filter({ hasText: 'Not published.' });
  await expect(rejection).toContainText('../evil.html');
  await expect(rejection).toContainText('Your published version has not changed.');
  await expect(page.getByText('Published: version 1')).toBeVisible();

  await upload('warnings-site.zip');
  const ok = page.getByRole('status').filter({ hasText: 'Published as version 2.' });
  await expect(ok).toContainText('warning(s)');
  await expect(ok).toContainText('inline');

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Go back to version 1' }).click();
  await expect(page.getByText('Published: version 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go back to version 2' })).toBeVisible();
  await signOut(page);
});

test('instructor closes the assignment; the student sees it as closed', async ({ page }) => {
  await signIn(page, INSTRUCTOR.email, INSTRUCTOR.password);
  await page.getByRole('link', { name: /CAT201/ }).click();
  await page.getByRole('link', { name: 'Assignment 1: Portfolio' }).click();
  await page.getByRole('link', { name: 'Review submissions →' }).click();
  await expect(page.getByRole('cell', { name: STUDENT.name })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'v1', exact: true })).toBeVisible();
  await page.goBack();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Close assignment' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Closed');
  await signOut(page);

  await signIn(page, STUDENT.email, STUDENT.password);
  await page.getByRole('link', { name: /CAT201/ }).click();
  await page.getByRole('link', { name: 'Assignment 1: Portfolio' }).click();
  await expect(
    page.getByText('This assignment is closed. Uploads and rollbacks are not accepted.'),
  ).toBeVisible();
});
