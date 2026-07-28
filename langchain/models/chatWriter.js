/**
 * Writer (ChatWriter / Palmyra) 模型接入
 *
 * LangChain JS 暂无官方 ChatWriter 包（仅 Python），
 * 这里通过 OpenAI 兼容客户端对接 Writer Chat API
 * （将 /chat/completions 重写为 /v1/chat）。
 *
 * 在 .env 中配置：
 *   WRITER_API_KEY=你的 Writer API Key
 *
 * API Key 获取：https://dev.writer.com/home/quickstart
 */

import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { tool } from "langchain";
import * as z from "zod";
import { getCodingSystemPrompt, fileTools } from "../tools/fs.js";

/** Writer API base（OpenAI SDK 会再拼 /chat/completions） */
const WRITER_BASE_URL = "https://api.writer.com/v1";

/** 默认使用的 Writer 模型
 * 可选值：palmyra-x5, palmyra-x4, palmyra-fin, palmyra-med 等
 * 详见 https://dev.writer.com/home/models
 */
const DEFAULT_WRITER_MODEL = "palmyra-x5";

const getWeather = tool(
  ({ city }) => `${city} 天气总是晴朗！`,
  {
    name: "get_weather",
    description: "获取指定城市的天气",
    schema: z.object({
      city: z.string(),
    }),
  },
);

function assertWriterApiKey() {
  if (!process.env.WRITER_API_KEY) {
    throw new Error("请在 .env 中设置 WRITER_API_KEY（Writer API Key）");
  }
}

/** Writer 使用 /v1/chat，OpenAI SDK 默认走 /chat/completions，需改写路径 */
async function writerFetch(url, init) {
  const rewritten = String(url).replace(/\/chat\/completions\b/, "/chat");
  return fetch(rewritten, init);
}

/** 创建一个由 Writer Palmyra 驱动的 LangChain Agent */
export function createChatWriterAgent() {
  assertWriterApiKey();

  const model = new ChatOpenAI({
    model: DEFAULT_WRITER_MODEL,
    temperature: 0,
    apiKey: process.env.WRITER_API_KEY,
    configuration: {
      baseURL: WRITER_BASE_URL,
      fetch: writerFetch,
    },
  });

  return createAgent({
    model,
    tools: [getWeather, ...fileTools],
    systemPrompt: getCodingSystemPrompt(),
  });
}

export const chatWriter = {
  DEFAULT_WRITER_MODEL,
  createChatWriterAgent,
};
