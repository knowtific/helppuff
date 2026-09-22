import config from '../../../murmur.config.js';
import { createApp } from './app.js';

/** Cloudflare Worker entry. The config is bundled at build time (§5). */
export default createApp(config);
