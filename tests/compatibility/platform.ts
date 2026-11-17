/**
 * Publish folders as student submissions through the real platform API and return
 * tokenised links (one assignment per site). Synthetic accounts only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { request, type APIRequestContext, type Page } from '@playwright/test';
import { buildZip } from '@webcove/zip-validator/zip-writer';
import { E2E_ADMIN } from '../e2e/global-setup.js';
import { PLATFORM_URL } from '../../playwright.config.js';

const API_URL = 'http://127.0.0.1:3000';

export function zipFolder(dir: string): Buffer {
  const entries: { name: string; data: Buffer }[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
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

export interface PublishOutcome {
  status: number;
  errors: { code: string; file?: string; message: string }[];
  warnings: { code: string; file?: string; message: string }[];
  link?: string;
}

export class StudentSession {
  private constructor(
    private student: APIRequestContext,
    private instructor: APIRequestContext,
    private courseId: string,
  ) {}

  static async create(tag: string): Promise<StudentSession> {
    const t = `${tag}-${Date.now().toString(36)}`;
    const ctx = () =>
      request.newContext({ baseURL: API_URL, extraHTTPHeaders: { Origin: PLATFORM_URL } });
    const ok = async <T>(r: Awaited<ReturnType<APIRequestContext['post']>>) => {
      if (!r.ok()) throw new Error(`${r.url()} ${r.status()} ${await r.text()}`);
      return (await r.json()) as T;
    };
    const admin = await ctx();
    await ok(await admin.post('/api/auth/login', { data: E2E_ADMIN }));
    const staff = await ok<{ user: { id: string }; temporaryPassword: string }>(
      await admin.post('/api/admin/staff', {
        data: { name: 'Compat Instructor', email: `compat-i-${t}@e2e.webcove.test` },
      }),
    );
    const course = await ok<{ course: { id: string; joinCode: string } }>(
      await admin.post('/api/courses', { data: { code: 'COMPAT', title: `Compatibility ${t}` } }),
    );
    await ok(
      await admin.post(`/api/courses/${course.course.id}/staff`, {
        data: { userId: staff.user.id, role: 'instructor' },
      }),
    );
    const instructor = await ctx();
    await ok(
      await instructor.post('/api/auth/login', {
        data: { email: `compat-i-${t}@e2e.webcove.test`, password: staff.temporaryPassword },
      }),
    );
    await ok(
      await instructor.post('/api/auth/change-password', {
        data: { currentPassword: staff.temporaryPassword, newPassword: 'compat-instructor-pw' },
      }),
    );
    const student = await ctx();
    await ok(
      await student.post('/api/auth/register', {
        data: {
          name: 'Compat Student',
          email: `compat-s-${t}@e2e.webcove.test`,
          password: 'compat-student-pw',
        },
      }),
    );
    await ok(
      await student.post('/api/courses/join', { data: { joinCode: course.course.joinCode } }),
    );
    return new StudentSession(student, instructor, course.course.id);
  }

  async publish(title: string, zip: Buffer): Promise<PublishOutcome> {
    const a = await this.instructor.post(`/api/courses/${this.courseId}/assignments`, {
      data: { title },
    });
    const assignmentId = ((await a.json()) as { assignment: { id: string } }).assignment.id;
    const up = await this.student.post(`/api/assignments/${assignmentId}/submission`, {
      multipart: { archive: { name: 'site.zip', mimeType: 'application/zip', buffer: zip } },
    });
    const body = (await up.json()) as {
      submission?: { id: string };
      warnings?: PublishOutcome['warnings'];
      error?: { code: string; message: string; details?: { errors?: PublishOutcome['errors'] } };
    };
    if (!up.ok()) {
      // Validator rejections carry per-file details; other refusals (e.g. size limit) carry one code.
      const errors =
        body.error?.details?.errors ??
        (body.error ? [{ code: body.error.code, message: body.error.message }] : []);
      return { status: up.status(), errors, warnings: [] };
    }
    const t = await this.student.post(`/api/submissions/${body.submission!.id}/view-token`);
    const link = ((await t.json()) as { url: string }).url;
    return { status: up.status(), errors: [], warnings: body.warnings ?? [], link };
  }
}

/** Collect CSP violations and JavaScript errors on a page (installed before any page script). */
export async function watch(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  await page.addInitScript(() => {
    const w = window as unknown as {
      __violations: { directive: string; blocked: string; source: string }[];
    };
    w.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__violations.push({
        directive: e.effectiveDirective,
        blocked: String(e.blockedURI),
        source: e.sourceFile,
      });
    });
  });
  return {
    pageErrors,
    consoleErrors,
    violations: () =>
      page.evaluate(
        () =>
          (window as unknown as { __violations?: { directive: string; blocked: string }[] })
            .__violations ?? [],
      ),
  };
}
