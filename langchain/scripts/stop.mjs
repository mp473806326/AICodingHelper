/**
 * 结束本服务相关进程，解决 Windows 上 Ctrl+C 留下孤儿 node 的问题。
 * 用法: npm run stop
 *
 * 策略：
 * 1) 结束占用 PORT（默认 3000）的 LISTENING 进程
 * 2) 再按命令行匹配 agent.mjs（防止端口已换但仍在跑）
 */
import { execSync } from "node:child_process";

const PORT = process.env.PORT || "3000";

function listeningPids(port) {
  try {
    const out = execSync("netstat -ano", { encoding: "utf8" });
    const pids = new Set();
    const portRe = new RegExp(`:${port}\\s`);
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes("LISTENING") || !portRe.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts.at(-1);
      if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

function agentMjsPids() {
  if (process.platform !== "win32") return [];
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Where-Object { $_.CommandLine -match \'agent\\\\.mjs\' } | Select-Object -ExpandProperty ProcessId"',
      { encoding: "utf8" },
    );
    return [
      ...new Set(
        out
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => /^\d+$/.test(s) && s !== "0"),
      ),
    ];
  } catch {
    return [];
  }
}

function killPid(pid) {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "inherit" });
    } else {
      execSync(`kill -9 ${pid}`, { stdio: "inherit" });
    }
    console.log(`已结束进程 PID ${pid}`);
    return true;
  } catch (err) {
    console.error(`无法结束 PID ${pid}:`, err.message);
    return false;
  }
}

const pids = new Set([...listeningPids(PORT), ...agentMjsPids()]);
if (pids.size === 0) {
  console.log(`未发现占用端口 ${PORT} 或运行 agent.mjs 的进程。`);
  process.exit(0);
}

for (const pid of pids) {
  killPid(pid);
}
