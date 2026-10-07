/**
 * IP addresses and CIDR ranges, for the owner's allow and block lists
 * (`security.allowIps`, `security.blockIps`). The visitor's address is
 * compared in memory and never stored or logged; only its salted hash is
 * used as a rate-limit key.
 */

type Parsed = { version: 4 | 6; value: bigint };

function parseV4(text: string): bigint | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function parseV6(text: string): bigint | null {
  let input = text.toLowerCase();
  // An embedded IPv4 tail (::ffff:1.2.3.4) becomes two hextets.
  const v4 = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(input);
  if (v4) {
    const tail = parseV4(v4[1]!);
    if (tail === null) return null;
    input = `${input.slice(0, v4.index)}:${(tail >> 16n).toString(16)}:${(tail & 0xffffn).toString(16)}`;
  }
  const halves = input.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

export function parseIp(text: string): Parsed | null {
  const trimmed = text.trim();
  if (trimmed.includes(':')) {
    const value = parseV6(trimmed);
    if (value === null) return null;
    // An IPv4-mapped address (::ffff:a.b.c.d) is that IPv4 address.
    if (value >> 32n === 0xffffn) return { version: 4, value: value & 0xffffffffn };
    return { version: 6, value };
  }
  const value = parseV4(trimmed);
  return value === null ? null : { version: 4, value };
}

type Range = { version: 4 | 6; base: bigint; bits: number };

/** `203.0.113.7`, `203.0.113.0/24`, `2001:db8::/32`. Null when it is neither. */
export function parseRange(text: string): Range | null {
  const [address, prefix, extra] = text.trim().split('/');
  if (extra !== undefined || !address) return null;
  const ip = parseIp(address);
  if (!ip) return null;
  const size = ip.version === 4 ? 32 : 128;
  const bits = prefix === undefined ? size : /^\d{1,3}$/.test(prefix) ? Number(prefix) : NaN;
  if (!Number.isInteger(bits) || bits < 0 || bits > size) return null;
  const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(size - bits);
  return { version: ip.version, base: ip.value & mask, bits };
}

export const isIpOrRange = (text: string): boolean => parseRange(text) !== null;

function inRange(ip: Parsed, range: Range): boolean {
  if (ip.version !== range.version) return false;
  const size = ip.version === 4 ? 32 : 128;
  const mask = range.bits === 0 ? 0n : ((1n << BigInt(range.bits)) - 1n) << BigInt(size - range.bits);
  return (ip.value & mask) === range.base;
}

/** Whether `ip` is in any of `entries`. Entries that do not parse match nothing. */
export function ipMatches(ip: string | null | undefined, entries: readonly string[]): boolean {
  if (!ip || entries.length === 0) return false;
  const parsed = parseIp(ip);
  if (!parsed) return false;
  return entries.some((entry) => {
    const range = parseRange(entry);
    return range !== null && inRange(parsed, range);
  });
}
