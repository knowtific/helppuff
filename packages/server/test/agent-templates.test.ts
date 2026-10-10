import { describe, expect, it } from 'vitest';
import { AGENT_TEMPLATES } from '@helppuff/protocol/agents';
import { promptToolRefs } from '@helppuff/protocol/tools';
import { agentFileSchema } from '../src/admin/agent.js';
import { validTool } from '../src/tools/store.js';
import { SECRET } from './helpers.js';

/**
 * The tutorials' templates are real agent files: each passes the import's
 * checks, every tool is valid as written, every `{{tool}}` the prompt names
 * is one of its tools, and every `${SECRET}` is listed in `needs`.
 */
describe('the agent templates', () => {
  for (const template of AGENT_TEMPLATES) {
    it(`${template.id} imports as it is`, async () => {
      expect(agentFileSchema.safeParse(template.agent).success).toBe(true);
      const names = template.agent.tools.map((t) => t.name);
      for (const tool of template.agent.tools) {
        // Placeholders filled as an import would; the secret's value does not matter here.
        const headers = ((tool['headers'] as { value: string }[] | undefined) ?? []).map((h) => ({ ...h, value: h.value.replace(/\$\{[A-Z0-9_]+\}/g, 'x') }));
        await expect(validTool({ ...tool, ...(tool['headers'] ? { headers } : {}) }, null, names.filter((n) => n !== tool.name), SECRET)).resolves.toBeTruthy();
      }
      const named = new Set(promptToolRefs(template.agent.prompt ?? '').map((r) => r.name));
      for (const name of named) if (!['lead', 'business', 'context', 'page', 'user'].includes(name)) expect(names, `{{${name}}} in the prompt`).toContain(name);
      // Each tool used during the chat is named in the prompt (a tool is offered only then); before/after tools run by themselves.
      for (const tool of template.agent.tools) if (!tool['before'] && !tool['after']) expect([...named], `${tool.name} in the prompt`).toContain(tool.name);
      const secrets = [...JSON.stringify(template.agent.tools).matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]);
      expect(new Set(secrets)).toEqual(new Set(template.agent.needs.map((n) => n.name)));
    });
  }
});
