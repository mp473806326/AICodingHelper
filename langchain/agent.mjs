import "dotenv/config";
import express from "express";
import { createDeepseekAgent } from "./models/deepseek.js";
import { createOpenaiAgent } from "./models/openai.js";

// 预创建 agent 实例
const deepseekAgent = createDeepseekAgent();
const openaiAgent = createOpenaiAgent();

const MODEL_MAP = {
  deepseek: { name: "DeepSeek", agent: deepseekAgent },
  openai: { name: "OpenAI", agent: openaiAgent },
};

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

app.post("/chat", async (req, res) => {
  try {
    const { message, model: modelId } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "请提供 message 字符串参数" });
    }

    // 根据 modelId 选择 agent，默认使用 deepseek
    const modelConfig = MODEL_MAP[modelId] || MODEL_MAP.deepseek;
    const agent = modelConfig.agent;

    const result = await agent.invoke({
      messages: [{ role: "user", content: message }],
    });

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

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`服务已启动: http://localhost:${PORT}`);
  console.log(`POST /chat  body: { "message": "东京天气如何？", "model": "deepseek" }`);
  console.log(`GET  /models`);
  console.log(`在终端中按 Ctrl+C 可关闭服务`);
});

/* ---------- 优雅关闭 ---------- */

/** 关闭所有连接并退出进程 */
function gracefulShutdown(signal) {
  console.log(`\n收到 ${signal} 信号，正在关闭服务…`);
  server.close(() => {
    console.log("服务已关闭。");
    process.exit(0);
  });

  // 若 5 秒后仍未关闭，强制退出
  setTimeout(() => {
    console.error("强制退出（超时）");
    process.exit(1);
  }, 5000);
}

// 监听终端 Ctrl+C 和 kill 命令
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
