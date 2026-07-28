/**
 * 豆包（Doubao）模型接入
 *
 * 通过火山方舟（Volcengine Ark）OpenAI 兼容接口接入，依赖已有的 @langchain/openai。
 *
 * 在 .env 中配置：
 *   DOUBAO_API_KEY=Agent Plan 专属 API Key（在 Agent Plan 控制台创建，勿用普通方舟 Key）
 *   DOUBAO_MODEL=ark-code-latest（可选，Plan 智能路由）或具体模型名
 *   DOUBAO_BASE_URL=可选，覆盖默认 endpoint
 *
 * 端点说明（勿混用）：
 *   Agent Plan  → https://ark.cn-beijing.volces.com/api/plan/v3
 *   Coding Plan → https://ark.cn-beijing.volces.com/api/coding/v3
 *   按量付费    → https://ark.cn-beijing.volces.com/api/v3（须用 ep-xxx 或具体模型 ID，无 ark-code-latest）
 *
 * API Key 获取：https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey
 * 模型列表：https://www.volcengine.com/docs/82379
 */

import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { tool } from "langchain";
import * as z from "zod";
import { WORKSPACE_ROOT, fileTools } from "../tools/fs.js";

/** Agent Plan OpenAI 兼容 endpoint（ark-code-latest 仅在此或 Coding Plan 端点可用） */
const DOUBAO_BASE_URL =
  process.env.DOUBAO_BASE_URL ||
  "https://ark.cn-beijing.volces.com/api/plan/v3";

/** 默认模型：Plan 套餐用 ark-code-latest 自动路由；也可填具体模型名 */
const DEFAULT_DOUBAO_MODEL =
  process.env.DOUBAO_MODEL || "ark-code-latest";

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

function assertDoubaoApiKey() {
  if (!process.env.DOUBAO_API_KEY && !process.env.ARK_API_KEY) {
    throw new Error(
      "请在 .env 中设置 DOUBAO_API_KEY（或 ARK_API_KEY，火山方舟 API Key）",
    );
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

/** 创建一个由豆包（Doubao）驱动的 LangChain Agent */
export function createDoubaoAgent() {
  assertDoubaoApiKey();

  const model = new ChatOpenAI({
    model: DEFAULT_DOUBAO_MODEL,
    temperature: 0,
    apiKey: process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY,
    configuration: {
      baseURL: DOUBAO_BASE_URL,
    },
  });

  return createAgent({
    model,
    tools: [getWeather, ...fileTools],
    systemPrompt: SYSTEM_PROMPT,
  });
}

export const doubao = {
  DEFAULT_DOUBAO_MODEL,
  createDoubaoAgent,
};
