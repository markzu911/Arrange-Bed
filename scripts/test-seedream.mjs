import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const apiKey = process.env.ARK_API_KEY || process.env.SEEDREAM_API_KEY;
const model = process.env.SEEDREAM_MODEL || "doubao-seedream-5-0-pro-260628";
const apiBase = process.env.SEEDREAM_API_BASE || "https://ark.cn-beijing.volces.com/api/v3";
const size = process.env.SEEDREAM_SIZE || "1K";

if (!apiKey) {
  console.error("Missing ARK_API_KEY. In PowerShell, run:");
  console.error('$env:ARK_API_KEY="your ark key"');
  process.exit(1);
}

const body = {
  model,
  prompt: "一张现代卧室床品近景细节测试图，真实摄影风格，柔和自然光，展示床品材质、缝线、软包和被面层次。",
  response_format: "url",
  size,
  stream: false,
  watermark: false
};

const started = Date.now();
const { status, raw, transport } = await requestSeedream(body);

let data;
try {
  data = JSON.parse(raw);
} catch {
  data = undefined;
}

const imageUrl = Array.isArray(data?.data)
  ? data.data.find((item) => typeof item?.url === "string")?.url
  : "";
const ok = status >= 200 && status < 300;
const errorMessage = data?.error?.message || data?.message || (!ok ? raw.slice(0, 500) : "");

console.log(JSON.stringify({
  ok,
  status,
  transport,
  elapsedMs: Date.now() - started,
  model,
  size,
  hasImageUrl: Boolean(imageUrl),
  imageUrl,
  errorMessage
}, null, 2));

if (!ok || !imageUrl) {
  process.exit(1);
}

async function requestSeedream(requestBody) {
  try {
    const response = await fetch(`${apiBase}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    return {
      status: response.status,
      raw: await response.text(),
      transport: "node-fetch"
    };
  } catch (error) {
    console.warn("node-fetch failed, retrying with curl.exe...");
    console.warn(formatTransportError(error));
    return requestWithCurl(requestBody);
  }
}

async function requestWithCurl(requestBody) {
  const tempDir = await mkdtemp(join(tmpdir(), "seedream-test-"));
  const bodyPath = join(tempDir, "body.json");
  const configPath = join(tempDir, "curl.conf");
  try {
    await writeFile(bodyPath, JSON.stringify(requestBody), "utf8");
    await writeFile(configPath, [
      `url = "${apiBase}/images/generations"`,
      "request = POST",
      'header = "Content-Type: application/json"',
      `header = "Authorization: Bearer ${apiKey}"`,
      `data-binary = "@${bodyPath.replace(/\\/g, "\\\\")}"`,
      "http1.1",
      "connect-timeout = 30",
      "max-time = 180",
      "retry = 2",
      "retry-all-errors",
      "retry-delay = 3",
      "silent",
      "show-error",
      'write-out = "\\n__HTTP_STATUS__:%{http_code}\\n__TIME_TOTAL__:%{time_total}\\n"'
    ].join("\n"), "utf8");

    const { stdout, stderr, code } = await runCurl(["--config", configPath]);

    if (code !== 0) {
      const redacted = `${stderr || ""}\n${stdout || ""}`.replaceAll(apiKey, "[REDACTED]");
      throw new Error(`curl.exe failed with code ${code}: ${redacted.trim()}`);
    }

    const statusMatch = stdout.match(/\n__HTTP_STATUS__:(\d+)\n__TIME_TOTAL__:[\d.]+\s*$/);
    const status = statusMatch ? Number(statusMatch[1]) : 0;
    const raw = statusMatch ? stdout.slice(0, statusMatch.index).trim() : stdout.trim();
    return { status, raw, transport: "curl.exe" };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function runCurl(args) {
  return new Promise((resolve) => {
    const child = spawn("curl.exe", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: error.message });
    });
  });
}

function formatTransportError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : "";
  const address = cause && typeof cause === "object" && "remoteAddress" in cause ? cause.remoteAddress : "";
  return `${error.name}: ${error.message}${code ? ` (${code})` : ""}${address ? ` remote=${address}` : ""}`;
}
