import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, errorMessage, fieldErrors, formatBytes, type Course, type PublicUser } from '../api';
import type { ResourceSettings } from '@webcove/shared';
import { Alert, Badge, Field, Loading, useLoad } from '../components/ui';

export function AdminPage() {
  return (
    <>
      <h1>Administration</h1>
      <CoursesSection />
      <StaffSection />
      <SettingsSection />
      <UsageSection />
      <RetentionSection />
      <AuditSection />
    </>
  );
}

function CoursesSection() {
  const { data, error, loading, reload } = useLoad(
    () => api.get<{ courses: Course[] }>('/api/courses'),
    [],
  );
  const [formError, setFormError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setFormError('');
    setFields({});
    try {
      await api.post('/api/courses', {
        code: fd.get('code'),
        title: fd.get('title'),
        endDate: fd.get('endDate') || null,
      });
      form.reset();
      await reload();
    } catch (err) {
      setFields(fieldErrors(err));
      setFormError(errorMessage(err));
    }
  }

  return (
    <section className="card">
      <h2>Courses</h2>
      {loading && <Loading />}
      <Alert>{error}</Alert>
      <ul className="list">
        {data?.courses.map((c) => (
          <li key={c.id}>
            <Link to={`/courses/${c.id}`}>
              <strong>{c.code}</strong> {c.title}
            </Link>{' '}
            <small className="hint">join code {c.joinCode}</small>
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit} className="stack">
        <h3>New course</h3>
        <Alert>{formError}</Alert>
        <Field label="Course code" name="code" required maxLength={20} error={fields.code} />
        <Field label="Title" name="title" required maxLength={200} error={fields.title} />
        <Field label="End date (optional)" name="endDate" type="date" error={fields.endDate} />
        <button type="submit">Create course</button>
      </form>
    </section>
  );
}

function StaffSection() {
  const { data, error, loading, reload } = useLoad(
    () => api.get<{ staff: PublicUser[] }>('/api/admin/staff'),
    [],
  );
  const [formError, setFormError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setFormError('');
    setFields({});
    try {
      const res = await api.post<{ user: PublicUser; temporaryPassword: string }>(
        '/api/admin/staff',
        {
          name: fd.get('name'),
          email: fd.get('email'),
        },
      );
      setIssued({ email: res.user.email, password: res.temporaryPassword });
      form.reset();
      await reload();
    } catch (err) {
      setFields(fieldErrors(err));
      setFormError(errorMessage(err));
    }
  }

  async function setStatus(u: PublicUser, status: 'active' | 'disabled') {
    if (
      status === 'disabled' &&
      !confirm(`Disable ${u.name}? They will be signed out immediately.`)
    )
      return;
    try {
      await api.patch(`/api/admin/staff/${u.id}`, { status });
      await reload();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  }

  async function reset(u: PublicUser) {
    if (!confirm(`Reset the password of ${u.name}? Their current sessions will end.`)) return;
    try {
      const res = await api.post<{ temporaryPassword: string }>(
        `/api/admin/staff/${u.id}/reset-password`,
      );
      setIssued({ email: u.email, password: res.temporaryPassword });
      await reload();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  }

  return (
    <section className="card">
      <h2>Instructor and TA accounts</h2>
      {issued && (
        <Alert kind="success">
          Temporary password for {issued.email}: <code>{issued.password}</code>
          <br />
          Give it to the person privately. It is shown only once and must be changed at first
          sign-in.{' '}
          <button type="button" className="link-button" onClick={() => setIssued(null)}>
            Hide
          </button>
        </Alert>
      )}
      {loading && <Loading />}
      <Alert>{error}</Alert>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">E-mail</th>
            <th scope="col">Status</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {data?.staff.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>
                <Badge tone={u.status === 'active' ? 'ok' : 'warn'}>
                  {u.status === 'active' ? 'Active' : 'Disabled'}
                </Badge>
                {u.mustChangePassword && <small className="hint"> temporary password</small>}
              </td>
              <td className="row">
                {u.status === 'active' ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setStatus(u, 'disabled')}
                  >
                    Disable
                  </button>
                ) : (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setStatus(u, 'active')}
                  >
                    Enable
                  </button>
                )}
                <button type="button" className="secondary" onClick={() => reset(u)}>
                  Reset password
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={onCreate} className="stack">
        <h3>New staff account</h3>
        <Alert>{formError}</Alert>
        <Field label="Full name" name="name" required error={fields.name} />
        <Field label="E-mail" name="email" type="email" required error={fields.email} />
        <button type="submit">Create account</button>
      </form>
    </section>
  );
}

interface AuditEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  createdAt: string;
  actorName: string | null;
}

function AuditSection() {
  const { data, error, loading } = useLoad(
    () => api.get<{ entries: AuditEntry[] }>('/api/admin/audit-log?limit=50'),
    [],
  );
  return (
    <section className="card">
      <h2>Audit log (latest 50)</h2>
      {loading && <Loading />}
      <Alert>{error}</Alert>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Who</th>
            <th scope="col">Action</th>
            <th scope="col">Target</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>
          {data?.entries.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.createdAt).toLocaleString()}</td>
              <td>{e.actorName ?? '—'}</td>
              <td>
                <code>{e.action}</code>
              </td>
              <td>
                {e.targetType} <small className="hint">{e.targetId.slice(0, 8)}</small>
              </td>
              <td>{e.reason ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const MB = 1024 * 1024;
/** Fields shown in MB are converted to bytes for the API. */
const SETTING_FIELDS: { key: keyof ResourceSettings; label: string; mb?: boolean }[] = [
  { key: 'storageQuotaBytes', label: 'Storage per student (MB)', mb: true },
  { key: 'uploadsPerHour', label: 'Uploads per student per assignment per hour' },
  { key: 'contentRequestsPerSecond', label: 'Requests per site per second' },
  { key: 'maxArchiveBytes', label: 'Maximum ZIP size (MB)', mb: true },
  { key: 'maxFileBytes', label: 'Maximum single file (MB)', mb: true },
  { key: 'maxFiles', label: 'Maximum number of files' },
  { key: 'maxTotalBytes', label: 'Maximum unpacked size (MB)', mb: true },
  { key: 'maxCompressionRatio', label: 'Maximum compression ratio (x:1)' },
  { key: 'retentionDays', label: 'Delete submissions this many days after course end' },
];

/** FR-35: view and adjust quotas and limits. */
function SettingsSection() {
  const { data, error, loading, setData } = useLoad(
    () => api.get<{ settings: ResourceSettings }>('/api/admin/settings'),
    [],
  );
  const [formError, setFormError] = useState('');
  const [saved, setSaved] = useState('');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(
      SETTING_FIELDS.map((f) => {
        const n = Number(fd.get(f.key));
        return [f.key, f.mb ? Math.round(n * MB) : n];
      }),
    );
    setFormError('');
    setSaved('');
    try {
      const res = await api.put<{ settings: ResourceSettings }>('/api/admin/settings', body);
      setData(res);
      setSaved('Saved. New limits apply to the next upload or request.');
    } catch (err) {
      setFormError(errorMessage(err));
    }
  }

  return (
    <section className="card">
      <h2>Quotas and limits</h2>
      {loading && <Loading />}
      <Alert>{error || formError}</Alert>
      <Alert kind="success">{saved}</Alert>
      {data && (
        <form onSubmit={onSubmit} className="settings-grid">
          {SETTING_FIELDS.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              name={f.key}
              type="number"
              min={f.mb ? 0.01 : 1}
              step={f.mb ? 0.01 : 1}
              required
              defaultValue={
                f.mb
                  ? String(Math.round((data.settings[f.key] / MB) * 100) / 100)
                  : String(data.settings[f.key])
              }
            />
          ))}
          <div>
            <button type="submit">Save limits</button>
          </div>
        </form>
      )}
    </section>
  );
}

function UsageSection() {
  const { data, error, loading } = useLoad(
    () =>
      api.get<{
        quotaBytes: number;
        users: { id: string; name: string; email: string; usedBytes: number }[];
      }>('/api/admin/usage'),
    [],
  );
  return (
    <section className="card">
      <h2>Storage usage</h2>
      {loading && <Loading />}
      <Alert>{error}</Alert>
      {data && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col">E-mail</th>
              <th scope="col">Used</th>
              <th scope="col">Of quota</th>
            </tr>
          </thead>
          <tbody>
            {data.users
              .filter((u) => u.usedBytes > 0)
              .map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{formatBytes(u.usedBytes)}</td>
                  <td>{Math.round((u.usedBytes / data.quotaBytes) * 100)}%</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface RetentionStatus {
  retentionDays: number;
  courses: {
    id: string;
    code: string;
    title: string;
    endDate: string;
    deleteAfter: string;
    purgedAt: string | null;
  }[];
  pendingDeletions: { prefix: string; attempts: number; lastError: string | null }[];
}

/** FR-37: what will be deleted when, and failed storage deletions waiting for retry. */
function RetentionSection() {
  const { data, error, loading, reload } = useLoad(
    () => api.get<RetentionStatus>('/api/admin/retention'),
    [],
  );
  const [msg, setMsg] = useState('');
  const [runError, setRunError] = useState('');

  async function runNow() {
    if (
      !confirm(
        'Run the retention job now? Submissions of courses past their retention period are deleted permanently.',
      )
    )
      return;
    setMsg('');
    setRunError('');
    try {
      const res = await api.post<{
        result: {
          coursesPurged: { code: string }[];
          foldersDeleted: number;
          foldersFailed: number;
        };
      }>('/api/admin/retention/run');
      const r = res.result;
      setMsg(
        `Done: ${r.coursesPurged.length} course(s) purged, ${r.foldersDeleted} folder(s) deleted, ${r.foldersFailed} failed (will retry).`,
      );
      await reload();
    } catch (err) {
      setRunError(errorMessage(err));
    }
  }

  return (
    <section className="card">
      <h2>Data retention</h2>
      {loading && <Loading />}
      <Alert>{error || runError}</Alert>
      <Alert kind="success">{msg}</Alert>
      {data && (
        <>
          <p className="hint">
            Submissions, versions and files of a course are deleted {data.retentionDays} days after
            its end date. Deleted sites answer “410 Gone” and their addresses are never reused. The
            job runs every 6 hours.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Course</th>
                <th scope="col">End date</th>
                <th scope="col">Deleted after</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.courses.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.code} {c.title}
                  </td>
                  <td>{c.endDate}</td>
                  <td>{c.deleteAfter}</td>
                  <td>
                    {c.purgedAt ? (
                      <Badge>Deleted {new Date(c.purgedAt).toLocaleDateString()}</Badge>
                    ) : (
                      'Kept'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.pendingDeletions.length > 0 && (
            <Alert>
              {data.pendingDeletions.length} storage folder(s) could not be deleted yet and will be
              retried. Last error: {data.pendingDeletions[0]!.lastError}
            </Alert>
          )}
          <button type="button" className="danger" onClick={runNow}>
            Run retention now
          </button>
        </>
      )}
    </section>
  );
}
