// 「林离的信」前端。
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `请求失败（${response.status}）`);
  return payload;
}

// ---------------------------------------------------------------- 页面切换

const PAGES = ["mail", "memory", "settings"];
function show(page) {
  for (const name of PAGES) {
    const el = $(`page-${name}`);
    if (el) el.classList.toggle("on", name === page);
  }
  for (const btn of document.querySelectorAll(".rb")) {
    btn.classList.toggle("on", btn.dataset.page === page);
  }
  if (page === "memory") loadMemory();
  if (page === "settings") loadSettings();
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

const PROVIDER_PRESETS = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  zhipu: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.6" },
  moonshot: { baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2-0905" },
  custom: { baseUrl: "http://127.0.0.1:11434/v1", model: "" },
};

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
    $("proactiveVerdict").textContent = data.verdict?.ok
      ? `现在可以写（${data.verdict.trigger?.kind ?? ""}）`
      : `现在不发：${data.verdict?.reason ?? ""}`;
  } catch (error) {
    toast(error.message);
  }
}

$("provider").addEventListener("change", () => {
  const preset = PROVIDER_PRESETS[$("provider").value];
  if (!preset) return;
  if (!$("baseUrl").value.trim() || confirm("用这个服务商的默认接口地址和模型名覆盖当前填写？")) {
    $("baseUrl").value = preset.baseUrl;
    if (preset.model) $("modelName").value = preset.model;
  }
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

// ---------------------------------------------------------------- 启动

loadLetters();
setInterval(loadLetters, 5000);
