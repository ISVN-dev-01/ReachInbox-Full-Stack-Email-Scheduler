import { Navigate, Outlet, Route, Routes, Link } from 'react-router-dom';
import { useCurrentUser } from './hooks/queries';
import { ErrorState, Loading } from './components/ui';
import { Shell } from './layouts/Shell';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Compose } from './pages/Compose';
import { Settings } from './pages/Settings';
import { EmailDetail } from './pages/EmailDetail';
function Protected() {
  const user = useCurrentUser();
  if (user.isPending) return <Loading label="Opening your outbox…" />;
  if (user.error) return <ErrorState error={user.error} retry={() => void user.refetch()} />;
  if (!user.data) return <Navigate to="/login" replace />;
  return <Outlet />;
}
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected />}>
        <Route element={<Shell />}>
          <Route path="/dashboard" element={<Dashboard key="scheduled" kind="scheduled" />} />
          <Route path="/sent" element={<Dashboard key="sent" kind="sent" />} />
          <Route path="/failed" element={<Dashboard key="failed" kind="failed" />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="/compose" element={<Compose />} />
        <Route path="/emails/:id" element={<EmailDetail />} />
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route
        path="*"
        element={
          <div className="state-panel">
            <h1>This page has moved out.</h1>
            <Link className="text-link" to="/dashboard">
              Back to your outbox
            </Link>
          </div>
        }
      />
    </Routes>
  );
}
