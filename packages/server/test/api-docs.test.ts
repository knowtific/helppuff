import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { apiReferencePages } from '../src/api/openapi.js';

/**
 * The API reference's TypeScript tabs are generated from the registry's
 * examples; this compiles every one of them (with the shared types from the
 * overview page), so a changed example can never publish code that does not
 * typecheck.
 */
describe('the API reference', () => {
  it('has a TypeScript example for every endpoint, and every one typechecks', () => {
    const pages = apiReferencePages();
    const shared = /```ts\n([\s\S]*?)```/.exec(pages['API-Reference']!)![1]!;
    const dir = mkdtempSync(join(tmpdir(), 'helppuff-api-docs-'));
    try {
      const files: string[] = [];
      for (const [page, markdown] of Object.entries(pages)) {
        if (page === 'API-Reference') continue;
        for (const section of markdown.split('\n## ').slice(1)) {
          const request = /```ts \[TypeScript\]\n([\s\S]*?)```/.exec(section)?.[1];
          const response = /```ts \[Type\]\n([\s\S]*?)```/.exec(section)?.[1] ?? '';
          expect(request, `${page}: ${section.split('\n')[0]}`).toBeDefined();
          const lines = request!.split('\n');
          const file = join(dir, `${page}-${files.length}.ts`);
          writeFileSync(file, [...lines.filter((l) => l.startsWith('import ')), shared, response, ...lines.filter((l) => !l.startsWith('import ')), 'export { data };'].join('\n'));
          files.push(file);
        }
      }
      const root = resolve(__dirname, '../../..');
      const program = ts.createProgram(files, {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
        types: ['node'],
        typeRoots: [join(root, 'node_modules/@types')],
      });
      const errors = ts.getPreEmitDiagnostics(program).map((d) => `${d.file?.fileName.split('/').pop()}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
      expect(errors).toEqual([]);
      expect(files.length).toBeGreaterThan(50);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
