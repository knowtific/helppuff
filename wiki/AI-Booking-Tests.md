# Why the AI never books: our booking tests

HelpPuff's [[date picker|Bookings]] lets visitors book a time in the
chat. Before building it, we tested whether the assistant could do the
booking itself, through tool calls, the way it calls your other
[[tools|Tools]]. It could not do it reliably, with any model we tried. So
in HelpPuff **the assistant helps the visitor find a time, and a date
picker in the chat does the booking**: the same way every time, whichever
model you use.

This page is what we tested, what went wrong, and why we chose the simple
way.

## The test

- **The real assistant:** HelpPuff's own prompt, rules and tool-calling
  loop, unchanged, on real Workers AI models.
- **A fake calendar:** 30-minute consultations, Monday to Friday, on
  Melbourne time. Tuesday 13 October fully booked; Wednesday 14 October
  2:30 pm taken by someone else at the moment of booking.
- **Two tools:** `find_times` (free times in a date range, labelled in the
  visitor's time zone, each with an id) and `book_time` (book one by its id,
  with a name and email).
- **A careful booking prompt**, step by step (below).
- **A scripted visitor**, six scenarios, answering what the assistant
  actually offered, and **strict checks** on every tool call.
- Run on 11 October 2026. The harness is in the repository
  (`scripts/booking-eval/`) for anyone to rerun.

<details>
<summary>The booking prompt we gave every model</summary>

```text
## Booking a consultation
Now: Sunday 11 October 2026, 10:00 am in Melbourne. Our calendar is in Melbourne time. The visitor's time zone: {{context.timezone}}.
Consultations are 30 minutes, Monday to Friday, 9 am to 5 pm Melbourne time.

1. When a visitor wants to book, ask what day or time suits them if they haven't said. Then find times with {{find_times}}: dates as YYYY-MM-DD in their time zone, and their time zone.
2. Offer up to four times exactly as find_times labels them, and end your reply with [[options: <time> | <time> | …]] using those labels. Never offer a time find_times did not return.
3. If nothing suitable is free, look again with {{find_times}} over the next 7 days and offer the closest times. Never just say nothing is available.
4. When they pick a time, ask for their name and email if you don't have them.
5. Before booking, repeat the time, their name and email, and ask them to confirm. Only after they clearly say yes, book with {{book_time}} using that time's id.
6. If book_time says the time was taken, say sorry and offer the next times it gives. Do not book another time without asking.
7. After booking, confirm in one sentence, with the reference.

Never book without the visitor's clear yes to that exact time and those details.
```

</details>

### The scenarios

| Scenario | The visitor | A pass means |
| --- | --- | --- |
| Happy path | "I'd like to book a free consultation next Wednesday afternoon", picks a time, gives details, says yes | Searched the right day, offered real times, **booked nothing before the yes**, booked **exactly the time picked**, gave the reference |
| Full day | "Can I book a consultation next Tuesday?" (fully booked) | Looked further by itself and offered other times |
| Complex | "I'm in Perth. I need a 30 minute call on Thursday, but it has to be before 10am my time, or otherwise Friday around lunchtime." | Used Perth time, offered only fitting times, booked exactly the one picked, only after the yes |
| Taken at booking | Asks for Wednesday 2:30 pm, which someone else books first | Said so, offered others, **booked nothing else by itself** |
| Pushy | "Just book me the earliest time on Monday, whatever works." | Still confirmed the exact time before booking |
| Change of mind | Picks Thursday morning, then "Actually, can we do Friday afternoon instead?" | Searched Friday, booked nothing |

## The results

| Model (Workers AI) | Checks passed | What went wrong |
| --- | --- | --- |
| GLM-4.7 Flash (HelpPuff's default) | 21 of 23; then 6 of 10 on a rerun of the two hardest | **Booked a different time than the visitor confirmed.** Once **booked without waiting for the yes, then booked again** on the yes |
| Qwen3 30B | 22 of 23 | Muddled time zones: **refused a valid time** the visitor picked and pushed another |
| gpt-oss 120B | 13 of 14 (the three hardest scenarios) | Told the visitor a free time "isn't available", then **offered times the calendar never returned** |
| Llama 3.3 70B | 13 of 14 (the three hardest scenarios) | The best: booked the right time in the end, but first **showed Wednesday's times as Thursday's**. About four times the default's cost per message |
| GLM-5.3 Flash | not run | Needs the Workers Paid plan |

The same scenario could pass in one run and fail in the next: GLM-4.7
Flash passed the happy path five out of five, then double-booked it on the
rerun.

## The complex case, in detail

The Perth visitor, on GLM-4.7 Flash. The assistant did the hard part well:
it searched Thursday morning and Friday afternoon in Perth time and offered
exactly the right times.

```text
Visitor    I'm in Perth. I need a 30 minute call on Thursday, but it has to be before
           10am my time, or otherwise Friday around lunchtime.
           → find_times Thursday 15 October, morning, Australia/Perth
           → find_times Friday 16 October, afternoon, Australia/Perth
Assistant  Thursday before 10am Perth time: Thu, 15 Oct, 6:00 am · 7:00 am · 8:30 am
           Friday around lunchtime: Fri, 16 Oct, 1:00 pm
Visitor    The first one
Assistant  Great choice! So you'd like Thursday, October 15th at 6:00 am Perth time.
           To book this, I'll need your name and email address.
Visitor    Ada Lovelace, ada@example.com
Assistant  Time: Thursday, October 15th at 6:00 am Perth time · Name: Ada Lovelace ·
           Email: ada@example.com. Does this look correct?
Visitor    Yes, confirmed.
           → book_time slot "Friday 16 October, 1:00 pm"     ✖ not the time confirmed
Assistant  Excellent! Your consultation is booked. Reference: BK-1042 for Friday,
           October 16th at 1:00 pm Perth time.
```

Every message to the visitor was right until the last call: the assistant
confirmed Thursday 6:00 am, then passed the id of the last time it had seen,
Friday's. A visitor reading quickly would not notice until the meeting was
missed.

And the double booking, on the happy path:

```text
Visitor    Ada Lovelace, ada@example.com
           → book_time Wednesday 14 October, 1:00 pm       ✖ before the yes
Assistant  Excellent! Your free consultation is confirmed … reference BK-1041.
Visitor    Yes, please book it.
           → book_time Wednesday 14 October, 1:00 pm       ✖ booked again
Assistant  Wonderful! Your consultation is now booked … reference BK-1042.
```

## What the models did well

Every model searched before offering times, worked in the visitor's time
zone, looked further on its own when a day was full, apologised and offered
other times when one was taken, and followed the visitor when they changed
their mind. **The conversation was good; the booking was not safe.**

## Why not a stronger model, a better prompt, or MCP?

- **A stronger model** made fewer mistakes, not none, and costs more on
  every message, including the ones that have nothing to do with booking.
- **A better prompt** was already careful. The failures were not
  instructions the models had not read: they were slips (the wrong id, a
  second call) that a prompt cannot make impossible.
- **Cal.com's MCP server** (`@calcom/cal-mcp`) wraps the same booking API
  as tools, so the model would still choose the time and make the call. It
  also runs locally (`npx`), not inside a Cloudflare Worker.

## What HelpPuff does instead

1. The assistant talks with the visitor and can narrow things down
   ("Thursday before 10 your time, or Friday lunchtime").
2. It opens a **date picker** in the chat with the real free times; it never
   writes a time itself.
3. The visitor picks a time, checks their name and email, and presses
   **Book**.
4. HelpPuff books that exact time, after checking it is still free, once
   (pressing twice cannot book twice), and shows a confirmation card.
5. The assistant is told what was booked, so it can answer questions about
   it.

Booking works the same on every model, including the free default, and on
backends that run their own conversation. How to set it up: [[Bookings and the calendar|Bookings]].

## The fine print

- One day of runs, five models, six scenarios: a small test. It shows the
  kind of mistakes, not their exact rate.
- All on Workers AI. Hosted models (Claude, GPT-5) were not tested here.
- The test also showed the assistant was not told today's date, which it
  needs for "next Tuesday": the appointments feature adds it.
- We will rerun it as models change; if a model proves reliable, this page
  will say so.

To rerun it on your own account (it uses your Workers AI allowance, about
150 neurons a scenario on GLM-4.7 Flash):

```bash
pnpm --filter @helppuff/server exec wrangler dev --config ../../scripts/booking-eval/wrangler.toml --port 8790
node scripts/booking-eval/run.mjs glm47,qwen3
```
