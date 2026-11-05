// Haiku prompts + JSON schemas. One job per call; the schema enforces shape, code re-checks content.

const NICHE = `领域「AI / 智能体」（on）：AI 智能体/Agent、AI 编程与开发工具（Claude Code、Cursor、Codex 等）、大模型应用、提示词、AI 工作流与自动化、AI 产品与创业、AI 工具测评与教程、AI 行业观察。
不属于（off）：与 AI 无关的生活/情感/美妆/家居/穿搭/娱乐/新闻；标题只是蹭"智能"二字但讲的是家电、汽车、手机等。`;

export const classifySchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          note_id: { type: "string" },
          niche: { type: "string", enum: ["on", "off"] },
          reason: { type: "string", description: "不超过20字" },
        },
        required: ["note_id", "niche", "reason"],
      },
    },
  },
  required: ["items"],
};

export function classifyPrompt(notes: { note_id: string; title: string | null; keyword: string | null; author: string | null }[]) {
  return `你在为一个小红书「AI / 智能体」领域的小账号筛选笔记。
${NICHE}

输入（JSON 数组，每项 note_id / title / keyword=搜到它的关键词 / author）：
${JSON.stringify(notes)}

任务：给每一项打 niche（on 或 off），并写不超过 20 字的理由。
规则：
- 输入里的每个 note_id 必须恰好出现一次，不得新增或遗漏。
- 只凭标题和作者判断；看不出与 AI 相关时一律 off。
返回前自查：items 数量是否等于输入数量（${notes.length}）。`;
}

export const keywordSchema = {
  type: "object",
  properties: {
    keywords: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          reason: { type: "string" },
          evidence_note_ids: { type: "array", items: { type: "string" } },
        },
        required: ["keyword", "reason", "evidence_note_ids"],
      },
    },
  },
  required: ["keywords"],
};

export function keywordPrompt(existing: string[], notes: { note_id: string; title: string | null; tags: string[]; comments: string[] }[]) {
  return `目标：为小红书「AI / 智能体」领域找到新的搜索关键词——用户真实会在搜索框里输入的词。

现有关键词（不要重复，也不要只做同义改写）：${JSON.stringify(existing)}
今天的高分笔记（note_id / 标题 / 话题 / 热门评论摘录）：
${JSON.stringify(notes)}

任务：提出最多 5 个新关键词。每个：2–12 个字，中文为主（可含英文产品名，如 Claude Code）；附一句理由；用 evidence_note_ids 引用 1–3 个上面出现过的 note_id 作为依据。
不要：泛词（"AI"、"人工智能"、"科技"）；编造平台数据（不要写"搜索量高""热搜"之类你看不到的东西）。`;
}

export const cardSchema = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "选题标题，不超过20字" },
          summary: { type: "string" },
          why_now: { type: "string" },
          angle: { type: "string" },
          evidence_note_ids: { type: "array", items: { type: "string" } },
          keywords: { type: "array", items: { type: "string" } },
          score: { type: "number", minimum: 1, maximum: 10 },
        },
        required: ["title", "summary", "why_now", "angle", "evidence_note_ids", "keywords", "score"],
      },
    },
  },
  required: ["cards"],
};

export function cardPrompt(notes: object[]) {
  return `你是小红书「AI / 智能体」领域的内容策划，为我们自己的小账号（刚起步、粉丝很少）写「选题机会卡」。

今天的高分笔记（note_id / 标题 / 正文摘录 / 话题 / 赞藏评 / growth_per_day=互动增长每日 / save_ratio=收藏÷点赞 / top_comments=热门评论）：
${JSON.stringify(notes)}

任务：写 3–5 张卡，每张：
- title：选题标题（≤20 字）
- summary：这个机会是什么（1–2 句）
- why_now：为什么现在做——必须引用输入里的数据（增长、收藏比、评论里反复出现的需求）
- angle：我们具体怎么做、和原笔记有什么不同（结构级借鉴，绝不照抄原文句子）
- evidence_note_ids：1–4 个输入里出现过的 note_id
- keywords：2–4 个相关搜索词
- score：1–10，越值得我们现在做越高
标准：每张卡的依据都能在输入里找到；不同卡覆盖不同的用户需求；不写空泛建议（如"多发干货""保持更新"）。`;
}

export const draftSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "8–20字" },
    body: { type: "string", description: "300–800字" },
    topics: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
    cover_text: { type: "string", description: "封面大字，不超过12字" },
  },
  required: ["title", "body", "topics", "cover_text"],
};

export function draftPrompt(card: object, sources: object[], feedback?: string) {
  return `为下面这张选题卡写一篇小红书图文笔记草稿。

选题卡：${JSON.stringify(card)}
参考笔记（只借鉴结构和角度，绝不照抄任何句子）：${JSON.stringify(sources)}

要求：
- title：8–20 个字，具体、有信息量
- body：300–800 字，分段，口语化；要有具体步骤、清单或例子，读完能直接用
- topics：3–6 个话题词（不带 # 号）
- cover_text：封面大字，≤12 字
不要：引流或联系方式（"私信我""加V"等）、夸大承诺、照搬参考笔记的原句。${feedback ? `\n上一版的问题，务必修正：${feedback}` : ""}`;
}
