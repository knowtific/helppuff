/**
 * The visitor's photos and files (`files.chat`): loaded by the app only when
 * one is picked, so sites without files never download it. No Preact, no Zod.
 *
 * A photo is drawn again, smaller, before it leaves the browser: a phone's
 * 5 MB picture becomes a few hundred KB, and its location data stays behind.
 * Every failure becomes a message for the visitor; nothing throws past here.
 */

export type Uploaded = { id: string; name: string; type: string; size: number; url?: string };

const STYLE =
  '.hpf{display:flex;flex-wrap:wrap;gap:6px}.hpf-u{justify-content:flex-end}' +
  '.hpf a{display:block;max-width:180px;overflow:hidden;border-radius:var(--hp-radius-md,16px);border:1px solid var(--hp-border,#e5e5e5);color:inherit;font-size:var(--hp-text-sm,13px)}' +
  '.hpf span{display:block;padding:8px 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.hpf img{display:block;max-width:180px;max-height:180px;object-fit:cover}' +
  '.hpf p{flex-basis:100%;margin:0;padding:10px 14px;border-radius:var(--hp-radius-lg,24px);background:var(--hp-surface,#f4f4f5);white-space:pre-wrap}' +
  '.hpf-u p{flex-basis:auto;background:var(--hp-accent);color:var(--hp-accent-fg)}';

const isImage = (type: string) => /^image\/(jpeg|png|gif|webp)$/.test(type);

/** A file message's photos (shown), files (links) and what was written with them, drawn into `root`. Links are the server's signed ones, checked by the app. */
export function drawFiles(root: HTMLElement, message: { role: string; files: Uploaded[]; text?: string }): void {
  const style = document.createElement('style');
  style.textContent = STYLE;
  const box = document.createElement('div');
  box.className = message.role === 'user' ? 'hpf hpf-u' : 'hpf';
  for (const file of message.files) {
    const link = document.createElement('a');
    if (file.url) Object.assign(link, { href: file.url, target: '_blank', rel: 'noopener' });
    if (file.url && isImage(file.type)) {
      const img = document.createElement('img');
      Object.assign(img, { src: file.url, alt: file.name, loading: 'lazy' });
      link.append(img);
    } else {
      const label = document.createElement('span');
      label.textContent = `📎 ${file.name}`;
      link.append(label);
    }
    box.append(link);
  }
  if (message.text) {
    const text = document.createElement('p');
    text.textContent = message.text;
    box.append(text);
  }
  root.replaceChildren(style, box);
}

/** The longest side a photo is sent at, in pixels. */
const MAX_SIDE = 1600;
const TIMEOUT_MS = 60_000;

/** Draw a photo again as a JPEG: smaller, upright, without its metadata. GIFs (they move) and PDFs go as they are. */
async function shrink(file: File): Promise<{ blob: Blob; name: string }> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || typeof createImageBitmap !== 'function') return { blob: file, name: file.name };
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    // A small PNG (a screenshot) is sharper as it is, and carries no location.
    if (file.type === 'image/png' && scale === 1 && file.size < 1_500_000) return { blob: file, name: file.name };
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob: file, name: file.name };
    // Transparent parts of a PNG would turn black in a JPEG.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ? { blob, name: file.name.replace(/\.[^.]*$/, '') + '.jpg' } : { blob: file, name: file.name };
  } catch {
    return { blob: file, name: file.name };
  }
}

/** Send one file on the chat's token. Resolves with the file, or rejects with a message to show the visitor. */
export async function uploadFile(options: { apiBase: string; token: string; file: File; fallback?: string | undefined }): Promise<Uploaded> {
  const { blob, name } = await shrink(options.file);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), TIMEOUT_MS);
  let body: { id?: unknown; name?: unknown; type?: unknown; size?: unknown; url?: unknown; error?: { message?: unknown } } = {};
  let ok = false;
  try {
    const response = await fetch(`${options.apiBase.replace(/\/+$/, '')}/v1/sessions/files?name=${encodeURIComponent(name.slice(-200))}`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
      ...(controller ? { signal: controller.signal } : {}),
    });
    ok = response.ok;
    body = ((await response.json().catch(() => ({}))) ?? {}) as typeof body;
  } catch {
    // Offline, blocked, or too slow: the fallback says so.
  } finally {
    clearTimeout(timer);
  }
  const { id, type, size, url } = body;
  if (ok && typeof id === 'string' && typeof type === 'string' && typeof size === 'number') {
    return { id, name: typeof body.name === 'string' ? body.name : name, type, size, ...(typeof url === 'string' ? { url } : {}) };
  }
  const message = body.error?.message;
  // `widget.strings.fileFailed` translates the fallback; the server's message is already the visitor's.
  throw new Error(typeof message === 'string' && message ? message.slice(0, 300) : options.fallback || 'That file could not be sent. Try again.');
}

/** The file the visitor picked in the composer's input: sent, with the paperclip marked busy meanwhile. Null when nothing was picked. */
export async function uploadFrom(input: HTMLInputElement, options: { apiBase: string; token: string; fallback?: string | undefined }): Promise<Uploaded | null> {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return null;
  const label = input.parentElement;
  label?.setAttribute('data-busy', '');
  try {
    return await uploadFile({ ...options, file });
  } finally {
    label?.removeAttribute('data-busy');
  }
}
