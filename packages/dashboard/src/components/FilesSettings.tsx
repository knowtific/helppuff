import { useId } from 'react';
import type { FilesSettings as Files } from '../lib/api';
import { HelpLink } from './Shell';
import { InfoTip, Input, Select } from './ui';

/**
 * Settings → Advanced → Files: visitors sending photos in the chat, and
 * files on jobs. Both off until turned on. Part of the settings object
 * (`files`), saved with the page's Save button.
 */

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (on: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-[13px]">
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function Num({ label, hint, value, min, max, step = 1, onChange }: { label: string; hint: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="text-xs font-medium">
          {label}
        </label>
        <InfoTip label={`About ${label.toLowerCase()}`}>{hint}</InfoTip>
      </div>
      <Input id={id} type="number" inputMode="numeric" min={min} max={max} step={step} required value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.valueAsNumber)} />
    </div>
  );
}

export function FilesSettings({ value, storage, live, onChange }: { value: Files; storage: boolean; live: boolean; onChange: (value: Files) => void }) {
  const set = (patch: Partial<Files>) => onChange({ ...value, ...patch });
  const chatId = useId();
  const on = value.chat !== 'off' || value.jobs;
  return (
    <div className="space-y-4">
      {on && !storage && (
        <p role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-[#f59e0b]/40 bg-[#f59e0b]/5 px-3 py-2 text-xs">
          File storage is not set up on this deployment yet: turn on R2 in Cloudflare, then deploy again.
          <HelpLink page="Files" label="How" />
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={chatId} className="text-xs font-medium">
            Visitors send photos and PDFs
          </label>
          <Select id={chatId} className="w-full" value={value.chat} onChange={(e) => set({ chat: e.target.value as Files['chat'] })}>
            <option value="off">Off</option>
            <option value="live">During live chat</option>
            <option value="always">Any time</option>
          </Select>
          {value.chat === 'live' && !live && <p className="text-xs text-muted-foreground">Live chat is off, so nobody can send them yet.</p>}
        </div>
        <div className="space-y-2 pt-5">
          <Check label="Files on jobs" checked={value.jobs} onChange={(jobs) => set({ jobs })} hint="Installation photos, plans, quotes." />
          {value.chat === 'always' && (
            <Check label="The assistant sees photos" checked={value.aiSeesPhotos} onChange={(aiSeesPhotos) => set({ aiSeesPhotos })} hint="A vision model describes each photo. More AI usage." />
          )}
        </div>
      </div>
      {on && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {value.chat !== 'off' && (
            <>
              <Num label="Largest from visitors (MB)" hint="Photos are made smaller in the browser first." value={value.maxChatMb} min={1} max={25} step={0.5} onChange={(maxChatMb) => set({ maxChatMb })} />
              <Num label="Files a chat" hint="Per conversation." value={value.perConversation} min={1} max={100} onChange={(perConversation) => set({ perConversation })} />
              <Num label="Keep chat files (days)" hint="Then they are deleted. Files on jobs stay until removed." value={value.keepChatDays} min={1} max={3650} onChange={(keepChatDays) => set({ keepChatDays })} />
            </>
          )}
          {value.jobs && <Num label="Largest on jobs (MB)" hint="Per file." value={value.maxJobMb} min={1} max={95} onChange={(maxJobMb) => set({ maxJobMb })} />}
        </div>
      )}
      {value.chat === 'always' && value.aiSeesPhotos && (
        <div className="max-w-sm space-y-1.5">
          <label htmlFor={`${chatId}-model`} className="text-xs font-medium">
            Vision model
          </label>
          <Input id={`${chatId}-model`} value={value.visionModel} onChange={(e) => set({ visionModel: e.target.value })} />
        </div>
      )}
      <HelpLink page="Files" />
    </div>
  );
}
