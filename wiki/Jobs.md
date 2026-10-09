# Jobs

Jobs are the requests, quotes and work that come out of conversations: a
plumber's "blocked drain in Glebe", a builder's renovation quote, a software
company's support ticket. Each one moves through your **stages**
(*New request → Site visit → Quote sent → Booked → Done*, or whatever fits
your business) on a board in the dashboard.

You can rename them: *Quotes*, *Tickets*, *Projects*, *Bookings*. This page
says "jobs".

## Where jobs come from

| Source | How |
| --- | --- |
| **The assistant** | When a visitor asks for a quote, a booking or work done, the assistant records a job with what it learned. It then asks, in a short form, for any required details it doesn't have. |
| **The quote questions** | A **Get a quote** button on the widget's home screen asks your questions one at a time, then saves the answers as a job. The visitor gets its number (*Your request is #1042*). |
| **The API** | `POST /api/v1/jobs` from your own forms, Zapier or Make. See [[the API reference|API-Reference-Jobs]]. |
| **The dashboard** | **New job** on the Jobs page, or **New job** / **Make a job** from a contact, a conversation or a callback request. Any job made this way is linked to its contact and chat. |
| **The CLI** | `helppuff jobs create --title … --email …` |

Each job gets a number, starting at 1001. A job that came from a chat links to
the conversation, and to the contact, who is matched by email (then phone) or
created. When the quote questions ask for a name, email and phone, the visitor
is not asked again by the lead form.

## Set up for you

The first time the dashboard opens after your website has been learned
(straight away, from the home page, with a backend that doesn't learn it),
HelpPuff's AI reads your site and picks the template that fits the business,
then adjusts it: your services become the choices of the *Service* field, and the names of
a stage or two may change. The dashboard's Home page says what it chose and
why, with **Change it**. If it isn't sure (or there's no AI), you get the
**Basic** template: *New → Quote sent → In progress → Done / Cancelled*.

| Template | For | Stages (won · lost) | Fields |
| --- | --- | --- | --- |
| Service quote | Trades and home or business services that quote first | New request, Site visit, Quote sent, Booked, In progress · Done · Lost | Service, Description, Address or suburb, Urgency, Preferred date, Property type |
| Projects | Bigger work: builders, agencies, designers | New enquiry, Discovery call, Proposal sent, Negotiation · Won · Lost | Project type, Description, Budget, Timeline, Company |
| Support | Software and products | New, Triage, In progress, Waiting on customer · Resolved · Won't fix | Product area, Priority, What happened, Account or plan, Steps to reproduce |
| Sales (demo) | B2B: demo, trial, deal | Demo request, Qualified, Demo booked, Trial · Won · Lost | Company, Company size, Use case, Current tool |
| Bookings | Appointments and reservations | Request, Confirmed · Completed · Cancelled | Service, Preferred date and time, Number of people, Notes |
| Custom orders | Made-to-order products | Enquiry, Quoted, Paid · Delivered · Lost | Product, Quantity, Needed by, Description, Delivery address |
| Basic | Anything | New, Quote sent, In progress · Done · Cancelled | Description |

Once you edit anything, the AI never
changes your setup again unless you ask: **Let the AI choose again** in
Settings → Jobs, or `helppuff jobs setup`.

## Change it

**Settings → Jobs** (admins):

- **Template:** start again from another one. Stages and fields are replaced;
  jobs keep their place by kind (open, won, lost), and values in removed
  fields stay on the old jobs.
- **Names and the assistant:** what one job and many are called, and whether
  the assistant may create jobs from the chat.
- **Stages:** in order, each *open* (a column on the board), *won* (it went
  ahead) or *lost*. Keep at least one of each. **Stale after N days** marks a
  job red when it sits in that stage too long. Jobs in a removed stage move to
  the first stage of the same kind.
- **Fields:** label, type (short or long text, choice, number, date, email,
  phone), required, the choices, and how the widget and the assistant ask for
  it. The assistant asks for required fields it doesn't have; jobs from the
  API may arrive without them.
- **Quote questions:** show the button or not, its label, which fields it
  asks (up to 10, in order), and whether it asks for a name, email and phone.
  A preview shows exactly what the visitor sees. The button replaces a widget
  shortcut with the same label, so the home screen shows it once.
- **Send them from other tools:** a ready-made `curl` with your fields.

## Working with jobs

The **Jobs** page (everyone on the team, members too):

- **Board:** a column per open stage, with the count and total value. Drag a
  card to another column, or use the menu under each card (it does the same,
  without a mouse). Drop on **Done** or **Lost** at the bottom to close it;
  you're asked why it was lost. *New* marks a job from the last day; *Stale*
  one that has waited too long.
- **List:** every job in a table, open, won, lost or all. Search by words or
  a number (`1042`). The view and filters are remembered.
- **A job:** its stage, who has it, value and due date; its fields; **Add an
  update** (a line in its history, like *Parts ordered, back Thursday*);
  private team **notes**; links to the contact and the conversation; and the
  **history** of everything that happened: created, moved, each field
  changed, and who did it.

With [[live chat|Live-Chat]] on, a new job from the chat, the quote
questions or the API notifies the team the way a new message does (see
[[Notifications|Live-Chat#notifications]]), and an open board refreshes
itself.

## From the CLI

```bash
helppuff jobs                                   # open jobs
helppuff jobs list --status all --search drain
helppuff jobs show 1042
helppuff jobs create --name "Ada Lovelace" --email ada@example.com --fields '{"service":"Hot water","address":"Glebe"}'
helppuff jobs move 1042 "Quote sent"
helppuff jobs move 1042 Lost --reason "Went with another quote"
helppuff jobs update 1042 "Booked for Thursday 9am"
helppuff jobs pipeline                          # stages, fields, quote questions
helppuff jobs template projects                 # start again from a template
helppuff jobs setup                             # let the AI choose from the website
```

Every command takes `--json`. See [[the CLI reference|CLI-Reference]].

## Webhooks and the API

`job.created`, `job.updated`, `job.stage_changed`, `job.won` and `job.lost`
are sent to your [[Webhooks]], each with the whole job. Every route the
dashboard uses is in the public API with the `jobs:read` and `jobs:write`
scopes (the pipeline itself needs `settings:write`): see
[[the API reference|API-Reference-Jobs]].
