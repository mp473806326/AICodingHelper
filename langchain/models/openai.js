import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { tool } from "langchain";
import * as z from "zod";
import { WORKSPACE_ROOT, fileTools } from "../tools/fs.js";

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

const SYSTEM_PROMPT = `你是一个能操作本地文件的编程助手。
工作区根目录: ${WORKSPACE_ROOT}
你可以用工具 list_dir / read_file / write_file 浏览、读取、创建或修改工作区内的文件。
路径一律使用相对于工作区根目录的相对路径（例如 front/src/App.vue）。
修改文件前先 read_file 确认现状；写入时提供完整文件内容。
不要尝试访问工作区外的路径。`;

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
    systemPrompt: SYSTEM_PROMPT,
  });
}

export const agent = createOpenaiAgent();
export const openai = {
  DEFAULT_OPENAI_MODEL,
  createOpenaiAgent,
};
