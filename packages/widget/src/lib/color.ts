/**
 * Just enough colour maths to keep the accent accessible: the
 * foreground on an accent fill is chosen at runtime, not assumed. No colour
 * library — this is ~30 lines and the budget is 35 kb.
 */

export type Rgb = { r: number; g: number; b: number };

export function parseHex(hex: string): Rgb | null {
  const value = hex.trim().replace(/^#/, '');
  const expanded =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value.length === 8
        ? value.slice(0, 6)
        : value;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

/** WCAG relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 17, g: 17, b: 20 };

/**
 * Pick black or white text for an accent fill, whichever has more contrast.
 * Accessibility: checked against the accent at runtime rather than assumed white.
 */
export function foregroundFor(accent: string): string {
  const rgb = parseHex(accent);
  if (!rgb) return '#FFFFFF';
  return contrastRatio(rgb, WHITE) >= contrastRatio(rgb, BLACK) ? '#FFFFFF' : '#111114';
}

/** Whether a colour pair clears WCAG AA for normal text. */

/**
 * Rotate a hex colour's hue, for the orb's gradient. Works in HSL,
 * which is close enough for a soft gradient and far smaller than an OKLCH
 * implementation.
 */
export function rotateHue(hex: string, degrees: number, lighten = 0): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  h = (h * 60 + degrees + 360) % 360;

  const l = Math.min(1, (max + min) / 2 + lighten);
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * ((max + min) / 2) - 1));

  return hslToHex(h, s, l);
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  const [r, g, b] = (
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  ) as [number, number, number];

  const hex = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
