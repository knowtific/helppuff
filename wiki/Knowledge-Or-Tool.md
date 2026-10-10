# Knowledge base or tool?

The assistant can know things in four ways. Choosing the wrong one is the
most common reason an answer is out of date, or slow, or wrong.

| Put it in… | When the information | Examples |
| --- | --- | --- |
| **The website** (learned automatically) | Is already on your site and changes at the speed of the site | Services, process, policies, FAQs, product descriptions |
| **Your own answers / files** (Knowledge) | Is not on the site, or must be said exactly | A price list PDF, the warranty terms, holiday hours |
| **The prompt** | Is a rule about *how* to answer, or corrects the website | "Always say + GST", "the free audit is no longer a video", what is quote-only |
| **A tool** | Changes by the hour, or is about *this* visitor | Order status, stock, availability, their account, their plan |

## Questions to ask

**Does it change faster than you re-learn the site?** The site is re-learned
weekly (or when you ask). Stock, prices with sales, delivery status and
availability change faster: use a tool.

**Is it about this one visitor?** Their order, their invoices, their
booking: a tool, and for anything private, with
[[signed-in visitors|Signed-In-Visitors]] or a check your API makes.

**Is it a rule, not a fact?** "Never quote prices for custom work", "offer a
callback after two questions": the prompt. Facts in the prompt go stale;
rules don't.

**Is the website wrong?** Fix the page if you can. If not (or not yet), say
so in the prompt: the prompt wins over the website.

## Mixing them

Most good setups use all four. A shop's assistant, for example:

- **Website:** what each product is, sizing guides, the returns policy.
- **Your own answers:** "Click & collect orders are held for 7 days."
- **Prompt:** "Say prices are right now; never hold stock."
- **Tools:** product search with live prices, stock by store, order
  tracking.

## Signs you chose wrong

| You see | Probably |
| --- | --- |
| Old prices or "in stock" for sold-out items | Live data in the knowledge base: move it to a tool |
| "Let me check" for a question every visitor asks | A tool for something stable: put it in the knowledge base or the prompt |
| The assistant contradicts your site | The site is out of date: fix the page, or correct it in the prompt |
| It answers about one customer from another's details | Private data without verification: use signed-in visitors |

See: [[Knowledge base|Knowledge-Base]], [[Prompt and instructions|Prompts-and-Instructions]],
[[Tools]], [[Tutorials]].
