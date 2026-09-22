import { z } from 'zod';
import { isHttpUrl, isSafeUrl } from './url.js';

export const safeUrl = z
  .string()
  .min(1)
  .max(2048)
  .refine(isSafeUrl, { message: 'url must be http(s), mailto or tel' });

export const httpUrl = z
  .string()
  .min(1)
  .max(2048)
  .refine(isHttpUrl, { message: 'url must be http or https' });
