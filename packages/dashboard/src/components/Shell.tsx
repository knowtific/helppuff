import { ArrowUpCircle, BookOpen, ChartColumn, ChevronDown, House, LogOut, MessagesSquare, Moon, PhoneCall, Settings, Sun, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type CallbackList, type Me, type Site } from '../lib/api';
import { cn, href, useTheme, type Route } from '../lib/utils';
import { Avatar, Button } from './ui';
import { useVersion } from './Updates';

const ALL_NAV: {
  page: Route['page'];
  label: string;
  icon: ReactNode;
  knowledge?: boolean;
}[] = [
  { page: 'home', label: 'Home', icon: <House /> },
  { page: 'conversations', label: 'Conversations', icon: <MessagesSquare /> },
  { page: 'leads', label: 'Leads', icon: <Users /> },
  { page: 'callbacks', label: 'Callbacks', icon: <PhoneCall /> },
  {
    page: 'knowledge',
    label: 'Knowledge',
    icon: <BookOpen />,
    knowledge: true,
  },
  { page: 'analytics', label: 'Analytics', icon: <ChartColumn /> },
  { page: 'settings', label: 'Settings', icon: <Settings /> },
];

/** Settings, one page per topic; the sidebar opens them as a sub-menu. */
export type SettingsSection = 'chat' | 'appearance' | 'leads' | 'instructions' | 'business' | 'advanced' | 'webhooks' | 'team' | 'updates';

export function settingsSections(site: Site | undefined): { id: SettingsSection; label: string }[] {
  return [
    { id: 'chat' as const, label: 'Chat' },
    { id: 'appearance' as const, label: 'Appearance' },
    { id: 'leads' as const, label: 'Lead form' },
    { id: 'instructions' as const, label: 'Instructions' },
    ...(site?.knowledge ? [{ id: 'business' as const, label: 'Business details' }] : []),
    ...(site?.knowledge || site?.connector === 'workers-ai' ? [{ id: 'advanced' as const, label: 'Advanced' }] : []),
    { id: 'webhooks' as const, label: 'Webhooks' },
    { id: 'team' as const, label: 'Team & security' },
    { id: 'updates' as const, label: 'Updates' },
  ];
}

export function Shell({ me, route, onLogout, children }: { me: Me; route: Route; onLogout: () => void; children: ReactNode }) {
  const [dark, toggleTheme] = useTheme();
  const site = me.sites[0];
  const NAV = ALL_NAV.filter((item) => !item.knowledge || site?.knowledge);
  const inSettings = route.page === 'settings' || route.page === 'prompt';
  const sections = settingsSections(site);
  const version = useVersion();
  // Callbacks waiting, on the menu: refreshed whenever the page changes.
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    api<CallbackList>('/callbacks?status=open').then(
      (list) => setWaiting(list.counts.open),
      () => {},
    );
  }, [route.page, route.id]);
  const [settingsOpen, setSettingsOpen] = useState(inSettings);
  useEffect(() => {
    if (inSettings) setSettingsOpen(true);
  }, [inSettings]);

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
          {NAV.map((item) =>
            item.page === 'settings' ? (
              <div key="settings">
                <button
                  type="button"
                  aria-expanded={settingsOpen}
                  aria-controls="settings-menu"
                  onClick={() => {
                    // Opening goes to the first page too, unless one is already showing.
                    if (!settingsOpen && !inSettings)
                      window.location.hash = href({
                        page: 'settings',
                        id: sections[0]!.id,
                      });
                    setSettingsOpen(!settingsOpen);
                  }}
                  className={cn(
                    'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors [&_svg]:size-4',
                    inSettings ? 'font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  {item.icon}
                  <span className="flex-1 text-left">{item.label}</span>
                  <ChevronDown className={cn('text-muted-foreground transition-transform', settingsOpen && 'rotate-180')} aria-hidden />
                </button>
                {settingsOpen && (
                  <ul id="settings-menu" className="mt-0.5 ml-[17px] flex flex-col gap-0.5 border-l pl-2">
                    {sections.map((section) => {
                      const current = route.page === 'settings' && (route.id ?? sections[0]!.id) === section.id;
                      return (
                        <li key={section.id}>
                          <a
                            href={href({ page: 'settings', id: section.id })}
                            aria-current={current ? 'page' : undefined}
                            className={cn(
                              'flex h-7 items-center rounded-md px-2 text-[13px] transition-colors',
                              current ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                            )}
                          >
                            {section.label}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : (
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
                <span className="flex-1">{item.label}</span>
                {item.page === 'callbacks' && waiting > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-[11px] font-medium tabular-nums text-primary-foreground" aria-label={`${waiting} waiting`}>
                    {waiting}
                  </span>
                )}
              </a>
            ),
          )}
        </nav>
        {version?.upgradeAvailable && (
          <a
            href={href({ page: 'settings', id: 'updates' })}
            className="mx-2 mt-auto mb-2 flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <ArrowUpCircle className="size-4 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="block font-medium text-foreground">Update available</span>
              HelpPuff {version.latest}
            </span>
          </a>
        )}
        <div className={cn('flex items-center gap-2 border-t px-3 py-2.5', !version?.upgradeAvailable && 'mt-auto')}>
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
              className={cn('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] [&_svg]:size-4', route.page === item.page ? 'text-foreground' : 'text-muted-foreground')}
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
