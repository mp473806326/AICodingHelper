/**
 * Google Gemini 模型接入
 *
 * 依赖 @langchain/google-genai。
 *
 * 在 .env 中配置：
 *   GOOGLE_API_KEY=你的 Google AI Studio API Key
 *
 * API Key 获取：https://aistudio.google.com/apikey
 */

import "dotenv/config";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createAgent } from "langchain";
import { tool } from "langchain";
import * as z from "zod";
import { WORKSPACE_ROOT, fileTools } from "../tools/fs.js";

/** 默认使用的 Gemini 模型
 * 可选值：gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash 等
 * 详见 https://ai.google.dev/gemini-api/docs/models
 */
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

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

function assertGoogleApiKey() {
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error("请在 .env 中设置 GOOGLE_API_KEY（Google AI Studio API Key）");
  }
}

const SYSTEM_PROMPT = `你是一个能操作本地文件的编程助手。
工作区根目录: ${WORKSPACE_ROOT}
你可以用工具 list_dir / read_file / write_file 浏览、读取、创建或修改工作区内的文件。
路径一律使用相对于工作区根目录的相对路径（例如 front/src/App.vue）。
修改文件前先 read_file 确认现状；写入时提供完整文件内容。
write_file 成功后不要再反复 read_file 校验，直接用文字总结改动并结束。
每个文件只写入一次；不要对同一文件重复 write_file。
不要尝试访问工作区外的路径。`;

/** 创建一个由 Google Gemini 驱动的 LangChain Agent */
export function createGoogleGeminiAgent() {
  assertGoogleApiKey();

  const model = new ChatGoogleGenerativeAI({
    model: DEFAULT_GEMINI_MODEL,
    temperature: 0,
    apiKey: process.env.GOOGLE_API_KEY,
  });

  return createAgent({
    model,
    tools: [getWeather, ...fileTools],
    systemPrompt: SYSTEM_PROMPT,
  });
}

export const googleGemini = {
  DEFAULT_GEMINI_MODEL,
  createGoogleGeminiAgent,
};
