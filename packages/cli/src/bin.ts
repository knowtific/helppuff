import { main } from './cli.js';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (thrown: unknown) => {
    process.stderr.write(`${thrown instanceof Error ? (thrown.stack ?? thrown.message) : String(thrown)}\n`);
    process.exitCode = 1;
  },
);
