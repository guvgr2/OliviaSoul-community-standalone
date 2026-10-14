// 「借鉴多家 + 自己的创新」那一段的护栏测试。
//
// 为什么必须补：新加的这五个函数是**决定她什么时候开口**的东西。
//   写错了不会报错，只会让她在不该说话的时候说话 —— 而那正是这个项目最不能出错的地方。
// ★ 每一条断言都必须能被变异打红（改 check 时要同步跑 tests/mutation-check.mjs）。

import assert from "node:assert/strict";
import test from "node:test";
import {
  MUSIC_SLOTS,
  musicAnchor,
  openLoop,
  reunionTone,
  REUNION_AFTER_DAYS,
  psWindow,
  reflectLetters,
  proactiveIntro,
  answerProactiveIntro,
  pickTrigger,
  TRIGGER_WEIGHT,
  evaluateProactive,
  PROACTIVE_DEFAULTS,
  TRIGGER_LABELS,
  triggerLabel,
} from "../app/core.mjs";

const HOUR = 3600;
const DAY = 86400;

test("① 音乐锚点：和《原游戏口径》的三档严格对齐（含跨零点那一段）", () => {
  assert.equal(musicAnchor(6 * 60).slot, "TOD12");      // 06:00 起
  assert.equal(musicAnchor(15 * 60 + 59).slot, "TOD12");
  assert.equal(musicAnchor(16 * 60).slot, "TOD1730");   // 16:00 起
  assert.equal(musicAnchor(19 * 60 + 59).slot, "TOD1730");
  assert.equal(musicAnchor(20 * 60).slot, "TOD20");     // 20:00 起
  assert.equal(musicAnchor(23 * 60 + 59).slot, "TOD20");
  // ★★ 00:00–05:59 属于"夜里那一档"，不能因为 180 < 360 就掉到 TOD12
  assert.equal(musicAnchor(0).slot, "TOD20");
  assert.equal(musicAnchor(3 * 60).slot, "TOD20");
  assert.equal(musicAnchor(5 * 60 + 59).slot, "TOD20");
  assert.equal(MUSIC_SLOTS.length, 3);
  assert.equal(musicAnchor(NaN), null);                 // 时间不可用 ⇒ 不硬猜
});

test("② 未闭环：她问过、且之后没人再说话 ⇒ 找回来；用户接过话就不算悬着", () => {
  const asked = [{ id: 1, from: "her", at: 0, body: "今天风很大，窗户一直响。你那边呢？" }];
  const got = openLoop(asked, 30 * HOUR);
  assert.equal(got.sentence, "你那边呢？");
  assert.equal(got.letterId, 1);
  assert.ok(got.ageHours >= 29);

  // 用户之后回过信 ⇒ 不算悬着（否则她会追着人问，很烦）
  const answered = [
    { id: 1, from: "her", at: 0, body: "你那边呢？" },
    { id: 2, from: "user", at: 2 * HOUR, body: "这边还好。" },
  ];
  assert.equal(openLoop(answered, 30 * HOUR), null);

  // 刚问完 2 小时就追问 ⇒ 太急，不追
  assert.equal(openLoop(asked, 2 * HOUR), null);
  // 她最近一封没有问号 ⇒ 没有"欠着的回音"
  assert.equal(openLoop([{ id: 1, from: "her", at: 0, body: "今天就这样吧。" }], 30 * HOUR), null);
});

test("③ 重聚口径：先交待自己，不把天数当账本", () => {
  const t = reunionTone(5, musicAnchor(12 * 60).label);
  assert.equal(t.days, 5);
  assert.match(t.text, /这 5 天我把白天的那一档又从头听了一遍/);
  assert.match(t.text, /不着急回/);                 // ★ 不能变成催促
  assert.doesNotMatch(t.text, /怎么才来|为什么不来|忘了/);   // 指责式的措辞一律不许出现
  assert.ok(REUNION_AFTER_DAYS >= 3);
});

test("④ 又及（P.S.）：只在不打扰的那个区间里补一句", () => {
  assert.equal(psWindow({ sentAtSeconds: 0, nowSeconds: 3 * HOUR }).ok, false);        // 太早
  assert.equal(psWindow({ sentAtSeconds: 0, nowSeconds: 24 * HOUR }).ok, true);        // 正好
  assert.equal(psWindow({ sentAtSeconds: 0, nowSeconds: 10 * DAY }).ok, false);        // 太晚，显得刻意
  const replied = psWindow({ sentAtSeconds: 0, nowSeconds: 24 * HOUR, answeredAtSeconds: 12 * HOUR });
  assert.equal(replied.ok, false);                                                    // 已经回信了
  assert.equal(psWindow({ sentAtSeconds: 100, nowSeconds: 0 }).ok, false);            // 将来的信
});

test("⑤ 反思档案：本地确定性抽取，且不为它多发一次请求", () => {
  const letters = [
    { from: "her", at: 1, body: "我又弹了一遍《送别》，手有点生。" },
    { from: "her", at: 2, body: "《送别》的第三段总是卡。" },
    { from: "her", at: 3, body: "今天听的是《牧羊少年》。" },
  ];
  const r = reflectLetters(letters);
  assert.equal(r.songs[0], "送别");       // 出现两次 ⇒ 排在最前
  assert.ok(r.songs.includes("牧羊少年"));
  assert.match(r.line, /《送别》/);
  assert.equal(reflectLetters([]).line, "");   // 没有可提取的 ⇒ 不硬凑一句话
});

test("⑥ 由头优先级：她惦记着的 ＞ 久别重聚 ＞ 刚发生的事 ＞ 泛泛的时刻", () => {
  const letters = [{ id: 1, from: "her", at: 0, body: "你那边呢？" }];
  const ts = 40 * DAY;

  assert.equal(pickTrigger({ herLetters: letters }, ts, 0).kind, "open_loop");
  // 没有悬而未决的事，但隔了很久 ⇒ 重聚（而不是竞品那句"已经 N 天没有往来了"）
  assert.equal(pickTrigger({}, ts, 0).kind, "reunion");
  // 隔了两三天、又有刚听完的歌 ⇒ 歌优先（更具体）
  assert.equal(pickTrigger({ songTitle: "送别" }, 3 * DAY, 0).kind, "song_played");
  // 什么都没有 ⇒ 落到"此刻这一档"，而不是"这是一个平常的晚上"
  assert.equal(pickTrigger({ nowMinutes: 22 * 60 }, 1000, 0).kind, "music_anchor");
  assert.equal(pickTrigger({ nowMinutes: 22 * 60 }, 1000, 0).text.includes("TOD20"), true);
  // 权重：我们自己那两条必须排在最前，否则会退回泛泛寒暄
  assert.ok(TRIGGER_WEIGHT.open_loop > TRIGGER_WEIGHT.song_played);
  assert.ok(TRIGGER_WEIGHT.reunion >= TRIGGER_WEIGHT.quiet_days);
});

test("⑦ 接进来之后不能破坏原来的宁可不发", () => {
  // 这里显式开起来，本来就是"开了之后还守不守得住"的测试。
  const on = { enabled: true, windowStart: "09:00", windowEnd: "21:30" };
  const base = {
    nowMinutes: 13 * 60, nowSeconds: 40 * DAY,
    exchangedCount: 20, unreadProactive: 0, busyCount: 0,
    lastCreatedAt: 0, lastProactiveAt: null, proactive24h: 0, proactive7d: 0,
    herLetters: [{ id: 1, from: "her", at: 0, body: "你那边呢？" }],
  };
  const v = evaluateProactive(on, base);
  assert.equal(v.ok, true);
  assert.equal(v.trigger.kind, "open_loop");
  // 关掉开关 ⇒ 一个字都发不出
  assert.equal(evaluateProactive({ ...on, enabled: false }, base).ok, false);
  assert.equal(evaluateProactive({}, base).ok, false);
  // 她在练琴 ⇒ 有事也不写
  assert.equal(evaluateProactive(on, { ...base, herActivity: "practice" }).ok, false);
});

test("⑧ 第一次打开时的询问弹窗：只问一次，也不能替用户做决定", () => {
  // ★★ 这一条是 2026-10-14 端到端跑出来的真 bug 留下的：
  //    早先版本判据写成 `if (enabled) return {shouldAsk:false}`，而 PROACTIVE_DEFAULTS.enabled
  //    恰好是 **true** ⇒ 全新用户永远看不到这个弹窗，整个功能一上线就是死的。
  //    原来的断言自己造了 `{asked:false, enabled:false}` 当输入 —— 前提是自己给的，
  //    默认值到底是什么，谁也没问 ⇒ 全绿。⇒ 这里必须**拿真正的默认值**去喂它。
  assert.equal(
    proactiveIntro({ asked: false, enabled: PROACTIVE_DEFAULTS.enabled }).shouldAsk, true,
    "★ 用真正的默认值（默认开启）时也必须问 —— 这是端到端抓出来的那条",
  );
  // 逐条覆盖：开着要问、关着也要问，只有"答过"才不问
  for (const enabled of [true, false]) {
    assert.equal(proactiveIntro({ asked: false, enabled }).shouldAsk, true);
    assert.equal(proactiveIntro({ asked: true, enabled }).shouldAsk, false);
  }
  // 一个参数都不传 ⇒ 默认"没答过" ⇒ 该问
  assert.equal(proactiveIntro({}).shouldAsk, true);
  assert.equal(proactiveIntro().shouldAsk, true);

  // ★★ 只有明确的"愿意"才保持开启；其它一切答案都关掉，但都算答过
  assert.deepEqual(answerProactiveIntro("yes"), { enabled: true, asked: true });
  assert.deepEqual(answerProactiveIntro("no"), { enabled: false, asked: true });
  assert.deepEqual(answerProactiveIntro("dismiss"), { enabled: false, asked: true });
  assert.deepEqual(answerProactiveIntro(undefined), { enabled: false, asked: true });
  // ⇒ 不存在任何一种答案能让"开关被打开且不算答过"
  for (const a of ["yes", "no", "", null, undefined, 0, 1]) {
    const r = answerProactiveIntro(a);
    assert.equal(r.asked, true);
    if (a !== "yes") assert.equal(r.enabled, false);
  }
});

test("⑨ 由头代号不许漏到界面上（代号是给程序看的，不是给用户看的）", () => {
  // ★★ 这一条是"把整个界面渲染出来、逐字读一遍"抓出来的：
  //   设置页原来写的是 `现在可以写（${'$'}{trigger.kind}）`，用户看到的是
  //   「现在可以写（song_played）」。字符串检查全绿 —— 那句模板确实是照写的，
  //   只是写错了地方。⇒ 界面只能拿 label。
  const ALL = ["song_played", "library_finding", "open_loop", "reunion",
               "music_anchor", "quiet_days", "first_open_today", "time_of_day"];
  for (const kind of ALL) {
    const label = triggerLabel(kind);
    assert.ok(TRIGGER_LABELS[kind], `${kind} 必须有给人看的说法`);
    assert.equal(label, TRIGGER_LABELS[kind]);
    // 说法必须是人话：含中文，且不含下划线（代号就长这样）
    assert.ok(/[\u4e00-\u9fa5]/.test(label), `${kind} 的说法要含中文，实际是「${label}」`);
    assert.ok(!label.includes("_"), `${kind} 的说法不能是代号，实际是「${label}」`);
  }
  // 未知代号也要给中文兜底，绝不原样吐出去
  const fallback = triggerLabel("brand_new_code");
  assert.ok(/[\u4e00-\u9fa5]/.test(fallback) && !fallback.includes("_"),
    "未知代号必须兜底成人话，不能把代号原样吐给用户");
  assert.equal(triggerLabel(undefined), fallback);
  assert.equal(triggerLabel(null), fallback);

  // 反向：pickTrigger 真的会产出的每一个 kind，都得在表里有说法。
  // ★ last 要逐条给：给成 5 天前的话，"重聚"会抢在音乐锚点前面命中
  //   （第一版就是所有用例共用 5*DAYS，于是 music_anchor 那条拿到了 reunion）。
  const DAYS = 86400;
  const TS = 40 * DAYS;              // ★ last 要相对 TS 给：写成绝对值 1*DAYS 的话
  const ago = (d) => TS - d * DAYS;  //   就变成"距上一次 39 天"，重聚会抢在所有由头前头命中。
  // 生产里一定成立的前提：服务端**总会**传 nowMinutes。
  const cases = [
    [{ songTitle: "送别", nowMinutes: 13 * 60 }, ago(1), "song_played"],
    [{ libraryFinding: "一首没听过的", nowMinutes: 13 * 60 }, ago(1), "library_finding"],
    [{ herLetters: [{ id: 1, from: "her", at: 0, body: "你那边呢？" }], nowMinutes: 13 * 60 }, ago(1), "open_loop"],
    [{ nowMinutes: 13 * 60 }, ago(10), "reunion"],
    [{ nowMinutes: 22 * 60 }, ago(1), "music_anchor"],
    [{ nowMinutes: 13 * 60 }, ago(2), "music_anchor"],
  ];
  for (const [ctx, last, expect] of cases) {
    const got = pickTrigger(ctx, TS, last);
    assert.equal(got.kind, expect, `由头应命中 ${expect}`);
    assert.ok(TRIGGER_LABELS[got.kind], `${got.kind} 没有 label —— 界面就会显示代号`);
  }

  // ★★ 已核实的事实（不是猜的，是下面断言跑出来的）：
  //   `musicAnchor()` 对**任何**分钟数都返回一档（00:00–06:00 也归 TOD20），
  //   它又排在 quiet_days / first_open_today / time_of_day 前面，
  //   而服务端**永远**会传 nowMinutes ⇒ 这三条在生产里一次都不会被选中。
  //   留着它们不是错（决定由头优先级的正是"此刻是她的哪一档"这种更具体的事），
  //   但要让它是**有意识的**，所以钉在这里：谁改了顺序，这里会响。
  for (const [ctx, last, expect] of [
    [{}, ago(2), "quiet_days"],
    [{ firstOpenToday: true }, ago(1), "first_open_today"],
    [{}, ago(1), "time_of_day"],
  ]) {
    const got = pickTrigger(ctx, TS, last);
    assert.equal(got.kind, expect, "只有不传 nowMinutes，才轮得到这三条");
    assert.ok(TRIGGER_LABELS[got.kind]);
  }
  // 反过来：只要有 nowMinutes，就一定被 music_anchor 拦住
  assert.equal(pickTrigger({ nowMinutes: 0 }, TS, ago(2)).kind, "music_anchor", "半夜也归 TOD20");
  assert.equal(pickTrigger({ firstOpenToday: true, nowMinutes: 13 * 60 }, TS, ago(1)).kind, "music_anchor",
    "★ first_open_today 被 music_anchor 全时段遮蔽 —— 这是已知事实，不是回归");
});
