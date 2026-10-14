// 协议文本的解析器（纯函数，无副作用）。
//
// 单独一个文件的原因：**生成器不能被测**。`sync-legal.mjs` 一被 import 就会重写 legal.js，
// 那样"两边不一致"这条测试永远绿 —— 测试自己把被测对象修好了（旧项目踩过的那个坑）。

/** 协议.txt → { title, lead, sections[], tail } */
export function parseLegal(raw) {
  // ★ 顺手把 `\r\n` 与**单独的 `\r`**（老 Mac / 混合换行）都归一。
  //   只写 `\r\n` 的话，一份 CRLF 文件里混一个裸 `\r` 就会让那一个字进到正文里 ——
  //   而"两边必须逐字一致"这类判据会因此假红。
  const text = String(raw).replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  const lines = text.split("\n");
  const title = (lines.find((l) => l.trim()) ?? "").trim();
  const sections = [];
  const lead = [];
  const tail = [];
  let cur = null;
  for (const line of lines) {
    if (line.trim() === title) continue;
    // ★ 量词必须是 `+`，不能只匹配一个字：
    //   写成 `/^[一二三四五六七八九十]、/u` 时，「十一、…」的第二字是「一」不是「、」，
    //   ⇒ 这一整节不会被当成一节，而是被悄悄拼进第十条的正文里（条数静默少一条，
    //      而且第十条的 body 里会多出一段别人的内容）。协议条数一上两位数就踩。
    if (/^[一二三四五六七八九十]+、/u.test(line.trim())) {
      cur = { head: line.trim(), body: [] };
      sections.push(cur);
      continue;
    }
    if (/^勾选/u.test(line.trim())) { cur = null; tail.push(line); continue; }
    if (cur) cur.body.push(line);
    else if (sections.length === 0) lead.push(line);
    else tail.push(line);
  }
  const trim = (arr) => arr.join("\n").replace(/^\n+|\n+$/gu, "").replace(/\n{3,}/gu, "\n\n");
  return {
    title,
    lead: trim(lead),
    sections: sections.map((s) => ({ head: s.head, body: trim(s.body) })),
    tail: trim(tail),
  };
}

export const LEGAL_PATHS = {
  source: "协议.txt",
  generated: "app/public/legal.js",
  installer: "install.iss",
};
