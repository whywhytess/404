import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api, errorMessage, fieldErrors, type Assignment, type Role } from '../api';
import { Alert, Badge, Field, Loading, useLoad } from '../components/ui';
import { SubmissionPanel } from '../components/SubmissionPanel';

/** Submission rules (SRD 3.9.3), shown on every assignment page (FR-26). */
export function SubmissionRules() {
  return (
    <section className="card">
      <h2>Submission rules</h2>
      <ol>
        <li>
          The root folder of the ZIP contains <code>index.html</code>.
        </li>
        <li>
          JavaScript is written in <code>.js</code> files — no inline <code>&lt;script&gt;</code>{' '}
          blocks or <code>onclick=</code> attributes.
        </li>
        <li>Third-party libraries are included in the project, not loaded from a CDN.</li>
        <li>Data is read from local JSON files, not external APIs.</li>
        <li>No external frames such as video embeds.</li>
        <li>
          Links between files use <strong>relative paths</strong> (<code>css/style.css</code>, not{' '}
          <code>/css/style.css</code>).
        </li>
        <li>Only static files are uploaded.</li>
      </ol>
    </section>
  );
}

export function AssignmentPage() {
  const { id = '' } = useParams();
  const { data, error, loading, setData } = useLoad(
    () => api.get<{ assignment: Assignment; role: Role }>(`/api/assignments/${id}`),
    [id],
  );
  const [actionError, setActionError] = useState('');

  if (loading) return <Loading />;
  if (error || !data) return <Alert>{error ?? 'Assignment not found'}</Alert>;
  const { assignment: a, role } = data;
  const isStaff = role !== 'student';
  const canEdit = role === 'instructor' || role === 'admin';

  async function toggle() {
    const action = a.status === 'open' ? 'close' : 'reopen';
    const msg =
      action === 'close'
        ? 'Close this assignment? Students will not be able to upload or roll back, so the current version of every submission stays fixed for marking.'
        : 'Reopen this assignment? Students will be able to upload again.';
    if (!confirm(msg)) return;
    setActionError('');
    try {
      const res = await api.post<{ assignment: Assignment }>(`/api/assignments/${a.id}/${action}`);
      setData({ assignment: res.assignment, role });
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <>
      <p>
        <Link to={`/courses/${a.courseId}`}>← Course</Link>
      </p>
      <h1>
        {a.title}{' '}
        <Badge tone={a.status === 'open' ? 'ok' : 'warn'}>
          {a.status === 'open' ? 'Open' : 'Closed'}
        </Badge>
      </h1>
      {/* Rendered as text: React escapes it, so HTML in descriptions is not interpreted. */}
      {a.description && <p className="description">{a.description}</p>}
      <Alert>{actionError}</Alert>

      {isStaff && (
        <section className="card">
          <h2>Manage</h2>
          <p>
            <Link to={`/assignments/${a.id}/review`}>Review submissions →</Link>
          </p>
          <button type="button" className="secondary" onClick={toggle}>
            {a.status === 'open' ? 'Close assignment' : 'Reopen assignment'}
          </button>
          {a.closedAt && <p className="hint">Closed at {new Date(a.closedAt).toLocaleString()}</p>}
          {canEdit && (
            <EditAssignment assignment={a} onSaved={(x) => setData({ assignment: x, role })} />
          )}
        </section>
      )}

      {role === 'student' && <SubmissionPanel assignment={a} />}
      <SubmissionRules />
    </>
  );
}

function EditAssignment({
  assignment,
  onSaved,
}: {
  assignment: Assignment;
  onSaved: (a: Assignment) => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  if (!open)
    return (
      <p>
        <button type="button" className="link-button" onClick={() => setOpen(true)}>
          Edit title and description
        </button>
      </p>
    );
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError('');
    setFields({});
    try {
      const res = await api.patch<{ assignment: Assignment }>(`/api/assignments/${assignment.id}`, {
        title: fd.get('title'),
        description: fd.get('description'),
      });
      onSaved(res.assignment);
      setOpen(false);
    } catch (err) {
      setFields(fieldErrors(err));
      setError(errorMessage(err));
    }
  }
  return (
    <form onSubmit={onSubmit} className="stack">
      <Alert>{error}</Alert>
      <Field
        label="Title"
        name="title"
        defaultValue={assignment.title}
        required
        maxLength={200}
        error={fields.title}
      />
      <div className="field">
        <label htmlFor="edit-desc">Description</label>
        <textarea
          id="edit-desc"
          name="description"
          rows={4}
          maxLength={5000}
          defaultValue={assignment.description}
        />
      </div>
      <div className="row">
        <button type="submit">Save</button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
