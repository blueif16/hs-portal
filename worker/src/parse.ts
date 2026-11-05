// Parsers for xiaohongshu-mcp tool responses (shapes verified against live output, see test/fixtures).

export type Counts = { likes: number | null; collects: number | null; comments: number | null; shares: number | null };

export type SearchRow = Counts & {
  noteId: string;
  xsecToken: string | null;
  title: string | null;
  noteType: string | null;
  authorId: string | null;
  authorName: string | null;
  rank: number;
};

export type FeedDetail = {
  noteId: string;
  title: string | null;
  description: string;
  imageCount: number;
  tags: string[];
  publishedAt: string | null;
  counts: Counts;
  comments: { commentId: string; content: string; likes: number | null }[];
};

// "1168" | "1.2万" | "10万+" | "3.4亿" | 42 → number; "" / unreadable → null.
export function parseCount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = v.trim().replace(/\+$/, "").match(/^(\d+(?:\.\d+)?)(万|亿)?$/);
  if (!m) return null;
  const unit = m[2] === "万" ? 1e4 : m[2] === "亿" ? 1e8 : 1;
  return Math.round(parseFloat(m[1]) * unit);
}

// Topics are inlined in the description as "#名称[话题]#".
export function extractTopics(desc: string): string[] {
  return [...(desc || "").matchAll(/#([^#\[\]\n]+)\[话题\]#/g)].map((m) => m[1].trim());
}

function countsOf(info: any): Counts {
  return {
    likes: parseCount(info?.likedCount),
    collects: parseCount(info?.collectedCount),
    comments: parseCount(info?.commentCount),
    shares: parseCount(info?.sharedCount),
  };
}

export function parseSearchFeeds(json: any): SearchRow[] {
  const feeds: any[] = Array.isArray(json?.feeds) ? json.feeds : [];
  const rows: SearchRow[] = [];
  for (const f of feeds) {
    if (f?.modelType !== "note" || !f?.id) continue;
    const nc = f.noteCard || {};
    rows.push({
      noteId: f.id,
      xsecToken: f.xsecToken || null,
      title: nc.displayTitle || null,
      noteType: nc.type || null,
      authorId: nc.user?.userId || null,
      authorName: nc.user?.nickname || nc.user?.nickName || null,
      ...countsOf(nc.interactInfo),
      rank: rows.length + 1,
    });
  }
  return rows;
}

export function parseFeedDetail(json: any): FeedDetail {
  const data = json?.data || json || {};
  const note = data.note || {};
  const description: string = note.desc || "";
  const list: any[] = Array.isArray(data.comments?.list) ? data.comments.list : [];
  return {
    noteId: note.noteId || json?.feed_id,
    title: note.title || null,
    description,
    imageCount: Array.isArray(note.imageList) ? note.imageList.length : 0,
    tags: extractTopics(description),
    publishedAt: typeof note.time === "number" ? new Date(note.time).toISOString() : null,
    counts: countsOf(note.interactInfo),
    comments: list
      .filter((c) => c?.id && c?.content)
      .map((c) => ({ commentId: c.id, content: c.content, likes: parseCount(c.likeCount) })),
  };
}

// XHS note ids are MongoDB-style ObjectIds: the first 8 hex digits are the creation time in epoch seconds.
// Checked against detail-page publish times on 8 real notes (2026-11-05): exact or within hours.
export function noteIdTime(noteId: string): number | null {
  if (!/^[0-9a-f]{24}$/i.test(noteId)) return null;
  return parseInt(noteId.slice(0, 8), 16) * 1000;
}
