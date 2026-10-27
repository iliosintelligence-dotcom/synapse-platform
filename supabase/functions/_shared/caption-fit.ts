/* CAPTIONS THAT FIT (Eden, 2026-10-27: "sometimes it overshoots the captions for social media platforms ... make sure it
   doesn't happen"). The writers were told a length in the prompt for X and Telegram only, and nothing checked what came
   back, so a long caption reached the publisher and was cut there mid-sentence (Telegram at 1024, X at 280).

   Each platform has a TARGET, the length the writer is asked for and held to, and the platform's own HARD limit. The
   target sits under the hard limit to leave room for what the publisher adds (the link, the "View this home" button
   text, hashtags). A caption over its target gets one rewrite asking for less; if that is still over, it is cut at the
   last whole sentence or line that fits, never mid-word. */

export const CAPTION_LIMITS: Record<string, { target: number; hard: number }> = {
  x: { target: 240, hard: 280 },            // the link is added after; X counts it as 23
  telegram: { target: 850, hard: 1024 },    // a photo caption is refused over 1024, and the link goes in too
  whatsapp: { target: 650, hard: 700 },     // a Status text
  threads: { target: 450, hard: 500 },
  instagram: { target: 2000, hard: 2200 },  // hashtags are appended after
  tiktok: { target: 2000, hard: 2200 },
  linkedin: { target: 2800, hard: 3000 },
  facebook: { target: 3000, hard: 63206 },  // no real cap; past this nobody reads the spec sheet
  youtube: { target: 4500, hard: 5000 },
};

export function captionTarget(platform: string): number | null {
  return CAPTION_LIMITS[platform.toLowerCase()]?.target ?? null;
}

/** The prompt line that tells a writer its length. */
export function lengthRule(platform: string): string {
  const t = captionTarget(platform);
  return t ? `Length: under ${t} characters including spaces and emoji. A hard limit: a longer caption is cut off by the platform.` : '';
}

/** Cut to the last whole sentence or line within max; failing that, the last whole word with an ellipsis. */
export function fitAtSentence(text: string, max: number): string {
  const t = (text ?? '').trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  let end = -1;
  for (const m of head.matchAll(/[.!?](?=\s|$)|\n/g)) end = (m.index ?? 0) + (m[0] === '\n' ? 0 : 1);
  if (end >= max * 0.6) return head.slice(0, end).trim();
  const words = t.slice(0, max - 1).replace(/\s+\S*$/, '').trim();
  return words + '…';
}

/**
 * Hold a caption to its platform's target: if it is over, ask `rewrite` once for a shorter one, then cut at a sentence
 * if it is still over. `rewrite` gets the caption and the limit and returns the new text, or null when it failed.
 */
export async function keepWithin(
  platform: string,
  text: string,
  rewrite: (caption: string, max: number) => Promise<string | null>,
): Promise<string> {
  const max = captionTarget(platform);
  const t = (text ?? '').trim();
  if (!max || t.length <= max) return t;
  let shorter: string | null = null;
  try { shorter = (await rewrite(t, max))?.trim() || null; } catch { shorter = null; }
  const best = shorter && shorter.length < t.length ? shorter : t;
  return fitAtSentence(best, max);
}

/** The instruction that asks for the shorter version. */
export function shortenAsk(platform: string, caption: string, max: number): string {
  return `This ${platform} caption is ${caption.length} characters. The limit is ${max}. `
    + `Rewrite it under ${Math.round(max * 0.9)} characters. Keep the opening line, the price, the charges and the next step; `
    + `cut the least important lines first. Same facts, nothing new.`;
}
