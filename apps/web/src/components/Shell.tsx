import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Moon, Sun, LogOut } from 'lucide-react';
import { useAuth } from '../state/auth.js';
import { Button } from './ui/Button.js';

const getInitialDark = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

export interface NavItem {
  key: string;
  label: string;
}

export const Shell = ({
  children,
  nav,
  activeNavKey,
  onNavigate,
}: {
  children: ReactNode;
  nav?: NavItem[];
  activeNavKey?: string;
  onNavigate?: (key: string) => void;
}) => {
  const { user, logout } = useAuth();
  const [dark, setDark] = useState(getInitialDark);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  return (
    <div className="min-h-screen">
      <header className="no-print border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              MAFK Retail-Flow POS
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {user?.tenantId ? 'Client Workspace' : 'Master Admin'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <span className="text-sm text-slate-600 dark:text-slate-300">{user.displayName}</span>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => setDark((d) => !d)}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
            <Button variant="secondary" onClick={() => void logout()}>
              <LogOut size={14} /> Sign out
            </Button>
          </div>
        </div>
        {nav && nav.length > 0 ? (
          <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
            {nav.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate?.(item.key)}
                className={`focus-ring whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeNavKey === item.key
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        ) : null}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
};
