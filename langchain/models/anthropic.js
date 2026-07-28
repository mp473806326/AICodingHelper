/**
 * Anthropic (Claude) 模型接入
 *
 * 依赖 @langchain/anthropic。
 *
 * 在 .env 中配置：
 *   ANTHROPIC_API_KEY=你的 Anthropic API Key
 *
 * API Key 获取：https://console.anthropic.com/settings/keys
 */

import "dotenv/config";
import { ChatAnthropic } from "@langchain/anthropic";
import { createAgent } from "langchain";
import { tool } from "langchain";
import * as z from "zod";
import { WORKSPACE_ROOT, fileTools } from "../tools/fs.js";

/** 默认使用的 Claude 模型
 * 可选值：claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5 等
 * 详见 https://docs.anthropic.com/en/docs/about-claude/models
 */
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

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

function assertAnthropicApiKey() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("请在 .env 中设置 ANTHROPIC_API_KEY（Anthropic API Key）");
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

/** 创建一个由 Anthropic Claude 驱动的 LangChain Agent */
export function createAnthropicAgent() {
  assertAnthropicApiKey();

  const model = new ChatAnthropic({
    model: DEFAULT_ANTHROPIC_MODEL,
    temperature: 0,
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  return createAgent({
    model,
    tools: [getWeather, ...fileTools],
    systemPrompt: SYSTEM_PROMPT,
  });
}

export const anthropic = {
  DEFAULT_ANTHROPIC_MODEL,
  createAnthropicAgent,
};
