import { useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  api,
  errorMessage,
  formatBytes,
  uploadArchive,
  type Assignment,
  type Issue,
  type Submission,
  type Version,
} from '../api';
import { Alert, Badge, Loading, useLoad } from './ui';

type Phase = 'idle' | 'uploading' | 'processing';

/** Student view: upload (FR-10), result with errors/warnings (FR-14/15), history and rollback (FR-17/18). */
export function SubmissionPanel({ assignment }: { assignment: Assignment }) {
  const { data, error, loading, reload, setData } = useLoad(
    () =>
      api.get<{ submission: Submission | null; versions: Version[] }>(
        `/api/assignments/${assignment.id}/submission`,
      ),
    [assignment.id],
  );
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [rejected, setRejected] = useState<{ message: string; errors: Issue[] } | null>(null);
  const [published, setPublished] = useState<{ version: Version; warnings: Issue[] } | null>(null);
  const [actionError, setActionError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const open = assignment.status === 'open';

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    setRejected(null);
    setPublished(null);
    setActionError('');
    if (!file) {
      setActionError('Choose a ZIP file first.');
      return;
    }
    setPhase('uploading');
    setProgress(0);
    try {
      const res = await uploadArchive<{ version: Version; warnings: Issue[] }>(
        `/api/assignments/${assignment.id}/submission`,
        file,
        (f) => {
          setProgress(f);
          if (f >= 1) setPhase('processing');
        },
      );
      setPublished(res);
      if (fileInput.current) fileInput.current.value = '';
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'UPLOAD_REJECTED') {
        setRejected({ message: err.message, errors: (err.details as { errors: Issue[] }).errors });
      } else {
        setActionError(errorMessage(err));
      }
    } finally {
      setPhase('idle');
    }
  }

  async function rollback(target: Version) {
    if (!data?.submission) return;
    if (!confirm(`Go back to version ${target.number}? You can switch again afterwards.`)) return;
    setActionError('');
    try {
      const res = await api.post<{ submission: Submission; versions: Version[] }>(
        `/api/submissions/${data.submission.id}/rollback`,
      );
      setData(res);
      setPublished(null);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  const sub = data?.submission ?? null;
  const versions = data?.versions ?? [];
  const current = versions.find((v) => v.id === sub?.currentVersionId);
  const previous = versions.find((v) => v.id === sub?.previousVersionId);

  return (
    <section className="card">
      <h2>Your submission</h2>
      {loading && <Loading />}
      <Alert>{error}</Alert>
      {sub?.takenDown && (
        <Alert>
          Your site has been taken down by the course staff
          {sub.takenDownReason ? `: ${sub.takenDownReason}` : '.'}
        </Alert>
      )}
      {current ? (
        <p>
          Published: <strong>version {current.number}</strong> ({formatBytes(current.totalBytes)},{' '}
          {current.fileCount} files, uploaded {new Date(current.createdAt).toLocaleString()}).
        </p>
      ) : (
        !loading && <p>You have not uploaded anything yet.</p>
      )}

      {open ? (
        <form onSubmit={onUpload} className="stack" aria-describedby="upload-help">
          <div className="field">
            <label htmlFor="archive">ZIP file of your website</label>
            <input
              id="archive"
              ref={fileInput}
              type="file"
              accept=".zip,application/zip"
              required
              disabled={phase !== 'idle'}
            />
            <small id="upload-help" className="hint">
              Up to 20 MB. Uploading publishes it immediately as a new version; your previous
              version is kept.
            </small>
          </div>
          <button type="submit" disabled={phase !== 'idle'}>
            {phase === 'idle'
              ? 'Upload and publish'
              : phase === 'uploading'
                ? `Uploading… ${Math.round(progress * 100)}%`
                : 'Checking and publishing…'}
          </button>
          <p aria-live="polite" className="visually-hidden">
            {phase === 'uploading'
              ? 'Uploading'
              : phase === 'processing'
                ? 'Checking and publishing'
                : ''}
          </p>
        </form>
      ) : (
        <Alert kind="info">
          This assignment is closed. Uploads and rollbacks are not accepted.
        </Alert>
      )}

      <Alert>{actionError}</Alert>
      {rejected && (
        <div className="alert alert-error" role="alert">
          <strong>Not published.</strong> {rejected.message} Your published version has not changed.
          <IssueList issues={rejected.errors} />
        </div>
      )}
      {published && (
        <div className="alert alert-success" role="status">
          <strong>Published as version {published.version.number}.</strong>
          {published.warnings.length > 0 && (
            <>
              {' '}
              {published.warnings.length} warning(s) — these do not block publishing, but the
              affected parts will not work:
              <IssueList issues={published.warnings} />
            </>
          )}
        </div>
      )}

      {versions.length > 0 && (
        <>
          <h3>Version history</h3>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Uploaded</th>
                <th scope="col">Size</th>
                <th scope="col">Warnings</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td>{v.number}</td>
                  <td>{new Date(v.createdAt).toLocaleString()}</td>
                  <td>{formatBytes(v.totalBytes)}</td>
                  <td>{v.warningCount}</td>
                  <td>
                    {v.id === sub?.currentVersionId ? (
                      <Badge tone="ok">Published</Badge>
                    ) : v.id === sub?.previousVersionId ? (
                      <Badge>Previous</Badge>
                    ) : (
                      <small className="hint">Files removed (record kept)</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {open && previous && (
            <button type="button" className="secondary" onClick={() => rollback(previous)}>
              Go back to version {previous.number}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <ul className="issues">
      {issues.map((i, n) => (
        <li key={n}>
          {i.file && <code>{i.file}</code>} {i.message}
        </li>
      ))}
    </ul>
  );
}
