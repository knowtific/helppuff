import { afterEach, describe, expect, it } from 'vitest';
import { AgentFiles } from '../src/components/AgentFile';
import type { AgentPlan } from '../src/lib/api';
import { button, byText, click, fakeApi, mount, type, unmount } from './helpers';

/** Settings → Import & export: a template's preview, the keys it needs, then the import. */

afterEach(async () => {
  await unmount();
});

const plan = (extra: Partial<AgentPlan>): AgentPlan => ({
  site: 'acme',
  dryRun: true,
  ready: false,
  name: 'Order tracking',
  settings: [],
  tools: [
    { name: 'order_number', action: 'create' },
    { name: 'order_lookup', action: 'create' },
    { name: 'track_shipment', action: 'create' },
  ],
  prompt: { action: 'replace', version: 3 },
  missingSecrets: [
    { name: 'SHOP_API_KEY', description: 'The key your shop’s order endpoint expects' },
    { name: 'SHIPPO_TOKEN', description: 'Your Shippo API token' },
  ],
  ...extra,
});

describe('importing an agent file', () => {
  it('shows what a template changes, asks for its keys, then imports with them', async () => {
    const calls = fakeApi({
      'POST /agent/import': (c: { body: unknown }) =>
        (c.body as { dryRun?: boolean }).dryRun ? plan({}) : plan({ dryRun: false, ready: true, missingSecrets: [], prompt: { action: 'replace', version: 4 } }),
    });
    const page = await mount(<AgentFiles site="acme" />);
    await click(button(page, 'Use this'));
    const dialog = page.querySelector('[role="dialog"]')!;
    expect(byText(dialog, 'track_shipment')).toBeTruthy();
    expect(byText(dialog, /replaced \(v3 stays in history\)/)).toBeTruthy();
    const importButton = button(dialog, 'Import') as HTMLButtonElement;
    expect(importButton.disabled).toBe(true);

    const keys = dialog.querySelectorAll<HTMLInputElement>('input[type="password"]');
    expect(keys).toHaveLength(2);
    await type(keys[0], 'sk_shop');
    await type(keys[1], 'shippo_test_1');
    await click(button(dialog, 'Import'));
    const imported = calls.filter((c) => c.path === '/agent/import').at(-1)!;
    expect(imported.body).toMatchObject({ site: 'acme', secrets: { SHOP_API_KEY: 'sk_shop', SHIPPO_TOKEN: 'shippo_test_1' }, agent: { helppuff: 'agent', name: 'Order tracking' } });
    expect((imported.body as { dryRun?: boolean }).dryRun).toBeUndefined();
    expect(byText(page, 'Imported')).toBeTruthy();
    expect(byText(page, 'now v4')).toBeTruthy();
  });
});
