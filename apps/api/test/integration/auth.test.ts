import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ORIGIN, client, setupHarness, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => h.close());

describe('FR-01 student registration', () => {
  it('creates a student account, signs in and never returns the password hash', async () => {
    const c = client(h.app);
    const res = await c.post('/api/auth/register', {
      name: 'Aina',
      email: 'Aina@Example.test',
      password: 'long-enough-pw',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      name: 'Aina',
      email: 'aina@example.test',
      accountType: 'student',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash|argon2/);

    // NFR-S4: HttpOnly, SameSite=Lax, no Domain attribute.
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/wc\.sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Domain=/i);

    const me = await c.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('aina@example.test');
  });

  it('rejects a duplicate e-mail regardless of case', async () => {
    const res = await client(h.app).post('/api/auth/register', {
      name: 'X',
      email: 'AINA@example.test',
      password: 'long-enough-pw',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates input and reports field errors', async () => {
    const res = await client(h.app).post('/api/auth/register', {
      name: '',
      email: 'not-an-email',
      password: 'short',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    const paths = res.body.error.details.fields.map((f: { path: string }) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });
});

describe('FR-02 sign in and sign out', () => {
  it('uses the same error for a wrong password and an unknown e-mail', async () => {
    const wrong = await client(h.app).post('/api/auth/login', {
      email: 'aina@example.test',
      password: 'wrong-password',
    });
    const unknown = await client(h.app).post('/api/auth/login', {
      email: 'nobody@example.test',
      password: 'wrong-password',
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('invalidates the session on sign-out, including a replayed cookie', async () => {
    const c = client(h.app);
    const login = await c.post('/api/auth/login', {
      email: 'aina@example.test',
      password: 'long-enough-pw',
    });
    expect(login.status).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await c.post('/api/auth/logout')).status).toBe(204);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    // Replay the old cookie from a different client.
    const replay = await request(h.app).get('/api/auth/me').set('Cookie', cookie);
    expect(replay.status).toBe(401);
  });

  it('issues a new session ID at sign-in (no session fixation)', async () => {
    const c = client(h.app);
    const first = await c.post('/api/auth/login', {
      email: 'aina@example.test',
      password: 'long-enough-pw',
    });
    const second = await c.post('/api/auth/login', {
      email: 'aina@example.test',
      password: 'long-enough-pw',
    });
    const sid = (r: request.Response) => String(r.headers['set-cookie']).split(';')[0];
    expect(sid(first)).not.toBe(sid(second));
  });
});

describe('CSRF origin check', () => {
  it('refuses state-changing requests without an Origin header', async () => {
    const res = await request(h.app)
      .post('/api/auth/login')
      .send({ email: 'aina@example.test', password: 'long-enough-pw' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN_MISMATCH');
  });

  it('refuses state-changing requests from another origin', async () => {
    const res = await request(h.app)
      .post('/api/auth/login')
      .set('Origin', 'https://k7f3x9.example-usercontent.net')
      .send({ email: 'aina@example.test', password: 'long-enough-pw' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN_MISMATCH');
  });

  it('allows GET without an Origin header', async () => {
    expect((await request(h.app).get('/health')).status).toBe(200);
  });
});

describe('health and readiness', () => {
  it('reports readiness when the database is reachable', async () => {
    const res = await request(h.app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.database).toBe('ok');
  });
});

describe('login rate limiting', () => {
  it('returns 429 after too many attempts for the same e-mail', async () => {
    const limited = await setupHarness({ rateLimits: { loginMax: 3 } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const r = await request(limited.app)
          .post('/api/auth/login')
          .set('Origin', ORIGIN)
          .send({ email: 'victim@example.test', password: `guess-${i}-xxxx` });
        statuses.push(r.status);
      }
      expect(statuses).toEqual([401, 401, 401, 429]);
    } finally {
      await limited.close();
    }
  });
});
