/**
 * Azure OpenAI 模型接入
 *
 * 使用 @langchain/openai 中的 AzureChatOpenAI。
 *
 * 在 .env 中配置：
 *   AZURE_OPENAI_API_KEY=你的 Azure OpenAI Key
 *   AZURE_OPENAI_API_INSTANCE_NAME=你的实例名（如 my-resource）
 *   AZURE_OPENAI_API_DEPLOYMENT_NAME=你的部署名
 *   AZURE_OPENAI_API_VERSION=2024-08-01-preview
 *
 * 详见 https://learn.microsoft.com/azure/ai-services/openai/overview
 */

import "dotenv/config";
import { AzureChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { tool } from "langchain";
import * as z from "zod";
import { WORKSPACE_ROOT, fileTools } from "../tools/fs.js";

/** 默认模型名（需与 Azure 部署的模型对应；实际调用以 Deployment Name 为准） */
const DEFAULT_AZURE_OPENAI_MODEL = "gpt-4o";

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

function assertAzureOpenaiConfig() {
  const required = [
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_API_INSTANCE_NAME",
    "AZURE_OPENAI_API_DEPLOYMENT_NAME",
    "AZURE_OPENAI_API_VERSION",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`请在 .env 中设置: ${missing.join(", ")}`);
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

/** 创建一个由 Azure OpenAI 驱动的 LangChain Agent */
export function createAzureOpenaiAgent() {
  assertAzureOpenaiConfig();

  const model = new AzureChatOpenAI({
    model: DEFAULT_AZURE_OPENAI_MODEL,
    temperature: 0,
    azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
    azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
    azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
  });

  return createAgent({
    model,
    tools: [getWeather, ...fileTools],
    systemPrompt: SYSTEM_PROMPT,
  });
}

export const azureOpenai = {
  DEFAULT_AZURE_OPENAI_MODEL,
  createAzureOpenaiAgent,
};
