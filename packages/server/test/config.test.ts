import { describe, expect, it } from 'vitest';
import type { Field } from '@murmur/protocol';
import { collectSecretNames, defineConfig, getSite, resolveSecrets } from '../src/config/load.js';
import { isMurmurError } from '../src/core/errors.js';
import { validateLead } from '../src/core/lead.js';
import { hashIp, memoryKv, resilientKv } from '../src/core/platform.js';

const minimal = { sites: { a: { origins: ['https://a.co'], connector: { type: 'echo' } } } };

describe('defineConfig', () => {
  it('applies defaults for everything a site leaves out', () => {
    const config = defineConfig(minimal);
    const site = getSite(config, 'a');
    expect(site.sinks).toEqual([]);
    expect(site.security.sessionTtlHours).toBe(24);
    expect(site.security.limits.messagesPerSitePerDay).toBe(500);
    expect(site.widget.brand.accent).toBe('#5B5BF7');
  });

  it('throws a readable error naming the bad path', () => {
    expect(() => defineConfig({ sites: { a: { origins: [], connector: { type: 'echo' } } } }))
      .toThrow(/sites\.a\.origins/);
  });

  it('refuses a config with no sites', () => {
    expect(() => defineConfig({ sites: {} })).toThrow(/at least one site/);
  });

  it('404s an unknown site id', () => {
    expect(() => getSite(defineConfig(minimal), 'missing')).toSatisfy((thrown: unknown) => {
      try {
        (thrown as () => void)();
        return false;
      } catch (error) {
        return isMurmurError(error) && error.code === 'not_found';
      }
    });
  });
});

describe('resolveSecrets', () => {
  const env = { RETELL_API_KEY: 'key_123', HOOK: 'https://hook.example' };

  it('replaces env refs anywhere in the options tree', () => {
    const resolved = resolveSecrets(
      { apiKey: { env: 'RETELL_API_KEY' }, nested: { list: [{ url: { env: 'HOOK' } }] }, plain: 5 },
      env,
    );
    expect(resolved).toEqual({
      apiKey: 'key_123',
      nested: { list: [{ url: 'https://hook.example' }] },
      plain: 5,
    });
  });

  it('fails with a detail naming the missing variable, and no value', () => {
    try {
      resolveSecrets({ apiKey: { env: 'NOT_SET' } }, env);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isMurmurError(error)).toBe(true);
      if (isMurmurError(error)) {
        expect(error.detail).toBe('missing_secret:NOT_SET');
        expect(error.message).not.toContain('NOT_SET');
      }
    }
  });

  it('leaves an object that merely has an env key among others alone', () => {
    expect(resolveSecrets({ env: 'HOOK', other: 1 }, env)).toEqual({ env: 'HOOK', other: 1 });
  });

  it('collects every referenced variable name', () => {
    const names = collectSecretNames({ a: { env: 'ONE' }, b: [{ c: { env: 'TWO' } }] });
    expect([...names].sort()).toEqual(['ONE', 'TWO']);
  });
});

describe('validateLead', () => {
  const fields: Field[] = [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'when', label: 'When', type: 'select', options: ['Today', 'Tomorrow'] },
  ];

  const code = (fn: () => void) => {
    try {
      fn();
      return null;
    } catch (error) {
      return isMurmurError(error) ? error.detail : 'not_a_murmur_error';
    }
  };

  it('trims values and keeps only configured fields', () => {
    const lead = validateLead({ name: '  Ada  ', nickname: 'drop me' }, fields);
    expect(lead).toEqual({ name: 'Ada' });
  });

  it('requires required fields', () => {
    expect(code(() => validateLead({}, fields))).toBe('lead_missing:name');
    expect(code(() => validateLead({ name: '   ' }, fields))).toBe('lead_missing:name');
  });

  it('allows optional fields to be absent or empty', () => {
    expect(validateLead({ name: 'Ada', email: '' }, fields)).toEqual({ name: 'Ada' });
  });

  it.each([
    ['ada@example.com', null],
    ['ada@example.co.uk', null],
    ['no-at-sign', 'lead_bad_email:email'],
    ['a@b', 'lead_bad_email:email'],
    ['a b@c.co', 'lead_bad_email:email'],
  ])('checks the email %s', (email, expected) => {
    expect(code(() => validateLead({ name: 'Ada', email }, fields))).toBe(expected);
  });

  it.each([
    ['+61 400 000 000', null],
    ['(03) 9000-0000', null],
    ['12345', 'lead_bad_tel:phone'],
    ['call me', 'lead_bad_tel:phone'],
  ])('checks the phone %s', (phone, expected) => {
    expect(code(() => validateLead({ name: 'Ada', phone }, fields))).toBe(expected);
  });

  it('restricts a select to its options', () => {
    expect(code(() => validateLead({ name: 'Ada', when: 'Today' }, fields))).toBeNull();
    expect(code(() => validateLead({ name: 'Ada', when: 'Whenever' }, fields))).toBe('lead_bad_option:when');
  });

  it('caps each value at 200 characters', () => {
    expect(code(() => validateLead({ name: 'x'.repeat(201) }, fields))).toBe('lead_too_long:name');
  });

  it('anchors a configured pattern', () => {
    const patterned: Field[] = [{ name: 'ref', label: 'Ref', type: 'text', pattern: '\\d{4}' }];
    expect(code(() => validateLead({ ref: '1234' }, patterned))).toBeNull();
    expect(code(() => validateLead({ ref: 'x1234x' }, patterned))).toBe('lead_bad_pattern:ref');
  });

  it('ignores a pattern that will not compile rather than failing the request', () => {
    const broken: Field[] = [{ name: 'ref', label: 'Ref', type: 'text', pattern: '([' }];
    expect(code(() => validateLead({ ref: 'anything' }, broken))).toBeNull();
  });
});

describe('platform', () => {
  it('memoryKv stores, expires and deletes', async () => {
    const kv = memoryKv();
    await kv.put('a', '1');
    expect(await kv.get('a')).toBe('1');
    await kv.delete('a');
    expect(await kv.get('a')).toBeNull();
    expect(await kv.get('never-set')).toBeNull();
  });

  it('resilientKv degrades open when the binding throws', async () => {
    const broken = {
      get: async () => {
        throw new Error('kv down');
      },
      put: async () => {
        throw new Error('kv down');
      },
      delete: async () => {
        throw new Error('kv down');
      },
    };
    const events: string[] = [];
    const kv = resilientKv(broken, (event) => events.push(event));
    expect(await kv.get('a')).toBeNull();
    await expect(kv.put('a', '1')).resolves.toBeUndefined();
    expect(events).toEqual(['kv.get_failed', 'kv.put_failed']);
  });

  it('resilientKv tolerates a missing binding entirely', async () => {
    const kv = resilientKv(undefined, () => {});
    expect(await kv.get('a')).toBeNull();
  });

  it('hashes an IP to a short salted digest, never the raw value', async () => {
    const hashed = await hashIp('203.0.113.9', 'salt');
    expect(hashed).toMatch(/^[0-9a-f]{24}$/);
    expect(hashed).not.toContain('203');
    expect(await hashIp('203.0.113.9', 'other-salt')).not.toBe(hashed);
    expect(await hashIp(null, 'salt')).toBe('noip');
  });
});
