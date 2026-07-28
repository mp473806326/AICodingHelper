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
import { getCodingSystemPrompt, fileTools } from "../tools/fs.js";

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
    systemPrompt: getCodingSystemPrompt(),
  });
}

export const googleGemini = {
  DEFAULT_GEMINI_MODEL,
  createGoogleGeminiAgent,
};
