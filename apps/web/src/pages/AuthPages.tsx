import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { api, errorMessage, fieldErrors, type PublicUser } from '../api';
import { useAuth } from '../auth';
import { Alert, Field } from '../components/ui';

function formValues(e: FormEvent<HTMLFormElement>) {
  return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
}

export function LoginPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } = await api.post<{ user: PublicUser }>('/api/auth/login', formValues(e));
      setUser(user);
      navigate(user.mustChangePassword ? '/change-password' : from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="narrow card">
      <h1>Sign in</h1>
      <Alert>{error}</Alert>
      <form onSubmit={onSubmit} noValidate>
        <Field label="E-mail" name="email" type="email" autoComplete="username" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p>
        Student without an account? <Link to="/register">Register</Link>
      </p>
    </section>
  );
}

export function RegisterPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFields({});
    try {
      const { user } = await api.post<{ user: PublicUser }>('/api/auth/register', formValues(e));
      setUser(user);
      navigate('/', { replace: true });
    } catch (err) {
      setFields(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="narrow card">
      <h1>Student registration</h1>
      <p className="hint">Instructor and TA accounts are created by an administrator.</p>
      <Alert>{error}</Alert>
      <form onSubmit={onSubmit} noValidate>
        <Field label="Full name" name="name" autoComplete="name" required error={fields.name} />
        <Field
          label="E-mail"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={fields.email}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          hint="At least 8 characters. A long passphrase is best."
          error={fields.password}
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p>
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </section>
  );
}

export function ChangePasswordPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e);
    setFields({});
    if (v.newPassword !== v.confirm) {
      setFields({ confirm: 'The two new passwords do not match' });
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { user } = await api.post<{ user: PublicUser }>('/api/auth/change-password', {
        currentPassword: v.currentPassword,
        newPassword: v.newPassword,
      });
      setUser(user);
      navigate('/', { replace: true });
    } catch (err) {
      setFields(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="narrow card">
      <h1>Change password</h1>
      {user?.mustChangePassword && (
        <Alert kind="info">
          You signed in with a temporary password. Choose your own password to continue.
        </Alert>
      )}
      <Alert>{error}</Alert>
      <form onSubmit={onSubmit} noValidate>
        <Field
          label="Current password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
        <Field
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          error={fields.newPassword}
        />
        <Field
          label="Repeat new password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          error={fields.confirm}
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </section>
  );
}
