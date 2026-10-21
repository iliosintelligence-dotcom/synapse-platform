/**
 * Live context: what the buyer's device says they are doing right now, so Tayo is not starting from nothing every message.
 *
 * The page sends a small object with each message (surface, time, language, the homes they last opened and saved). It is
 * UNTRUSTED: anyone can send anything to this endpoint. So nothing in it is taken as text for the model. Each field is reduced to
 * a closed set of values, ids must be uuids, and the homes the ids stand for are read from the database; what Tayo is told
 * about a home comes from there, never from the request.
 */

export interface LiveContext {
  surface: 'app' | 'web';
  /** 0-23 in the buyer's own time zone, worked out from the server clock and their offset, not from a time they claim. */
  localHour: number | null;
  partOfDay: 'morning' | 'afternoon' | 'evening' | 'night' | null;
  language: string | null;
  savedIds: string[];
  recentIds: string[];
  lastHome: { id: string; channel: string | null; minutesAgo: number | null } | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = new Set(['instagram', 'facebook', 'tiktok', 'telegram', 'whatsapp', 'youtube', 'x', 'synapse', 'direct']);

const ids = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && UUID.test(x)).map((x) => x.toLowerCase()))].slice(0, max) : [];

export function partOfDay(hour: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  return hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 21 ? 'evening' : 'night';
}

export function parseLiveContext(raw: unknown, nowMs: number = Date.now()): LiveContext | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const off = Number(r.tzOffsetMin);
  let localHour: number | null = null;
  if (Number.isFinite(off) && off >= -720 && off <= 840) {
    const shifted = new Date(nowMs + off * 60_000);
    localHour = shifted.getUTCHours();
  }

  const lang = typeof r.language === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(r.language.trim()) ? r.language.trim().slice(0, 12) : null;

  let lastHome: LiveContext['lastHome'] = null;
  const lh = r.lastHome as Record<string, unknown> | undefined;
  if (lh && typeof lh === 'object' && typeof lh.id === 'string' && UUID.test(lh.id)) {
    const ch = typeof lh.ch === 'string' ? lh.ch.toLowerCase() : '';
    const age = Number(lh.ageMin);
    lastHome = {
      id: lh.id.toLowerCase(),
      channel: CHANNELS.has(ch) ? ch : null,
      minutesAgo: Number.isFinite(age) && age >= 0 && age <= 60 * 24 * 30 ? Math.round(age) : null,
    };
  }

  return {
    surface: r.surface === 'app' ? 'app' : 'web',
    localHour,
    partOfDay: localHour == null ? null : partOfDay(localHour),
    language: lang,
    savedIds: ids(r.saved, 8),
    recentIds: ids(r.recent, 8),
    lastHome,
  };
}

/** The homes worth looking up, most relevant first, at most five: the last one opened, then recent views, then saves. */
export function contextHomeIds(c: LiveContext, exclude: string | null = null): string[] {
  const order = [c.lastHome?.id, ...c.recentIds.slice(0, 3), ...c.savedIds.slice(0, 3)].filter((x): x is string => !!x);
  return [...new Set(order)].filter((id) => id !== (exclude ?? '').toLowerCase()).slice(0, 5);
}

export interface HomeLine { id: string; title: string; where: string; priceText: string; kind: string; bedrooms: number | null; verified: boolean }

/** What the model is given. Home facts are only ever those read from the database for an id that was a uuid. */
export function liveContextForModel(c: LiveContext, homes: HomeLine[]): Record<string, unknown> {
  const byId = new Map(homes.map((h) => [h.id, h]));
  const line = (id: string) => {
    const h = byId.get(id);
    return h ? { title: h.title, where: h.where, price: h.priceText, kind: h.kind, bedrooms: h.bedrooms, verified: h.verified } : null;
  };
  const last = c.lastHome ? line(c.lastHome.id) : null;
  return {
    surface: c.surface === 'app' ? 'the Synapse app on their phone' : 'the website',
    part_of_day: c.partOfDay,
    language: c.language,
    last_home_opened: last && c.lastHome ? { ...last, came_from: c.lastHome.channel, minutes_ago: c.lastHome.minutesAgo } : null,
    recently_viewed: c.recentIds.map(line).filter(Boolean).slice(0, 3),
    saved: c.savedIds.map(line).filter(Boolean).slice(0, 3),
  };
}

/** True when there is nothing worth telling the model (a first visit on a new browser). */
export function isEmptyContext(m: Record<string, unknown>): boolean {
  return !m.last_home_opened && !(m.recently_viewed as unknown[]).length && !(m.saved as unknown[]).length;
}
