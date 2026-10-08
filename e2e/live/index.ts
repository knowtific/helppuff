// The live-chat Worker's entry: the real Worker, with the config above.
import { createWorker } from '../../packages/server/src/worker.js';
import config from './config.js';

export { CrawlWorkflow } from '../../packages/server/src/workflows/crawl.js';
export { LiveHub } from '../../packages/server/src/live/object.js';

export default createWorker(config);
