import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronRight, CircleHelp, Eye, EyeOff, UserRound } from 'lucide-react';
import { cn, HELPPUFF_MARK, hueOf, initials } from '../lib/utils';

/** shadcn-shaped primitives, hand-written: same anatomy, no generator. */

/**
 * A modal's keyboard: focus moves into it when it opens and back to what
 * opened it when it closes, and Escape closes it (only the topmost one, so
 * a dialog opened from another closes first).
 */
export function useModal<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Read while rendering, before an autofocus inside the dialog moves focus.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(() => {
    if (!ref.current?.contains(document.activeElement)) ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const escape = (e: KeyboardEvent) => {
      const modals = document.querySelectorAll('[aria-modal="true"]');
      if (e.key === 'Escape' && modals[modals.length - 1] === ref.current) close.current();
    };
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('keydown', escape);
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);
  return ref;
}

/** HelpPuff's mark, in the brand's colours whatever the site's (`--hp-mark`: oxblood, citron in the dark theme). */
export function HelpPuffMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className={className}>
      <path fill="var(--hp-mark)" d={HELPPUFF_MARK} />
    </svg>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'sm' | 'md' | 'icon';
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = 'default', size = 'md', ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
      variant === 'default' && 'bg-primary text-primary-foreground hover:opacity-90',
      variant === 'outline' && 'border bg-background hover:bg-muted',
      variant === 'secondary' && 'bg-muted hover:bg-muted/70',
      variant === 'ghost' && 'hover:bg-muted text-muted-foreground hover:text-foreground',
      size === 'sm' && 'h-7 px-2.5 text-xs',
      size === 'md' && 'h-8 px-3 text-[13px]',
      size === 'icon' && 'size-8',
      className,
    )}
    {...props}
  />
));
Button.displayName = 'Button';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-8 w-full rounded-md border bg-background px-2.5 text-[13px] placeholder:text-muted-foreground/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { visibilityLabel?: string };

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(({ className, visibilityLabel = 'password', ...props }, ref) => {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative block">
      <Input ref={ref} {...props} type={visible ? 'text' : 'password'} className={cn('pr-10', className)} />
      <button
        type="button"
        aria-label={`${visible ? 'Hide' : 'Show'} ${visibilityLabel}`}
        disabled={props.disabled}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </span>
  );
});
PasswordInput.displayName = 'PasswordInput';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded-md border bg-background px-2.5 py-2 text-[13px] placeholder:text-muted-foreground/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn('h-8 rounded-md border bg-background px-2 text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40', className)}
      {...props}
    />
  );
}

/** Secondary detail, closed until asked for: a chevron and a short label. */
export function Disclosure({ summary, children, className, open }: { summary: ReactNode; children: ReactNode; className?: string; open?: boolean }) {
  return (
    <details className={cn('group', className)} open={open}>
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded text-xs font-medium text-muted-foreground marker:hidden hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/** `attention`: something waiting for you. Use it for one or two cards a page at most. */
export function Card({ className, tone, ...props }: HTMLAttributes<HTMLDivElement> & { tone?: 'attention' }) {
  return <div className={cn('rounded-lg border', tone === 'attention' ? 'border-attention-border bg-attention' : 'bg-card', className)} {...props} />;
}

export function CardHeader({ title, description, action, tip }: { title: ReactNode; description?: ReactNode; action?: ReactNode; tip?: { label: string; text: ReactNode; align?: 'start' | 'end'; href?: string } }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
      <div>
        <h3 className="flex items-center gap-1.5 text-[13px] font-medium">
          {title}
          {tip && (
            <InfoTip label={tip.label} align={tip.align} href={tip.href}>
              {tip.text}
            </InfoTip>
          )}
        </h3>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Badge({ className, children, dot }: { className?: string; children: ReactNode; dot?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none', className)}>
      {dot && <span className="size-1.5 rounded-full" style={{ background: dot }} aria-hidden />}
      {children}
    </span>
  );
}

export function Avatar({ name, className }: { name: string | null | undefined; className?: string }) {
  if (!name || !initials(name)) {
    return (
      <span aria-hidden className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground', className)}>
        <UserRound className="size-3.5" />
      </span>
    );
  }
  const hue = hueOf(name);
  return (
    <span
      aria-hidden
      className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', className)}
      style={{ background: `hsl(${hue} 70% 92%)`, color: `hsl(${hue} 45% 32%)` }}
    >
      {initials(name)}
    </span>
  );
}

/**
 * A (?) that explains something, so pages carry no paragraphs of help. It
 * opens on hover, keyboard focus or a tap (never a mouse alone), stays open
 * while the pointer or focus is inside it, so a "Learn more" link in it can
 * be reached, and Escape closes it.
 */
export function InfoTip({ label, children, align = 'start', href }: { label: string; children: ReactNode; align?: 'start' | 'end' | undefined; href?: string | undefined }) {
  const id = useId();
  return (
    <span
      className="group relative inline-flex align-middle"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }}
    >
      {/* "More info", never the field's own name: voice control and label lookups would find two things called "Email". */}
      <button type="button" aria-label="More info" data-topic={label} aria-describedby={id} className="rounded-full text-muted-foreground hover:text-foreground focus-visible:text-foreground">
        <CircleHelp className="size-3.5" aria-hidden />
      </button>
      {/* Padding, not margin, between the (?) and the box: the pointer never leaves the group on its way in. */}
      <span className={cn('absolute top-full z-30 hidden pt-1 group-focus-within:block group-hover:block', align === 'end' ? 'right-0' : 'left-0')}>
        <span className="block w-64 rounded-md border bg-card px-2.5 py-1.5 text-left text-xs leading-relaxed font-normal text-foreground shadow-sm">
          <span role="tooltip" id={id} className="block">
            {children}
          </span>
          {href && (
            <a href={href} target="_blank" rel="noreferrer" className="mt-1 inline-block font-medium underline-offset-2 hover:underline">
              Learn more →
            </a>
          )}
        </span>
      </span>
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">{icon}</div>
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-sm text-[13px] text-muted-foreground">{children}</div>}
    </div>
  );
}

/** A segmented control, for short either/or choices like a date range. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border bg-muted/50 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-6 rounded-[5px] px-2.5 text-xs font-medium transition-colors',
            value === option.value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">
      <span>{error.message}</span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
