import config from '../../../murmur.config.js';
import { createWorker } from './worker.js';

export { CrawlWorkflow } from './workflows/crawl.js';

/** Cloudflare Worker entry. The config is bundled at build time. */
export default createWorker(config);
