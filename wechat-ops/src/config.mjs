import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function parseDotEnv(text) {
  const result = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

export function loadConfig({ cwd = process.cwd(), env = process.env } = {}) {
  const baseDir = cwd.endsWith("wechat-ops") ? cwd : resolve(cwd, "wechat-ops");
  const localEnvPath = resolve(baseDir, ".env.local");
  const fileEnv = existsSync(localEnvPath) ? parseDotEnv(readFileSync(localEnvPath, "utf8")) : {};
  const merged = { ...fileEnv, ...env };

  return {
    appId: merged.WECHAT_APP_ID || "",
    appSecret: merged.WECHAT_APP_SECRET || "",
    accessToken: merged.WECHAT_ACCESS_TOKEN || "",
    outputDir: resolve(baseDir, merged.WECHAT_OPS_OUTPUT_DIR || "reports")
  };
}
