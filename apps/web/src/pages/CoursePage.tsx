import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import {
  api,
  errorMessage,
  fieldErrors,
  type Assignment,
  type Course,
  type StaffMember,
} from '../api';
import { Alert, Badge, Field, Loading, useLoad } from '../components/ui';
import { roleLabel } from './DashboardPage';

export function CoursePage() {
  const { id = '' } = useParams();
  const course = useLoad(() => api.get<{ course: Course }>(`/api/courses/${id}`), [id]);
  const assignments = useLoad(
    () => api.get<{ assignments: Assignment[] }>(`/api/courses/${id}/assignments`),
    [id],
  );

  if (course.loading) return <Loading />;
  if (course.error || !course.data) return <Alert>{course.error ?? 'Course not found'}</Alert>;
  const c = course.data.course;
  const canManage = c.role === 'instructor' || c.role === 'admin';
  const isStaff = canManage || c.role === 'ta';

  return (
    <>
      <p>
        <Link to="/">← My courses</Link>
      </p>
      <h1>
        {c.code} {c.title} <Badge>{roleLabel[c.role]}</Badge>
      </h1>
      {c.endDate && <p className="hint">Course end date: {c.endDate}</p>}

      {canManage && c.joinCode && <JoinCodeCard course={c} onRotated={course.reload} />}
      {isStaff && <StaffCard course={c} />}

      <section className="card">
        <h2>Assignments</h2>
        {assignments.loading && <Loading />}
        <Alert>{assignments.error}</Alert>
        {assignments.data && assignments.data.assignments.length === 0 && (
          <p>No assignments yet.</p>
        )}
        <ul className="list">
          {assignments.data?.assignments.map((a) => (
            <li key={a.id}>
              <Link to={`/assignments/${a.id}`}>{a.title}</Link>{' '}
              <Badge tone={a.status === 'open' ? 'ok' : 'warn'}>
                {a.status === 'open' ? 'Open' : 'Closed'}
              </Badge>
            </li>
          ))}
        </ul>
        {canManage && <CreateAssignment courseId={c.id} onCreated={assignments.reload} />}
      </section>
    </>
  );
}

function JoinCodeCard({ course, onRotated }: { course: Course; onRotated: () => void }) {
  const [error, setError] = useState('');
  async function rotate() {
    if (!confirm('Generate a new join code? The current code will stop working immediately.'))
      return;
    setError('');
    try {
      await api.post(`/api/courses/${course.id}/join-code/rotate`);
      onRotated();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <section className="card">
      <h2>Join code</h2>
      <Alert>{error}</Alert>
      <p>
        Students join this course with: <code className="join-code">{course.joinCode}</code>
      </p>
      <button type="button" className="secondary" onClick={rotate}>
        Generate new code
      </button>
    </section>
  );
}

function StaffCard({ course }: { course: Course }) {
  const staff = useLoad(
    () => api.get<{ staff: StaffMember[] }>(`/api/courses/${course.id}/staff`),
    [course.id],
  );
  const allStaff = useLoad(
    () =>
      course.role === 'admin'
        ? api.get<{ staff: StaffMember[] }>('/api/admin/staff')
        : Promise.resolve({ staff: [] }),
    [course.role],
  );
  const [error, setError] = useState('');

  async function assign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError('');
    try {
      await api.post(`/api/courses/${course.id}/staff`, {
        userId: fd.get('userId'),
        role: fd.get('role'),
      });
      await staff.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function remove(userId: string) {
    if (!confirm('Remove this person from the course staff?')) return;
    setError('');
    try {
      await api.delete(`/api/courses/${course.id}/staff/${userId}`);
      await staff.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section className="card">
      <h2>Course staff</h2>
      <Alert>{error || staff.error}</Alert>
      <ul className="list">
        {staff.data?.staff.map((s) => (
          <li key={s.id}>
            {s.name} <small className="hint">{s.email}</small>{' '}
            <Badge>{s.role === 'instructor' ? 'Instructor' : 'TA'}</Badge>
            {course.role === 'admin' && (
              <button type="button" className="link-button" onClick={() => remove(s.id)}>
                Remove
              </button>
            )}
          </li>
        ))}
        {staff.data?.staff.length === 0 && <li>No staff assigned yet.</li>}
      </ul>
      {course.role === 'admin' && (
        <form onSubmit={assign} className="inline-form">
          <div className="field">
            <label htmlFor="assign-user">Staff account</label>
            <select id="assign-user" name="userId" required>
              <option value="">Choose…</option>
              {allStaff.data?.staff
                .filter((s) => s.status === 'active')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.email})
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="assign-role">Role</label>
            <select id="assign-role" name="role" defaultValue="instructor">
              <option value="instructor">Instructor</option>
              <option value="ta">TA</option>
            </select>
          </div>
          <button type="submit">Assign</button>
        </form>
      )}
    </section>
  );
}

function CreateAssignment({ courseId, onCreated }: { courseId: string; onCreated: () => void }) {
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError('');
    setFields({});
    try {
      await api.post(`/api/courses/${courseId}/assignments`, {
        title: fd.get('title'),
        description: fd.get('description'),
      });
      form.reset();
      onCreated();
    } catch (err) {
      setFields(fieldErrors(err));
      setError(errorMessage(err));
    }
  }
  return (
    <form onSubmit={onSubmit} className="stack">
      <h3>New assignment</h3>
      <Alert>{error}</Alert>
      <Field label="Title" name="title" required maxLength={200} error={fields.title} />
      <div className="field">
        <label htmlFor="new-desc">Description</label>
        <textarea id="new-desc" name="description" rows={3} maxLength={5000} />
      </div>
      <button type="submit">Create assignment</button>
    </form>
  );
}
