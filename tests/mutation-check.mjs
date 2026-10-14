// 变异测试：护栏不能只"绿着"，得证明它**绿得有理由**。
//
// 做法：基线全绿 → 逐个植入一处"看起来无害"的错误 → 每个都必须变红 → 复原复跑。
// ★ 红数不是判据，要看**失败原因**是不是这条变异该挑出来的那条。
// ★ 「没匹配上原文」≠「仍然绿」：前者是这次**根本没测到**，必须分开报（memory 里的教训）。
// ★ 每条变异带 `file`（改哪个文件）与 `tests`（跑哪套测试）：护栏不只长在 core.mjs 上。
//
// 跑法：node tests/mutation-check.mjs

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CORE = join(ROOT, "app", "core.mjs");
const NODE = process.execPath;

const CORE_TESTS = ["tests/core.test.js"];
const LEGAL_TESTS = ["tests/legal.test.js"];

// ---------------------------------------------------------------- 变异清单
//
// name 里不能出现 Windows 文件名非法字符（* / \ : ? " < > |）—— 见 memory。
// from 必须**原样**出现在 core.mjs 里，否则这一条等于没测，脚本会单独标出来。

const MUTATIONS = [
  // ---- 借鉴竞品那 9 条 ----
  {
    name: "她自己的作息(1)-闸门只留用户那一侧",
    from: "if (act && Object.prototype.hasOwnProperty.call(HER_BUSY, act)) {",
    to: "if (act && Object.prototype.hasOwnProperty.call({}, act)) {",
  },
  {
    // ★ 等价变异：`>=2` 改成 `>=1` 是**行为中性**的 —— unansweredWaitHours(1,·) 返回 0，
    //   `since < 0` 永远不成立 ⇒ 两版行为完全一致。它不是缺口，别当成"护栏没测到"报。
    //   （标 equivalent 是为了把它和真正的「仍绿」分开，而不是为了让报告好看。）
    name: "未回复(2)-等价变异(门槛1封,行为中性)",
    from: "if (unread >= 2) {",
    to: "if (unread >= 1) {",
    equivalent: true,
  },
  {
    name: "未回复(2)-门槛抬高到3封(2封未读不再等待)",
    from: "if (unread >= 2) {",
    to: "if (unread >= 3) {",
  },
  {
    name: "未回复(2)-只1封也算冷",
    from: "if (n <= 1) return 0;",
    to: "if (n <= 0) return 0;",
  },
  {
    name: "未回复(2)-压力不衰减(永远顶到上限)",
    from: "return Math.min(base * Math.pow(UNANSWERED_BASE, n - 2), UNANSWERED_CAP_HOURS);",
    to: "return Math.min(base * Math.pow(UNANSWERED_BASE, n - 2) * 0 + UNANSWERED_CAP_HOURS, UNANSWERED_CAP_HOURS);",
  },
  {
    name: "关系中位间隔(3)-有样本也不用,写死退回设置值",
    from: "  if (u === null) return s.minGapHours;",
    to: "  return s.minGapHours;",
  },
  {
    name: "关系中位间隔(3)-中位数不剔异常样本",
    from: ".filter((g) => Number.isFinite(g) && g >= 0.5 && g <= 168);",
    to: ".filter((g) => Number.isFinite(g) && g >= 0);",
  },
  {
    name: "离线不补发(4)-一开程序就发",
    from: "if (quiet >= 24) {",
    to: "if (false) {",
  },
  {
    name: "离线不补发(4)-宽限不抖动",
    from: "return 60 + (v % 241);",
    to: "return 60;",
  },
  {
    name: "不发原因有名字(5)-代号串到别的原因上",
    from: 'HER_BUSY: "her_busy",',
    to: 'HER_BUSY: "out_of_hours",',
  },
  {
    name: "由头质量下限(6)-下限归零,形同虚设",
    from: "export const SHALLOW_UNTIL = 8;",
    to: "export const SHALLOW_UNTIL = 0;",
  },
  {
    name: "由头质量下限(6)-根本不判",
    from: "if (shallow && (TRIGGER_WEIGHT[trigger?.kind] ?? 0) < 2) {",
    to: "if (false && (TRIGGER_WEIGHT[trigger?.kind] ?? 0) < 2) {",
  },
  {
    name: "由头质量下限(6)-权重表把空洞由头抬到有事那一档",
    from: "song_played: 3, library_finding: 3, quiet_days: 3, first_open_today: 2, time_of_day: 1,",
    to: "song_played: 3, library_finding: 3, quiet_days: 3, first_open_today: 2, time_of_day: 3,",
  },
  {
    name: "生成前先扣(7)-等于没扣(due 就是 now)",
    from: "  return now + base * (0.9 + (Math.abs(Math.floor(Number(jitterSeed) || 0)) % 21) / 100);",
    to: "  return now;",
  },
  {
    name: "生成前先扣(7)-不抖动(每次同一个值)",
    from: "(Math.abs(Math.floor(Number(jitterSeed) || 0)) % 21) / 100",
    to: "0.05",
  },
  {
    name: "回信降级(8)-把点名那句之后的整段都删了",
    from: "for (const s of list) out = out.slice(0, s.start) + out.slice(s.end);",
    to: "for (const s of list) out = out.slice(0, s.start);",
  },
  {
    name: "回信降级(8)-删过却不标记",
    from: "? { ...again, degraded: true }",
    to: "? { ...again, degraded: false }",
  },
  {
    name: "曲名上限(9)-不做截断",
    from: "return name.length > SONG_NAME_MAX ? name.slice(0, SONG_NAME_MAX - 1).trimEnd() + \"…\" : name;",
    to: "return name;",
  },
  {
    name: "曲名上限(9)-硬切不带省略号",
    from: "name.slice(0, SONG_NAME_MAX - 1).trimEnd() + \"…\"",
    to: "name.slice(0, SONG_NAME_MAX - 1)",
  },

  // ---- 原有几道闸的回归（确认新写的一批测试没把旧护栏架空） ----
  {
    name: "配额->写成>(上限1时会发第2封)",
    from: "if ((ctx.proactive24h ?? 0) >= s.maxPerDay) {",
    to: "if ((ctx.proactive24h ?? 0) > s.maxPerDay) {",
  },
  {
    name: "窗口终点-改成开区间",
    from: "if (!Number.isFinite(minutes) || minutes < start || minutes > end) {",
    to: "if (!Number.isFinite(minutes) || minutes < start || minutes >= end) {",
  },
  {
    name: "时段填错-静默回退默认值",
    from: "if (s.invalid.length > 0) {",
    to: "if (false) {",
  },
  {
    name: "主动信专属禁词-漏掉共用那批",
    from: "const FORBIDDEN_PROACTIVE = [\n  ...FORBIDDEN_REPLY,",
    to: "const FORBIDDEN_PROACTIVE = [",
  },
  {
    name: "曲库目录-不锚在开头(MySolo 会混进来)",
    from: "/^(?:solo|playsing)/iu",
    to: "/(?:solo|playsing)/iu",
  },
  {
    name: "原游戏时段-傍晚推到17:30",
    from: 'return m >= 360 && m < 960 ? "TOD12" : m >= 960 && m < 1200 ? "TOD1730" : "TOD20";',
    to: 'return m >= 360 && m < 1050 ? "TOD12" : m >= 1050 && m < 1200 ? "TOD1730" : "TOD20";',
  },

  // ---- 协议那一链（用户 2026-10-13：「设置页的协议还是别删了」） ----
  {
    name: "协议-改了源头忘了同步(legal.js 与 协议.txt 差一个字)",
    file: "app/public/legal.js",
    tests: LEGAL_TESTS,
    from: "    信件、设置、账本、曲库索引，全部存在本机",
    to: "    内容、设置、账本、曲库索引，全部存在本机",
  },
  {
    name: "协议-设置页入口被删掉(回到上一轮那种「只留在安装包里」)",
    file: "app/public/index.html",
    tests: LEGAL_TESTS,
    from: '<button class="lnk" id="lnkTerms">服务协议</button>',
    to: '<button class="lnk">服务协议</button>',
  },
  {
    name: "协议-弹层藏不住(一进页面就顶着整屏)",
    file: "app/public/styles.css",
    tests: LEGAL_TESTS,
    from: ".modal[hidden] { display: none; }",
    to: "/* .modal[hidden] { display: none; } */",
  },
  {
    name: "协议-安装时读的不是同一份",
    file: "install.iss",
    tests: LEGAL_TESTS,
    from: "LicenseFile=协议.txt",
    to: "LicenseFile=LICENSE.txt",
  },
  {
    name: "协议-正文被手抄进 index.html(从此有两份会各改各的)",
    file: "app/public/index.html",
    tests: LEGAL_TESTS,
    from: "      <div class=\"legalbar\">",
    to: "      <p>一、你的东西都在你自己机器上</p>\n      <div class=\"legalbar\">",
  },
  {
    name: "协议-小链接被套上液态玻璃高光(变成视觉焦点)",
    file: "app/public/app.js",
    tests: LEGAL_TESTS,
    from: 'const SELECTOR = "button:not(.lnk), .rb";',
    to: 'const SELECTOR = "button, .rb";',
  },
  {
    // ★ 第一版真漏过这个：截图里"那是读的你**自己那个厂商账户**里剩多少"，
    //   星号原样显示 —— 安装向导按纯文本渲染、弹层用 textContent，都不是 markdown。
    //   （这条会同时让「逐字一致」变红：改的是派生文件，源头没跟着动。两条都对。）
    name: "协议-正文里混进 markdown 星号(会原样露出来)",
    file: "app/public/legal.js",
    tests: LEGAL_TESTS,
    from: "那是读的你「你自己那个厂商账户」里剩多少",
    to: "那是读的你**自己那个厂商账户**里剩多少",
  },
];

// ---------------------------------------------------------------- 执行

function runTests(files) {
  const r = spawnSync(NODE, ["--test", "--test-force-exit", "--test-concurrency=3",
    ...files.map((f) => join(ROOT, f))], { encoding: "utf8", windowsHide: true });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const failed = /^# fail (\d+)/m.exec(out);
  const passed = /^# pass (\d+)/m.exec(out);
  const names = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
  return {
    ok: r.status === 0,
    fail: failed ? Number(failed[1]) : -1,
    pass: passed ? Number(passed[1]) : -1,
    names,
    out,
  };
}

const paths = new Set(MUTATIONS.map((m) => m.file ?? "app/core.mjs"));
const originals = new Map([...paths].map((p) => [p, readFileSync(join(ROOT, p), "utf8")]));

console.log("— 基线 —");
const base = runTests(CORE_TESTS.concat(LEGAL_TESTS));
if (!base.ok) {
  console.log(`基线就不绿（fail=${base.fail}）⇒ 变异结果不可信，先修基线。`);
  console.log(base.names.map((n) => `  · ${n}`).join("\n"));
  process.exit(1);
}
console.log(`基线 ${base.pass} pass / ${base.fail} fail\n`);

const killed = [];
const alive = [];
const missed = [];
const equivalent = [];

for (const m of MUTATIONS) {
  const rel = m.file ?? "app/core.mjs";
  const original = originals.get(rel);
  const hits = original.split(m.from).length - 1;
  if (hits !== 1) {
    missed.push({ ...m, hits });
    continue;
  }
  const tests = m.tests ?? CORE_TESTS;
  writeFileSync(join(ROOT, rel), original.replace(m.from, m.to), "utf8");
  const r = runTests(tests);
  writeFileSync(join(ROOT, rel), original, "utf8");

  if (r.ok) (m.equivalent ? equivalent : alive).push(m);
  else killed.push({ ...m, fail: r.fail, names: r.names });

  const mark = !r.ok
    ? `变红 ✓ (${r.fail} 条)`
    : m.equivalent ? "等价 ○" : "仍绿 ✗";
  console.log(`${mark.padEnd(16)} ${m.name}`);
  if (!r.ok) for (const n of r.names.slice(0, 3)) console.log(`                  ↳ ${n}`);
}

console.log("\n— 复原后复跑 —");
const after = runTests(CORE_TESTS.concat(LEGAL_TESTS));
console.log(`基线 ${after.pass} pass / ${after.fail} fail`);

console.log("\n— 汇总 —");
console.log(`变异总数 ${MUTATIONS.length}：变红 ${killed.length} ／ 仍绿 ${alive.length} ／ 等价 ${equivalent.length} ／ 没打中原文 ${missed.length}`);
if (alive.length) {
  console.log("\n★ 仍绿 = 这条护栏没有测试在守，必须补：");
  for (const m of alive) console.log(`  · ${m.name}`);
}
if (equivalent.length) {
  console.log("\n等价变异（行为中性，不构成缺口；但说明这两处是同一条判据的两道保险）：");
  for (const m of equivalent) console.log(`  · ${m.name}`);
}
if (missed.length) {
  console.log("\n★ 没打中原文 = 这次根本没测到（原文已改？）单独报，别和「仍绿」混在一起：");
  for (const m of missed) console.log(`  · ${m.name}（出现 ${m.hits} 次）`);
}
if (after.pass !== base.pass || after.fail !== 0) {
  console.log("\n★ 复原后与基线不一致 ⇒ 文件可能被写坏，检查 core.mjs");
}

process.exit(alive.length || missed.length || !after.ok ? 1 : 0);

