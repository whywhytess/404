import { Link, useParams } from 'react-router';
import { api, type Assignment } from '../api';
import { Alert, Loading, useLoad } from '../components/ui';

interface ReviewRow {
  student: { id: string; name: string; email: string };
  submission: {
    id: string;
    currentVersion: number | null;
    lastUploadAt: string | null;
    warningCount: number;
    takenDown: boolean;
  } | null;
}

/** FR-27 skeleton: the sandboxed preview (FR-28) arrives with the content server (Phase 3). */
export function ReviewPage() {
  const { id = '' } = useParams();
  const { data, error, loading } = useLoad(
    () =>
      api.get<{ assignment: Assignment; submissions: ReviewRow[] }>(
        `/api/assignments/${id}/review`,
      ),
    [id],
  );
  if (loading) return <Loading />;
  if (error || !data) return <Alert>{error ?? 'Not found'}</Alert>;
  return (
    <>
      <p>
        <Link to={`/assignments/${id}`}>← Assignment</Link>
      </p>
      <h1>Review: {data.assignment.title}</h1>
      <table className="table">
        <caption className="visually-hidden">Submissions</caption>
        <thead>
          <tr>
            <th scope="col">Student</th>
            <th scope="col">E-mail</th>
            <th scope="col">Current version</th>
            <th scope="col">Last upload</th>
            <th scope="col">Warnings</th>
          </tr>
        </thead>
        <tbody>
          {data.submissions.map((r) => (
            <tr key={r.student.id}>
              <td>{r.student.name}</td>
              <td>{r.student.email}</td>
              <td>
                {r.submission?.currentVersion ? `v${r.submission.currentVersion}` : 'Not submitted'}
                {r.submission?.takenDown && ' (taken down)'}
              </td>
              <td>
                {r.submission?.lastUploadAt
                  ? new Date(r.submission.lastUploadAt).toLocaleString()
                  : '—'}
              </td>
              <td>{r.submission ? r.submission.warningCount : '—'}</td>
            </tr>
          ))}
          {data.submissions.length === 0 && (
            <tr>
              <td colSpan={5}>No students have joined this course yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
