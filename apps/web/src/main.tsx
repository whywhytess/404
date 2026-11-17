import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { AuthProvider } from './auth';
import { Layout, RequireAuth } from './components/Layout';
import { ChangePasswordPage, LoginPage, RegisterPage } from './pages/AuthPages';
import { DashboardPage } from './pages/DashboardPage';
import { CoursePage } from './pages/CoursePage';
import { AssignmentPage } from './pages/AssignmentPage';
import { ReviewPage } from './pages/ReviewPage';
import { AdminPage } from './pages/AdminPage';
import './styles.css';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/change-password', element: <ChangePasswordPage /> },
          { path: '/courses/:id', element: <CoursePage /> },
          { path: '/assignments/:id', element: <AssignmentPage /> },
          { path: '/assignments/:id/review', element: <ReviewPage /> },
        ],
      },
      { element: <RequireAuth admin />, children: [{ path: '/admin', element: <AdminPage /> }] },
      { path: '*', element: <p>Page not found.</p> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
