// 端到端验证：第一次打开时的"要不要让林主动来信"询问弹窗
//
// ★ 为什么还要这一层：单测只证明 core.mjs 的纯函数对，证明不了
//   「接口真的返回了 shouldAsk」「asked 真的落库了」「答过之后真的不再问」。
//   「字符串对得上」不等于「跑得对」，所以这里真的把服务起起来走一遍。
//
// 用法：node tools/e2e-proactive-intro.mjs
//
// 隔离办法：不改动 server.mjs。Node 的 os.homedir() 在 Windows 上读 USERPROFILE，
//   所以每次给一个临时 USERPROFILE，数据目录就落在临时目录里，互不干扰。

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "app", "server.mjs");

let pass = 0;
const fails = [];
function check(label, actual, expected, raw) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else {
    fails.push(label);
    console.log(`  ✗ ${label}  期望 ${JSON.stringify(expected)} 实际 ${JSON.stringify(actual)}`);
    if (raw !== undefined) console.log(`      原始响应: ${JSON.stringify(raw)}`);
  }
}

async function startServer(tag) {
  const home = mkdtempSync(join(tmpdir(), `linli-e2e-${tag}-`));
  const proc = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, USERPROFILE: home, LINLI_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buf = "";
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`服务 25 秒内没报端口。stdout:\n${buf}`)), 25000);
    proc.stdout.on("data", (c) => {
      buf += c.toString();
      const m = buf.match(/LINLI_PORT=(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    proc.stderr.on("data", (c) => { buf += c.toString(); });
    proc.on("exit", (code) => { clearTimeout(timer); reject(new Error(`服务退出了 code=${code}\n${buf}`)); });
  });
  // ★ 写操作要带会话令牌（服务端第 ② 道闸：挡本机其它进程）。GET 不需要，POST 需要。
  //   从 /api/session 现拿 —— 千万别在脚本里写死，那等于把闸拆了。
  const { json: sess } = await api(port, "/api/session");
  if (!sess?.token) throw new Error("没拿到会话令牌");

  return {
    proc, port, home, token: sess.token,
    stop: () => new Promise((r) => {
      proc.once("exit", () => { try { rmSync(home, { recursive: true, force: true }); } catch {} r(); });
      proc.kill();
      setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 3000);
    }),
  };
}

async function api(port, path, method = "GET", body, token) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (token) headers["x-linli-token"] = token;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function main() {
  // ---------------------------------------------------------------- 场景 A：全新用户 → 弹窗 → 点「先不用，关掉吧」
  console.log("\n场景 A：全新用户第一次打开 → 弹窗 → 点「先不用，关掉吧」");
  const a = await startServer("a");
  try {
    let r = await api(a.port, "/api/proactive");
    check("① GET 状态码 200", r.status, 200, r.json);
    // ★★ 这条是端到端抓出来的真 bug 留下的：默认 enabled=true，早先的判据
    //    `if (enabled) return {shouldAsk:false}` 会把全新用户直接短路掉 ⇒ 弹窗永远不弹。
    check("② 第一次打开 ⇒ shouldAsk=true", r.json.shouldAsk, true, r.json);
    check("③ 默认确实是开启（10-13 定）", r.json.settings.enabled, true, r.json);
    check("④ 还没问过（asked=false）", r.json.settings.asked, false, r.json);

    r = await api(a.port, "/api/proactive", "POST", { enabled: false, asked: true }, a.token);
    check("⑤ 回答后 shouldAsk 立刻变 false", r.json.shouldAsk, false, r.json);
    check("⑥ asked 已落库", r.json.settings.asked, true, r.json);
    check("⑦ 关掉了", r.json.settings.enabled, false, r.json);

    // ★ 关键：再取一次（模拟第二天重新打开），不能再问
    r = await api(a.port, "/api/proactive");
    check("⑧ 重新打开 ⇒ 不再问（shouldAsk=false）", r.json.shouldAsk, false, r.json);
    check("⑨ asked 读回来还是 true", r.json.settings.asked, true, r.json);
    check("⑩ 开关保持关着", r.json.settings.enabled, false, r.json);
  } finally { await a.stop(); }

  // ---------------------------------------------------------------- 场景 B：全新用户 → 弹窗 → 点「好，就让她这样」
  console.log("\n场景 B：全新用户第一次打开 → 弹窗 → 点「好，就让她这样」");
  const b = await startServer("b");
  try {
    let r = await api(b.port, "/api/proactive");
    check("① 第一次打开 ⇒ shouldAsk=true", r.json.shouldAsk, true, r.json);

    r = await api(b.port, "/api/proactive", "POST", { enabled: true, asked: true }, b.token);
    check("② 保持开启（enabled=true）", r.json.settings.enabled, true, r.json);
    check("③ asked=true", r.json.settings.asked, true, r.json);
    check("④ 不再问", r.json.shouldAsk, false, r.json);

    r = await api(b.port, "/api/proactive");
    check("⑤ 重新打开 ⇒ 不再问", r.json.shouldAsk, false, r.json);
    check("⑥ 开关状态保持开着", r.json.settings.enabled, true, r.json);
  } finally { await b.stop(); }

  // ---------------------------------------------------------------- 场景 C：Esc / 点遮罩关窗
  console.log("\n场景 C：按 Esc / 点遮罩关窗（前端补发 enabled:false + asked:true）");
  const c = await startServer("c");
  try {
    let r = await api(c.port, "/api/proactive");
    check("① 全新用户该问", r.json.shouldAsk, true, r.json);
    r = await api(c.port, "/api/proactive", "POST", { enabled: false, asked: true }, c.token);
    check("② 关掉也算答过 ⇒ 不再问", r.json.shouldAsk, false, r.json);
    check("③ 关掉了", r.json.settings.enabled, false, r.json);
  } finally { await c.stop(); }

  // ---------------------------------------------------------------- 场景 D：设置页里自己动开关
  console.log("\n场景 D：用户没走弹窗，直接在设置页里把开关动了一下");
  const d = await startServer("d");
  try {
    let r = await api(d.port, "/api/proactive");
    check("① 一开始 shouldAsk=true", r.json.shouldAsk, true, r.json);
    // ★ 设置页自己开 ⇒ 服务端会顺手把 asked 置 1（等于"我已经知道了"）
    r = await api(d.port, "/api/proactive", "POST", { enabled: true }, d.token);
    check("② 开了就算答过（asked 自动置 1）", r.json.settings.asked, true, r.json);
    check("③ 不再问", r.json.shouldAsk, false, r.json);
  } finally { await d.stop(); }

  // ---------------------------------------------------------------- 场景 E：只改别的设置，不该影响 asked
  console.log("\n场景 E：只改时段/频次，不该把 asked 顺手改掉");
  const e = await startServer("e");
  try {
    let r = await api(e.port, "/api/proactive");
    check("① 全新用户 shouldAsk=true", r.json.shouldAsk, true, r.json);
    r = await api(e.port, "/api/proactive", "POST", { windowStart: "21:00", maxPerWeek: "3" }, e.token);
    check("② asked 还是 false（没被顺手改）", r.json.settings.asked, false, r.json);
    check("③ 仍然该问", r.json.shouldAsk, true, r.json);
    check("④ 时段改掉了", r.json.settings.windowStart, "21:00", r.json);
    check("⑤ 周上限改掉了", r.json.settings.maxPerWeek, 3, r.json);
  } finally { await e.stop(); }

  // ---------------------------------------------------------------- 场景 F：令牌闸不能是摆设
  console.log("\n场景 F：写操作不带会话令牌必须被拒（第 ② 道闸）");
  const f = await startServer("f");
  try {
    const r = await api(f.port, "/api/proactive", "POST", { enabled: false, asked: true });
    check("① 不带令牌 ⇒ 403", r.status, 403, r.json);
    // ★ 令牌必须是 ASCII：HTTP 头放不下中文（会直接抛 ByteString 错）
    const bad = await api(f.port, "/api/proactive", "POST", { enabled: false, asked: true }, "wrong-token-0123456789abcdef");
    check("② 令牌不对 ⇒ 403", bad.status, 403, bad.json);
    const after = await api(f.port, "/api/proactive");
    check("③ 被拒之后 asked 没被改（闸真挡住了）", after.json.settings.asked, false, after.json);
  } finally { await f.stop(); }

  console.log(`\n端到端：${pass} 条通过，${fails.length} 条失败`);
  if (fails.length) { console.log(fails.map((x) => `  \u2717 ${x}`).join("\n")); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error("端到端跑挂了：", e); process.exit(2); });
