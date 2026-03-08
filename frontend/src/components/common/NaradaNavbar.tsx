import { useNavigate } from 'react-router-dom';
import { Button, Classes } from '@blueprintjs/core';
import { Building2, Satellite, BarChart3, LayoutDashboard, Terminal, LogOut, Search } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuthStore } from '../../store/slices/authSlice';
import { NotificationBell } from './NotificationBell';

const NAV_ITEMS = [
  { key: 'analyst', path: '/', label: 'Analyst', Icon: LayoutDashboard },
  { key: 'investigation', path: '/investigation', label: 'Investigation', Icon: Search },
  { key: 'corporate', path: '/corporate', label: 'Corporate', Icon: Building2 },
  { key: 'damage', path: '/damage-assessment', label: 'Spatial PWTT', Icon: Satellite },
  { key: 'trade', path: '/trade', label: 'Trade', Icon: BarChart3 },
] as const;

export type PageKey = (typeof NAV_ITEMS)[number]['key'];

interface NaradaNavbarProps {
  activePage: PageKey;
}

export function NaradaNavbar({ activePage }: NaradaNavbarProps) {
  const navigate = useNavigate();
  const { isDev } = usePermissions();
  const { user, logout } = useAuthStore();

  return (
    <nav
      className={`${Classes.DARK} flex h-[42px] items-center justify-between border-b border-bp-border bg-bp-bg px-4 flex-shrink-0`}
    >
      {/* Left: Branding */}
      <div className="flex min-w-[80px] items-center">
        <span className="text-[13px] font-bold tracking-[0.15em] text-bp-text">
          NepalOSINT
        </span>
      </div>

      {/* Center: Navigation */}
      <div className="flex items-center gap-1">
        {NAV_ITEMS.map(item => {
          const isActive = item.key === activePage;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.path)}
              className={`relative flex h-[42px] items-center gap-1.5 px-3 text-xs transition-colors ${
                isActive
                  ? 'font-semibold text-bp-text'
                  : 'font-normal text-bp-text-secondary hover:text-bp-text'
              }`}
            >
              <item.Icon size={14} />
              <span className="hidden sm:inline">{item.label}</span>
              {isActive && (
                <span
                  className="absolute bottom-0 left-2 right-2 h-0.5 rounded-t-[2px] bg-bp-primary"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Right: Utilities */}
      <div className="flex items-center gap-2">
        <NotificationBell />
        {isDev && (
          <Button
            minimal
            small
            icon={<Terminal size={13} />}
            onClick={() => navigate('/dev')}
            title="Developer Console"
            className="text-bp-text-secondary hover:text-bp-text"
          />
        )}
        <span className="mx-1 h-4 w-px bg-bp-border" />
        {user && (
          <span className="hidden sm:inline font-mono text-[11px] text-bp-text-secondary">
            {user.username || user.email}
          </span>
        )}
        {!useAuthStore.getState().isGuest && (
          <Button
            minimal
            small
            icon={<LogOut size={13} />}
            onClick={logout}
            title="Sign out"
            className="text-bp-text-secondary hover:text-bp-text"
          />
        )}
      </div>
    </nav>
  );
}
