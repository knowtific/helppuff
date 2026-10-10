import { ArrowUpCircle, Bot, Briefcase, ChartColumn, ChevronDown, CircleHelp, House, LogOut, MessagesSquare, Moon, PanelsTopLeft, PhoneCall, Server, Settings, Sun, Users } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { api, isMember, type CallbackList, type LiveStatus, type Me, type Prefs, type Site } from '../lib/api';
import { onToast, setAvailable, unlockAudio, useLiveConnection, useLiveEvents, type Toast } from '../lib/live';
import { setAccent, setWaiting } from '../lib/attention';
import { cn, href, useTheme, type Route } from '../lib/utils';
import { Avatar, Button, InfoTip } from './ui';
import { useVersion } from './Updates';

const WIKI = 'https://github.com/knowtific/helppuff/wiki';

export function wikiHref(page: string): string {
  return `${WIKI}/${page}`;
}

/** A wiki page, opened in a new tab. */
export function WikiLink({ page, ...props }: { page: string } & Omit<ComponentProps<'a'>, 'href' | 'target' | 'rel'>) {
  return <a href={wikiHref(page)} target="_blank" rel="noreferrer" {...props} />;
}

export function HelpLink({ page, label = 'Learn more', className }: { page: string; label?: string; className?: string }) {
  return (
    <WikiLink
      page={page}
      className={cn('inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline', className)}
    >
      <CircleHelp className="size-3.5" aria-hidden />
      {label}
    </WikiLink>
  );
}

const ALL_NAV: {
  page: Route['page'];
  label: string;
  icon: ReactNode;
  knowledge?: boolean;
  /** Admins only (members see the inbox). */
  admin?: boolean;
}[] = [
  { page: 'home', label: 'Home', icon: <House />, admin: true },
  { page: 'conversations', label: 'Conversations', icon: <MessagesSquare /> },
  { page: 'jobs', label: 'Jobs', icon: <Briefcase /> },
  { page: 'leads', label: 'Contacts', icon: <Users /> },
  { page: 'callbacks', label: 'Callbacks', icon: <PhoneCall /> },
  { page: 'analytics', label: 'Analytics', icon: <ChartColumn />, admin: true },
  { page: 'settings', label: 'Settings', icon: <Settings /> },
];

/** Settings, one page per topic; the sidebar opens them as a sub-menu. */
export type SettingsSection = 'chat' | 'home' | 'appearance' | 'leads' | 'instructions' | 'business' | 'advanced' | 'live' | 'labels' | 'jobs' | 'notifications' | 'webhooks' | 'api' | 'team' | 'updates';

/** The Prompt page (the owner's prompt, its versions, and the site's tools) in the Settings menu, after Instructions. */
export const PROMPT_LABEL = 'Prompt & tools';

export type SettingsLink = { key: string; label: string; href: string; current: (route: Route) => boolean };
export type SettingsGroup = { label: string; icon: ReactNode; items: SettingsLink[] };

const GROUPS: { label: string; icon: ReactNode; keys: string[] }[] = [
  { label: 'Assistant', icon: <Bot />, keys: ['instructions', 'prompt', 'knowledge', 'business'] },
  { label: 'Widget', icon: <PanelsTopLeft />, keys: ['chat', 'home', 'appearance', 'leads'] },
  { label: 'Team', icon: <Users />, keys: ['live', 'labels', 'jobs', 'notifications'] },
  { label: 'System', icon: <Server />, keys: ['advanced', 'webhooks', 'api', 'team', 'updates'] },
];

/**
 * The Settings menu, grouped: the settings pages, plus two pages of their own
 * that are set up rather than used every day (Prompt & tools, Knowledge).
 * The sidebar's sub-menu and the phone tabs both draw it.
 */
export function settingsMenu(site: Site | undefined, me?: Me): SettingsGroup[] {
  const sections = settingsSections(site, me);
  const admin = !me || !isMember(me);
  const links = new Map<string, SettingsLink>(
    sections.map((s) => [s.id, { key: s.id, label: s.label, href: href({ page: 'settings', id: s.id }), current: (r: Route) => r.page === 'settings' && r.id === s.id }]),
  );
  if (admin && site?.prompt !== false) links.set('prompt', { key: 'prompt', label: PROMPT_LABEL, href: href({ page: 'prompt' }), current: (r) => r.page === 'prompt' });
  if (admin && site?.knowledge) links.set('knowledge', { key: 'knowledge', label: 'Knowledge', href: href({ page: 'knowledge' }), current: (r) => r.page === 'knowledge' });
  return GROUPS.map((g) => ({ label: g.label, icon: g.icon, items: g.keys.map((k) => links.get(k)).filter((l): l is SettingsLink => Boolean(l)) })).filter((g) => g.items.length);
}

/** The Settings menu as tabs, on a phone (the sidebar has it otherwise). */
export function SettingsTabs({ me, route }: { me: Me; route: Route }) {
  const site = me.sites[0];
  const first = settingsSections(site, me)[0]?.id;
  const here = route.page === 'settings' && !route.id && first ? { ...route, id: first } : route;
  return (
    <nav className="flex gap-1 overflow-x-auto border-b px-4 py-2 scroll-thin md:hidden" aria-label="Settings">
      {settingsMenu(site, me)
        .flatMap((g) => g.items)
        .map((link) => (
          <a
            key={link.key}
            href={link.href}
            aria-current={link.current(here) ? 'page' : undefined}
            className={cn('shrink-0 rounded-md px-2.5 py-1 text-xs', link.current(here) ? 'bg-muted font-medium' : 'text-muted-foreground')}
          >
            {link.label}
          </a>
        ))}
    </nav>
  );
}

export function settingsSections(site: Site | undefined, me?: Me): { id: SettingsSection; label: string }[] {
  // Notifications are live chat's: with it off (the default) there is no such page.
  const live = Boolean(site?.live);
  // Members change only their own notifications.
  if (me && isMember(me)) return live ? [{ id: 'notifications' as const, label: 'Notifications' }] : [];
  return [
    { id: 'chat' as const, label: 'Chat' },
    { id: 'home' as const, label: 'Home screen' },
    { id: 'appearance' as const, label: 'Appearance' },
    { id: 'leads' as const, label: 'Lead form' },
    // A backend that keeps its own prompt (Retell, an OpenAI stored prompt, a test backend) has no use for these.
    ...(site?.prompt !== false ? [{ id: 'instructions' as const, label: 'Instructions' }] : []),
    ...(site?.knowledge ? [{ id: 'business' as const, label: 'Business details' }] : []),
    { id: 'live' as const, label: 'Live chat' },
    { id: 'labels' as const, label: 'Labels' },
    { id: 'jobs' as const, label: 'Jobs' },
    ...(live ? [{ id: 'notifications' as const, label: 'Notifications' }] : []),
    ...(site?.knowledge || site?.connector === 'workers-ai' ? [{ id: 'advanced' as const, label: 'Advanced' }] : []),
    { id: 'webhooks' as const, label: 'Webhooks' },
    { id: 'api' as const, label: 'API keys' },
    { id: 'team' as const, label: 'Team & security' },
    { id: 'updates' as const, label: 'Updates' },
  ];
}

/**
 * Live chat in the shell: the connection (one per tab), the person's
 * Available switch, and the count of live chats waiting for a reply, on the
 * menu and in the tab's title.
 */
function useLive(me: Me) {
  const enabled = Boolean(me.sites[0]?.live);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  useEffect(() => {
    if (!enabled) return;
    api<Prefs>('/prefs').then(setPrefs, () => {});
  }, [enabled]);
  const connected = useLiveConnection(enabled, prefs, me.admin.email);
  const refresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = () => {
    if (enabled) api<LiveStatus>('/live/status').then(setStatus, () => {});
  };
  useEffect(load, [enabled, connected]);
  useLiveEvents((event) => {
    if (event.t === 'typing') return;
    if (refresh.current) clearTimeout(refresh.current);
    refresh.current = setTimeout(load, 300);
  });
  // Prefs saved on the Notifications page reach the live connection.
  useEffect(() => {
    const onPrefs = (e: Event) => setPrefs((e as CustomEvent<Prefs>).detail);
    window.addEventListener('hp-prefs', onPrefs);
    return () => window.removeEventListener('hp-prefs', onPrefs);
  }, []);
  const waiting = status ? status.unassigned + status.mine : 0;
  // The tab's title and icon count what waits (lib/attention.ts).
  useEffect(() => setAccent(me.sites[0]?.accent ?? ''), [me]);
  useEffect(() => setWaiting(waiting), [waiting]);
  const toggle = async () => {
    unlockAudio();
    if (!prefs) return;
    setPrefs(await setAvailable(!prefs.available));
  };
  return { enabled, connected, prefs, waiting, toggle };
}

/** Pop-ups for what concerns you while you are elsewhere in the dashboard: a few seconds each, with Open. */
function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(
    () =>
      onToast((toast) => {
        setItems((current) => [...current.filter((t) => t.conversationId !== toast.conversationId), toast].slice(-3));
        setTimeout(() => setItems((current) => current.filter((t) => t.id !== toast.id)), toast.kind === 'new-chat' ? 15_000 : 7000);
      }),
    [],
  );
  if (!items.length) return null;
  return (
    <div className="fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2" role="status" aria-live="polite">
      {items.map((toast) => (
        <div key={toast.id} className="rounded-lg border bg-card p-3 text-[13px] shadow-lg">
          <p className="font-medium">{toast.title}</p>
          {toast.body && <p className="mt-0.5 line-clamp-2 text-muted-foreground">{toast.body}</p>}
          <div className="mt-2 flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setItems((current) => current.filter((t) => t.id !== toast.id))}>
              Dismiss
            </Button>
            <Button
              size="sm"
              onClick={() => {
                window.location.hash = toast.link;
                setItems((current) => current.filter((t) => t.id !== toast.id));
              }}
            >
              Open
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Availability({ live }: { live: ReturnType<typeof useLive> }) {
  if (!live.enabled || !live.prefs) return null;
  const on = live.prefs.available;
  return (
    <div className="mx-2 mb-2 flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs">
      <span className={cn('size-2 rounded-full', on && live.connected ? 'bg-[#16a34a]' : 'bg-muted-foreground/40')} aria-hidden />
      <span className="flex-1">
        <span className="block font-medium">{on ? 'Available' : 'Away'}</span>
        <span className="text-muted-foreground">{live.connected ? (on ? 'You get new live chats' : 'No live chat alerts') : 'Connecting…'}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Available for live chats"
        onClick={() => void live.toggle()}
        className={cn('relative h-5 w-9 shrink-0 rounded-full border border-transparent transition-colors', on ? 'bg-primary' : 'bg-muted-foreground/30')}
      >
        {/* Anchored to the left edge: a button centres its content, so an unanchored knob starts mid-track. */}
        <span className={cn('absolute top-px left-px size-4 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none', on ? 'translate-x-4' : 'translate-x-0')} />
      </button>
    </div>
  );
}

export function Shell({ me, route, onLogout, children }: { me: Me; route: Route; onLogout: () => void; children: ReactNode }) {
  const [dark, toggleTheme] = useTheme();
  const site = me.sites[0];
  const member = isMember(me);
  // A member with live chat off has no settings at all: no Settings entry.
  const NAV = ALL_NAV.filter((item) => (!item.knowledge || site?.knowledge) && (!item.admin || !member) && (item.page !== 'settings' || !member || site?.live));
  const inSettings = route.page === 'settings' || route.page === 'prompt' || route.page === 'knowledge';
  const menu = settingsMenu(site, me);
  // A bare #/settings shows the first settings page.
  const firstSection = settingsSections(site, me)[0]?.id;
  const isCurrent = (link: SettingsLink) => link.current(route.page === 'settings' && !route.id && firstSection ? { ...route, id: firstSection } : route);
  const live = useLive(me);
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
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
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
                    if (!settingsOpen && !inSettings && menu[0]) window.location.hash = menu[0].items[0]!.href;
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
                  <div id="settings-menu" className="mt-0.5 ml-[17px] flex flex-col gap-2 border-l pl-2">
                    {menu.map((group) => (
                      <div key={group.label}>
                        <p className="flex items-center gap-1.5 px-2 pt-1 pb-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase [&_svg]:size-3" aria-hidden>
                          {group.icon}
                          {group.label}
                        </p>
                        {/* Indented under their group's label, so it reads as a category. */}
                        <ul className="flex flex-col gap-0.5 pl-3" aria-label={group.label}>
                          {group.items.map((link) => (
                            <li key={link.key}>
                              <a
                                href={link.href}
                                aria-current={isCurrent(link) ? 'page' : undefined}
                                className={cn(
                                  'flex h-7 items-center rounded-md px-2 text-[13px] transition-colors',
                                  isCurrent(link) ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                                )}
                              >
                                {link.label}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <a
                key={item.page}
                href={href({ page: item.page })}
                aria-current={route.page === item.page || (item.page === 'leads' && route.page === 'contact') ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors [&_svg]:size-4',
                  route.page === item.page || (item.page === 'leads' && route.page === 'contact') ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
                {item.page === 'conversations' && live.waiting > 0 && (
                  <span className="rounded-full bg-[#d97706] px-1.5 text-[11px] font-medium tabular-nums text-white" aria-label={`${live.waiting} live chats waiting`}>
                    {live.waiting}
                  </span>
                )}
                {item.page === 'callbacks' && waiting > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-[11px] font-medium tabular-nums text-primary-foreground" aria-label={`${waiting} waiting`}>
                    {waiting}
                  </span>
                )}
              </a>
            ),
          )}
        </nav>
        <div className="mt-auto" />
        <Availability live={live} />
        {!member && version?.upgradeAvailable && (
          <a
            href={href({ page: 'settings', id: 'updates' })}
            className="mx-2 mb-2 flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <ArrowUpCircle className="size-4 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="block font-medium text-foreground">Update available</span>
              HelpPuff {version.latest}
            </span>
          </a>
        )}
        <div className="flex items-center gap-2 border-t px-3 py-2.5">
          <Avatar name={me.admin.email} className="size-6 text-[10px]" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={me.admin.email}>
            {me.admin.email}
          </span>
          <WikiLink
            page="Home"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Open HelpPuff help"
            title="Help and documentation"
          >
            <CircleHelp className="size-4" aria-hidden />
          </WikiLink>
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
        {live.enabled && <Toasts />}
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions, help }: { title: string; description?: ReactNode; actions?: ReactNode; help?: string }) {
  // What the page is for lives in a (?) beside the title, with the guide; the header itself stays one line.
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3.5 md:px-6">
      <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        {title}
        {description ? (
          <InfoTip label={`About ${title}`} href={help ? wikiHref(help) : undefined}>
            {description}
          </InfoTip>
        ) : (
          help && (
            <WikiLink page={help} aria-label={`Help: ${title}`} className="text-muted-foreground hover:text-foreground">
              <CircleHelp className="size-3.5" aria-hidden />
            </WikiLink>
          )
        )}
      </h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
