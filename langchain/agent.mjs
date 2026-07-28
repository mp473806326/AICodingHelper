import "dotenv/config";
import express from "express";
import { agent } from "./models/deepseek.js";

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

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "请提供 message 字符串参数" });
    }

    const result = await agent.invoke({
      messages: [{ role: "user", content: message }],
    });

    const messages = result.messages.map((m) => ({
      type: typeof m.getType === "function" ? m.getType() : m.role,
      content: m.content,
      tool_calls: m.tool_calls,
      name: m.name,
    }));

    res.json({
      reply: messages.at(-1)?.content ?? "",
      messages,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "调用模型失败" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务已启动: http://localhost:${PORT}`);
  console.log(`POST /chat  body: { "message": "东京天气如何？" }`);
});
