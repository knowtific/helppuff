import { projectJsonSchema } from './schema.js';

/**
 * The wiki's configuration reference: every helppuff.json field, its type,
 * default, limits and description, generated from the JSON Schema (itself
 * generated from the Zod schemas the CLI validates with). `pnpm sync:docs`
 * writes it; a test fails when it is stale. To change the text, change the
 * `.describe()` on the field.
 */

type Node = {
  type?: string | string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  anyOf?: Node[];
  properties?: Record<string, Node>;
  required?: string[];
  items?: Node;
  additionalProperties?: Node | boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  format?: string;
};

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n+/g, ' ');

function typeOf(node: Node): string {
  if (node.const !== undefined) return `\`${JSON.stringify(node.const)}\``;
  if (node.enum) return node.enum.map((v) => `\`${JSON.stringify(v)}\``).join(' \\| ');
  if (node.anyOf) return [...new Set(node.anyOf.map(typeOf))].join(' \\| ');
  if (node.type === 'array') return `${node.items ? typeOf(node.items) : 'any'}[]`;
  if (Array.isArray(node.type)) return node.type.join(' \\| ');
  if (node.type === 'object' && node.properties?.['env'] && Object.keys(node.properties).length === 1) return '`{ env }`';
  if (node.type === 'object' && !node.properties && node.additionalProperties && typeof node.additionalProperties === 'object') return `map of ${typeOf(node.additionalProperties)}`;
  return node.type ?? (node.format ?? 'any');
}

function limits(node: Node): string {
  const parts: string[] = [];
  const range = (lo?: number, hi?: number, unit = '') =>
    lo !== undefined && hi !== undefined ? `${lo}–${hi}${unit}` : lo !== undefined ? `≥ ${lo}${unit}` : hi !== undefined ? `≤ ${hi}${unit}` : '';
  const numbers = range(node.minimum, node.maximum);
  if (numbers) parts.push(numbers);
  const length = range(node.minLength, node.maxLength, ' chars');
  if (length && !(node.minLength === 1 && node.maxLength === undefined)) parts.push(length);
  const items = range(node.minItems, node.maxItems, ' items');
  if (items) parts.push(items);
  if (node.format === 'uri') parts.push('URL');
  if (node.format === 'email') parts.push('email');
  return parts.join(', ');
}

const shown = (value: unknown) => (value === undefined ? '' : `\`${JSON.stringify(value)}\``);

/** Rows for one object, recursing into nested objects; each nested object of note becomes its own section. */
function rows(node: Node, prefix: string, sections: { title: string; prefix: string; node: Node }[]): string[] {
  const out: string[] = [];
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    const required = node.required?.includes(key) && child.default === undefined;
    out.push(`| \`${path}\`${required ? ' **(required)**' : ''} | ${typeOf(child)} | ${shown(child.default)} | ${cell([child.description ?? '', limits(child)].filter(Boolean).join(' · '))} |`);
    // A union of objects told apart by one constant field (an action's `kind`): one row for the
    // shared fields, and each variant's own fields marked with the value they belong to.
    const variants = child.anyOf?.filter((o) => o.type === 'object' && o.properties);
    if (variants && variants.length > 1 && variants.length === child.anyOf!.length) {
      const tag = Object.keys(variants[0]!.properties!).find((k) => variants.every((v) => v.properties![k]?.const !== undefined));
      if (tag) {
        const shared = Object.keys(variants[0]!.properties!).filter((k) => k !== tag && variants.every((v) => k in v.properties!));
        const kinds = variants.map((v) => `\`${JSON.stringify(v.properties![tag]!.const)}\` ${v.properties![tag]!.description ?? ''}`.trim());
        out.push(`| \`${path}.${tag}\` **(required)** | ${variants.map((v) => `\`${JSON.stringify(v.properties![tag]!.const)}\``).join(' \\| ')} |  | ${cell(kinds.join(' · '))} |`);
        out.push(...rows({ properties: Object.fromEntries(shared.map((k) => [k, variants[0]!.properties![k]!])), required: variants[0]!.required ?? [] }, path, sections));
        for (const variant of variants) {
          const own = Object.fromEntries(Object.entries(variant.properties!).filter(([k]) => k !== tag && !shared.includes(k)));
          const value = JSON.stringify(variant.properties![tag]!.const);
          for (const line of rows({ properties: own, required: variant.required ?? [] }, path, sections)) {
            out.push(line.replace(/\| ([^|]*) \|$/, (_match, text: string) => `| With \`${tag}: ${value}\`. ${text} |`));
          }
        }
        continue;
      }
    }
    const objectChild = child.type === 'object' && child.properties ? child : child.anyOf?.find((o) => o.type === 'object' && o.properties);
    if (objectChild && !(objectChild.properties!['env'] && Object.keys(objectChild.properties!).length === 1)) {
      // Small objects inline; big ones get a section of their own.
      if (Object.keys(objectChild.properties!).length > 6) sections.push({ title: path, prefix: path, node: objectChild });
      else out.push(...rows(objectChild, path, sections));
    }
    const itemObject = child.items?.type === 'object' && child.items.properties ? child.items : undefined;
    if (itemObject) out.push(...rows(itemObject, `${path}[]`, sections));
  }
  return out;
}

const HEADER = ['| Field | Type | Default | Description |', '| --- | --- | --- | --- |'];

function table(node: Node, prefix: string, sections: { title: string; prefix: string; node: Node }[]): string {
  return [...HEADER, ...rows(node, prefix, sections)].join('\n');
}

export function configReferencePage(): string {
  const schema = projectJsonSchema() as Node;
  const props = schema.properties ?? {};
  const out: string[] = [
    '<!-- Generated from the helppuff.json schema by `pnpm sync:docs`. Change a field\'s `.describe()`, not this page. -->',
    '',
    '# Configuration reference',
    '',
    'Every field of `helppuff.json`. Generated from the schema `helppuff` validates against, so it is',
    'always exact; `helppuff schema` prints the same as JSON Schema. For what these files are and how',
    'they relate to the dashboard, see [[Configuration]].',
    '',
    'Secrets are never values here: a field marked `{ env }` takes the name of an environment',
    'variable, e.g. `{ "env": "OPENAI_API_KEY" }`, whose value lives in `.env` and on the Worker.',
    '',
  ];

  const top: Node = { properties: Object.fromEntries(Object.entries(props).filter(([k]) => !['backend', 'knowledge', 'widget', 'security', 'leads', 'dashboard', 'cloudflare'].includes(k))), required: schema.required ?? [] };
  out.push('## Top level', '', table(top, '', []), '');

  out.push('## `backend`', '', props['backend']?.description ?? '', '');
  for (const variant of props['backend']?.anyOf ?? []) {
    const type = variant.properties?.['type']?.const;
    const sections: { title: string; prefix: string; node: Node }[] = [];
    out.push(`### \`"type": "${String(type)}"\``, '', variant.properties?.['type']?.description ?? '', '', table({ ...variant, properties: Object.fromEntries(Object.entries(variant.properties ?? {}).filter(([k]) => k !== 'type')) }, 'backend', sections), '');
    for (const section of sections) out.push(`#### \`${section.title}\``, '', section.node.description ?? '', '', table(section.node, section.prefix, []), '');
  }

  for (const key of ['knowledge', 'security', 'leads', 'dashboard', 'cloudflare']) {
    const node = props[key];
    if (!node) continue;
    const sections: { title: string; prefix: string; node: Node }[] = [];
    out.push(`## \`${key}\``, '', node.description ?? '', '', table(node, key, sections), '');
    for (const section of sections) out.push(`### \`${section.title}\``, '', section.node.description ?? '', '', table(section.node, section.prefix, []), '');
  }

  const widget = props['widget'];
  if (widget) {
    out.push('## `widget`', '', widget.description ?? '', '');
    for (const [key, child] of Object.entries(widget.properties ?? {})) {
      const objectChild = child.type === 'object' && child.properties ? child : undefined;
      if (objectChild) {
        const sections: { title: string; prefix: string; node: Node }[] = [];
        out.push(`### \`widget.${key}\``, '', child.description ?? '', '', table(objectChild, `widget.${key}`, sections), '');
        for (const section of sections) out.push(`#### \`${section.title}\``, '', section.node.description ?? '', '', table(section.node, section.prefix, []), '');
      } else {
        out.push(`### \`widget.${key}\``, '', `${cell(child.description ?? '')} Type: ${typeOf(child)}${child.default !== undefined ? `, default ${shown(child.default)}` : ''}.`, '');
        const items = child.items?.type === 'object' ? child.items : child.type === 'object' && child.additionalProperties && typeof child.additionalProperties === 'object' ? child.additionalProperties : undefined;
        if (items?.properties) out.push(table(items, `widget.${key}${child.items ? '[]' : '.<id>'}`, []), '');
      }
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
