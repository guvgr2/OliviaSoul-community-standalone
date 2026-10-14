// 从 协议.txt 生成 app/public/legal.js —— 协议**只有一份真源**。
//
// 为什么要生成而不是手抄一份进 app.js：抄一份就有两处会各改各的，
//   而"设置页里那份协议"和"安装时你同意的那份"必须是同一份（看到的和同意的是同一件事）。
//   tests/legal.test.js 会拿两边逐字比对，改了这边忘了那边直接红。
//
// 跑法：node tools/sync-legal.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseLegal } from "./legal-parse.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "协议.txt");
const DST = join(HERE, "..", "app", "public", "legal.js");

const legal = parseLegal(readFileSync(SRC, "utf8"));

const out = `// ★ 这个文件是**生成**的，不要手改。
//   真源：仓库根目录的 协议.txt（安装程序的 LicenseFile 用的也是它）。
//   改了 协议.txt 之后跑：node tools/sync-legal.mjs
//   tests/legal.test.js 会逐字比对两边，忘了同步就红。
window.LEGAL = ${JSON.stringify(legal, null, 2)};
`;
writeFileSync(DST, out, "utf8");
console.log(`saved ${DST}\n  ${legal.sections.length} 条：${legal.sections.map((s) => s.head.slice(0, 2)).join(" ")}`);
