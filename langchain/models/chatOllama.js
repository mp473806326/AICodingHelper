/**
 * Ollama (ChatOllama) 本地模型接入
 *
 * 依赖已有的 @langchain/ollama。需先在本机安装并启动 Ollama，
 * 并拉取对应模型（例如：ollama pull llama3.2）。
 *
 * 可选 .env 配置：
 *   OLLAMA_BASE_URL=http://127.0.0.1:11434
 *   OLLAMA_MODEL=llama3.2
 *
 * 详见 https://ollama.com/
 */

import "dotenv/config";
import { ChatOllama } from "@langchain/ollama";
import { createAgent } from "langchain";
import { tool } from "langchain";
import * as z from "zod";
import { WORKSPACE_ROOT, fileTools } from "../tools/fs.js";

/** 默认本地模型（需已通过 ollama pull 下载） */
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";

/** Ollama 服务地址 */
const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";

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

const SYSTEM_PROMPT = `你是一个能操作本地文件的编程助手。
工作区根目录: ${WORKSPACE_ROOT}
你可以用工具 list_dir / read_file / write_file 浏览、读取、创建或修改工作区内的文件。
路径一律使用相对于工作区根目录的相对路径（例如 front/src/App.vue）。
修改文件前先 read_file 确认现状；写入时提供完整文件内容。
write_file 成功后不要再反复 read_file 校验，直接用文字总结改动并结束。
每个文件只写入一次；不要对同一文件重复 write_file。
不要尝试访问工作区外的路径。`;

/** 创建一个由本地 Ollama 驱动的 LangChain Agent */
export function createChatOllamaAgent() {
  const model = new ChatOllama({
    model: DEFAULT_OLLAMA_MODEL,
    temperature: 0,
    baseUrl: OLLAMA_BASE_URL,
  });

  return createAgent({
    model,
    tools: [getWeather, ...fileTools],
    systemPrompt: SYSTEM_PROMPT,
  });
}

export const chatOllama = {
  DEFAULT_OLLAMA_MODEL,
  createChatOllamaAgent,
};
