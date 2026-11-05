// Pre-publish gate for drafts (same limits the old Content Studio enforced): title 8–20 chars,
// body 80–1000 chars, ≥3 topics, no 引流 bait. Lengths count code points, so emoji = 1.

const BAIT = /私信我|加[vV微]|vx|微信|wx号|二维码|主页领取|评论区扣/i;
const len = (s: string) => [...(s || "")].length;

export function draftProblems(d: { title: string; body: string; topics: string[] }): string[] {
  const p: string[] = [];
  if (len(d.title) < 8 || len(d.title) > 20) p.push(`title is ${len(d.title)} chars (need 8–20)`);
  if (len(d.body) < 80 || len(d.body) > 1000) p.push(`body is ${len(d.body)} chars (need 80–1000)`);
  if ((d.topics || []).length < 3) p.push(`topics has ${(d.topics || []).length} (need ≥3)`);
  if (BAIT.test(`${d.title}\n${d.body}`)) p.push("contains 引流/contact bait (e.g. 私信我/加V)");
  return p;
}
