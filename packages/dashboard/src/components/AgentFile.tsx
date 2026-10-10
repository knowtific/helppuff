import { BookOpen, Download, FileUp, Loader2, PackageOpen, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AGENT_TEMPLATES, type AgentFile } from '@helppuff/protocol/agents';
import { api, type AgentPlan } from '../lib/api';
import { href } from '../lib/utils';
import { wikiHref } from './Shell';
import { Badge, Button, Card, CardHeader, ErrorNote, Input } from './ui';

/**
 * Settings → Import & export: the agent file, the whole assistant's setup in
 * one JSON file (the prompt, the tools, the behaviour and lead form
 * settings). Start from a tutorial's template, import a file, or download
 * this site's. Importing shows what changes first, and asks for the secrets
 * the tools need (they are never in the file). The same API as
 * `helppuff agent`.
 */
export function AgentFiles({ site }: { site: string }) {
  const [importing, setImporting] = useState<{ agent: AgentFile; source: string } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const file = await api<AgentFile>(`/agent/export?site=${encodeURIComponent(site)}`);
      const url = URL.createObjectURL(new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${site}-agent.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setBusy(false);
    }
  };

  const open = async (file: File) => {
    setError(null);
    try {
      const agent = JSON.parse(await file.text()) as AgentFile;
      if (agent?.helppuff !== 'agent') throw new Error('This is not a HelpPuff agent file.');
      setImporting({ agent, source: file.name });
    } catch (thrown) {
      setError(thrown instanceof SyntaxError ? new Error('This file is not valid JSON.') : (thrown as Error));
    }
  };

  return (
    <div className="space-y-4">
      {error && <ErrorNote error={error} />}
      <Card>
        <CardHeader
          title="Start from a template"
          tip={{ label: 'About templates', text: 'Ready-made setups from the tutorials: a prompt, its tools and the settings they need. Import one, then change it to fit.', href: wikiHref('Tutorials') }}
        />
        <ul className="divide-y border-t">
          {AGENT_TEMPLATES.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{t.title}</p>
                <p className="text-xs text-muted-foreground">{t.summary}</p>
              </div>
              <a href={wikiHref(t.tutorial)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <BookOpen className="size-3.5" aria-hidden /> Tutorial
              </a>
              <Button size="sm" variant="outline" onClick={() => setImporting({ agent: t.agent, source: t.title })}>
                Use this
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="px-4 py-4">
          <p className="flex items-center gap-2 text-[13px] font-medium">
            <FileUp className="size-4 text-muted-foreground" aria-hidden /> Import a file
          </p>
          <p className="mt-1 mb-3 text-xs text-muted-foreground">An agent.json exported here, or by `helppuff agent export`.</p>
          <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
            Choose file
          </Button>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label="Agent file to import"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void open(file);
              e.target.value = '';
            }}
          />
        </Card>
        <Card className="px-4 py-4">
          <p className="flex items-center gap-2 text-[13px] font-medium">
            <Download className="size-4 text-muted-foreground" aria-hidden /> Export
          </p>
          <p className="mt-1 mb-3 text-xs text-muted-foreground">This site’s prompt, tools and settings. Secrets stay here.</p>
          <Button size="sm" variant="outline" onClick={() => void download()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Download />} Download agent.json
          </Button>
        </Card>
      </div>

      {importing && <ImportDialog site={site} agent={importing.agent} source={importing.source} onClose={() => setImporting(null)} />}
    </div>
  );
}

/** What an import changes (a dry run), the secrets it needs, then the import itself. */
function ImportDialog({ site, agent, source, onClose }: { site: string; agent: AgentFile; source: string; onClose: () => void }) {
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<AgentPlan | null>(null);

  useEffect(() => {
    api<AgentPlan>('/agent/import', { method: 'POST', json: { site, agent, dryRun: true } }).then(setPlan, (thrown: Error) => setError(thrown));
  }, [site, agent]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  const missing = plan?.missingSecrets ?? [];
  const filled = missing.every((m) => secrets[m.name]?.trim());
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setDone(await api<AgentPlan>('/agent/import', { method: 'POST', json: { site, agent, secrets } }));
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[8vh]" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="w-full max-w-lg rounded-xl border bg-card shadow-xl">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <PackageOpen className="size-4 text-muted-foreground" aria-hidden />
          <h2 id="import-title" className="flex-1 truncate text-[15px] font-semibold">
            {done ? 'Imported' : `Import “${agent.name || source}”`}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        <div className="space-y-3 p-4 text-[13px]">
          {error && <ErrorNote error={error} />}
          {!plan && !error && (
            <p className="flex items-center gap-2 text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Checking the file…
            </p>
          )}
          {plan && (
            <>
              {agent.description && !done && <p className="text-muted-foreground">{agent.description}</p>}
              <p className="text-xs font-medium text-muted-foreground">{done ? 'What changed' : 'What it changes'}</p>
              <ul className="space-y-1.5">
                {plan.prompt && (
                  <li className="flex items-center justify-between gap-2">
                    <span>Prompt</span>
                    <Badge>{plan.prompt.action === 'replace' ? (done ? `now v${done.prompt?.version}` : `replaced (v${plan.prompt.version} stays in history)`) : plan.prompt.action}</Badge>
                  </li>
                )}
                {plan.tools.map((t) => (
                  <li key={t.name} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[12.5px]">{t.name}</span>
                    <Badge>{t.action === 'create' ? 'new tool' : 'replaces yours'}</Badge>
                  </li>
                ))}
                {plan.settings.map((s) => (
                  <li key={s} className="flex items-center justify-between gap-2">
                    <span>{s === 'leads' ? 'Lead form' : s === 'behaviour' ? 'Instructions' : s}</span>
                    <Badge>changed</Badge>
                  </li>
                ))}
              </ul>
              {!done && missing.length > 0 && (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-xs font-medium text-muted-foreground">Keys its tools need (stored encrypted, never shown again)</p>
                  {missing.map((m) => (
                    <label key={m.name} className="block space-y-1">
                      <span className="block font-mono text-xs">{m.name}</span>
                      <Input type="password" autoComplete="off" placeholder={m.description} value={secrets[m.name] ?? ''} onChange={(e) => setSecrets({ ...secrets, [m.name]: e.target.value })} />
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          {done ? (
            <>
              <a href={href({ page: 'prompt' })} className="mr-auto text-xs font-medium underline-offset-2 hover:underline" onClick={onClose}>
                Open Prompt & tools →
              </a>
              <Button onClick={onClose}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => void run()} disabled={!plan || !filled || busy}>
                {busy && <Loader2 className="animate-spin" />} Import
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
