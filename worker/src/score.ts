// Pure scoring for the discovery pipeline. Collects and comments count more than likes
// (on XHS a save is the strongest "this is useful" signal).

type C = { likes: number | null; collects: number | null; comments: number | null };
type Snap = C & { at: number }; // at = epoch ms

const DAY = 24 * 3600_000;

export function engagement(c: C): number {
  return (c.likes || 0) + 1.5 * (c.collects || 0) + 2 * (c.comments || 0);
}

// Engagement gained per 24h since the previous snapshot; null on first sighting.
export function growthPerDay(now: Snap, prev: Snap | undefined): number | null {
  if (!prev || now.at <= prev.at) return null;
  return (engagement(now) - engagement(prev)) / ((now.at - prev.at) / DAY);
}

// Momentum dominates size: log-scaled so a rising small note can beat a stalled big one.
export function scoreNote(c: C, growth: number | null): number {
  const size = Math.log10(1 + engagement(c));
  const momentum = Math.log10(1 + Math.max(growth ?? 0, 0));
  const saveRatio = Math.min((c.collects || 0) / Math.max(c.likes || 0, 1), 2);
  return size + 2 * momentum + saveRatio;
}

export function pickDetailCandidates<T extends { niche: string | null; score: number; detailFresh: boolean }>(
  notes: T[],
  k: number,
): T[] {
  return notes
    .filter((n) => n.niche === "on" && !n.detailFresh)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// A card survives only if it cites ≥1 note and every cited note is one we actually stored.
export function keepCitedCards<T extends { evidence_note_ids: string[] }>(cards: T[], known: Set<string>): T[] {
  return cards.filter((c) => c.evidence_note_ids.length > 0 && c.evidence_note_ids.every((id) => known.has(id)));
}
