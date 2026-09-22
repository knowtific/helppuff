import { describe, expect, it } from 'vitest';
import { DEFAULT_LEAD_FIELDS, themeTokensSchema, widgetConfigSchema } from '../src/index.js';

describe('widgetConfigSchema', () => {
  it('parses an empty object into a fully usable config (§8.3 conservative defaults)', () => {
    const config = widgetConfigSchema.parse({});
    expect(config.brand.accent).toBe('#5B5BF7');
    expect(config.brand.theme).toBe('auto');
    expect(config.launcher.position).toBe('bottom-right');
    expect(config.home.title).toBe('Hi there');
    expect(config.leadForm.enabled).toBe(true);
    expect(config.leadForm.fields).toEqual([...DEFAULT_LEAD_FIELDS]);
    expect(config.poweredBy).toBe(true);
  });

  it('falls back to the default lead fields when the configured ones are malformed', () => {
    const config = widgetConfigSchema.parse({ leadForm: { fields: [{ name: 'a' }] } });
    expect(config.leadForm.fields).toEqual([...DEFAULT_LEAD_FIELDS]);
  });

  it('rejects a non-hex accent rather than writing it into a stylesheet', () => {
    expect(widgetConfigSchema.safeParse({ brand: { accent: 'red; }' } }).success).toBe(false);
  });

  it('rejects a teaser delay under 2000ms', () => {
    expect(widgetConfigSchema.safeParse({ teaser: { text: 'Hi', delayMs: 500 } }).success).toBe(false);
  });

  it('rejects a privacy link with an unsafe scheme', () => {
    const value = { leadForm: { privacy: { text: 'Privacy', url: 'javascript:alert(1)' } } };
    expect(widgetConfigSchema.safeParse(value).success).toBe(false);
  });
});

describe('themeTokensSchema', () => {
  it('accepts known tokens with plain values', () => {
    expect(themeTokensSchema.safeParse({ accent: '#123456', 'radius-md': '12px' }).success).toBe(true);
  });

  it.each([
    ['an unknown token name', { 'accent-glow': '#fff' }],
    ['a declaration break', { accent: 'red; background: url(x)' }],
    ['a url() value', { 'shadow-panel': 'url(https://evil.example/x.png)' }],
    ['an @import', { font: '@import "https://evil.example/f.css"' }],
  ])('rejects %s', (_name, value) => {
    expect(themeTokensSchema.safeParse(value).success).toBe(false);
  });
});
