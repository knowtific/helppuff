import { widgetConfigSchema } from '@helppuff/protocol';

/**
 * Every widget option, read from the Zod schema the server validates with,
 * so the playground's reference and hints can never drift from the code.
 * The `.describe()` text is the same the wiki's configuration reference is
 * generated from.
 */

export type OptionRow = { path: string; type: string; defaultValue?: string; description: string };

/** The parts of a Zod 3 schema's definition this walk reads. */
type Def = {
  typeName?: string;
  description?: string;
  innerType?: Schema;
  schema?: Schema;
  type?: Schema;
  valueType?: Schema;
  options?: Schema[] | Map<unknown, Schema>;
  values?: readonly unknown[];
  value?: unknown;
  defaultValue?: () => unknown;
  shape?: () => Record<string, Schema>;
};
type Schema = { _def: Def };

/** Strip optional/default/catch/effects wrappers, keeping the first description and default. */
function unwrap(schema: Schema): { core: Schema; description: string; defaultValue?: unknown } {
  let node = schema;
  let description = '';
  let defaultValue: unknown;
  for (;;) {
    const def = node._def;
    if (!description && def.description) description = def.description;
    if (def.typeName === 'ZodDefault' && defaultValue === undefined) defaultValue = def.defaultValue?.();
    const inner = def.typeName === 'ZodEffects' ? def.schema : ['ZodOptional', 'ZodDefault', 'ZodCatch', 'ZodNullable'].includes(def.typeName ?? '') ? def.innerType : undefined;
    if (!inner) return { core: node, description, defaultValue };
    node = inner;
  }
}

function variants(def: Def): Schema[] {
  if (!def.options) return [];
  return Array.isArray(def.options) ? def.options : [...def.options.values()];
}

function typeName(schema: Schema): string {
  const { core } = unwrap(schema);
  const def = core._def;
  switch (def.typeName) {
    case 'ZodString': return 'string';
    case 'ZodNumber': return 'number';
    case 'ZodBoolean': return 'boolean';
    case 'ZodLiteral': return JSON.stringify(def.value);
    case 'ZodEnum': return (def.values ?? []).map((v) => JSON.stringify(v)).join(' | ');
    case 'ZodArray': return `${def.type ? typeName(def.type) : 'any'}[]`;
    case 'ZodRecord': return `map of ${def.valueType ? typeName(def.valueType) : 'any'}`;
    case 'ZodObject': return 'object';
    case 'ZodDiscriminatedUnion': return 'action';
    case 'ZodUnion': return [...new Set(variants(def).map(typeName))].join(' | ');
    default: return 'any';
  }
}

function walk(schema: Schema, path: string, out: OptionRow[]): void {
  const { core, description, defaultValue } = unwrap(schema);
  const def = core._def;
  const shown = defaultValue === undefined || (typeof defaultValue === 'object' && defaultValue !== null) ? undefined : JSON.stringify(defaultValue);
  if (path) out.push({ path, type: typeName(schema), description, ...(shown === undefined ? {} : { defaultValue: shown }) });

  if (def.typeName === 'ZodObject' && def.shape) {
    for (const [key, child] of Object.entries(def.shape())) walk(child, path ? `${path}.${key}` : key, out);
  } else if (def.typeName === 'ZodArray' && def.type && unwrap(def.type).core._def.typeName === 'ZodObject') {
    walk(def.type, `${path}[]`, out);
    // The row for the item itself repeats the array's; drop it.
    const item = out.findIndex((row) => row.path === `${path}[]`);
    if (item >= 0) out.splice(item, 1);
  } else if (def.typeName === 'ZodRecord' && def.valueType && unwrap(def.valueType).core._def.typeName === 'ZodObject') {
    walk(def.valueType, `${path}.<id>`, out);
    const item = out.findIndex((row) => row.path === `${path}.<id>`);
    if (item >= 0) out.splice(item, 1);
  }
}

export const OPTIONS: OptionRow[] = (() => {
  const out: OptionRow[] = [];
  walk(widgetConfigSchema as unknown as Schema, '', out);
  return out;
})();

const BY_PATH = new Map(OPTIONS.map((row) => [row.path, row]));

/** The schema's description of one option, for a control's hint. */
export const describe = (path: string): string => BY_PATH.get(path)?.description ?? '';
