import "dotenv/config";
import express from "express";
import { createDeepseekAgent } from "./models/deepseek.js";
import { createOpenaiAgent } from "./models/openai.js";
import { createTongyiQwenAgent } from "./models/TongyiQwen.js";
import { createAi21Agent } from "./models/ai21.js";
import { createAnthropicAgent } from "./models/anthropic.js";
import { createBaiduQianfanAgent } from "./models/baiduQianfan.js";
import { createGoogleGeminiAgent } from "./models/googleGemini.js";
import { createChatWriterAgent } from "./models/chatWriter.js";
import { createAzureOpenaiAgent } from "./models/azureOpenai.js";
import { createChatOllamaAgent } from "./models/chatOllama.js";
import { createDoubaoAgent } from "./models/doubao.js";
import {
  beginChangeBatch,
  undoLastChange,
  redoLastUndone,
  getChangeStatus,
  clearChangeHistory,
  getWorkspaceRoot,
  setWorkspaceRoot,
} from "./tools/fs.js";

/** 按需创建并缓存 agent，缺少 API Key 的模型不在启动时强制初始化 */
const agentCache = new Map();
const MODEL_FACTORIES = {
  deepseek: { name: "DeepSeek", create: createDeepseekAgent },
  openai: { name: "OpenAI", create: createOpenaiAgent },
  tongyiqwen: { name: "通义千问", create: createTongyiQwenAgent },
  doubao: { name: "豆包", create: createDoubaoAgent },
  ai21: { name: "AI21", create: createAi21Agent },
  anthropic: { name: "Anthropic", create: createAnthropicAgent },
  baiduqianfan: { name: "Baidu Qianfan", create: createBaiduQianfanAgent },
  googlegemini: { name: "Google Gemini", create: createGoogleGeminiAgent },
  chatwriter: { name: "ChatWriter", create: createChatWriterAgent },
  azureopenai: { name: "Azure OpenAI", create: createAzureOpenaiAgent },
  chatollama: { name: "ChatOllama", create: createChatOllamaAgent },
};

function getAgent(modelId) {
  const id = MODEL_FACTORIES[modelId] ? modelId : "deepseek";
  if (!agentCache.has(id)) {
    agentCache.set(id, MODEL_FACTORIES[id].create());
  }
  return { id, name: MODEL_FACTORIES[id].name, agent: agentCache.get(id) };
}

const MODEL_MAP = Object.fromEntries(
  Object.entries(MODEL_FACTORIES).map(([id, config]) => [
    id,
    { name: config.name },
  ]),
);

function normalizeContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          return part.text ?? part.content ?? JSON.stringify(part);
        }
        return String(part);
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content === "object") {
    return content.text ?? content.content ?? JSON.stringify(content);
  }
  return String(content);
}

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/info", (_req, res) => {
  res.send("helloworld1121");
});

/** 返回可用模型列表 */
app.get("/models", (_req, res) => {
  const models = Object.entries(MODEL_MAP).map(([id, config]) => ({
    id,
    name: config.name,
  }));
  res.json({ models });
});

/** 获取当前工作区目录 */
app.get("/workspace", (_req, res) => {
  res.json({ workspaceRoot: getWorkspaceRoot() });
});

/** 设置工作区目录（后端将在此目录内读写文件） */
app.post("/workspace", async (req, res) => {
  try {
    const { path: dirPath } = req.body ?? {};
    if (!dirPath || typeof dirPath !== "string") {
      return res.status(400).json({ error: "请提供 path 字符串参数（绝对路径目录）" });
    }
    const workspaceRoot = await setWorkspaceRoot(dirPath);
    // 工作区变更后清空 agent 缓存，以便重新注入系统提示中的根目录
    agentCache.clear();
    res.json({ success: true, workspaceRoot });
  } catch (err) {
    res.status(400).json({ error: err.message ?? "设置工作区失败" });
  }
});

app.post("/chat", async (req, res) => {
  try {
    const { message, model: modelId } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "请提供 message 字符串参数" });
    }

    // 根据 modelId 选择 agent，默认使用 deepseek
    const { agent } = getAgent(modelId);

    // 本轮聊天的写文件归入同一批次，便于只撤销/重做本轮更改
    beginChangeBatch();

    // 文件读写场景下，每轮「模型调用 + 工具执行」约占 2 个 superstep；
    // 默认 recursionLimit=25 容易在多文件修改时触顶。
    const result = await agent.invoke(
      { messages: [{ role: "user", content: message }] },
      { recursionLimit: 1000 },
    );

    const messages = result.messages.map((m) => {
      const type = typeof m.getType === "function" ? m.getType() : m.role;
      return {
        type,
        content: normalizeContent(m.content),
        tool_calls: m.tool_calls,
        name: m.name,
      };
    });

    const lastAi = [...messages].reverse().find((m) => m.type === "ai");
    const toolResults = messages
      .filter((m) => m.type === "tool" && m.content)
      .map((m) => ({ name: m.name, content: m.content }));

    res.json({
      reply: lastAi?.content ?? "",
      toolResults,
      messages,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "调用模型失败" });
  }
});

/* ========== 文件更改管理 API ========== */

/** 获取文件更改状态 */
app.get("/file-changes/status", (_req, res) => {
  res.json(getChangeStatus());
});

/** 撤销最后一次聊天产生的文件更改 */
app.post("/file-changes/undo", async (_req, res) => {
  const result = await undoLastChange();
  if (result.success) {
    const paths = result.entries.map((e) => e.filePath).join(", ");
    res.json({
      success: true,
      files: result.entries.map((e) => e.filePath),
      message: `已撤销本轮更改: ${paths}`,
    });
  } else {
    res.status(400).json({ success: false, error: result.error });
  }
});

/** 重做（重新应用）最近一次已撤销的聊天更改 */
app.post("/file-changes/redo", async (_req, res) => {
  const result = await redoLastUndone();
  if (result.success) {
    const paths = result.entries.map((e) => e.filePath).join(", ");
    res.json({
      success: true,
      files: result.entries.map((e) => e.filePath),
      message: `已重新更改: ${paths}`,
    });
  } else {
    res.status(400).json({ success: false, error: result.error });
  }
});

/** 清空更改历史 */
app.post("/file-changes/clear", (_req, res) => {
  clearChangeHistory();
  res.json({ success: true, message: "已清空更改历史" });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`服务已启动: http://localhost:${PORT}`);
  console.log(`工作区: ${getWorkspaceRoot()}`);
  console.log(`POST /chat  body: { "message": "东京天气如何？", "model": "deepseek" }`);
  console.log(`GET  /models`);
  console.log(`GET  /workspace`);
  console.log(`POST /workspace  body: { "path": "D:\\\\path\\\\to\\\\project" }`);
  console.log(`GET  /file-changes/status`);
  console.log(`POST /file-changes/undo`);
  console.log(`POST /file-changes/redo`);
  console.log(`在终端中按 Ctrl+C 可关闭服务`);
});

/* ---------- 优雅关闭 ---------- */

let shuttingDown = false;

/** 关闭所有连接并退出进程（含 keep-alive，避免 Windows 上 Ctrl+C 挂起） */
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n收到 ${signal}，正在关闭服务…`);

  // Node 18.2+：立刻掐断空闲/全部连接，避免 server.close 一直等 keep-alive
  if (typeof server.closeIdleConnections === "function") {
    server.closeIdleConnections();
  }
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }

  server.close(() => {
    console.log("服务已关闭。");
    process.exit(0);
  });

  // 若 2 秒后仍未关闭，强制退出（unref 避免单独拖住进程）
  const forceExit = setTimeout(() => {
    console.error("强制退出（超时）");
    process.exit(1);
  }, 2000);
  forceExit.unref();
}

// 监听终端 Ctrl+C 和 kill 命令
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Windows + npm start：Ctrl+C 常只结束 npm，留下占端口的孤儿 node。
// 1) stdin 管道断开时退出
process.stdin.on("end", () => gracefulShutdown("stdin-end"));
process.stdin.on("close", () => gracefulShutdown("stdin-close"));
if (process.stdin.isTTY) {
  process.stdin.resume();
}

// 2) 父进程（多为 npm）已消失时退出
const parentPid = process.ppid;
const parentWatch = setInterval(() => {
  try {
    process.kill(parentPid, 0);
  } catch {
    clearInterval(parentWatch);
    gracefulShutdown("parent-exit");
  }
}, 500);
parentWatch.unref();
