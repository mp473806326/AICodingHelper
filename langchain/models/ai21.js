/**
 * AI21 Labs 模型接入
 *
 * 通过 OpenAI 兼容接口接入，依赖已有的 @langchain/openai。
 *
 * 在 .env 中配置：
 *   AI21_API_KEY=你的AI21 Labs API Key
 *
 * AI21 Labs API Key 获取：https://www.ai21.com/
 */

import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { tool } from "langchain";
import * as z from "zod";
import { getCodingSystemPrompt, fileTools } from "../tools/fs.js";

/** AI21 Labs OpenAI 兼容模式 endpoint */
const AI21_BASE_URL = "https://api.ai21.com/studio/v1";

/** 默认使用的 AI21 模型
 * 可选值：jamba-1.5-mini, jamba-1.5-large, jamba-instruct 等
 * 详见 https://docs.ai21.com/reference/jamba-instruct-api
 */
const DEFAULT_AI21_MODEL = "jamba-1.5-mini";

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

function assertAi21ApiKey() {
  if (!process.env.AI21_API_KEY) {
    throw new Error("请在 .env 中设置 AI21_API_KEY（AI21 Labs API Key）");
  }
}

/** 创建一个由 AI21 Labs 驱动的 LangChain Agent */
export function createAi21Agent() {
  assertAi21ApiKey();

  const model = new ChatOpenAI({
    model: DEFAULT_AI21_MODEL,
    temperature: 0,
    apiKey: process.env.AI21_API_KEY,
    configuration: {
      baseURL: AI21_BASE_URL,
    },
  });

  return createAgent({
    model,
    tools: [getWeather, ...fileTools],
    systemPrompt: getCodingSystemPrompt(),
  });
}

export const ai21 = {
  DEFAULT_AI21_MODEL,
  createAi21Agent,
};
