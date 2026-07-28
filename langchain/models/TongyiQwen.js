/**
 * 通义千问（Qwen）模型接入
 *
 * 通过 DashScope OpenAI 兼容接口接入，依赖已有的 @langchain/openai。
 *
 * 在 .env 中配置：
 *   TONGYI_API_KEY=你的阿里云DashScope API Key
 *
 * DashScope API Key 获取：https://help.aliyun.com/zh/model-studio/developer-reference/get-api-key
 */

import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { tool } from "langchain";
import * as z from "zod";
import { WORKSPACE_ROOT, fileTools } from "../tools/fs.js";

/** DashScope OpenAI 兼容模式 endpoint */
const DASHSCOPE_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";

/** 默认使用的千问模型
 * 可选值：qwen-turbo, qwen-plus, qwen-max, qwen-max-0428, qwen-max-0403 等
 * 详见 https://help.aliyun.com/zh/model-studio/overview
 */
const DEFAULT_TONGYI_QWEN_MODEL = "qwen-plus";

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

function assertTongyiApiKey() {
  if (!process.env.TONGYI_API_KEY) {
    throw new Error("请在 .env 中设置 TONGYI_API_KEY（阿里云 DashScope API Key）");
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

/** 创建一个由通义千问（Qwen）驱动的 LangChain Agent */
export function createTongyiQwenAgent() {
  assertTongyiApiKey();

  const model = new ChatOpenAI({
    model: DEFAULT_TONGYI_QWEN_MODEL,
    temperature: 0,
    apiKey: process.env.TONGYI_API_KEY,
    configuration: {
      baseURL: DASHSCOPE_BASE_URL,
    },
  });

  return createAgent({
    model,
    tools: [getWeather, ...fileTools],
    systemPrompt: SYSTEM_PROMPT,
  });
}

export const tongyiQwen = {
  DEFAULT_TONGYI_QWEN_MODEL,
  createTongyiQwenAgent,
};
