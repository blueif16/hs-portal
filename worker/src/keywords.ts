// Keyword upkeep, pure. Heat follows 千瓜's 热度指数 idea (weighted interaction summed over the keyword's
// notes), measured on the 一周内 · 最多点赞 page, so it reads as "how much this keyword moved this week".
// The list keeps the top `cap` on-niche keywords by heat; anything below the cut twice in a row is retired.
import { engagement } from "./score.ts";

type C = { likes: number | null; collects: number | null; comments: number | null };
export type KeywordRun = { keyword: string; status: "active" | "candidate"; heat: number; onShare: number | null; prevBelow: boolean };
export type KeywordPlan = { keyword: string; inCut: boolean; to: "active" | "retired" | null; reason: string | null };

export function keywordHeat(page: C[]): number {
  return page.reduce((sum, n) => sum + engagement(n), 0);
}

export function planKeywords(runs: KeywordRun[], cap: number, minOnShare = 0.6): KeywordPlan[] {
  const eligible = runs.filter((r) => r.onShare !== null && r.onShare >= minOnShare && r.heat > 0);
  const rank = new Map([...eligible].sort((a, b) => b.heat - a.heat).map((r, i) => [r.keyword, i + 1]));
  return runs.map((r) => {
    const place = rank.get(r.keyword);
    const inCut = place !== undefined && place <= cap;
    const facts = `本周热度 ${Math.round(r.heat)}，本领域占比 ${Math.round((r.onShare ?? 0) * 100)}%`;
    if (inCut && r.status === "candidate")
      return { keyword: r.keyword, inCut, to: "active", reason: `${facts}，排第 ${place}，进入前 ${cap}` };
    if (!inCut && r.prevBelow)
      return { keyword: r.keyword, inCut, to: "retired", reason: `${facts}，连续两次未进前 ${cap}（本领域占比需 ≥${minOnShare * 100}%）` };
    return { keyword: r.keyword, inCut, to: null, reason: null };
  });
}
