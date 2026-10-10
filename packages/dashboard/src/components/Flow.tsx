import { ArrowDown, ArrowRight, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/utils';
import { InfoTip } from './ui';

/**
 * The pieces of a flow diagram that does not move: what happens around a
 * chat, left to right on a dotted canvas (top to bottom on a phone). Nodes
 * are cards with a tinted header; edges are a line, an arrow and a label.
 * Nothing is dragged: the diagram explains, the nodes are where you act.
 */

export type Tint = 'pink' | 'amber' | 'lime' | 'teal' | 'blue' | 'violet';

// A tint for the header and its icon only; text stays the foreground colour, so it reads in both themes.
const TINT: Record<Tint, { head: string; icon: string }> = {
  pink: { head: 'bg-[#ec4899]/10', icon: 'text-[#db2777]' },
  amber: { head: 'bg-[#f59e0b]/12', icon: 'text-[#d97706]' },
  lime: { head: 'bg-[#84cc16]/14', icon: 'text-[#65a30d]' },
  teal: { head: 'bg-[#14b8a6]/12', icon: 'text-[#0d9488]' },
  blue: { head: 'bg-[#3b82f6]/10', icon: 'text-[#2563eb]' },
  violet: { head: 'bg-[#8b5cf6]/12', icon: 'text-[#7c3aed]' },
};

export function Canvas({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section
      aria-label={label}
      className="overflow-x-auto rounded-xl border bg-subtle/40 p-4 scroll-thin md:p-8"
      style={{ backgroundImage: 'radial-gradient(circle, var(--border) 1px, transparent 1px)', backgroundSize: '16px 16px' }}
    >
      {children}
    </section>
  );
}

/** A card: a tinted header (icon, title, a count or a (?)), then its body. */
export function Node({
  tint,
  icon,
  title,
  tip,
  aside,
  children,
  className,
}: {
  tint: Tint;
  icon: ReactNode;
  title: ReactNode;
  tip?: string;
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const t = TINT[tint];
  return (
    <div className={cn('w-full overflow-visible rounded-lg border bg-card shadow-sm', className)}>
      <div className={cn('flex items-center gap-2 rounded-t-lg px-3 py-2', t.head, !children && 'rounded-b-lg')}>
        <span className={cn('[&_svg]:size-4', t.icon)} aria-hidden>
          {icon}
        </span>
        <h2 className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium">
          <span className="truncate">{title}</span>
          {tip && <InfoTip label={typeof title === 'string' ? title : 'this step'}>{tip}</InfoTip>}
        </h2>
        {aside}
      </div>
      {children && <div className="space-y-2 border-t p-3">{children}</div>}
    </div>
  );
}

/** A node that is one button (or link), like the prompt or the webhooks. */
export function NodeButton({
  tint,
  icon,
  title,
  detail,
  onClick,
  href,
  className,
}: {
  tint: Tint;
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  onClick?: () => void;
  href?: string;
  className?: string;
}) {
  const t = TINT[tint];
  const body = (
    <>
      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4', t.head, t.icon)} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 text-left">
        <span className="flex items-center gap-1.5 text-[13px] font-medium">{title}</span>
        {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
    </>
  );
  const classes = cn('flex w-full items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-colors hover:border-foreground/30 hover:bg-subtle', className);
  return href ? (
    <a href={href} className={classes}>
      {body}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={classes}>
      {body}
    </button>
  );
}

/** An arrow between steps, with what happens there: across on a wide screen, down on a phone. */
export function Edge({ icon, label, className }: { icon?: ReactNode; label: string; className?: string }) {
  return (
    <div className={cn('flex shrink-0 items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground lg:min-w-28 lg:flex-1 lg:px-1 lg:py-0', className)}>
      <span className="hidden h-px flex-1 bg-border lg:block" aria-hidden />
      <span className="flex items-center gap-1 whitespace-nowrap [&_svg]:size-3.5">
        {icon}
        {label}
      </span>
      <span className="hidden h-px flex-1 bg-border lg:block" aria-hidden />
      <ArrowRight className="-ml-1 hidden size-3.5 text-border lg:block" aria-hidden />
      <ArrowDown className="size-3.5 text-border lg:hidden" aria-hidden />
    </div>
  );
}

/** A short line down from one node to the next, in the centre column. */
export function Stem({ dashed = false }: { dashed?: boolean }) {
  return <span className={cn('mx-auto block h-6 w-px', dashed ? 'border-l border-dashed border-muted-foreground/40' : 'bg-border')} aria-hidden />;
}

export type MenuItem = { key: string; label: string; detail?: string | undefined; onSelect: () => void };

/**
 * "+ Add": a menu of what can go here (the tools you already have), then
 * making a new one. Closes on a choice, a click outside or Escape.
 */
export function AddMenu({ label, items, newLabel, onNew, disabled }: { label: string; items: MenuItem[]; newLabel: string; onNew: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const choose = (run: () => void) => {
    setOpen(false);
    run();
  };
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className="inline-flex h-7 items-center gap-1 rounded-md border bg-card px-2 text-xs font-medium hover:bg-subtle disabled:opacity-50"
      >
        <Plus className="size-3.5" aria-hidden /> Add
      </button>
      {open && (
        <div role="menu" aria-label={label} className="absolute top-full left-0 z-30 mt-1 w-64 overflow-hidden rounded-lg border bg-card py-1 shadow-lg">
          {items.length > 0 && (
            <>
              <p className="px-3 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">Your tools</p>
              {items.map((item) => (
                <button key={item.key} type="button" role="menuitem" onClick={() => choose(item.onSelect)} className="block w-full px-3 py-1.5 text-left hover:bg-subtle">
                  <span className="block font-mono text-[12.5px]">{item.label}</span>
                  {item.detail && <span className="block truncate text-[11px] text-muted-foreground">{item.detail}</span>}
                </button>
              ))}
              <div className="my-1 border-t" />
            </>
          )}
          <button type="button" role="menuitem" onClick={() => choose(onNew)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-subtle">
            <Plus className="size-3.5 text-muted-foreground" aria-hidden /> {newLabel}
          </button>
        </div>
      )}
    </div>
  );
}
