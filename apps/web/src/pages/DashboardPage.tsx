import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, errorMessage, type Course } from '../api';
import { useAuth } from '../auth';
import { Alert, Badge, Field, Loading, useLoad } from '../components/ui';

export const roleLabel: Record<Course['role'], string> = {
  student: 'Student',
  ta: 'TA',
  instructor: 'Instructor',
  admin: 'Administrator',
};

export function DashboardPage() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(
    () => api.get<{ courses: Course[] }>('/api/courses'),
    [],
  );
  const [joinError, setJoinError] = useState('');
  const [joinOk, setJoinOk] = useState('');

  async function onJoin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setJoinError('');
    setJoinOk('');
    try {
      const { course } = await api.post<{ course: Course }>('/api/courses/join', {
        joinCode: new FormData(form).get('joinCode'),
      });
      setJoinOk(`You joined ${course.code} ${course.title}.`);
      form.reset();
      await reload();
    } catch (err) {
      setJoinError(errorMessage(err));
    }
  }

  return (
    <>
      <h1>My courses</h1>
      {user?.accountType !== 'admin' && (
        <section className="card">
          <h2>Join a course</h2>
          <Alert>{joinError}</Alert>
          <Alert kind="success">{joinOk}</Alert>
          <form onSubmit={onJoin} className="inline-form">
            <Field
              label="Join code from your instructor"
              name="joinCode"
              required
              autoComplete="off"
            />
            <button type="submit">Join</button>
          </form>
        </section>
      )}
      {loading && <Loading />}
      <Alert>{error}</Alert>
      {data && data.courses.length === 0 && <p>You are not in any course yet.</p>}
      {data && data.courses.length > 0 && (
        <ul className="list">
          {data.courses.map((c) => (
            <li key={c.id}>
              <Link to={`/courses/${c.id}`}>
                <strong>{c.code}</strong> {c.title}
              </Link>{' '}
              <Badge>{roleLabel[c.role]}</Badge>
              {c.endDate && <small className="hint"> · ends {c.endDate}</small>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
