import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function detectEncoding(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return "utf8";
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return "utf16le";
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return "utf16be";
  }
  return "utf8";
}

export function loadEnvFile(envPath = null) {
  const candidates = [];
  if (envPath) candidates.push(path.resolve(envPath));
  const baseDir = path.dirname(fileURLToPath(import.meta.url));
  candidates.push(path.resolve(baseDir, ".env"));
  candidates.push(path.resolve(process.cwd(), ".env"));

  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (!fs.existsSync(candidate)) continue;

    const buffer = fs.readFileSync(candidate);
    const text = buffer.toString(detectEncoding(buffer));
    const normalized = text.replace(/\uFEFF/g, "").replace(/\r\n?/g, "\n");

    for (const line of normalized.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value.replace(/^['"]|['"]$/g, "");
      }
    }
    return true;
  }

  return false;
}
