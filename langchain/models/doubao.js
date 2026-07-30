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
import { getCodingSystemPrompt, fileTools } from "../tools/fs.js";

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

/**
 * 豆包 Agent Plan 常对无参/可选参工具返回 arguments: ""，
 * LangChain 的 JSON.parse("") 会失败，工具调用变成 invalid_tool_calls，
 * agent 直接空回复结束（表现为「改代码没反应」）。
 * 在进入 LangChain 解析前把空 arguments 归一成 "{}"。
 */
function normalizeToolCallArguments(payload) {
  if (!payload || typeof payload !== "object") return payload;
  for (const choice of payload.choices ?? []) {
    const toolCalls = choice?.message?.tool_calls;
    if (!Array.isArray(toolCalls)) continue;
    for (const tc of toolCalls) {
      if (!tc?.function) continue;
      const args = tc.function.arguments;
      if (args == null || args === "") {
        tc.function.arguments = "{}";
      }
    }
  }
  return payload;
}

/** OpenAI SDK 兼容 fetch：修补豆包空 tool arguments */
async function doubaoFetch(url, init) {
  const response = await fetch(url, init);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return response;
  }

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return new Response(raw, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  normalizeToolCallArguments(data);

  return new Response(JSON.stringify(data), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** 创建豆包 Chat 模型（无工具，适合狼人杀发言等纯对话） */
export function createDoubaoChatModel(options = {}) {
  assertDoubaoApiKey();

  return new ChatOpenAI({
    model: options.model || DEFAULT_DOUBAO_MODEL,
    temperature: options.temperature ?? 0.85,
    timeout: options.timeout,
    maxRetries: options.maxRetries,
    apiKey: process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY,
    configuration: {
      baseURL: DOUBAO_BASE_URL,
      fetch: doubaoFetch,
    },
  });
}

/** 创建一个由豆包（Doubao）驱动的 LangChain Agent */
export function createDoubaoAgent() {
  const model = createDoubaoChatModel({ temperature: 0 });

  return createAgent({
    model,
    tools: [getWeather, ...fileTools],
    systemPrompt: getCodingSystemPrompt(),
  });
}

export const doubao = {
  DEFAULT_DOUBAO_MODEL,
  createDoubaoChatModel,
  createDoubaoAgent,
};
