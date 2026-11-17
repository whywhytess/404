/**
 * Shared set-up for the browser security tests: one course, an instructor, and two
 * students who each publish the attack fixture site (tests/fixtures/attack-site).
 * Everything is created through the real platform API. Synthetic data only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { request, type APIRequestContext, type Page } from '@playwright/test';
import { buildZip } from '@webcove/zip-validator/zip-writer';
import { E2E_ADMIN } from '../e2e/global-setup.js';
import { PLATFORM_URL } from '../../playwright.config.js';

export const API_URL = 'http://127.0.0.1:3000';
export const ATTACKER = 'https://attacker.test';
const FIXTURE_DIR = path.resolve(import.meta.dirname, '../fixtures/attack-site');

function zipFolder(dir: string): Buffer {
  const entries: { name: string; data: Buffer }[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else
        entries.push({
          name: path.relative(dir, full).split(path.sep).join('/'),
          data: readFileSync(full),
        });
    }
  };
  walk(dir);
  return buildZip(entries);
}

async function api(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: API_URL, extraHTTPHeaders: { Origin: PLATFORM_URL } });
}

async function ok<T>(res: Awaited<ReturnType<APIRequestContext['post']>>): Promise<T> {
  if (!res.ok()) throw new Error(`${res.url()} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

export interface World {
  assignmentId: string;
  instructor: { email: string; password: string };
  students: {
    email: string;
    password: string;
    submissionId: string;
    link: string;
    subdomain: string;
  }[];
}

let cached: Promise<World> | undefined;

export function getWorld(): Promise<World> {
  return (cached ??= build());
}

async function build(): Promise<World> {
  const tag = Date.now().toString(36);
  const admin = await api();
  await ok(await admin.post('/api/auth/login', { data: E2E_ADMIN }));
  const staff = await ok<{ user: { id: string }; temporaryPassword: string }>(
    await admin.post('/api/admin/staff', {
      data: { name: 'Security Instructor', email: `sec-instructor-${tag}@e2e.webcove.test` },
    }),
  );
  const course = await ok<{ course: { id: string; joinCode: string } }>(
    await admin.post('/api/courses', {
      data: { code: `SEC${tag.slice(-4)}`, title: 'Security tests' },
    }),
  );
  await ok(
    await admin.post(`/api/courses/${course.course.id}/staff`, {
      data: { userId: staff.user.id, role: 'instructor' },
    }),
  );

  const instructor = {
    email: `sec-instructor-${tag}@e2e.webcove.test`,
    password: 'sec-instructor-pw',
  };
  const inst = await api();
  await ok(
    await inst.post('/api/auth/login', {
      data: { email: instructor.email, password: staff.temporaryPassword },
    }),
  );
  await ok(
    await inst.post('/api/auth/change-password', {
      data: { currentPassword: staff.temporaryPassword, newPassword: instructor.password },
    }),
  );
  const a = await ok<{ assignment: { id: string } }>(
    await inst.post(`/api/courses/${course.course.id}/assignments`, {
      data: { title: 'Attack fixture' },
    }),
  );

  const zip = zipFolder(FIXTURE_DIR);
  const students: World['students'] = [];
  for (const who of ['a', 'b']) {
    const email = `sec-student-${who}-${tag}@e2e.webcove.test`;
    const password = 'sec-student-pw';
    const s = await api();
    await ok(
      await s.post('/api/auth/register', {
        data: { name: `Student ${who.toUpperCase()}`, email, password },
      }),
    );
    await ok(await s.post('/api/courses/join', { data: { joinCode: course.course.joinCode } }));
    const up = await ok<{ submission: { id: string } }>(
      await s.post(`/api/assignments/${a.assignment.id}/submission`, {
        multipart: { archive: { name: 'attack.zip', mimeType: 'application/zip', buffer: zip } },
      }),
    );
    const link = await ok<{ url: string; subdomain: string }>(
      await s.post(`/api/submissions/${up.submission.id}/view-token`),
    );
    students.push({
      email,
      password,
      submissionId: up.submission.id,
      link: link.url,
      subdomain: link.subdomain,
    });
  }
  return { assignmentId: a.assignment.id, instructor, students };
}

export async function signInUi(page: Page, email: string, password: string) {
  await page.goto(`${PLATFORM_URL}/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'My courses' }).waitFor();
}

export interface AttackResult {
  done: boolean;
  violations: { directive: string; blocked: string }[];
  [k: string]: unknown;
}
