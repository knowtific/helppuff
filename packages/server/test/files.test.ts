import { describe, expect, it } from 'vitest';
import { cleanFileName, fileKey, purgeOldChatFiles, signedFileUrl, sniffType, verifyFileUrl, type FilesBucket } from '../src/files/store.js';
import { assistantText, describePhotos } from '../src/files/chat.js';
import { chat, say, world } from './inbox-helpers.js';
import { SECRET } from './helpers.js';

/**
 * Files on R2: photos visitors send in the chat (off, during live chat, or
 * any time), files on jobs, signed links, and what the assistant is told.
 */

type Json = Record<string, any>;
const json = async (response: Response) => (await response.json()) as Json;

/** An in-memory R2 bucket: the slice the Worker uses. */
function memoryBucket() {
  const store = new Map<string, { bytes: Uint8Array; httpMetadata?: { contentType?: string; contentDisposition?: string } }>();
  const bucket: FilesBucket & { store: typeof store } = {
    store,
    put: async (key, value, options) => {
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value.slice(0)) : new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      store.set(key, { bytes, ...(options?.httpMetadata ? { httpMetadata: options.httpMetadata } : {}) });
    },
    get: async (key) => {
      const found = store.get(key);
      return found ? { body: new Response(found.bytes).body!, size: found.bytes.length, ...(found.httpMetadata ? { httpMetadata: found.httpMetadata } : {}) } : null;
    },
    delete: async (keys) => {
      for (const key of [keys].flat()) store.delete(key);
    },
  };
  return bucket;
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const PDF = new TextEncoder().encode('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n');
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>');

async function filesWorld(files: Record<string, unknown> = {}, site: Record<string, unknown> = {}) {
  const bucket = memoryBucket();
  const w = await world({ live: { enabled: true }, files: { chat: 'always', jobs: true, ...files }, ...site } as never, { HELPPUFF_FILES: bucket });
  const upload = (token: string, bytes: Uint8Array, name: string) =>
    w.h.fetch(`/v1/sessions/files?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: bytes });
  return { ...w, bucket, upload };
}

describe('what a file is', () => {
  it('reads the type from the bytes, never the name, and keeps only the kinds it knows', () => {
    expect(sniffType(JPEG, 'photo.png')).toBe('image/jpeg');
    expect(sniffType(PDF, 'quote.jpg')).toBe('application/pdf');
    expect(sniffType(HTML, 'page.html')).toBeNull();
    expect(sniffType(HTML, 'notes.txt')).toBe('text/plain');
    expect(sniffType(new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic')]), 'IMG_1.HEIC')).toBe('image/heic');
    expect(sniffType(new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypisom')]), 'clip.mp4')).toBe('video/mp4');
    expect(sniffType(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), 'plan.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(sniffType(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), 'archive.zip')).toBeNull();
  });

  it('keeps a name without its path or control characters', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('C:\\Users\\me\\leak\u0007.jpg')).toBe('leak_.jpg');
    expect(cleanFileName('')).toBe('file');
  });

  it('signs links that expire and cannot be bent to another file', async () => {
    const row = { id: 'f_abc12345def', site_id: 'demo', scope: 'chat' as const };
    const url = new URL(await signedFileUrl(SECRET, 'https://w.test', row, Date.now() + 60_000));
    const e = url.searchParams.get('e')!;
    const s = url.searchParams.get('s')!;
    expect(url.pathname).toBe('/v1/files/demo/chat/f_abc12345def');
    expect(await verifyFileUrl(SECRET, fileKey(row), e, s, Date.now())).toBe(true);
    expect(await verifyFileUrl(SECRET, fileKey({ ...row, id: 'f_abc12345deg' }), e, s, Date.now())).toBe(false);
    expect(await verifyFileUrl(SECRET, fileKey({ ...row, scope: 'job' }), e, s, Date.now())).toBe(false);
    expect(await verifyFileUrl(SECRET, fileKey(row), e, s, Date.now() + 120_000)).toBe(false);
    expect(await verifyFileUrl('another-secret-that-is-32-bytes-long!', fileKey(row), e, s, Date.now())).toBe(false);
  });
});

describe('photos in the chat', () => {
  it('are off by default: no paperclip, and the upload is refused', async () => {
    const w = await world({}, { HELPPUFF_FILES: memoryBucket() });
    const config = await json(await w.h.fetch('/v1/sites/demo/config'));
    expect(config['capabilities']['files']).toBeUndefined();
    const { token } = await chat(w.h);
    const response = await w.h.fetch('/v1/sessions/files?name=a.jpg', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({}) });
    expect(response.status).toBe(404);
  });

  it('are offered only when the deployment has its bucket', async () => {
    const w = await world({ files: { chat: 'always' } } as never);
    expect((await json(await w.h.fetch('/v1/sites/demo/config')))['capabilities']['files']).toBeUndefined();
    const settings = await json(await w.owner.get('/settings'));
    expect(settings).toMatchObject({ storage: false, settings: { files: { chat: 'always' } } });
  });

  it('during live chat only: refused until a person has the chat, then sent to the team', async () => {
    const w = await filesWorld({ chat: 'live' });
    expect((await json(await w.h.fetch('/v1/sites/demo/config')))['capabilities']['files']).toBe('live');
    const { token, id } = await chat(w.h);
    await w.settle();
    const early = await w.upload(token, JPEG, 'leak.jpg');
    expect(early.status).toBe(403);
    expect((await json(early))['error']['message']).toMatch(/once someone from the team has joined/);

    w.db.raw.prepare("UPDATE conversations SET status = 'live', last_at = ? WHERE id = ?").run(Date.now(), id);
    const sent = await w.upload(token, JPEG, 'leak.jpg');
    expect(sent.status).toBe(201);
    const file = await json(sent);
    expect(file).toMatchObject({ name: 'leak.jpg', type: 'image/jpeg', size: JPEG.length });
    expect(file['url']).toMatch(/^http:\/\/server\.test\/v1\/files\/demo\/chat\/f_[a-z0-9]+\?e=/);

    const message = await say(w.h, token, { kind: 'text', text: '', files: [file['id']] });
    expect(message.status).toBe(200);
    await w.settle();
    // The team's live view gets the file with a link; the transcript keeps the reference and signs it when read.
    expect(w.hub.events.some((e: Json) => e['type'] === 'visitor' && e['message']?.type === 'file' && e['message'].files[0].name === 'leak.jpg')).toBe(true);
    const transcript = await json(await w.owner.get(`/conversations/${id}`));
    const visitor = (transcript['messages'] as Json[]).find((m) => m['payload']?.files);
    expect(visitor).toMatchObject({ role: 'user', text: '📎 leak.jpg', payload: { caption: '', files: [{ id: file['id'], name: 'leak.jpg' }] } });
    expect(visitor!['payload'].files[0].url).toMatch(/\/v1\/files\/demo\/chat\//);

    // The signed link serves the bytes, as a picture that runs nothing.
    const served = await w.h.fetch(new URL(file['url']).pathname + new URL(file['url']).search);
    expect(served.status).toBe(200);
    expect(served.headers.get('Content-Type')).toBe('image/jpeg');
    expect(served.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(served.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(JPEG);
    const forged = await w.h.fetch(new URL(file['url']).pathname + '?e=zzzzzz&s=forged');
    expect(forged.status).toBe(404);
  });

  it('any time: the assistant is told a file arrived (never the file), and only the chat that sent it can name it', async () => {
    const w = await filesWorld();
    const { token } = await chat(w.h);
    const file = await json(await w.upload(token, PDF, 'quote.pdf'));
    expect(file['type']).toBe('application/pdf');
    const reply = await json(await say(w.h, token, { kind: 'text', text: 'Can you match this?', files: [file['id']] }));
    expect(reply['messages'][0].text).toContain('Can you match this?');
    expect(reply['messages'][0].text).toContain('[The visitor sent a PDF, "quote.pdf". You cannot see files');

    const other = await chat(w.h);
    const stolen = await say(w.h, other.token, { kind: 'text', text: '', files: [file['id']] });
    expect(stolen.status).toBe(400);
    expect((await json(stolen))['error']['message']).toMatch(/not part of this chat/);
  });

  it('refuses what is not a photo or PDF, what is too large, and past the per-chat count', async () => {
    const w = await filesWorld({ maxChatMb: 1, perConversation: 2 });
    const { token } = await chat(w.h);
    expect((await json(await w.upload(token, HTML, 'page.html')))['error']['message']).toMatch(/photo .* or a PDF/);
    const big = new Uint8Array(1024 * 1024 + 10);
    big.set(JPEG);
    expect((await json(await w.upload(token, big, 'big.jpg')))['error']['message']).toBe('Files can be up to 1 MB.');
    expect((await w.upload(token, JPEG, 'a.jpg')).status).toBe(201);
    expect((await w.upload(token, JPEG, 'b.jpg')).status).toBe(201);
    const third = await w.upload(token, JPEG, 'c.jpg');
    expect(third.status).toBe(429);
    expect((await json(third))['error']['message']).toBe('This chat cannot take more files.');
    expect(w.bucket.store.size).toBe(2);
  });

  it('are deleted with their conversation', async () => {
    const w = await filesWorld();
    const { token, id } = await chat(w.h);
    const file = await json(await w.upload(token, JPEG, 'leak.jpg'));
    await say(w.h, token, { kind: 'text', text: 'here', files: [file['id']] });
    await w.settle();
    expect(w.bucket.store.size).toBe(1);
    expect((await w.owner.send('DELETE', `/conversations/${id}`)).status).toBe(200);
    expect(w.bucket.store.size).toBe(0);
  });

  it('are kept keepChatDays, then the cron deletes them; job files stay', async () => {
    const w = await filesWorld();
    const { token } = await chat(w.h);
    await w.upload(token, JPEG, 'old.jpg');
    const job = await json(await w.owner.send('POST', '/jobs', { title: 'Fix the leak' }));
    expect((await rawPost(w, await loginCookie(w), `/jobs/${job['id']}/files?name=after.jpg`, JPEG)).status).toBe(201);
    w.db.raw.prepare('UPDATE files SET created_at = ?').run(Date.now() - 91 * 86_400_000);
    expect(await purgeOldChatFiles({ db: w.db, bucket: w.bucket }, 'demo', 90, Date.now())).toBe(1);
    expect(w.db.raw.prepare('SELECT scope FROM files').all()).toEqual([{ scope: 'job' }]);
    expect(w.bucket.store.size).toBe(1);
  });
});

describe('what the assistant reads', () => {
  it('a note per file, or what a vision model saw in a photo (described once)', async () => {
    const row = { id: 'f_1', site_id: 'demo', scope: 'chat' as const, conversation_id: 'c', job_id: null, name: 'leak.jpg', type: 'image/jpeg', size: JPEG.length, uploaded_by: 'visitor', uploaded_by_name: null, description: null, created_at: 1 };
    expect(assistantText('', [row])).toBe('[The visitor sent a photo, "leak.jpg". You cannot see files; say the team will look at it.]');

    const bucket = memoryBucket();
    await bucket.put(fileKey(row), JPEG);
    const calls: { model: string; input: Json }[] = [];
    const ai = { run: async (model: string, input: object) => (calls.push({ model, input: input as Json }), { choices: [{ message: { content: 'Water stain on a white ceiling,\n about 30 cm across.' } }] }) };
    const writes: unknown[] = [];
    const db = { prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({ sql, args }) }), batch: async (s: unknown[]) => (writes.push(...s), []) } as never;
    const seen = await describePhotos({ db, bucket, ai, model: '@cf/meta/llama-4-scout-17b-16e-instruct', log: () => {} }, [row]);
    expect(calls[0]!.model).toBe('@cf/meta/llama-4-scout-17b-16e-instruct');
    expect(calls[0]!.input['messages'][0].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,\/9j\//);
    expect(assistantText('Is this bad?', seen.rows)).toBe('Is this bad?\n[The visitor sent a photo, "leak.jpg". It shows: Water stain on a white ceiling, about 30 cm across.]');
    await seen.save();
    expect(writes).toHaveLength(1);

    // Described already: no second call.
    await describePhotos({ db, bucket, ai, model: 'm', log: () => {} }, seen.rows);
    expect(calls).toHaveLength(1);
  });
});

describe('files on jobs', () => {
  it('are refused while off, then attached, listed with the chat\'s photos, and removed', async () => {
    const w = await filesWorld({ jobs: false });
    const cookie = await loginCookie(w);
    const { token, id: conversationId } = await chat(w.h);
    const photo = await json(await w.upload(token, JPEG, 'leak.jpg'));
    await say(w.h, token, { kind: 'text', text: '', files: [photo['id']] });
    await w.settle();
    // A job from this conversation (as the assistant or the quote questions make one).
    const job = await json(await w.owner.send('POST', '/jobs', { title: 'Fix the leak' }));
    w.db.raw.prepare('UPDATE jobs SET conversation_id = ? WHERE id = ?').run(conversationId, job['id']);
    const path = `/jobs/${job['id']}`;

    const off = await rawPost(w, cookie, `${path}/files?name=after.jpg`, JPEG);
    expect(off.status).toBe(400);
    expect((await json(off))['error']['message']).toMatch(/Files on jobs are off/);

    await w.owner.send('PUT', '/settings', { settings: { files: { jobs: true } } });
    const added = await rawPost(w, cookie, `${path}/files?name=after-install.jpg`, JPEG);
    expect(added.status).toBe(201);
    const file = await json(added);
    expect(file).toMatchObject({ name: 'after-install.jpg', type: 'image/jpeg', uploadedBy: 'owner@acme.com' });

    const listed = await json(await w.owner.get(`${path}/files`));
    expect(listed).toMatchObject({ enabled: true, storage: true, maxMb: 25 });
    expect(listed['files'].map((f: Json) => f.name)).toEqual(['after-install.jpg']);
    expect(listed['fromChat'].map((f: Json) => f.name)).toEqual(['leak.jpg']);
    const history = await json(await w.owner.get(path));
    expect((history['history'] as Json[]).some((e) => e['kind'] === 'file' && e['data'].name === 'after-install.jpg')).toBe(true);

    expect((await w.owner.send('DELETE', `${path}/files/${file['id']}`)).status).toBe(200);
    expect((await json(await w.owner.get(`${path}/files`)))['files']).toEqual([]);
  });

  it('a member attaches and removes their own, not someone else\'s', async () => {
    const w = await filesWorld();
    const job = await json(await w.owner.send('POST', '/jobs', { title: 'Install' }));
    const ownerFile = await json(await rawPost(w, await loginCookie(w), `/jobs/${job['id']}/files?name=plan.pdf`, PDF));
    await w.member();
    const memberCookie = await loginCookie(w, 'mo@acme.com', 'member-password-1');
    const mine = await rawPost(w, memberCookie, `/jobs/${job['id']}/files?name=done.jpg`, JPEG);
    expect(mine.status).toBe(201);
    const del = (fileId: string) => w.admin.fetch(`/admin/api/jobs/${job['id']}/files/${fileId}`, { method: 'DELETE', headers: { Cookie: memberCookie } });
    expect((await del(ownerFile['id'])).status).toBe(403);
    expect((await del((await json(mine))['id'])).status).toBe(200);
  });

  it('go with the job when it is deleted', async () => {
    const w = await filesWorld();
    const job = await json(await w.owner.send('POST', '/jobs', { title: 'Install' }));
    await rawPost(w, await loginCookie(w), `/jobs/${job['id']}/files?name=plan.pdf`, PDF);
    expect(w.bucket.store.size).toBe(1);
    await w.owner.send('DELETE', `/jobs/${job['id']}`);
    expect(w.bucket.store.size).toBe(0);
  });
});

async function loginCookie(w: Awaited<ReturnType<typeof filesWorld>>, email = 'owner@acme.com', password = 'correct horse battery staple') {
  const response = await w.admin.post('/admin/api/login', { email, password });
  return response.headers.get('Set-Cookie')!.split(';')[0]!;
}

function rawPost(w: Awaited<ReturnType<typeof filesWorld>>, cookie: string, path: string, bytes: Uint8Array) {
  return w.admin.fetch(`/admin/api${path}`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream' }, body: bytes });
}
