import { Plus, X } from 'lucide-react';
import { TOOL_METHODS, isSecretHeader } from '@helppuff/protocol/tools';
import type { ToolHeaderView } from '../lib/api';
import { Button, Input, PasswordInput, Select, Textarea } from './ui';

/**
 * A request HelpPuff sends for you: a tool's call, a webhook in its own
 * format, the email service. The address (`{{…}}` only in its path and
 * query), headers (secret values stored encrypted, never shown again) and a
 * body template.
 */

export type RequestDraft = { method: string; url: string; headers: ToolHeaderView[]; body: string };

export function HeaderList({ headers, onChange }: { headers: ToolHeaderView[]; onChange: (headers: ToolHeaderView[]) => void }) {
  const update = (i: number, patch: Partial<ToolHeaderView>) => onChange(headers.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">Headers</p>
      {headers.map((h, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto_auto] items-center gap-1.5">
          <Input
            value={h.name}
            onChange={(e) => update(i, { name: e.target.value, ...(isSecretHeader(e.target.value) && !h.secret && !h.value ? { secret: true } : {}) })}
            placeholder="Name"
            aria-label={`Header ${i + 1} name`}
            className="font-mono text-xs"
          />
          {h.secret ? (
            <PasswordInput
              value={h.value}
              visibilityLabel={`header ${i + 1} value`}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder={h.set ? 'Stored: leave empty to keep it' : 'Value'}
              aria-label={`Header ${i + 1} value`}
              className="font-mono text-xs"
              autoComplete="off"
            />
          ) : (
            <Input
              value={h.value}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder="Value"
              aria-label={`Header ${i + 1} value`}
              className="font-mono text-xs"
              autoComplete="off"
            />
          )}
          <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Stored encrypted and never shown again">
            <input type="checkbox" checked={h.secret} onChange={(e) => update(i, { secret: e.target.checked })} /> Secret
          </label>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => onChange(headers.filter((_, j) => j !== i))} aria-label={`Remove header ${h.name || i + 1}`}>
            <X />
          </Button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...headers, { name: '', value: '', secret: false }])} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <Plus className="size-3" /> Add a header
      </button>
      {headers.some((h) => h.secret) && <p className="text-xs text-muted-foreground">Secret values are stored encrypted and never shown again.</p>}
    </div>
  );
}

/** The whole request: method and address on one line, the headers, the body. `values` lists the placeholders it can use. */
export function RequestEditor({ id, value, onChange, values, bodyPlaceholder }: { id: string; value: RequestDraft; onChange: (next: RequestDraft) => void; values: string; bodyPlaceholder?: string }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-1.5">
        <Select value={value.method} onChange={(e) => onChange({ ...value, method: e.target.value })} aria-label="Method">
          {TOOL_METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Select>
        <Input
          id={`${id}-url`}
          inputMode="url"
          value={value.url}
          onChange={(e) => onChange({ ...value, url: e.target.value })}
          placeholder="https://api.example.com/…"
          aria-label="Address"
          className="font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <HeaderList headers={value.headers} onChange={(headers) => onChange({ ...value, headers })} />
      <label className="block space-y-1.5" htmlFor={`${id}-body`}>
        <span className="text-xs font-medium">Body</span>
        <Textarea id={`${id}-body`} rows={7} value={value.body} onChange={(e) => onChange({ ...value, body: e.target.value })} placeholder={bodyPlaceholder} className="font-mono text-xs" spellCheck={false} />
      </label>
      <p className="text-xs text-muted-foreground">{values}</p>
    </div>
  );
}
