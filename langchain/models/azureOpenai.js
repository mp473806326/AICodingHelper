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
import { getCodingSystemPrompt, fileTools } from "../tools/fs.js";

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
    systemPrompt: getCodingSystemPrompt(),
  });
}

export const azureOpenai = {
  DEFAULT_AZURE_OPENAI_MODEL,
  createAzureOpenaiAgent,
};
