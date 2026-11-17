import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, errorMessage, getViewLink, type Assignment, type ViewLink } from '../api';
import { Alert, Badge, Loading, useLoad } from '../components/ui';

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

/** SRD Appendix D: the review iframe never gets allow-popups or allow-top-navigation. */
const SANDBOX = 'allow-scripts allow-forms allow-same-origin allow-modals';

/** FR-27 list + FR-28 sandboxed preview with previous/next and "open in new tab". */
export function ReviewPage() {
  const { id = '' } = useParams();
  const { data, error, loading } = useLoad(
    () =>
      api.get<{ assignment: Assignment; submissions: ReviewRow[] }>(
        `/api/assignments/${id}/review`,
      ),
    [id],
  );
  const [selected, setSelected] = useState<number | null>(null);
  const rows = data?.submissions ?? [];
  const submitted = rows.filter((r) => r.submission?.currentVersion);

  if (loading) return <Loading />;
  if (error || !data) return <Alert>{error ?? 'Not found'}</Alert>;
  const current = selected !== null ? submitted[selected] : undefined;

  return (
    <>
      <p>
        <Link to={`/assignments/${id}`}>← Assignment</Link>
      </p>
      <h1>
        Review: {data.assignment.title}{' '}
        <Badge tone={data.assignment.status === 'open' ? 'ok' : 'warn'}>
          {data.assignment.status === 'open' ? 'Open' : 'Closed — versions fixed'}
        </Badge>
      </h1>
      <div className="review-layout">
        <section className="card review-list" aria-label="Submissions">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Student</th>
                <th scope="col">Version</th>
                <th scope="col">Last upload</th>
                <th scope="col">Warnings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const idx = submitted.indexOf(r);
                const isSel = idx !== -1 && idx === selected;
                return (
                  <tr
                    key={r.student.id}
                    aria-selected={isSel}
                    className={isSel ? 'selected' : undefined}
                  >
                    <td>
                      {idx !== -1 ? (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setSelected(idx)}
                        >
                          {r.student.name}
                        </button>
                      ) : (
                        r.student.name
                      )}
                      <br />
                      <small className="hint">{r.student.email}</small>
                    </td>
                    <td>
                      {r.submission?.currentVersion
                        ? `v${r.submission.currentVersion}`
                        : 'Not submitted'}
                      {r.submission?.takenDown && (
                        <>
                          {' '}
                          <Badge tone="warn">Taken down</Badge>
                        </>
                      )}
                    </td>
                    <td>
                      {r.submission?.lastUploadAt
                        ? new Date(r.submission.lastUploadAt).toLocaleString()
                        : '—'}
                    </td>
                    <td>{r.submission ? r.submission.warningCount : '—'}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4}>No students have joined this course yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <section className="card review-preview" aria-label="Preview">
          {current?.submission ? (
            <Preview
              // A new component (and iframe) per submission, so the previous student's page never flashes.
              key={current.submission.id}
              row={current}
              position={`${selected! + 1} of ${submitted.length}`}
              onPrev={selected! > 0 ? () => setSelected(selected! - 1) : undefined}
              onNext={
                selected! < submitted.length - 1 ? () => setSelected(selected! + 1) : undefined
              }
            />
          ) : (
            <p className="hint">
              {submitted.length
                ? 'Select a student to preview their site.'
                : 'No submissions to preview yet.'}
            </p>
          )}
        </section>
      </div>
    </>
  );
}

function Preview({
  row,
  position,
  onPrev,
  onNext,
}: {
  row: ReviewRow;
  position: string;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const [link, setLink] = useState<ViewLink | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(async () => {
    setError('');
    try {
      setLink(await getViewLink(row.submission!.id));
      setNow(Date.now());
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [row.submission]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // The platform cannot see a 403 inside a cross-origin iframe, so expiry is shown from the
  // known expiry time and the user refreshes explicitly (no automatic reload, which would
  // discard the state of the student's page).
  const expired = link ? new Date(link.expiresAt).getTime() <= now : false;

  return (
    <>
      <div className="preview-toolbar">
        <strong>{row.student.name}</strong>{' '}
        <span className="hint">
          v{row.submission!.currentVersion} · {position}
        </span>
        <span className="row">
          <button type="button" className="secondary" onClick={onPrev} disabled={!onPrev}>
            ← Previous
          </button>
          <button type="button" className="secondary" onClick={onNext} disabled={!onNext}>
            Next →
          </button>
          <button type="button" className="secondary" onClick={refresh}>
            Refresh preview
          </button>
          {link && !expired && (
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="button-link secondary"
            >
              Open in new tab ↗
            </a>
          )}
        </span>
      </div>
      <Alert>{error}</Alert>
      {expired && (
        <Alert kind="info">
          The access link for this preview has expired. Use <strong>Refresh preview</strong> to get
          a new one.
        </Alert>
      )}
      {link && (
        <iframe
          key={reloadKey}
          title={`Submission of ${row.student.name}`}
          src={link.url}
          sandbox={SANDBOX}
          referrerPolicy="no-referrer"
          className="preview-frame"
        />
      )}
      {link && <p className="hint">Served from {link.origin} — a separate site from Web Cove.</p>}
    </>
  );
}
