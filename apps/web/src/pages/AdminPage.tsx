import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, errorMessage, fieldErrors, type Course, type PublicUser } from '../api';
import { Alert, Badge, Field, Loading, useLoad } from '../components/ui';

export function AdminPage() {
  return (
    <>
      <h1>Administration</h1>
      <CoursesSection />
      <StaffSection />
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
