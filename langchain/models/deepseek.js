import "dotenv/config";
import { createAgent } from "langchain";
import { tool } from "langchain";
import * as z from "zod";
import { WORKSPACE_ROOT, fileTools } from "../tools/fs.js";

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

const SYSTEM_PROMPT = `你是一个能操作本地文件的编程助手。
工作区根目录: ${WORKSPACE_ROOT}
你可以用工具 list_dir / read_file / write_file 浏览、读取、创建或修改工作区内的文件。
路径一律使用相对于工作区根目录的相对路径（例如 front/src/App.vue）。
修改文件前先 read_file 确认现状；写入时提供完整文件内容。
write_file 成功后不要再反复 read_file 校验，直接用文字总结改动并结束。
每个文件只写入一次；不要对同一文件重复 write_file。
不要尝试访问工作区外的路径。`;

/** Create a LangChain agent backed by DeepSeek. */
export function createDeepseekAgent() {
  assertDeepseekApiKey();
  return createAgent({
    model: DEFAULT_DEEPSEEK_MODEL,
    tools: [getWeather, ...fileTools],
    systemPrompt: SYSTEM_PROMPT,
  });
}

export const agent = createDeepseekAgent();
export const deepseek = {
  DEFAULT_DEEPSEEK_MODEL,
  createDeepseekAgent,
};
