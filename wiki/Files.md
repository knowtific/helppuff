# Photos and files

Two things, each **off by default** and turned on separately:

- **Photos in the chat.** Visitors send photos and PDFs from the widget: a
  leaking pipe, a cracked tile, a quote from someone else.
- **Files on jobs.** Your team attaches photos and files to a [[job|Jobs]]:
  installation photos, plans, signed quotes, compliance certificates.

Files are kept in your own Cloudflare account, in a private R2 bucket that
`helppuff deploy` makes (`knowtific-helppuff-<site>`). Nobody can browse it.
Every file is opened through a link the Worker signs, and the link expires.

## Turning them on

- **Dashboard:** Settings → **Advanced** → *Photos and files* → Save.
- **CLI:**

  ```bash
  helppuff files chat live      # visitors send photos while a person has the chat
  helppuff files chat always    # ...or any time, to the assistant too
  helppuff files jobs on        # the team attaches files to jobs
  helppuff files status         # what is on, and whether storage is ready
  ```

- **An agent:** the same commands with `--json`. When storage is missing, the
  answer's `next` says what the person has to do (below).

Both are saved live (within a minute) and pulled into `helppuff.json` as
`files` (see the [[Configuration reference|Configuration-Reference#top-level]]).

## One-time setup: R2

R2 has to be turned on once for your Cloudflare account. Cloudflare asks a
person to accept the plan in the dashboard (it is free up to 10 GB, but
Cloudflare may ask for a card), so neither the CLI nor an AI agent can do this
step for you:

1. Open [dash.cloudflare.com → R2](https://dash.cloudflare.com/?to=/:account/r2/overview)
   and follow *Purchase R2* / *Get started*.
2. Run `helppuff deploy` (or `helppuff upgrade`). It makes the bucket and
   connects it to the Worker.

If R2 is already on for your account, there is nothing to do: deploy makes the
bucket every time it can, even while files are off, so turning them on later
needs no redeploy.

Until the bucket exists, files stay unavailable and the rest of HelpPuff works
as before. The deploy only warns about it when files are on. `helppuff doctor`
has a **files** check, and the dashboard says *File storage is not set up*.

`npx wrangler login` already covers R2. With an API token instead, add
**Account › Workers R2 Storage › Edit** to it.

## Photos in the chat

| `files.chat` | Visitors can send files |
| --- | --- |
| `off` (default) | Never. The widget shows no paperclip and loads no upload code. |
| `live` | Only while a person has the chat ([[Live chat|Live-Chat]] must be on). The paperclip appears when the hand-over starts. |
| `always` | Any time, to the assistant too. |

Visitors can send photos (JPEG, PNG, WebP, GIF, HEIC) and PDFs, one at a time.
Before a photo leaves the browser, the widget redraws it at 1600 pixels on
its longest side. A 5 MB phone photo becomes a few hundred KB, and its
location data is left behind. HelpPuff reads each file's type from its bytes,
not its name, and refuses anything else.

The team sees the photos in the conversation, in the dashboard's live chat and
in the conversation's transcript. On [[Telegram]], each file arrives as a link
that works for a week.

### What the assistant knows

By default the assistant never opens a file. With `chat: always` it is told
one arrived (*"The visitor sent a photo, "leak.jpg". You cannot see files;
say the team will look at it."*), so it can say the team will look.

**The assistant sees photos** (`files.aiSeesPhotos`, or `helppuff files ai on`)
makes a vision model describe each photo once, in a few sentences: what it
shows, any damage, measurements, model numbers. The assistant reads that
description with the visitor's message. This costs one extra Workers AI call
per photo. The default model is `@cf/meta/llama-4-scout-17b-16e-instruct`.
Change it with `--model` or `files.visionModel`; it must be a Workers AI
model that accepts images. Descriptions are kept with the file, so a photo is
never described twice.

It works with every backend, because the assistant only ever receives text.

## Files on jobs

With `files.jobs` on, every job in the dashboard has a **Files** section: drop
files on it or press **Attach files**. Photos show as thumbnails; other files
as their name and size. The photos the visitor sent in the job's conversation
are listed under *Sent in the chat*.

You can attach photos, PDF, Word, Excel, PowerPoint, text, CSV, MP4 and MOV
files, up to `files.maxJobMb` (25 MB unless changed). Each file attached or
removed is recorded in the job's history.

Members can attach files, and remove the ones they attached. Admins can remove
any.

From the CLI or an agent:

```bash
helppuff jobs attach 1042 ./after-install.jpg ./certificate.pdf
helppuff jobs files 1042          # with links that work for 12 hours
helppuff jobs detach 1042 after-install.jpg
```

From your own systems, see [[Jobs in the API reference|API-Reference-Jobs]]
(`POST /jobs/:id/files` takes the bytes as the body; `jobs:write`).

## Links and privacy

- The bucket is private. A file is read only through
  `/v1/files/<site>/<chat|job>/<id>?e=…&s=…`, a link signed with the Worker's
  secret.
- Links expire: in the dashboard and the API after **12 hours** (list again
  for a fresh one), for the visitor when their chat does, and on Telegram
  after **a week**.
- Photos open in the browser; every other file downloads. Files are served
  with `nosniff` and a sandboxing content-security policy, so nothing in a
  file can run as your Worker.
- A visitor can only send files their own chat uploaded.

## How long files are kept

- **Chat files:** `files.keepChatDays` (90 days unless changed), then the
  Worker's cron deletes them. Deleting a conversation, or a contact with its
  conversations, deletes its files at once.
- **Job files:** until someone removes them, or the job is deleted.

## Limits

| Setting | Default | What it bounds |
| --- | --- | --- |
| `files.maxChatMb` | 10 | The largest file a visitor may send (after the photo is made smaller) |
| `files.perConversation` | 10 | Files one chat may send |
| `files.keepChatDays` | 90 | Days a chat file is kept |
| `files.maxJobMb` | 25 | The largest file on a job (up to 95) |
| `security.limits.uploadsPerIpPerHour` | 20 | Files one visitor may send an hour |

All of them are on Settings → Advanced, and in the [[Security|Security#every-limit]] table.
`helppuff files limits --max-chat-mb 5 --keep-days 30` changes them from the
CLI.

## What it costs

R2's free tier is 10 GB stored, a million uploads and ten million reads a
month, and no charge for downloads (see
[R2 pricing](https://developers.cloudflare.com/r2/pricing/)). With photos made
smaller in the browser, that is tens of thousands of photos. *The assistant
sees photos* adds one Workers AI call per photo (see
[[AI models: speed, quality, cost|AI-Models]]).

## Troubleshooting

- **No paperclip in the widget.** `files.chat` is `off`; or it is `live`
  and nobody has the chat yet (live chat must be on too); or the deployment
  has no bucket (`helppuff files status`). A change shows within a minute.
- **"File storage is not set up"**: turn on R2 (above), then `helppuff deploy`.
- **"This link has expired"**: open the file again from the dashboard, or list
  the job's files again.
- **A photo was refused**: only photos and PDFs come from visitors. Screenshots
  in other formats can be saved as PNG first.
