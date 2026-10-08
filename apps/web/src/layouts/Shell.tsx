import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ChevronDown,
  Clock3,
  ExternalLink,
  LogOut,
  Menu,
  Plus,
  Send,
  Settings2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCurrentUser, useStats } from '../hooks/queries';
import { Avatar, Button, Logo } from '../components/ui';
import { post } from '../api/client';
export function Shell() {
  const { data: user } = useCurrentUser();
  const stats = useStats();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  if (!user) return null;
  const logout = async () => {
    try {
      await post('/auth/logout');
      client.clear();
      navigate('/login');
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  return (
    <div className="app-shell">
      <header className="mobile-bar">
        <Logo />
        <button
          className="icon-button"
          aria-label="Toggle navigation"
          onClick={() => setMobile(!mobile)}
        >
          {mobile ? <X /> : <Menu />}
        </button>
      </header>
      <aside className={`sidebar ${mobile ? 'sidebar-open' : ''}`}>
        <a href="/dashboard" className="brand-link">
          <Logo />
        </a>
        <div className="profile-wrap">
          <button className="profile-button" onClick={() => setMenu(!menu)} aria-expanded={menu}>
            <Avatar name={user.name} url={user.avatarUrl} />
            <span className="profile-copy">
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
            <ChevronDown size={15} />
          </button>
          {menu && (
            <div className="profile-menu">
              <button
                onClick={() => {
                  setMenu(false);
                  navigate('/settings');
                }}
              >
                <Settings2 size={15} />
                Account settings
              </button>
              <button onClick={() => void logout()}>
                <LogOut size={15} />
                Log out
              </button>
            </div>
          )}
        </div>
        <Button
          variant="outline"
          className="compose-button"
          onClick={() => {
            setMobile(false);
            navigate('/compose');
          }}
        >
          <Plus size={17} />
          Compose
        </Button>
        <span className="nav-caption">CORE</span>
        <nav className="primary-nav" aria-label="Mailbox">
          <NavLink to="/dashboard" end onClick={() => setMobile(false)}>
            <Clock3 size={17} />
            <span>Scheduled</span>
            <small>{stats.data?.scheduled ?? '—'}</small>
          </NavLink>
          <NavLink to="/sent" onClick={() => setMobile(false)}>
            <Send size={17} />
            <span>Sent</span>
            <small>{stats.data?.sent ?? '—'}</small>
          </NavLink>
          <NavLink to="/failed" onClick={() => setMobile(false)}>
            <AlertCircle size={17} />
            <span>Failed</span>
            <small>{stats.data?.failed ?? '—'}</small>
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <NavLink to="/settings" onClick={() => setMobile(false)}>
            <Settings2 size={17} />
            Settings
          </NavLink>
          {user.isAdmin && (
            <a href="/admin/queues" target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              Queue dashboard
            </a>
          )}
          <div className="sidebar-footnote">
            <span className="live-dot" />
            Thoughtful outreach, right on time.
          </div>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
