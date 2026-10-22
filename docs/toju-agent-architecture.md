# Toju: from a scripted pipeline to a reasoning agent

October 2026. This covers what was wrong, what replaced it, how to turn it on, and how it was tested.

## 1. The audit: how a message moved through Toju before

Everything lives in one edge function, `supabase/functions/toju-demo/index.ts` (about 2,100 lines), with pure helpers in `facts.ts`. The page (`web/src/legacy/toju/inline-5.js`) posts the whole conversation, a `visitorId` and some live context. For a chat message, the function then did six things in a fixed order:

1. **Understand.** One model call (`understand()`, `UNDERSTAND_PROMPT`) turns the latest message into a JSON "brief" (place, deal, budget, bedrooms...) and "profile" (household, work, timeline...). It also returns one `intent` label out of six.
2. **Remember.** Code merges that into the saved brief and profile (`mergeBrief`, `mergeProfile` in `facts.ts`). A new value simply replaces the old one. Nothing records whether the person said it or the model guessed it.
3. **Look.** If a place is known, code always searches (`buildEvidence`, `fetchMatches`) and builds an "evidence" object.
4. **Choose the next question.** `nextAsk()` in `facts.ts` walks a fixed list: place, then purpose, then budget, then timeline, then household, and so on, picking the first slot that is empty. Each slot is asked up to twice (`profile.asked`).
5. **Say.** A second model call writes the reply under `RESPOND_PROMPT`, which says *"ask exactly ONE question: the one in 'ask'"*.
6. **Check.** `checkReply()` and inline rules send the reply back if it is missing the question (*"The reply must end with the one question to ask next"*), asks more than one, or is too long. After two failures, `plainReply()` writes a templated sentence ending in the slot's stock question.

### Why it felt like a form

| Cause | Where | Effect |
|---|---|---|
| Code picks the next question every turn | `facts.ts` `nextAsk` | The conversation follows the slot order whatever the person says |
| The reply must contain that question | `RESPOND_PROMPT` rule 2, check in `index.ts` ("must end with the one question") | Even a side question gets the next checklist question bolted on |
| The fallback is a template with the stock question | `facts.ts` `plainReply`, `plainQuestion` | When the model fails the check, the person gets a form line |
| One intent label per message | `UNDERSTAND_PROMPT` intent | A message with a question, a correction and a request is reduced to one |
| Search is tied to "a place is known" | `canSearch` in `index.ts` | No search without a place; a search every turn once there is one |
| Two separate model calls | understand, then respond | The writer sees code's reading of the message, not just the message |
| Memory without provenance | `mergeBrief`, `mergeProfile` | A model guess and a stated fact look the same; corrections lose history |
| Recent additions made it stricter | `discoveryDone`, the land and investment slots added this week | More script, not less |

### What was worth keeping

- **Grounding.** The insistence that every price and count comes from the database, and the check that catches invented amounts (`amountsIn`, `checkReply`). The agent keeps this in a new form.
- **The search itself.** `fetchMatches` (place and anchor resolution, budget, kind, verification, photos) and `loadPinned` (one listing's full facts). The agent calls them through its tools; nothing was duplicated.
- **The negotiation flow** for a pinned listing (the agency's price floor, decided by code). It stays on the old path, because a price floor must not be left to a model.
- **Session storage** in `demo_chat_sessions`. The agent writes to the same row.
- **The advisor playbook** (`playbook.ts`), which is principles rather than a script. The agent's prompt includes it.

## 2. What replaced it

New code is in `supabase/functions/toju-demo/agent/`. The model decides each step; code only enforces what code must.

```
message -> context (what is known, search state, recent turns, older turns condensed)
        -> model: reply, or call tools
        -> tools run (validated, against Synapse's real data) -> results back to the model
        -> repeat, within limits
        -> final reply checked for unsupported figures and claimed actions -> saved -> sent
```

- **`loop.ts`, the bounded loop.** Up to 5 model steps, 8 tool calls, 22 seconds, one retry for malformed output, one repair round for a reply that fails the checks. When a limit is hit it answers honestly from what it found. It never makes up a result.
- **`tools.ts`, the tools.**
  - `search_properties`: partial searches are fine; whatever is left out falls back to what is known.
  - `get_property`
  - `compare_properties`: the facts side by side and the real differences.
  - `calculate_affordability`: code does the arithmetic. Fees a listing does not state come back as unknown.
  - `update_preferences`
  - `reject_property`
  - `request_agent_contact` and `confirm_agent_contact`: a confirmation is only accepted in a later turn than the request, and nothing is sent without one.

  Every tool validates its arguments and handles empty results honestly. A card can only be shown for a listing a tool returned in that turn.
- **`memory.ts`, the memory.**
  - *Conversation:* the last 10 messages go in full, and older messages are condensed into a sentence of the person's own words.
  - *Preferences:* each one records its value, whether it was said or inferred, a confidence, whether it is a hard requirement, whether it is for this search or lasting, when it was set, and what it replaced. A guess never replaces something the person said. Saying it yourself turns a guess into a fact. "Not Lekki" becomes an exclusion. Weak guesses are remembered but not used as search filters.
  - *Task state:* the last search, homes shown, homes rejected and why, a pending action, and whether the person is exploring, comparing or ready to view.
  - *Safety net:* if the model searched with something the person literally said this turn but forgot to record it, it is recorded as said.
- **`prompt.ts`, the instructions.** Identity, how to decide, truthfulness, the person's autonomy, style, and safety against instructions hidden in listing text. There is no question order and no list of fields.
- **`affordability.ts`.** Deterministic cost breakdown. A service charge whose period the listing does not state is excluded from totals and said to be excluded.

### Compatibility

The agent saves its state under `criteria._v3`. It also writes the older `brief` and `profile` shape under `criteria._v2`, so Your matches and What Tayo remembers keep working. Contact details are never touched. Older sessions are read into the new shape (`fromLegacy`) on their first agent turn.

## 3. Switching it on

The agent is **off** by default. The live Tayo is unchanged until one of these is true:

- the page sends `agent: true` with the message (one person, one browser), or
- the function secret `TOJU_AGENT` is set to `on` (everyone). A request can still opt out with `agent: false`.

A conversation about one pinned listing (Discuss, negotiation) always stays on the old path.

## 4. Testing

- `deno test --allow-all supabase/functions/toju-demo/` runs 57 tests, 21 of them for the agent with a scripted stand-in model. They cover: a multi-intent message handled in one turn; general questions with no forced question; known facts passed to the model; corrections keeping history; a guess not overriding a statement; exclusions; cards only for returned listings; invented amounts sent back and stripped; claimed actions without a tool; confirmation in a later turn; unknown tools and bad arguments; step and time limits; malformed output; instructions hidden in a listing; affordability arithmetic; old sessions read and written; and the memory safety net.
- `scripts/toju_stress.py` runs many simulated conversations against the live function with one goal (rent a flat in Ibadan). It varies the order facts are given, and adds side questions, corrections, vague answers, cost and comparison requests, and "back to my search". It reports repeated questions, lost context (what Toju remembers at the end against what the person said last), ignored side questions, missing tool calls, tool errors, caught inventions, model outages and latency. The latest results are in section 5.

## 5. Results and what is still open

Stress test, 2026-10-23: 40 conversations, 219 turns, against the live function with `agent: true`, two at a time.

| Measure | Result |
|---|---|
| Turns that failed because no model was available | **92 of 219** (Cerebras "requests per minute limit exceeded", then Gemini over quota) |
| Of the 127 turns where the model answered: | |
| repeated a question already answered | **0** |
| ignored a side question | **0** |
| a change or "back to my search" without a fresh search | 6 (four asked a clarifying question first; one answered the previous side question again) |
| tool errors | 1 |
| replies sent back for an unsupported figure | 4 (caught before the person saw them) |
| conversations that ended remembering the wrong thing, with no model failure | 2 of 40 |
| median reply time | 3.3 s (7 turns over 12 s) |

The architecture behaves as intended when the model is reachable. The blocking problem is capacity: the free tiers of the fast hosts cannot carry even two conversations at once, and the Gemini fallback is out of quota.

Known limits:

- **Model capacity.** When the fast host (Groq or Cerebras) fails, the fallback is Gemini, whose quota was exhausted during testing. Turns then fail honestly. The fix is capacity (a paid tier on one host), not code.
- **Bad listing data.** One live 2-bed in Eleyele is priced at ₦50,000,000 a year. Every search in Ibadan reports that as the going rent. That listing should be corrected.
- **Agent contact.** `confirm_agent_contact` has no live sender yet. It tells the person to use "Introduce me", which creates the lead with their signed-in details. Wiring it to `create-lead` needs the person's session token passed through.
- **No live travel times or safety data.** The agent is told not to claim them.
