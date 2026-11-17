import { describe, expect, it } from 'vitest';
import { FIXTURES } from '@webcove/zip-validator/fixtures';
import {
  createCourseWithMembers,
  createUser,
  setupHarness,
  uploadZip,
} from '../helpers/harness.js';

// Separate file: setupHarness() resets the shared test database.
describe('FR-11 archive size limit', () => {
  it('refuses an archive over the size limit while receiving it (413)', async () => {
    const small = await setupHarness({
      uploadLimits: {
        maxArchiveBytes: 100,
        maxFileBytes: 1e6,
        maxFiles: 500,
        maxTotalBytes: 1e7,
        maxCompressionRatio: 100,
      },
    });
    try {
      const a = await createUser(small, 'admin');
      const c = await createCourseWithMembers(small, a.c);
      const asg = await c.instructor.c.post(`/api/courses/${c.course.id}/assignments`, {
        title: 'x',
      });
      const res = await uploadZip(c.student.c, asg.body.assignment.id, FIXTURES['valid-site']!());
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('ARCHIVE_TOO_LARGE');
    } finally {
      await small.close();
    }
  });
});
