import "dotenv/config";
import { createAgent } from "langchain";
import { tool } from "langchain";
import * as z from "zod";
import { getCodingSystemPrompt, fileTools } from "../tools/fs.js";

const DEFAULT_DEEPSEEK_MODEL = "deepseek:deepseek-v4-flash";

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

function assertDeepseekApiKey() {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("请在 .env 中设置 DEEPSEEK_API_KEY");
  }
}

/** Create a LangChain agent backed by DeepSeek. */
export function createDeepseekAgent() {
  assertDeepseekApiKey();
  return createAgent({
    model: DEFAULT_DEEPSEEK_MODEL,
    tools: [getWeather, ...fileTools],
    systemPrompt: getCodingSystemPrompt(),
  });
}

export const agent = createDeepseekAgent();
export const deepseek = {
  DEFAULT_DEEPSEEK_MODEL,
  createDeepseekAgent,
};
