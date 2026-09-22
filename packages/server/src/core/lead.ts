import type { Field, Lead } from '@murmur/protocol';
import { MurmurError } from './errors.js';

/** Each lead value is capped independently of the field's own rules (§7.1). */
export const MAX_LEAD_VALUE_LENGTH = 200;
const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;
const TEL_RE = /^[+()\-.\s\d]{6,40}$/;

/**
 * Validate a submitted lead against the site's configured form. Unknown keys
 * are dropped rather than rejected, so a stale widget cannot break a site by
 * sending a field that was just removed from the config.
 */
export function validateLead(lead: Lead | undefined, fields: readonly Field[]): Lead {
  const submitted = lead ?? {};
  const out: Lead = {};

  for (const field of fields) {
    const raw = submitted[field.name];
    const value = typeof raw === 'string' ? raw.trim() : '';

    if (!value) {
      if (field.required) {
        throw new MurmurError('bad_request', {
          message: `Please fill in ${field.label}.`,
          detail: `lead_missing:${field.name}`,
        });
      }
      continue;
    }

    if (value.length > MAX_LEAD_VALUE_LENGTH) {
      throw new MurmurError('bad_request', {
        message: `${field.label} is too long.`,
        detail: `lead_too_long:${field.name}`,
      });
    }

    if (field.type === 'email' && !EMAIL_RE.test(value)) {
      throw new MurmurError('bad_request', {
        message: `Please enter a valid ${field.label.toLowerCase()}.`,
        detail: `lead_bad_email:${field.name}`,
      });
    }

    if (field.type === 'tel' && !TEL_RE.test(value)) {
      throw new MurmurError('bad_request', {
        message: `Please enter a valid ${field.label.toLowerCase()}.`,
        detail: `lead_bad_tel:${field.name}`,
      });
    }

    if (field.type === 'select' && field.options && !field.options.includes(value)) {
      throw new MurmurError('bad_request', {
        message: `Please choose one of the options for ${field.label}.`,
        detail: `lead_bad_option:${field.name}`,
      });
    }

    if (field.pattern && !matchesPattern(value, field.pattern)) {
      throw new MurmurError('bad_request', {
        message: `Please check ${field.label}.`,
        detail: `lead_bad_pattern:${field.name}`,
      });
    }

    out[field.name] = value;
  }

  return out;
}

/**
 * A config-supplied pattern is anchored and compiled defensively: a bad regex
 * is treated as no pattern rather than taking the request down.
 */
function matchesPattern(value: string, pattern: string): boolean {
  let re: RegExp;
  try {
    re = new RegExp(`^(?:${pattern})$`, 'u');
  } catch {
    return true;
  }
  return re.test(value);
}
