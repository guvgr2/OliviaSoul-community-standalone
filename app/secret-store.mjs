// API Key 的 DPAPI 存取。
//
// 竞品那条值得抄的是「Key 用 DPAPI 按当前 Windows 用户加密，明确不进日志」——
// 我们只抄这个**做法**（Windows 原生 API，谁都能调），不抄他的代码。
// 明文只在临时文件里存在一瞬间，用完立刻删；不经命令行传参（参数会出现在进程列表里）。
//
// 明文承诺：Key 不写日志、不进诊断包、不进导出包、不随数据目录搬走。
// （换 Windows 用户或换机器后密文解不开 —— 这是预期行为，届时让用户重新填一次。）

import { writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { dirname, join as pathJoin } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = pathJoin(HERE, "dpapi.ps1");

function run(mode, inFile, outFile) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-Mode", mode, "-In", inFile, "-Out", outFile],
      { windowsHide: true, timeout: 30000, maxBuffer: 1 << 20 },
      (error, stdout) => {
        if (error) return reject(new Error(`DPAPI ${mode} 失败：${error.message}`));
        resolve(stdout);
      },
    );
  });
}

async function tempPath(tag) {
  return join(tmpdir(), `linli-${tag}-${randomBytes(8).toString("hex")}.bin`);
}

/** 加密。返回 base64 密文。 */
export async function protect(plaintext) {
  if (!plaintext) throw new Error("没有可加密的内容");
  const inFile = await tempPath("in");
  const outFile = await tempPath("out");
  try {
    await writeFile(inFile, Buffer.from(String(plaintext), "utf8"));
    await run("protect", inFile, outFile);
    return (await readFile(outFile, "utf8")).trim();
  } finally {
    await rm(inFile, { force: true });
    await rm(outFile, { force: true });
  }
}

/** 解密。返回明文；解不开就抛错（换用户/换机器后会走到这里）。 */
export async function unprotect(blob) {
  if (!blob) return "";
  const inFile = await tempPath("in");
  const outFile = await tempPath("out");
  try {
    await writeFile(inFile, String(blob), "utf8");
    await run("unprotect", inFile, outFile);
    return (await readFile(outFile, "utf8")).trim();
  } finally {
    await rm(inFile, { force: true });
    await rm(outFile, { force: true });
  }
}

export async function runSecretPipeline(mode, value) {
  return mode === "protect" ? protect(value) : unprotect(value);
}
