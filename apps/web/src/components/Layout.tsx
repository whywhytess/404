import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth';
import { Loading } from './ui';

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          Web Cove
        </Link>
        {user && (
          <nav aria-label="Main">
            <Link to="/">My courses</Link>
            {user.accountType === 'admin' && <Link to="/admin">Administration</Link>}
            <span className="who">
              {user.name} <small>({user.accountType})</small>
            </span>
            <button type="button" className="link-button" onClick={() => void logout()}>
              Sign out
            </button>
          </nav>
        )}
      </header>
      <main className="container">
        <Outlet />
      </main>
    </>
  );
}

/** Redirects to sign-in, or to the password change page for temporary passwords. */
export function RequireAuth({ admin = false }: { admin?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  if (admin && user.accountType !== 'admin') return <p>Administrators only.</p>;
  return <Outlet />;
}
