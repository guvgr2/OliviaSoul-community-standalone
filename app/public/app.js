// 「OliviaSoul-community独立版」前端。
// 三块：信箱 / 记忆 / 设置。所有请求都打本地服务，不出本机。

const $ = (id) => document.getElementById(id);
let toastTimer = null;

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 2600);
}

// 会话令牌：服务端的写操作要它，防止本机其它进程（或任意网页）改配置。
// 令牌只发给通过来源检查的同源页面，取不到就说明我们不在自己的页面里。
let sessionToken = null;

async function ensureToken() {
  if (sessionToken) return sessionToken;
  const data = await api("/api/session");
  sessionToken = data.token;
  return sessionToken;
}

async function api(path, options = {}) {
  const method = options.method ?? "GET";
  const headers = {};
  if (options.body) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
    headers["X-Linli-Token"] = await ensureToken();
  }
  const response = await fetch(path, { method, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `请求失败（${response.status}）`);
  return payload;
}

// ---------------------------------------------------------------- 页面切换

const PAGES = ["mail", "library", "memory", "settings"];
function show(page) {
  // 离开曲库页就停掉时段轮询并卸掉播放器，别在后台继续解码 100MB 级的视频
  if (page !== "library") stopPlayerWatch();
  for (const name of PAGES) {
    const el = $(`page-${name}`);
    if (el) el.classList.toggle("on", name === page);
  }
  for (const btn of document.querySelectorAll(".rb")) {
    btn.classList.toggle("on", btn.dataset.page === page);
  }
  if (page === "memory") loadMemory();
  if (page === "settings") loadSettings();
  if (page === "library") loadLibrary();
}
for (const btn of document.querySelectorAll(".rb")) {
  btn.addEventListener("click", () => show(btn.dataset.page));
}

// ---------------------------------------------------------------- 信箱

function formatTime(seconds) {
  if (!seconds) return "";
  const d = new Date(seconds * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderLetters(letters) {
  const host = $("letters");
  if (!letters.length) {
    host.innerHTML = `<p class="hint">还没有信。写下第一句吧。</p>`;
    return;
  }
  const parts = [];
  for (const item of letters) {
    const proactive = item.origin === "proactive";
    if (!proactive) {
      parts.push(`
        <div class="letter">
          <div class="meta"><span class="who me">我</span><span class="when">${formatTime(item.created_at)}</span></div>
          <div class="body">${escapeHtml(item.content)}</div>
        </div>`);
    }
    const state = item.status === 5
      ? `<div class="body err">${escapeHtml(item.error ?? "生成失败")}</div>`
      : item.reply_text
        ? `<div class="body">${escapeHtml(item.reply_text)}</div>`
        : `<div class="body pending">她还在写……</div>`;
    const unread = item.is_read === 0 ? `<span class="unread-dot"></span>` : "";
    const tag = proactive ? `<span class="tag">她先写的</span>` : "";
    parts.push(`
      <div class="letter">
        <div class="meta"><span class="who her">林离</span>${tag}${unread}<span class="when">${formatTime(item.replied_at || item.created_at)}</span></div>
        ${state}
      </div>`);
    if (item.is_read === 0 && item.reply_text) {
      fetch(`/api/letters/${encodeURIComponent(item.id)}/read`, { method: "POST" }).catch(() => {});
    }
  }
  host.innerHTML = parts.join("");
}

async function loadLetters() {
  try {
    const { letters } = await api("/api/letters");
    renderLetters(letters);
  } catch (error) {
    toast(error.message);
  }
}

$("sendBtn").addEventListener("click", async () => {
  const content = $("compose").value.trim();
  if (!content) return toast("信是空的");
  const btn = $("sendBtn");
  btn.disabled = true;
  btn.textContent = "寄出中……";
  try {
    await api("/api/letters", { method: "POST", body: { content } });
    $("compose").value = "";
    toast("已寄出，等她回信");
    await loadLetters();
  } catch (error) {
    toast(error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "寄出";
  }
});

// ---------------------------------------------------------------- 曲库

async function loadLibrary() {
  try {
    const data = await api("/api/library");
    $("libraryDir").value = data.dir ?? "";
    $("libraryState").textContent = data.error
      ? data.error
      : `找到 ${data.count ?? 0} 首（目录名以 solo / playsing 开头）`;
    renderSongs(data.songs ?? []);
    await loadImported();
  } catch (error) {
    toast(error.message);
  }
}

function renderSongs(songs) {
  const host = $("songs");
  if (!songs.length) {
    host.innerHTML = `<p class="hint">这个目录下还没有曲目。</p>`;
    return;
  }
  host.innerHTML = songs.map((s) => `
    <div class="letter">
      <div class="meta"><span class="who her">${escapeHtml(s.name)}</span></div>
      <div class="body" style="color:var(--tx4);font-size:12px">${escapeHtml(s.dir)}</div>
    </div>`).join("");
}

async function loadImported() {
  const host = $("imported");
  if (!host) return;
  try {
    const { songs } = await api("/api/library/songs");
    if (!songs.length) {
      host.innerHTML = `<p class="hint">还没有导入任何曲子。点「随机导入一首」试试。</p>`;
      return;
    }
    host.innerHTML = songs.map((s) => `
      <div class="letter">
        <div class="meta">
          <span class="who her">${escapeHtml(s.name)}</span>
          <span class="tag">${s.variantCount} 个变体</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
          <button data-play="${escapeHtml(s.dir)}" data-name="${escapeHtml(s.name)}">按当前时段播放</button>
        </div>
      </div>`).join("");
    for (const btn of host.querySelectorAll("[data-play]")) {
      btn.addEventListener("click", () => play(btn.dataset.play, btn.dataset.name));
    }
  } catch (error) {
    host.innerHTML = `<p class="hint">${escapeHtml(error.message)}</p>`;
  }
}

// 时段边界：06:00 / 16:00 / 20:00 —— 与 core.mjs 的 playbackTimeOfDay 同口径，
// 傍晚从 16:00 起（不是 17:30，TOD1730 只是素材标签，别被名字骗了）。
const SLOT_BOUNDARIES = [360, 960, 1200];
let playerState = null;

function minutesNow() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function minutesToBoundary() {
  const m = minutesNow();
  for (const b of SLOT_BOUNDARIES) if (m < b) return b - m;
  return SLOT_BOUNDARIES[0] + 1440 - m; // 跨到次日 06:00
}
function stopPlayerWatch() {
  if (playerState?.timer) clearInterval(playerState.timer);
  if (playerState?.warmed) playerState.warmed.el.remove();
  playerState = null;
  const box = $("player");
  if (box && !box.dataset.keep) box.innerHTML = "";
}

/**
 * 时段跨越时不硬切：两个 video 叠加，旧的微放大淡出、新的微缩小淡入（900ms）。
 * 竞品是专门做了 Transition_1200_1730.mp4 这类转场片，我们没有转场素材，
 * 用交叉淡入等价实现，并在跨越前 90 秒把下一时段的文件预热好，避免切档黑屏。
 */
async function play(dir, name) {
  try {
    const info = await api(`/api/library/play?dir=${encodeURIComponent(dir)}`);
    if (!info.url) return toast("这首曲子在当前时段没有可用的变体");
    stopPlayerWatch();

    const box = $("player");
    box.innerHTML = `
      <p class="hint" style="margin-bottom:8px" id="playerMeta"></p>
      <div class="xfade">
        <video id="vA" controls autoplay playsinline></video>
        <video id="vB" controls playsinline class="under"></video>
      </div>
      <p class="hint" style="margin-top:8px" id="playerFile"></p>`;

    const st = { dir, name, tod: info.tod, active: "A", timer: null, warmed: null };
    playerState = st;
    $("vA").src = info.url;
    writePlayerMeta(info, name);

    st.timer = setInterval(async () => {
      try {
        const cur = await api(`/api/library/play?dir=${encodeURIComponent(dir)}`);
        if (cur.tod !== st.tod && cur.url) {
          crossFadeTo(cur, name);
          st.tod = cur.tod;
          st.warmed = null;
        }
        // 距边界 90 分钟内就开始预热下一时段（本地文件，提前打开省去切档时的黑屏）
        if (!st.warmed && minutesToBoundary() <= 90) await warmNextSlot(st);
      } catch { /* 轮询失败就下一轮再试，不打扰用户 */ }
    }, 30000);

    setSetting2("last_played_title", name);
    api("/api/library/played", { method: "POST", body: { title: name } }).catch(() => {});
  } catch (error) {
    toast(error.message);
  }
}

function writePlayerMeta(info, name) {
  const meta = $("playerMeta");
  const file = $("playerFile");
  if (meta) meta.textContent = `${name} · ${info.label}（${info.tod}）· 共 ${info.variantCount} 个变体 · 视角 ${info.view}`;
  if (file) file.textContent = info.file ?? "";
}

function crossFadeTo(info, name) {
  const st = playerState;
  if (!st) return;
  const a = $("vA"), b = $("vB");
  const incoming = st.active === "A" ? b : a;
  const outgoing = st.active === "A" ? a : b;
  incoming.src = info.url;
  incoming.play().catch(() => {});
  incoming.classList.remove("under");
  outgoing.classList.add("under");
  // 转场走完把旧的停掉，别让它继续占解码
  setTimeout(() => outgoing.pause(), 950);
  st.active = st.active === "A" ? "B" : "A";
  writePlayerMeta(info, name);
}

/** 提前把下一时段的文件交给一个隐藏 video 预热（不显示、不出声）。 */
async function warmNextSlot(st) {
  const order = ["TOD12", "TOD1730", "TOD20"];
  const next = order[(order.indexOf(st.tod) + 1) % order.length];
  try {
    const info = await api(`/api/library/play?dir=${encodeURIComponent(st.dir)}&tod=${next}`);
    if (!info.url || info.tod === st.tod) return;
    const warm = document.createElement("video");
    warm.preload = "auto";
    warm.muted = true;
    warm.style.display = "none";
    warm.src = info.url;
    document.body.appendChild(warm);
    st.warmed = { el: warm, tod: info.tod };
  } catch { /* 预热失败不影响正常切换 */ }
}

function setSetting2(key, value) { try { localStorage.setItem(key, value); } catch { /* 无痕模式下忽略 */ } }

$("saveLibraryDir").addEventListener("click", async () => {
  try {
    await api("/api/library/dir", { method: "POST", body: { dir: $("libraryDir").value.trim() } });
    toast("已保存");
    await loadLibrary();
  } catch (error) {
    toast(error.message);
  }
});

$("importRandom").addEventListener("click", async () => {
  const btn = $("importRandom");
  btn.disabled = true;
  btn.textContent = "导入中……";
  try {
    const data = await api("/api/library");
    const songs = data.songs ?? [];
    if (!songs.length) return toast("这个目录下没有曲目");
    const pick = songs[Math.floor(Math.random() * songs.length)];
    await api("/api/library/import", { method: "POST", body: { dir: pick.dir } });
    toast(`已导入：${pick.name}`);
    await loadImported();
  } catch (error) {
    toast(error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "随机导入一首";
  }
});

// ---------------------------------------------------------------- 记忆

const LEDGER_ORDER = [
  "关系", "关系依据", "已承认情感", "已承认称呼", "既有亲密", "既有边界",
  "亲密上限", "本封亲密判定", "说话者", "未决", "摘要待核实", "事实伪造", "结论",
];

async function loadMemory() {
  try {
    const data = await api("/api/memory");
    const entries = Object.entries(data.ledger ?? {});
    const dl = $("ledger");
    if (!entries.length) {
      dl.innerHTML = "";
      $("ledgerEmpty").style.display = "block";
    } else {
      $("ledgerEmpty").style.display = "none";
      const ordered = [...entries].sort((a, b) => {
        const ia = LEDGER_ORDER.indexOf(a[0]);
        const ib = LEDGER_ORDER.indexOf(b[0]);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      dl.innerHTML = ordered.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v || "—")}</dd>`).join("");
    }
    $("ctx").textContent = data.context ?? "";
  } catch (error) {
    toast(error.message);
  }
}

// ---------------------------------------------------------------- 设置

// 2026-10-13 核对过一轮（1.0.0 那版写的是 deepseek-chat / glm-4.6 / kimi-k2-0905，
// 全是过时编号；deepseek-chat 与 deepseek-reasoner 官方已在 2026-07-24 退役）。
// 型号会一直变，所以这里是「候选 + 可自己填」，不是写死一个。
const PROVIDER_PRESETS = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    models: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4"],
    note: "deepseek-chat / deepseek-reasoner 已退役，别再填。",
  },
  zhipu: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-5.3", "glm-5.3-flash", "glm-5.2", "glm-5.1"],
    note: "开放平台与 Z.ai 的编号节奏不同，以你的控制台为准。",
  },
  moonshot: {
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6", "kimi-k2.5"],
    note: "国际区用 api.moonshot.ai。",
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen3.7-plus", "qwen3.6-plus", "qwen-plus"],
    note: "阿里云百炼；新加坡、美国与 Coding Plan 是不同地址。",
  },
  minimax: {
    baseUrl: "https://api.minimaxi.com/v1",
    models: ["MiniMax-M3", "MiniMax-M2.7"],
    note: "型号以官方控制台为准。",
  },
  custom: {
    baseUrl: "http://127.0.0.1:11434/v1",
    models: [],
    note: "本地 / 中转：自己填地址和模型名。",
  },
};

function fillModelList(provider) {
  const list = document.getElementById("modelList");
  const preset = PROVIDER_PRESETS[provider];
  if (!list || !preset) return;
  list.innerHTML = (preset.models ?? []).map((m) => `<option value="${m}"></option>`).join("");
}

async function loadSettings() {
  try {
    const model = await api("/api/model");
    $("provider").value = model.provider ?? "deepseek";
    $("baseUrl").value = model.baseUrl ?? "";
    $("modelName").value = model.model ?? "";
    $("apiKey").value = "";
    $("apiKey").placeholder = model.hasKey ? "已保存（DPAPI 加密），留空表示不修改" : "还没有填写";
    $("modelState").textContent = model.hasKey ? "Key 已保存" : "还没有 Key";

    const data = await api("/api/proactive");
    const s = data.settings;
    $("pEnabled").value = s.enabled ? "1" : "0";
    $("pStart").value = s.windowStart;
    $("pEnd").value = s.windowEnd;
    $("pGap").value = s.minGapHours;
    $("pDay").value = s.maxPerDay;
    $("pWeek").value = s.maxPerWeek;
    // ★ 用 trigger.label（人话），不要 trigger.kind —— 那是内部代号，
    //   原样渲染出来会变成「现在可以写（song_played）」。
    $("proactiveVerdict").textContent = data.verdict?.ok
      ? `现在可以写：由头是「${data.verdict.trigger?.label ?? "她惦记着一件小事"}」`
      : `现在不发：${data.verdict?.reason ?? ""}`;
    maybeAskProactive(data.shouldAsk);
  } catch (error) {
    toast(error.message);
  }
}

// ---------------------------------------------------------------- 第一次打开时的询问弹窗
//
// ★ 用户 2026-10-14 定：主动来信**默认开启** ⇒ 这个弹窗问的不是"要不要打开"，
//   而是「确认 / 关掉」—— 告知一次她会在什么时候写信、有多克制，顺便给一次反悔的机会。
//   ⇒ 点"好，就让她这样" ⇒ 保持开着；点"先不用，关掉吧" / Esc / 遮罩 ⇒ 关掉。
// ★ 只问一次：以上每一种都算答过（asked=true），不再天天问。
(function introAsk() {
  const modal = $("introModal");
  if (!modal) return;
  let lastFocus = null;
  let answered = false;

  function close() {
    modal.hidden = true;
    // ★ 关掉也算答过：不然每开一次问一次，比不写信还烦人。
    if (!answered) send(false);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  async function send(yes) {
    answered = true;
    try {
      await api("/api/proactive", { method: "POST", body: { enabled: yes, asked: true } });
      await loadSettings();
      toast(yes ? "她会偶尔给你写信 —— 随时可以在设置里关掉。" : "已经关掉了，她只会在你先写信时回信。");
    } catch (error) {
      toast(error.message);
    }
  }
  window.__maybeAskProactive = (shouldAsk) => {
    if (!shouldAsk || !modal.hidden) return;
    lastFocus = document.activeElement;
    modal.hidden = false;
    $("introYes")?.focus();
  };
  // ★ 走 close() 而不只是 hidden=true：close() 会顺便把焦点还回去。
  //   send() 一进来就把 answered 置 true（同步），所以 close() 不会再补发一次。
  $("introYes")?.addEventListener("click", () => { void send(true); close(); });
  $("introNo")?.addEventListener("click", () => { void send(false); close(); });
  modal.addEventListener("click", (e) => { if (e.target.dataset.close === "1") close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) close();
  });
})();

function maybeAskProactive(shouldAsk) {
  window.__maybeAskProactive?.(shouldAsk);
}

// ---------------------------------------------------------------- 弹窗的液态玻璃高光
//
// ★ 配方跟 design-preview 第 2 节一致：高光斑跟着指针走。
//   CSS 里写的默认值 --mx:22% / --my:6% 就是"指针还没进来"的样子（跟飞机版一样钉在左上）。
// ★ 每个 .modal-box 各自记自己的高光位置，所以上一次弹窗的指针位置不会串到下一个弹窗上。
(function glassHighlight() {
  for (const box of document.querySelectorAll(".modal-box")) {
    box.addEventListener("pointermove", (e) => {
      const r = box.getBoundingClientRect();
      if (!r.width || !r.height) return;
      box.style.setProperty("--mx", `${Math.round((e.clientX - r.left) / r.width * 1000) / 10}%`);
      box.style.setProperty("--my", `${Math.round((e.clientY - r.top) / r.height * 1000) / 10}%`);
    });
  }
})();

$("provider").addEventListener("change", () => {
  const preset = PROVIDER_PRESETS[$("provider").value];
  if (!preset) return;
  fillModelList($("provider").value);
  if (!$("baseUrl").value.trim() || confirm("用这个服务商的默认接口地址覆盖当前填写？")) {
    $("baseUrl").value = preset.baseUrl;
  }
  if (preset.models?.length && !preset.models.includes($("modelName").value.trim())) {
    $("modelName").value = preset.models[0];
  }
  $("modelState").textContent = preset.note ?? "";
});

$("saveModel").addEventListener("click", async () => {
  const patch = {
    provider: $("provider").value,
    baseUrl: $("baseUrl").value.trim(),
    model: $("modelName").value.trim(),
  };
  const key = $("apiKey").value;
  if (key) patch.apiKey = key;
  try {
    const { model } = await api("/api/model", { method: "POST", body: patch });
    $("apiKey").value = "";
    $("apiKey").placeholder = model.hasKey ? "已保存（DPAPI 加密），留空表示不修改" : "还没有填写";
    $("modelState").textContent = model.hasKey ? "Key 已保存" : "还没有 Key";
    toast("已保存");
  } catch (error) {
    toast(error.message);
  }
});

$("testModel").addEventListener("click", async () => {
  const btn = $("testModel");
  btn.disabled = true;
  btn.textContent = "测试中……";
  try {
    const result = await api("/api/model/test", { method: "POST" });
    toast(result.ok ? `通了：${result.sample ?? ""}` : `不通：${result.error}`);
  } catch (error) {
    toast(error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "测试连通性";
  }
});

$("saveProactive").addEventListener("click", async () => {
  const num = (id, fallback) => {
    const n = Number($(id).value);
    return Number.isFinite(n) ? n : fallback;
  };
  const patch = {
    enabled: $("pEnabled").value === "1",
    windowStart: $("pStart").value.trim() || "09:00",
    windowEnd: $("pEnd").value.trim() || "21:30",
    minGapHours: num("pGap", 20),
    maxPerDay: num("pDay", 1),
    maxPerWeek: num("pWeek", 3),
  };
  try {
    await api("/api/proactive", { method: "POST", body: patch });
    toast("已保存");
    await loadSettings();
  } catch (error) {
    toast(error.message);
  }
});

$("checkProactive").addEventListener("click", async () => {
  const btn = $("checkProactive");
  btn.disabled = true;
  btn.textContent = "判断中……";
  try {
    const result = await api("/api/proactive/check", { method: "POST", body: {} });
    toast(result.sent ? "她写了一封新的" : `没写：${result.reason}`);
    await loadLetters();
  } catch (error) {
    toast(error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "现在判断一次";
  }
});

// ---------------------------------------------------------------- 液态玻璃交互
// 与设计预览（design-preview.html ② 节）同一套：指针位置 → 高光跟着走；
// 进入 → 扫一道光；按下 → 从指针位置散两层涟漪。**参数全在 styles.css 里**，这里只管接线。
// ★ 三处不能改：
//   ① 用 pointerdown 不是 click —— 按下那一刻就要有反馈，等到 click 就晚了半拍；
//   ② 进入时要先 remove 再 void offsetWidth 再 add —— 不强制重排，第二次进入不会重放动画；
//   ③ 涟漪用完后要 remove —— 不删的话连点十次就是十个 span 挂在按钮里。
(function enableGlass() {
  function upgrade(el) {
    if (el.dataset.glass === "1") return;
    el.dataset.glass = "1";
    const sheen = document.createElement("span");
    sheen.className = "sheen";
    el.appendChild(sheen);

    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100) + "%");
      el.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100) + "%");
    });
    el.addEventListener("pointerenter", () => {
      el.classList.remove("sheen-on");
      void el.offsetWidth;                       // 强制重排，否则连续进入不放第二遍
      el.classList.add("sheen-on");
    });
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const big = Math.max(r.width, r.height) * 2.1;
      [[big, "ripple"], [big * 1.5, "ripple two"]].forEach(([size, cls]) => {
        const d = document.createElement("span");
        d.className = cls;
        d.style.width = d.style.height = size + "px";
        d.style.left = x + "px";
        d.style.top = y + "px";
        el.appendChild(d);
        setTimeout(() => d.remove(), 1000);
      });
    });
  }

  // 信件/曲目/已导入里的按钮都是**动态渲染**出来的 ⇒ 每次 DOM 变了都要再扫一遍。
  // dataset.glass 的守卫保证幂等，所以重复扫不会重复接线。
  // ★ 排除 .lnk（协议那行小链接）：它要的是"低对比、不抢版面"，
  //   套上跟随高光反而把它变成视觉焦点，跟放这行字的用意相反。
  const SELECTOR = "button:not(.lnk), .rb";
  function scan() {
    document.querySelectorAll(SELECTOR).forEach(upgrade);
  }
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
})();

// ---------------------------------------------------------------- 协议弹层
//
// 正文来自 legal.js（由仓库根的 协议.txt 生成），HTML 里一个字都不抄 ——
// 抄一份就有两处会各改各的，而"设置页里看到的"和"安装时同意的"必须是同一份。
(function legalModal() {
  const modal = document.getElementById("legalModal");
  const titleEl = document.getElementById("legalTitle");
  const bodyEl = document.getElementById("legalBody");
  const hintEl = document.getElementById("legalHint");
  if (!modal || !titleEl || !bodyEl || !window.LEGAL) return;
  const L = window.LEGAL;
  // 正文在 协议.txt 里是缩进过的（给人读的排版），进 DOM 前把公共缩进去掉
  const dedent = (s) => String(s ?? "").replace(/^ {4}/gmu, "");
  // 隐私政策 = 数据在哪 / 唯一的对外连接 / 卸载会留下什么 —— 这三条才是"隐私"要回答的
  const PRIVACY = ["一、", "二、", "六、"];
  const pick = (keys) => L.sections.filter((s) => keys.some((k) => s.head.startsWith(k)));

  let lastFocus = null;
  function render(which) {
    const isPrivacy = which === "privacy";
    const secs = isPrivacy ? pick(PRIVACY) : L.sections;
    titleEl.textContent = isPrivacy ? "隐私政策" : L.title;
    bodyEl.textContent = "";
    const lead = document.createElement("p");
    lead.className = "lead";
    lead.textContent = L.lead;
    bodyEl.appendChild(lead);
    for (const s of secs) {
      const h = document.createElement("h4");
      h.textContent = s.head;
      bodyEl.appendChild(h);
      if (s.body) {
        const p = document.createElement("p");
        p.textContent = dedent(s.body);       // textContent：正文里的 %APPDATA%、< > 都当字面量
        bodyEl.appendChild(p);
      }
    }
    if (!isPrivacy && L.tail) {
      const p = document.createElement("p");
      p.className = "tail";
      p.textContent = L.tail;
      bodyEl.appendChild(p);
    }
    hintEl.textContent = isPrivacy ? `摘自《${L.title}》` : "安装时你同意的就是这份";
    bodyEl.scrollTop = 0;
  }
  function open(which) {
    lastFocus = document.activeElement;
    render(which);
    modal.hidden = false;
    modal.querySelector(".modal-x").focus();
  }
  function close() {
    modal.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();   // 焦点还回触发它的那个链接
  }
  document.getElementById("lnkTerms")?.addEventListener("click", () => open("terms"));
  document.getElementById("lnkPrivacy")?.addEventListener("click", () => open("privacy"));
  modal.addEventListener("click", (e) => { if (e.target.dataset.close === "1") close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) close();
  });
})();

// ---------------------------------------------------------------- 原生窗口

// ★ 外壳的 MainWindow 是**无边框**的，所以拖动、收进托盘、退出这三件事
//   得由页面发一句话给 C#（window.chrome.webview.postMessage），那边照做。
//   在浏览器里打开时没有这个通道 ⇒ 什么都不做、窗口条也不显示（那时浏览器自带标题栏）。
// ★ 判据是"有没有 chrome.webview"，不是"userAgent 里有没有 Edge" ——
//   UA 判断会误伤：Edge 里手动打开同一个地址也会匹配到，那是我们**没有**自己窗口的情况。
(function initNativeWindow() {
  const host = window.chrome && window.chrome.webview;
  if (!host) return;
  document.body.classList.add("native");
  const bar = document.getElementById("winchrome");
  if (!bar) return;
  bar.hidden = false;

  const say = (action) => { try { host.postMessage(action); } catch { /* 通道断了就算了 */ } };
  // 拖动：按在这条上（按钮除外）就叫窗口跟着走。
  bar.addEventListener("mousedown", (e) => { if (e.target.closest(".wc")) return; say("drag"); });
  document.getElementById("wcMin")?.addEventListener("click", () => say("min"));
  document.getElementById("wcQuit")?.addEventListener("click", () => say("quit"));
})();

// ---------------------------------------------------------------- 启动

// ★ 启动时要先读一次设置：第一次打开的询问弹窗挂在 loadSettings() 末尾。
//   不在这里调的话，只有用户自己点进「设置」页才会弹 —— 那就不叫"第一次打开时问"了。
//   （这一条是真渲染抓出来的：接口全 200、单测全绿，可弹窗就是不出现。）
loadSettings();

loadLetters();
setInterval(loadLetters, 5000);
