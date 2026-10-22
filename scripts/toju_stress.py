"""
Toju conversation stress test (2026-10-23).

Runs many simulated conversations with the SAME goal (rent a flat in Ibadan) against the live toju-demo function, varying message
order, digressions, corrections, ambiguous answers and changes of mind. Then counts, per turn:
  repeated_question   Toju asked for something the person had already told it (place, budget, bedrooms)
  lost_context        at the end, what Toju remembers differs from what the person last said
  ignored_digression  the person asked a side question and the reply did not address it
  missing_tool        the turn needed a search / comparison / cost calculation and the matching tool was not called
  tool_error          a tool call came back as an error
  caught_invention    the server's grounding check had to send a reply back (a figure no tool returned, or a claimed action)
  error / slow        request failures, and turns over 12 s

Usage:  python scripts/toju_stress.py [conversations=40] [agent|pipeline]
Needs only the public anon key. Each conversation uses a fresh visitor id. Writes scripts/toju_stress_report.json.
"""
import json, random, re, sys, time, urllib.request, uuid
from concurrent.futures import ThreadPoolExecutor

URL = "https://bhrhejpekmhbhwryjhgk.supabase.co/functions/v1/toju-demo"
KEY = "sb_publishable_D25gO3eui5oI4L3h7bx-vg_fCHbo3LV"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 40
MODE = sys.argv[2] if len(sys.argv) > 2 else "agent"

PLACES = ["Bodija", "Akobo", "Eleyele", "Moniya", "Ibadan"]
BUDGETS = [(800_000, "800k"), (1_500_000, "1.5m"), (2_000_000, "2 million naira"), (3_000_000, "3m")]
BEDS = [1, 2, 3]
DIGRESSIONS = [
    ("How do agency fees usually work here?", r"agen|fee|commission"),
    ("What is a C of O?", r"certificate|c of o|occupancy"),
    ("What does caution fee mean?", r"caution|deposit|refund"),
    ("Is it better to rent or buy right now?", r"rent|buy"),
    ("How long does it take to move in after paying?", r"move|day|week|time|depend"),
]
AMBIGUOUS = ["somewhere calm, not too noisy", "not too expensive please", "something decent, nothing fancy"]


def call(vid, msgs, extra=None):
    body = {"visitorId": vid, "messages": msgs, "debug": True}
    if MODE == "agent":
        body["agent"] = True
    if extra:
        body.update(extra)
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "apikey": KEY, "Authorization": "Bearer " + KEY})
    t = time.time()
    try:
        d = json.load(urllib.request.urlopen(req, timeout=60))
    except Exception as e:  # network, 5xx, timeout
        return {"error": str(e)[:200]}, time.time() - t
    return d, time.time() - t


def plan(seed):
    """One conversation: the facts the person ends with, and the messages that get them there, in a shuffled order."""
    r = random.Random(seed)
    place, (budget, btext), beds = r.choice(PLACES), r.choice(BUDGETS), r.choice(BEDS)
    steps = []
    style = r.choice(["all_at_once", "drip", "drip"])
    # every step carries the values it sets, so the expected memory is whatever was said LAST, in the order the steps run
    if style == "all_at_once":
        steps.append(("facts", f"I want to rent a {beds} bedroom flat in {place}, budget about {btext} a year", {"place": place, "budget": budget, "beds": beds}))
    else:
        facts = [("facts", f"I'm looking to rent in {place}", {"place": place}), ("facts", f"my budget is {btext} a year", {"budget": budget}), ("facts", f"{beds} bedrooms", {"beds": beds})]
        r.shuffle(facts)
        steps += facts
    events = []
    if r.random() < 0.8:
        events.append(("digression",) + r.choice(DIGRESSIONS))
    if r.random() < 0.6:
        new_place = r.choice([p for p in PLACES if p != place])
        events.append(("correction", f"Actually, make it {new_place} instead", "place", new_place))
    if r.random() < 0.5:
        nb, nbt = r.choice([b for b in BUDGETS if b[0] != budget])
        events.append(("correction", f"Sorry, I meant my budget is {nbt}", "budget", nb))
    if r.random() < 0.35:
        events.append(("ambiguous", r.choice(AMBIGUOUS)))
    if r.random() < 0.4:
        events.append(("cost", "What would the first one cost me up front?"))
    if r.random() < 0.35:
        events.append(("compare", "Can you compare the options you showed me?"))
    for e in events:
        steps.insert(r.randint(1, len(steps)), e)
    if r.random() < 0.5:
        steps.append(("back", "OK, back to my search. What do you have?"))
    return {"place": place, "budget": budget, "beds": beds, "steps": steps}


# Only real requests for a fact, not offers ("shall we look at a nearby area?") or checks ("would you raise the budget?").
ASKS = {
    "place": r"(which|what) (area|part of|neighbou?rhood|location|city)[^.?!]*(are you|do you|would you like|you('re| are) (looking|thinking))[^.?!]*\?|where (are|would) you (like|want|looking|thinking)[^.?!]*\?",
    "budget": r"(what('s| is) your budget|how much (do|can|would|are) you[^.?!]*(spend|pay|afford|budget)|what can you (spend|afford)|what('s| is) your price range)[^.?!]*\?",
    "beds": r"how many (bed|room)s?[^.?!]*\?",
}
FACT_OF = {"place": "place", "budget": "budget", "beds": "beds"}


def run(i):
    p = plan(1000 + i)
    vid = str(uuid.uuid4())
    msgs, known, cards_seen = [], set(), 0
    final = {}
    turns = []
    for kind, *rest in p["steps"]:
        text = rest[0]
        msgs.append({"role": "user", "content": text})
        d, secs = call(vid, msgs)
        reply = d.get("reply") or ""
        tools = [t.get("tool") for t in d.get("agentTrace", []) if t.get("kind") == "tool"]
        t = {"kind": kind, "you": text, "toju": reply[:400], "secs": round(secs, 1), "tools": tools, "cards": len(d.get("matches") or []), "flags": []}
        if d.get("error"):
            t["flags"].append("error")
        if secs > 12:
            t["flags"].append("slow")
        for slot, rx in ASKS.items():
            if slot in known and re.search(rx, reply, re.I):
                t["flags"].append("repeated_question:" + slot)
        if kind == "digression" and not re.search(rest[1], reply, re.I):
            t["flags"].append("ignored_digression")
        if MODE == "agent":
            # a change to the search, or "back to my search", needs a fresh search
            if kind in ("correction", "back") and "search_properties" not in tools:
                t["flags"].append("missing_tool:search")
            if kind == "cost" and cards_seen and "calculate_affordability" not in tools:
                t["flags"].append("missing_tool:affordability")
            if kind == "compare" and cards_seen >= 2 and "compare_properties" not in tools:
                t["flags"].append("missing_tool:compare")
            if any(x.get("kind") == "tool" and x.get("ok") is False for x in d.get("agentTrace", [])):
                t["flags"].append("tool_error")
            if any(x.get("kind") == "repair" for x in d.get("agentTrace", [])):
                t["flags"].append("caught_invention")
        if MODE == "agent" and any(x.get("kind") == "error" for x in d.get("agentTrace", [])):
            t["flags"].append("model_unavailable")
            t["model_error"] = next(x.get("detail") for x in d.get("agentTrace", []) if x.get("kind") == "error")
        if kind == "facts":
            known |= set(rest[1])
            final.update(rest[1])
        if kind == "correction":
            known.add(rest[1])
            final[rest[1]] = rest[2]
        cards_seen += t["cards"]
        msgs.append({"role": "assistant", "content": reply})
        turns.append(t)
    mem, _ = call(vid, msgs, {"action": "memory"})
    facts = {f["key"]: f["value"] for f in mem.get("facts", [])}
    lost = []
    if "place" in final and final["place"].lower() not in str(facts.get("place", "")).lower():
        lost.append(f"place: wanted {final['place']}, remembered {facts.get('place')}")
    if "budget" in final:
        want_b = f"{final['budget']:,}"
        if want_b not in str(facts.get("maxPrice", "")) and want_b not in str(facts.get("minPrice", "")):
            lost.append(f"budget: wanted {want_b}, remembered {facts.get('maxPrice')}")
    if "beds" in final and str(final["beds"]) not in str(facts.get("minBedrooms", "")):
        lost.append(f"beds: wanted {final['beds']}, remembered {facts.get('minBedrooms')}")
    # a turn that failed for want of a model cannot be blamed on memory: note it so the report can separate the two
    failed_turns = sum(1 for t in turns if "model_unavailable" in t["flags"])
    return {"conversation": i, "visitor": vid, "final_wanted": final, "remembered": facts, "lost_context": lost, "model_failed_turns": failed_turns, "turns": turns}


def main():
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=2) as ex:
        convs = list(ex.map(run, range(N)))
    turns = [t for c in convs for t in c["turns"]]
    count = lambda prefix: sum(1 for t in turns for f in t["flags"] if f.startswith(prefix))
    summary = {
        "mode": MODE, "conversations": N, "turns": len(turns), "minutes": round((time.time() - t0) / 60, 1),
        "repeated_question": count("repeated_question"), "ignored_digression": count("ignored_digression"),
        "missing_tool": count("missing_tool"), "tool_error": count("tool_error"), "caught_invention": count("caught_invention"),
        "error": count("error"), "slow_over_12s": count("slow"),
        "conversations_with_lost_context": sum(1 for c in convs if c["lost_context"]),
        "lost_context_without_model_failure": sum(1 for c in convs if c["lost_context"] and not c["model_failed_turns"]),
        "model_unavailable_turns": count("model_unavailable"),
        "median_secs": sorted(t["secs"] for t in turns)[len(turns) // 2] if turns else None,
        "digressions": sum(1 for t in turns if t["kind"] == "digression"), "corrections": sum(1 for t in turns if t["kind"] == "correction"),
    }
    out = sys.argv[3] if len(sys.argv) > 3 else "scripts/toju_stress_report.json"
    json.dump({"summary": summary, "conversations": convs}, open(out, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
