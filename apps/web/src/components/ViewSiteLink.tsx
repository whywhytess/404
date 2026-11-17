import { useCallback, useEffect, useState } from 'react';
import { errorMessage, getViewLink, type ViewLink } from '../api';
import { Alert } from './ui';

/**
 * Student's link to their own published site. The link is a short-lived bearer URL on the
 * content domain (FR-23); it opens in a new tab with no opener and no referrer.
 */
export function ViewSiteLink({
  submissionId,
  versionId,
}: {
  submissionId: string;
  versionId: string;
}) {
  const [link, setLink] = useState<ViewLink | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    setError('');
    try {
      setLink(await getViewLink(submissionId));
      setNow(Date.now());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [submissionId]);

  useEffect(() => {
    void refresh();
  }, [refresh, versionId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!link) return null;
  const expired = new Date(link.expiresAt).getTime() <= now;
  return (
    <p className="row">
      {expired ? (
        <button type="button" className="secondary" onClick={refresh}>
          Get a new link to my site
        </button>
      ) : (
        <>
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="button-link">
            View my published site ↗
          </a>
          <small className="hint">
            Link valid until {new Date(link.expiresAt).toLocaleTimeString()}. It works for anyone
            who has it, so do not share it.
          </small>
        </>
      )}
    </p>
  );
}
