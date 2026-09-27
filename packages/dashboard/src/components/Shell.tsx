import { LayoutDashboard, LogOut, MessagesSquare, Moon, ScrollText, Settings, Sun, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Me } from '../lib/api';
import { cn, href, useTheme, type Route } from '../lib/utils';
import { Avatar, Button } from './ui';

const NAV: { page: Route['page']; label: string; icon: ReactNode }[] = [
  { page: 'overview', label: 'Overview', icon: <LayoutDashboard /> },
  { page: 'conversations', label: 'Conversations', icon: <MessagesSquare /> },
  { page: 'leads', label: 'Leads', icon: <Users /> },
  { page: 'prompt', label: 'Prompt', icon: <ScrollText /> },
  { page: 'settings', label: 'Settings', icon: <Settings /> },
];

export function Shell({ me, route, onLogout, children }: { me: Me; route: Route; onLogout: () => void; children: ReactNode }) {
  const [dark, toggleTheme] = useTheme();
  const site = me.sites[0];

  return (
    <div className="flex h-full">
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-12 items-center gap-2 px-3">
          {site?.avatar ? (
            <img src={site.avatar} alt="" className="size-6 rounded-md object-cover" />
          ) : (
            <span className="flex size-6 items-center justify-center rounded-md text-[11px] font-semibold text-white" style={{ background: site?.accent ?? '#18181b' }}>
              {(site?.name ?? 'M')[0]}
            </span>
          )}
          <span className="truncate font-semibold">{site?.name ?? 'Dashboard'}</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2 py-2" aria-label="Main">
          {NAV.map((item) => (
            <a
              key={item.page}
              href={href({ page: item.page })}
              aria-current={route.page === item.page ? 'page' : undefined}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors [&_svg]:size-4',
                route.page === item.page ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {item.icon}
              {item.label}
            </a>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2 border-t px-3 py-2.5">
          <Avatar name={me.admin.email} className="size-6 text-[10px]" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={me.admin.email}>
            {me.admin.email}
          </span>
          <Button variant="ghost" size="icon" className="size-7" onClick={toggleTheme} aria-label={dark ? 'Light theme' : 'Dark theme'}>
            {dark ? <Sun /> : <Moon />}
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={onLogout} aria-label="Sign out">
            <LogOut />
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile: the nav becomes a bottom-aligned row of tabs. */}
        <nav className="flex border-b bg-sidebar md:hidden" aria-label="Main">
          {NAV.map((item) => (
            <a
              key={item.page}
              href={href({ page: item.page })}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] [&_svg]:size-4',
                route.page === item.page ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {item.icon}
              {item.label}
            </a>
          ))}
        </nav>
        <main className="min-h-0 flex-1 overflow-auto scroll-thin">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-3.5 md:px-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
