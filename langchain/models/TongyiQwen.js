/**
 * 通义千问（Qwen）模型接入
 *
 * 通过 DashScope OpenAI 兼容接口接入，依赖已有的 @langchain/openai。
 *
 * 在 .env 中配置：
 *   TONGYI_API_KEY=你的阿里云DashScope / 百炼 API Key
 *   TONGYI_BASE_URL=可选，覆盖默认 endpoint
 *   TONGYI_MODEL=可选，默认 qwen-plus
 *
 * DashScope API Key 获取：https://help.aliyun.com/zh/model-studio/developer-reference/get-api-key
 */

import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { tool } from "langchain";
import * as z from "zod";
import { getCodingSystemPrompt, fileTools } from "../tools/fs.js";

/**
 * OpenAI 兼容 endpoint（路径必须是 /compatible-mode/v1，不是 /api/v1）
 * 业务空间专属域名：https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
 * 通用域名：https://dashscope.aliyuncs.com/compatible-mode/v1
 */
const DASHSCOPE_BASE_URL =
  process.env.TONGYI_BASE_URL ||
  "https://ws-vrhpqtvzbsrxgjmg.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";

/** 默认使用的千问模型
 * 可选值：qwen-turbo, qwen-plus, qwen-max, qwen-max-0428, qwen-max-0403 等
 * 详见 https://help.aliyun.com/zh/model-studio/overview
 */
const DEFAULT_TONGYI_QWEN_MODEL =
  process.env.TONGYI_MODEL || "qwen-plus";

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
    systemPrompt: getCodingSystemPrompt(),
  });
}

export const tongyiQwen = {
  DEFAULT_TONGYI_QWEN_MODEL,
  createTongyiQwenAgent,
};
