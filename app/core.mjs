// 纯逻辑层：不碰数据库、不发网络、不读文件 —— 这样才能单测。
//
// 从 server.mjs 抽出来的原因：机会判定与自检是这个程序**唯一能挡住「不该发的信被发出去」**的两道闸，
// 埋在 HTTP 处理器里就没法测，而没法测的护栏等于没有护栏（旧项目踩过：沙箱自造前提 ⇒ 全绿却漏 P0）。

export const PROACTIVE_DEFAULTS = Object.freeze({
  // 用户 2026-10-13 定：默认开启，7 天最多 4 封。
  enabled: true,
  windowStart: "09:00",
  windowEnd: "21:30",
  minGapHours: 20,
  maxPerDay: 1,
  maxPerWeek: 4,
  checkIntervalMinutes: 30,
});

export function clockToMinutes(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// ---------------------------------------------------------------- 借鉴竞品
//
// 下面这几条来自 `analysis/竞品深度拆解-可借鉴清单.md`（逐条对着它的源码定的）。
// ★ 借鉴的是**判据与思路**，不是它的参数：它的 committed 档 5 分钟一封、
//   主动间隔上限 72 次/天，对一个"写信"的程序显然太密，我们按自己的尺度重定。

/**
 * (1) 她自己的作息 —— 闸门是双向的。
 * 竞品 `proactive_runtime.py` 的 world_gates：她睡觉/洗澡/上课/练琴时**她自己**不写。
 * 我们原来只有"用户可打扰时段"这一个维度 ⇒ 缺的正是写信人自己的状态。
 * 这一条直接决定"像不像一个人在写信"。
 */
export const HER_BUSY = Object.freeze({
  sleeping: "她在睡觉",
  bathing: "她在洗澡",
  class: "她在上课",
  practice: "她在练琴",
  errand: "她在外面办事",
  housework: "她在忙家务",
});

/**
 * (2) 未回复是**递增后衰减**，不是永久锁。
 * 竞品原文："The pressure decays with time and does not permanently lock initiative."
 * 我们原来写成「上一封主动信没读 ⇒ 永不发下一封」= 永久锁，对方忙一周就再也不会收到信。
 * 做法：连续没回，等待指数拉长（1.45 倍），但**有 7 天上限**，之后还能恢复。
 */
export const UNANSWERED_BASE = 1.45;
export const UNANSWERED_CAP_HOURS = 168;      // 7 天

export function unansweredWaitHours(unread, baseGapHours) {
  const n = Math.max(0, Math.floor(Number(unread) || 0));
  // 只 1 封没回不算"冷" —— 竞品 committed 档的原话：
  // "One unanswered everyday message does not imply hours of unavailability."
  if (n <= 1) return 0;
  const base = Math.max(Number(baseGapHours) || 0, 4);
  return Math.min(base * Math.pow(UNANSWERED_BASE, n - 2), UNANSWERED_CAP_HOURS);
}

/**
 * (3) 间隔 = **这段关系自己的节奏**，不是强加一个时钟。
 * 竞品 `_usual_user_gap`：取最近 9 次用户主动来信间隔的中位数。
 * 我们原来写死 20 小时 ⇒ 对每天写信的人是 20 小时，对一周写一次的人也是 20 小时，
 * 后者会被"定时轰炸"。
 */
export function medianGapHours(gaps) {
  const list = (Array.isArray(gaps) ? gaps : [])
    .map(Number)
    .filter((g) => Number.isFinite(g) && g >= 0.5 && g <= 168);   // 只留 30 分钟 ~ 7 天
  if (!list.length) return null;
  list.sort((a, b) => a - b);
  const mid = list.length >> 1;
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

/** 关系中位间隔 → 实际采用的最小间隔（有样本才用，没样本退回用户填的）。 */
export function effectiveGapHours(settings, usualGap) {
  const s = normalizeSettings(settings);
  const u = medianGapHours(usualGap === undefined ? null : [usualGap]);
  if (u === null) return s.minGapHours;
  return Math.min(Math.max(u * 0.9, 1), 720);
}

/**
 * (4) 离线过久不补发，只给一次带抖动的机会。
 * 竞品：到期了不立刻发，先推迟 1–5 分钟 —— "Expired appointments are not accumulated
 * offline mail."。我们原来一开程序就发（minGapHours 早满足了）。
 * "一开程序就收到信"是打扰，不是惊喜。
 * ★ 可测：抖动由 seed 决定，不直接调 Math.random。
 */
export function offlineGraceSeconds(seed) {
  const n = Number(seed);
  const v = Number.isFinite(n) ? Math.abs(Math.floor(n)) : 0;
  return 60 + (v % 241);                       // 60 ~ 300 秒
}

/**
 * (5) 每个"不发"的原因都有名字，并被记录。
 * 竞品 `_reason()` 返回枚举 + Observer ⇒ 能统计"为什么没发"，也能在设置页给人看一句人话
 * （"她这会儿在睡觉"比"不在可打扰窗口"好得多）。我们原来只返回一个中文字符串。
 */
export const PROACTIVE_REASONS = Object.freeze({
  DISABLED: "disabled",
  BAD_WINDOW: "bad_window",
  OUT_OF_HOURS: "out_of_hours",
  HER_BUSY: "her_busy",
  BUSY: "sending_uncertain",
  UNANSWERED_WAIT: "unanswered_wait",
  NO_EXCHANGE: "no_target",
  GAP: "wait_user",
  DAY_LIMIT: "attempt_limit",
  WEEK_LIMIT: "attempt_limit",
  OFFLINE_GRACE: "restore_delay",
  WEAK_TRIGGER: "reason_floor",
  READY: "ready",
});

/** 由头的"质量下限"：竞品的 reason_floor —— 由头不只是"有来源"，还得**够格**。
 *  ★ 后面四种是我们自己加的（见下面"借鉴多家 + 自己的创新"），权重给高：
 *    它们都要**先有事实**才成立，比"这是一个平常的晚上"硬得多。 */
export const TRIGGER_WEIGHT = Object.freeze({
  open_loop: 4,                       // 她问过的事还没有回音 ⇒ 最该补的一句
  reunion: 3,                         // 久别重聚（我们自己的口径，不是竞品的 quiet_days）
  song_played: 3, library_finding: 3, quiet_days: 3,
  first_open_today: 2,
  // ★ 音乐锚点**只能给 1 档**：它和"这是一个平常的晚上"是同一类东西 ——
  //   不是"发生了一件事"，只是"此刻是这个时候"。
  //   给到 2 档就会让关系还浅的用户也收到"此刻是夜里那一档"这种没有由头的信
  //   （全量测试里那两条 reason_floor 的断言就是被它顶掉的）。
  music_anchor: 1, time_of_day: 1,
});
// 往来少于这么多封时，关系还浅 ⇒ 拒掉"平常的晚上"这类空洞寒暄（竞品 reserved 档明令禁止）
export const SHALLOW_UNTIL = 8;

/**
 * 主动来信机会判定。
 *
 * ctx 是调用方查好的一组事实（不在这里查库，为了可测）：
 *   { nowMinutes, nowSeconds, unreadProactive, busyCount, exchangedCount,
 *     lastCreatedAt, lastProactiveAt, proactive24h, proactive7d,
 *     herActivity, usualGapHours, secondsSinceLaunch, seed,
 *     songTitle, libraryFinding, firstOpenToday }
 *
 * 返回 { ok, code, reason, trigger, waitHours }。任一条不满足即不发 —— 宁可不发，不要打扰。
 */
export function evaluateProactive(settings, ctx = {}) {
  const s = normalizeSettings(settings);
  const no = (code, reason, extra = {}) => ({ ok: false, code, reason, ...extra });

  if (!s.enabled) return no(PROACTIVE_REASONS.DISABLED, "主动来信已关闭，可以在设置里打开");

  // ★ 时段填错时必须拒绝，不能静默回退成默认值：
  //   用户设了 20:00–21:00，写错一个字符就悄悄变回 09:00–21:30 ⇒ 她在不受控的时段写信。
  if (s.invalid.length > 0) {
    return no(PROACTIVE_REASONS.BAD_WINDOW, `可打扰时段格式不对（${s.invalid.join("、")}），已停止主动来信`);
  }

  const start = clockToMinutes(s.windowStart);
  const end = clockToMinutes(s.windowEnd);
  if (start === null || end === null) return no(PROACTIVE_REASONS.BAD_WINDOW, "可打扰时段格式不对");
  const minutes = Number(ctx.nowMinutes);
  if (!Number.isFinite(minutes) || minutes < start || minutes > end) {
    return no(PROACTIVE_REASONS.OUT_OF_HOURS, `不在可打扰窗口（${s.windowStart}–${s.windowEnd}）`);
  }

  // ★ 她自己的状态。放在用户窗口之后：两边都舒服才算数。
  const act = String(ctx.herActivity ?? "").trim();
  if (act && Object.prototype.hasOwnProperty.call(HER_BUSY, act)) {
    return no(PROACTIVE_REASONS.HER_BUSY, `${HER_BUSY[act]}，这会儿不会有信寄出`);
  }

  if ((ctx.busyCount ?? 0) > 0) return no(PROACTIVE_REASONS.BUSY, "还有信在生成中");
  if ((ctx.exchangedCount ?? 0) < 1) return no(PROACTIVE_REASONS.NO_EXCHANGE, "还没有任何往来，林离无从下笔");

  const ts = Number(ctx.nowSeconds);
  const last = Number(ctx.lastCreatedAt);
  const lastPro = Number(ctx.lastProactiveAt);
  const gapHours = (Number.isFinite(ts) && Number.isFinite(last)) ? (ts - last) / 3600 : null;

  // ① 未回复：**递增后衰减**，不再是永久锁
  const unread = Math.max(0, Math.floor(Number(ctx.unreadProactive) || 0));
  if (unread >= 2) {
    const need = unansweredWaitHours(unread, s.minGapHours);
    const since = (Number.isFinite(ts) && Number.isFinite(lastPro)) ? (ts - lastPro) / 3600 : null;
    if (since === null || since < need) {
      return no(PROACTIVE_REASONS.UNANSWERED_WAIT,
        `还有 ${unread} 封没读，先等等（要满 ${need.toFixed(1)} 小时）`, { waitHours: need });
    }
  }

  // ② 最小间隔：**这段关系自己的节奏**，有样本才用
  const minGap = effectiveGapHours(s, ctx.usualGapHours);
  if (gapHours !== null && minGap > 0 && gapHours < minGap) {
    return no(PROACTIVE_REASONS.GAP, `距上一封仅 ${gapHours.toFixed(1)} 小时，未达 ${minGap.toFixed(1)} 小时`);
  }

  // ③ 刚刚打开程序：不立刻发（离线过久不补发）
  const up = Number(ctx.secondsSinceLaunch);
  if (Number.isFinite(up) && Number.isFinite(last) && Number.isFinite(ts)) {
    const quiet = (ts - last) / 3600;
    if (quiet >= 24) {                          // 隔了一天以上才算"离线过久"
      const grace = offlineGraceSeconds(ctx.seed ?? 0);
      if (up < grace) {
        return no(PROACTIVE_REASONS.OFFLINE_GRACE,
          `刚打开，先等 ${Math.ceil((grace - up) / 60)} 分钟 —— 隔了这么久不该一开程序就收到信`);
      }
    }
  }

  if ((ctx.proactive24h ?? 0) >= s.maxPerDay) {
    return no(PROACTIVE_REASONS.DAY_LIMIT, `24 小时内已发 ${ctx.proactive24h} 封，达上限 ${s.maxPerDay}`);
  }
  if ((ctx.proactive7d ?? 0) >= s.maxPerWeek) {
    return no(PROACTIVE_REASONS.WEEK_LIMIT, `7 天内已发 ${ctx.proactive7d} 封，达上限 ${s.maxPerWeek}`);
  }

  // ④ 由头有"质量下限"：关系还浅时，拒掉"平常的晚上"这种空洞由头
  const trigger = pickTrigger(ctx, ts, last);
  const shallow = (ctx.exchangedCount ?? 0) < SHALLOW_UNTIL;
  if (shallow && (TRIGGER_WEIGHT[trigger?.kind] ?? 0) < 2) {
    return no(PROACTIVE_REASONS.WEAK_TRIGGER,
      "这会儿没有一件值得写信的事 —— 宁可不写，也不写一句空洞的寒暄");
  }

  return { ok: true, code: PROACTIVE_REASONS.READY, reason: "可以写", trigger };
}

// ================================================================ 借鉴多家 + 自己的创新
//
// ★ 借鉴的是**思路**，不是代码，也不是它们的参数：
//   · Conscious Pebble —— Open Loop：没闭环的话题她会自己找回来说一句（她惦记着）
//   · Ackem 的 Time 系统 —— 时间感知 / 昼夜节律 / **重聚** / 反思
//   · astrbot 拟人插件 —— 每天的生活日程、重要日期、日记、**低频**主动消息
//   · Tanya —— 分层记忆 + 夜里把当天压成一条"值得记住的"
//   · Stanford Generative Agents —— 记忆要打分、会反思（reflection）
//   · 竞品 —— 她的作息闸门 / 未回复递增后衰减 / 由头质量下限
// ★ 上面各家都没有、属于这个程序的四条：
//   ① **音乐锚点**：触发时按《原游戏口径》取此刻该播的那一档 ⇒ 她的信总是从"我在听什么"下笔。
//      这是把"播放逻辑"和"写信"接上了 —— 它们本来就是同一个人的两个侧面。
//   ② **重聚的口径**：久别之后第一句不是"你怎么这么久才来"（这是把人推开），
//      而是"你不在的这几天，我这边发生了什么" ⇒ 先交待自己，再等对方。取其数据库和方法，避急躁。
//   ③ **又及（P.S.）**：手写信特有的二次投递 —— 信已经封口寄出了，她过一阵还能回来补一句。
//      即时通信的产品没有这个形态；它是"信"才有的。
//   ④ **反思档案是本地确定性算的**：不为了写封信再调一次模型，
//      统计由 herself 在信里提过的曲名/话题得出 ⇒ 既不花钱，也不把用户的信送去别处加工
//      （"用户数据绝不上传"这条红线不能因为加功能就破了）。

/** ① 音乐锚点。《原游戏口径》：06:00–16:00 → TOD12，16:00–20:00 → TOD1730，20:00–06:00 → TOD20。
 *  ★ 这一条必须和播放逻辑同源 —— 她说"我在听的"，就是程序此刻真的会播的那一档。 */
export const MUSIC_SLOTS = Object.freeze([
  { slot: "TOD12", from: 6 * 60, to: 16 * 60, label: "白天的那一档" },
  { slot: "TOD1730", from: 16 * 60, to: 20 * 60, label: "傍晚那一档" },
  { slot: "TOD20", from: 20 * 60, to: 24 * 60, label: "夜里那一档" },
]);

export function musicAnchor(nowMinutes) {
  const m = Number(nowMinutes);
  if (!Number.isFinite(m)) return null;
  const v = ((m % 1440) + 1440) % 1440;
  // 00:00–06:00 归到"夜里那一档"（TOD20 是跨零点的一整段，不能按数值大小比）
  if (v < 6 * 60) return MUSIC_SLOTS[2];
  if (v < 16 * 60) return MUSIC_SLOTS[0];
  if (v < 20 * 60) return MUSIC_SLOTS[1];
  return MUSIC_SLOTS[2];
}

/** ② 未闭环：她最近问过、但一直没有回音的那句话。
 *  ★ 只从**她写过的信**里找最后一句带问号的；用户之后如果又来信了，就不算悬着。
 *  ★★ 这里是纯文本的确定性抽取 —— 不再额外调一次模型去"理解"，理由同 ④。 */
export function openLoop(letters = [], nowSeconds, minAgeHours = 20) {
  const list = Array.isArray(letters) ? letters : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const L = list[i] || {};
    if (L.from === "user") break;                     // 用户之后还说过话 ⇒ 不算悬着
    const body = String(L.body ?? "");
    const q = body.search(/[?？]/);
    if (q < 0) continue;
    // 取最后一个问号所在的那一句（中文句号/换行分句），并在此截断
    const head = body.slice(0, q + 1);
    const parts = head.split(/(?<=[。！？!?])\s*|\n+/).filter(Boolean);
    const sentence = String(parts[parts.length - 1] ?? "").trim();
    if (!sentence) continue;
    const ageHours = Number.isFinite(Number(L.at)) && Number.isFinite(nowSeconds)
      ? (Number(nowSeconds) - Number(L.at)) / 3600 : null;
    if (ageHours !== null && ageHours < minAgeHours) return null;   // 刚问完就追问，太急
    return { sentence, ageHours, letterId: L.id ?? null };
  }
  return null;
}

/** ③ 重聚口径。区别于竞品的 quiet_days：那句是"你们已经 N 天没有往来了"——
 *  把天数摆在对方面前，像在记账。我们改成她先交待自己。 */
export const REUNION_AFTER_DAYS = 3;

export function reunionTone(daysAway, anchorLabel = "那一档歌") {
  const d = Math.max(0, Math.floor(Number(daysAway) || 0));
  return {
    days: d,
    text: `你已经 ${d} 天没有打开了。这 ${d} 天我把${anchorLabel}又从头听了一遍，` +
          `想起几件想跟你说的 —— 不着急回，我只是想让你知道这边的样子。`,
  };
}

/** ④ 又及（P.S.）：信寄出一段时间后，她还能回来补一句。
 *  ★ 必须满足两个"不像打扰"的条件：① 至少过了 minHours；② 用户**还没回**（回了就不需要补）。
 *  ★ 超出 maxHours 就不再补 —— 隔了一周才想起来补一句，那是尴尬，不是记挂。 */
export function psWindow({ sentAtSeconds, answeredAtSeconds, nowSeconds,
                           minHours = 6, maxHours = 72 } = {}) {
  const now = Number(nowSeconds);
  const sent = Number(sentAtSeconds);
  if (!Number.isFinite(now) || !Number.isFinite(sent)) return { ok: false, reason: "没有可用的时间戳" };
  const hours = (now - sent) / 3600;
  if (hours < 0) return { ok: false, reason: "将来的一封信" };
  if (Number.isFinite(Number(answeredAtSeconds))) return { ok: false, reason: "你已经回信了，不用再补" };
  if (hours < minHours) return { ok: false, hours, reason: `才过去 ${hours.toFixed(1)} 小时，还没到想起话要说的时候` };
  if (hours > maxHours) return { ok: false, hours, reason: `已经是 ${(hours / 24).toFixed(1)} 天前的事了，再补一句只会显得刻意` };
  return { ok: true, hours };
}

/**
 * ⑥ 第一次打开时问一句：主动来信这件事，就这样好不好。
 *
 * ★★ 用户 2026-10-14 定：主动来信**默认开启**（10-13 定的，有测试钉着），
 *   所以这个弹窗问的**不是**"要不要打开" —— 它本来就开着。它问的是
 *   「确认 / 关掉」：告知一次她会在什么时候写信、有多克制，顺便给一次反悔的机会。
 *
 * ★★ 判据只剩一条：**答没答过**。
 *    - 开着也要问，关着也要问 —— 只有"答过"才不问。
 *      （★ 这里踩过坑：早先版本写了 `if (enabled) return {shouldAsk:false}`，
 *        而默认值恰好是 enabled=true ⇒ 全新用户永远看不到这个弹窗，
 *        整个功能一上线就是死的。单测测不出来：单测只喂 {asked,enabled} 组合，
 *        没人去问"默认值到底是什么"。⇒ 端到端跑一遍就露馅了。）
 *    - 点"先不用"、按 Esc、点遮罩 —— 全都算答过（asked=true），不再天天问。
 *
 * @returns {{shouldAsk:boolean, reason?:string}}
 */
export function proactiveIntro({ asked = false } = {}) {
  if (asked) return { shouldAsk: false, reason: "已经问过一次了，不再打扰" };
  return { shouldAsk: true };
}

/** ★ 默认开启 ⇒ 明确的"愿意"⇒ 保持开启；其它一切答案 ⇒ 关掉。不管答什么，asked 都置 true（只问一次）。 */
export function answerProactiveIntro(answer) {
  const yes = answer === "yes";
  return { enabled: yes, asked: true };
}

/** ⑤ 反思档案：把来往压成"她记住的几件事"。本地确定性算，不额外调模型。
 *  返回 { songs: [], unresolvedDays, line } —— line 是直接可以进提示词的一句话。 */
export function reflectLetters(letters = [], top = 3) {
  const list = Array.isArray(letters) ? letters : [];
  const counts = new Map();
  for (const L of list) {
    for (const m of String(L.body ?? "").matchAll(/《([^》]{1,40})》/g)) {
      const k = m[1].trim();
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const songs = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([t]) => t);
  const last = list.length ? Number(list[list.length - 1].at) : null;
  const line = songs.length
    ? `她反复提过的歌：${songs.map((s) => `《${s}》`).join("、")} —— 这是她记得的事，写信时应当用得上。`
    : "";
  return { songs, lastAt: Number.isFinite(last) ? last : null, line };
}

/** 由头只认程序这侧能观测到的真实事件，绝不来信人的发言。
 *  ★ 优先级里前两条是我们自己的：她惦记着的 ＞ 久别重聚 ＞ 刚发生的事 ＞ 泛泛的时刻。 */
export function pickTrigger(ctx = {}, ts, last) {
  // ★ 顺序是有讲究的：**"你此刻在做什么" ＞ "她惦记着的" ＞ "我们多久没见了"**。
  //   把"久别"排在"刚听完一首歌"前面是不对的 —— 人都坐在面前弹完了，
  //   她却先说"你已经三天没打开了"，那是在翻旧账，不是写信。
  if (ctx.songTitle) return { kind: "song_played", text: `你刚刚听完《${ctx.songTitle}》。` };
  if (ctx.libraryFinding) return { kind: "library_finding", text: `整理时发现：${ctx.libraryFinding}` };

  const letters = Array.isArray(ctx.herLetters) ? ctx.herLetters : [];
  const loop = openLoop(letters, ts);
  if (loop) return { kind: "open_loop", text: `你还欠她一个回音：${loop.sentence}`, loop };

  if (Number.isFinite(ts) && Number.isFinite(last)) {
    const days = Math.floor((ts - last) / 86400);
    if (days >= REUNION_AFTER_DAYS) {
      const anchor = musicAnchor(Number.isFinite(ctx.nowMinutes) ? ctx.nowMinutes : 720);
      return { kind: "reunion", text: reunionTone(days, anchor?.label).text, days };
    }
  }

  // ★ 音乐锚点放在"泛泛的时刻"之前：即使这一刻没有别的由头，
  //   "她正在听这一档里的歌"也比"这是一个平常的晚上"更像一件真事。
  if (Number.isFinite(ctx.nowMinutes)) {
    const a = musicAnchor(ctx.nowMinutes);
    if (a) return { kind: "music_anchor", text: `此刻是${a.label}（${a.slot}），她正在听这一档里的歌。` };
  }

  if (Number.isFinite(ts) && Number.isFinite(last)) {
    const days = Math.floor((ts - last) / 86400);
    if (days >= 2) return { kind: "quiet_days", text: `你们已经有 ${days} 天没有往来了。` };
  }
  if (ctx.firstOpenToday) return { kind: "first_open_today", text: "你今天第一次打开程序。" };
  const hour = Number.isFinite(ctx.nowMinutes) ? Math.floor(ctx.nowMinutes / 60) : 12;
  return { kind: "time_of_day", text: `这是一个平常的${hour < 12 ? "早上" : hour < 18 ? "下午" : "晚上"}。` };
}

/** 由头代号 → **给人看**的说法。
 *  ★★ 界面绝不能直接显示 `kind`。原来的设置页写的是
 *     `现在可以写（${'${'}trigger.kind}）` ⇒ 用户会看到「现在可以写（song_played）」——
 *     内部代号漏到界面上了。这类东西静态看不出来（字符串都在），
 *     只有把界面渲染出来、逐字读一遍才会发现。 */
export const TRIGGER_LABELS = Object.freeze({
  song_played: "刚听完一首歌",
  library_finding: "整理曲库时有发现",
  open_loop: "你还没回她上一封的问话",
  reunion: "你们有阵子没见了",
  music_anchor: "这会儿是她常听歌的时段",
  quiet_days: "好几天没打开",
  first_open_today: "今天第一次打开",
  time_of_day: "一个平常的时段",
});

/** 未知代号也要给中文 —— 宁可含糊，也不能把 `some_new_code` 原样吐给用户。 */
export function triggerLabel(kind) {
  return TRIGGER_LABELS[kind] ?? "她惦记着一件小事";
}

/**
 * (6) 生成之前先"消耗掉"这次机会 —— 竞品 `reserve()`：
 *   "Durably consume this opportunity before generation, without changing eligibility."
 * 我们是**生成完才落库**；生成过程中崩了/被关 ⇒ 会重新生成一次 ⇒ 可能重复发。
 * 返回新的 due（秒）。调用方必须**在生成之前**落盘。
 */
export function reserveDue(nowSeconds, minGapHours, jitterSeed = 0) {
  const now = Number(nowSeconds);
  if (!Number.isFinite(now)) return null;
  const base = Math.max(Number(minGapHours) || 0, 0) * 3600;
  return now + base * (0.9 + (Math.abs(Math.floor(Number(jitterSeed) || 0)) % 21) / 100);
}

/**
 * (7) 回信的**降级路径** —— 竞品 `_without_unsupported_facts`：
 *   找出被判为伪造事实的**句子**，只删那些句子，其余保留。
 * ★ 主动信仍然"踩线即整封不落库"，这条只给**回信**：删完要重跑一次自检，
 *   并且**全局最多重写一次**（竞品也是这样，防止越改越不像人写的）。
 */
export function withoutSentences(text, spans) {
  const body = String(text ?? "");
  const list = (Array.isArray(spans) ? spans : [])
    .filter((s) => s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => b.start - a.start);            // 从后往前删，前面的下标才不会被挪动
  let out = body;
  for (const s of list) out = out.slice(0, s.start) + out.slice(s.end);
  return out.replace(/\n{3,}/gu, "\n\n").trim();
}

/** 回信降级：删掉被判定的句子后重检一次。通过就发，并标记 degraded。 */
export function inspectReplyDegraded(text, spans) {
  const first = inspectReply(text);
  if (first.ok) return { ...first, degraded: false };
  const cut = withoutSentences(text, spans);
  if (!cut || cut === String(text ?? "").trim()) return { ok: false, reason: first.reason, degraded: false };
  const again = inspectReply(cut);
  return again.ok
    ? { ...again, degraded: true }
    : { ok: false, reason: again.reason, degraded: false };
}

export function normalizeSettings(raw) {
  const clamp = (v, lo, hi, dflt) => {
    const n = Number(raw?.[v]);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  };
  const provided = (k) => raw?.[k] !== undefined && raw?.[k] !== null && String(raw[k]).trim() !== "";
  const invalid = [];
  // 「没填」用默认值；「填了但填错」记进 invalid，由上层的机会判定拒绝。
  if (provided("windowStart") && clockToMinutes(raw.windowStart) === null) invalid.push("windowStart");
  if (provided("windowEnd") && clockToMinutes(raw.windowEnd) === null) invalid.push("windowEnd");
  return {
    enabled: raw?.enabled === true || raw?.enabled === 1 || raw?.enabled === "1",
    windowStart: clockToMinutes(raw?.windowStart) === null ? PROACTIVE_DEFAULTS.windowStart : String(raw.windowStart),
    windowEnd: clockToMinutes(raw?.windowEnd) === null ? PROACTIVE_DEFAULTS.windowEnd : String(raw.windowEnd),
    minGapHours: clamp("minGapHours", 0, 720, PROACTIVE_DEFAULTS.minGapHours),
    maxPerDay: clamp("maxPerDay", 0, 10, PROACTIVE_DEFAULTS.maxPerDay),
    maxPerWeek: clamp("maxPerWeek", 0, 30, PROACTIVE_DEFAULTS.maxPerWeek),
    invalid,
  };
}

// ------------------------------------------------------------------ 自检

const FORBIDDEN_REPLY = [
  "由头", "触发", "主动来信", "主动信", "System", "prompt", "PROMPT", "{{", "}}", "预检", "账本", "栏目",
];

const FORBIDDEN_PROACTIVE = [
  ...FORBIDDEN_REPLY,
  "你上次说", "你说过", "你让我", "你信里", "如你所说", "你刚才说",
  "老公", "老婆", "男朋友", "女朋友", "在一起", "亲一下", "抱抱", "想我吗",
];

function baseInspect(text, { forbidden, maxChars, minChars, maxParagraphs, maxAsciiRun }) {
  const body = String(text ?? "").trim();
  if (!body) return { ok: false, reason: "空正文" };
  for (const word of forbidden) {
    if (body.includes(word)) return { ok: false, reason: `正文出现禁词：${word}` };
  }
  const cjk = (body.match(/[一-龥]/g) ?? []).length;
  if (cjk > maxChars) return { ok: false, reason: `正文 ${cjk} 字，超过 ${maxChars} 字` };
  if (cjk < minChars) return { ok: false, reason: `正文仅 ${cjk} 字，过短` };
  const paragraphs = body.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (paragraphs.length > maxParagraphs) return { ok: false, reason: `正文 ${paragraphs.length} 段，超过 ${maxParagraphs} 段` };
  const run = body.match(/[A-Za-z]+/g)?.sort((a, b) => b.length - a.length)[0] ?? "";
  if (run.length > maxAsciiRun) return { ok: false, reason: "正文出现英文长串" };
  return { ok: true, body, paragraphs };
}

export function inspectReply(text) {
  const r = baseInspect(text, { forbidden: FORBIDDEN_REPLY, maxChars: 240, minChars: 10, maxParagraphs: 8, maxAsciiRun: 7 });
  if (!r.ok) return r;
  if (/^(林离|回信)\s*[:：]/.test(r.body)) return { ok: false, reason: "正文带了角色名前缀" };
  return r;
}

export function inspectProactive(text) {
  return baseInspect(text, { forbidden: FORBIDDEN_PROACTIVE, maxChars: 200, minChars: 20, maxParagraphs: 3, maxAsciiRun: 5 });
}

// ------------------------------------------------------------------ 曲库变体
//
// 口径来自 OliviaSoul 旧项目的一手证据（不是猜的）：
//   midi/playback-clock.js —— 边界跟着原版桌面播放器的 localtime64：
//     06:00–16:00 → TOD12（白天）；16:00–20:00 → TOD1730（傍晚）；20:00–06:00 → TOD20（夜晚）。
//     ★ TOD1730 只是素材标签，傍晚实际从 16:00 开始，不是 17:30。
//   midi/library-importer.js:73 —— 文件名解析 TOD(1200|1730|2000)[_-](NI|WI)[_-](L|R)。
//   midi/song-metadata.js —— 编号归一：1200|12→TOD12，1730|17→TOD1730，2000|20→TOD20。
//   selectSongVariant —— 精确 tod+view → 同 tod 无 view → 同 tod → 兜底。

export const TIME_SLOTS = Object.freeze(["TOD12", "TOD1730", "TOD20"]);
export const TIME_SLOT_LABELS = Object.freeze({ TOD12: "白天", TOD1730: "傍晚", TOD20: "夜晚" });

// 曲库目录筛选口径（用户 2026-10-13 指定）：只要目录名以 solo / playsing 开头的。
// 放在这里而不是 server.mjs，是因为「哪些目录算曲目」是一条判据 —— 判据要能被变异打红。
export const LIBRARY_DIR_PATTERN = /^(?:solo|playsing)/iu;

/**
 * 目录名 → 曲名：去掉 _ziyun_original 这类来源尾巴，下划线还原成空格。
 * ★ 曲名长度上限（竞品 `local_song_library.py`：曲名 ≤120 字符）：
 *   我们原来没限，一个超长目录名会把曲目那一行撑破。夹到 120，超了给个省略号。
 */
export const SONG_NAME_MAX = 120;

export function prettySongName(dirName) {
  const name = String(dirName ?? "")
    .replace(/_?(?:ziyun|original)(?:[_-]?(?:ziyun|original))*/giu, "")
    .replace(/^[_-]+|[_-]+$/gu, "")
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return name.length > SONG_NAME_MAX ? name.slice(0, SONG_NAME_MAX - 1).trimEnd() + "…" : name;
}

export function playbackTimeOfDay(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m)) return "TOD12";
  return m >= 360 && m < 960 ? "TOD12" : m >= 960 && m < 1200 ? "TOD1730" : "TOD20";
}

export function normalizeTod(token) {
  const raw = String(token ?? "").toUpperCase();
  const m = /^TOD(1200|1730|2000|12|17|20)$/u.exec(raw);
  if (!m) return null;
  return ({ 1200: "TOD12", 12: "TOD12", 1730: "TOD1730", 17: "TOD1730", 2000: "TOD20", 20: "TOD20" })[m[1]];
}

/** 从文件名里拆出时段 / 视角 / 朝向。 */
export function parseVariant(fileName) {
  const stem = String(fileName ?? "").replace(/\.[^.]+$/u, "");
  const m = /(TOD(?:1200|1730|2000|12|17|20))(?:[_-](NI|WI))?(?:[_-]([LR]))?/iu.exec(stem);
  if (!m) return null;
  return { tod: normalizeTod(m[1]), view: (m[2] ?? "").toUpperCase() || null, hand: (m[3] ?? "").toUpperCase() || null };
}

/** 选变体：tod+view 精确 → 同 tod 无 view → 同 tod → 兜底。 */
export function selectVariant(variants, tod, view) {
  const list = Array.isArray(variants) ? variants.filter(Boolean) : [];
  if (!list.length) return null;
  const pool = list.filter((v) => v.tod === tod);
  return pool.find((v) => v.view === view)
    ?? pool.find((v) => !v.view)
    ?? pool[0]
    ?? list.find((v) => v.tod === "TOD12")
    ?? list[0]
    ?? null;
}

// ------------------------------------------------------------------ 账本

export const LEDGER_FIELDS = Object.freeze([
  "性描写", "涉党涉政", "提示注入", "事实伪造", "关系", "关系依据",
  "已承认情感", "已承认称呼", "既有亲密", "既有边界", "亲密上限",
  "本封亲密请求", "本封亲密判定",
  "说话者", "未决", "摘要待核实", "结论",
]);

export function parseLedger(text) {
  const out = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("　");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    if (LEDGER_FIELDS.includes(key)) out[key] = trimmed.slice(idx + 1).trim();
  }
  return out;
}
