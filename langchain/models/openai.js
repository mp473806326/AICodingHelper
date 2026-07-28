import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { tool } from "langchain";
import * as z from "zod";
import { getCodingSystemPrompt, fileTools } from "../tools/fs.js";

const DEFAULT_OPENAI_MODEL = "gpt-4o";

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

function assertOpenaiApiKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("请在 .env 中设置 OPENAI_API_KEY");
  }
}

/** 创建一个由 OpenAI 驱动的 LangChain Agent */
export function createOpenaiAgent() {
  assertOpenaiApiKey();

  const model = new ChatOpenAI({
    model: DEFAULT_OPENAI_MODEL,
    temperature: 0,
    apiKey: process.env.OPENAI_API_KEY,
  });

  return createAgent({
    model,
    tools: [getWeather, ...fileTools],
    systemPrompt: getCodingSystemPrompt(),
  });
}

export const agent = createOpenaiAgent();
export const openai = {
  DEFAULT_OPENAI_MODEL,
  createOpenaiAgent,
};
