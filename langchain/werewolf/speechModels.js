/**
 * 狼人杀发言用 Chat 模型工厂（与 /models 的 id 对齐）
 */

import "dotenv/config";
import { ChatOpenAI, AzureChatOpenAI } from "@langchain/openai";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { ChatBaiduQianfan } from "@langchain/baidu-qianfan";
import { createDoubaoChatModel } from "../models/doubao.js";

const SPEECH_DEFAULTS = {
  temperature: 0.9,
  timeout: 30000,
  maxRetries: 1,
};

function withSpeechOpts(options = {}) {
  return {
    temperature: options.temperature ?? SPEECH_DEFAULTS.temperature,
    timeout: options.timeout ?? SPEECH_DEFAULTS.timeout,
    maxRetries: options.maxRetries ?? SPEECH_DEFAULTS.maxRetries,
  };
}

/** Writer 使用 /v1/chat，OpenAI SDK 默认走 /chat/completions */
async function writerFetch(url, init) {
  const rewritten = String(url).replace(/\/chat\/completions\b/, "/chat");
  return fetch(rewritten, init);
}

/**
 * @param {string} modelId
 * @param {object} [options]
 */
export function createSpeechChatModel(modelId, options = {}) {
  const id = modelId || "doubao";
  const opts = withSpeechOpts(options);

  switch (id) {
    case "doubao":
      return createDoubaoChatModel(opts);

    case "deepseek": {
      if (!process.env.DEEPSEEK_API_KEY) {
        throw new Error("请在 .env 中设置 DEEPSEEK_API_KEY");
      }
      return new ChatDeepSeek({
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        apiKey: process.env.DEEPSEEK_API_KEY,
        ...opts,
      });
    }

    case "openai": {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("请在 .env 中设置 OPENAI_API_KEY");
      }
      return new ChatOpenAI({
        model: process.env.OPENAI_MODEL || "gpt-4o",
        apiKey: process.env.OPENAI_API_KEY,
        ...opts,
      });
    }

    case "tongyiqwen": {
      if (!process.env.TONGYI_API_KEY) {
        throw new Error("请在 .env 中设置 TONGYI_API_KEY");
      }
      return new ChatOpenAI({
        model: process.env.TONGYI_MODEL || "qwen-plus",
        apiKey: process.env.TONGYI_API_KEY,
        configuration: {
          baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        },
        ...opts,
      });
    }

    case "ai21": {
      if (!process.env.AI21_API_KEY) {
        throw new Error("请在 .env 中设置 AI21_API_KEY");
      }
      return new ChatOpenAI({
        model: process.env.AI21_MODEL || "jamba-1.5-mini",
        apiKey: process.env.AI21_API_KEY,
        configuration: { baseURL: "https://api.ai21.com/studio/v1" },
        ...opts,
      });
    }

    case "anthropic": {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("请在 .env 中设置 ANTHROPIC_API_KEY");
      }
      return new ChatAnthropic({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        apiKey: process.env.ANTHROPIC_API_KEY,
        ...opts,
      });
    }

    case "baiduqianfan": {
      if (!process.env.QIANFAN_ACCESS_KEY || !process.env.QIANFAN_SECRET_KEY) {
        throw new Error("请在 .env 中设置 QIANFAN_ACCESS_KEY 与 QIANFAN_SECRET_KEY");
      }
      return new ChatBaiduQianfan({
        model: process.env.QIANFAN_MODEL || "ERNIE-Lite-8K",
        qianfanAccessKey: process.env.QIANFAN_ACCESS_KEY,
        qianfanSecretKey: process.env.QIANFAN_SECRET_KEY,
        temperature: opts.temperature,
      });
    }

    case "googlegemini": {
      if (!process.env.GOOGLE_API_KEY) {
        throw new Error("请在 .env 中设置 GOOGLE_API_KEY");
      }
      return new ChatGoogleGenerativeAI({
        model: process.env.GOOGLE_MODEL || "gemini-2.5-flash",
        apiKey: process.env.GOOGLE_API_KEY,
        temperature: opts.temperature,
        maxRetries: opts.maxRetries,
      });
    }

    case "chatwriter": {
      if (!process.env.WRITER_API_KEY) {
        throw new Error("请在 .env 中设置 WRITER_API_KEY");
      }
      return new ChatOpenAI({
        model: process.env.WRITER_MODEL || "palmyra-x5",
        apiKey: process.env.WRITER_API_KEY,
        configuration: {
          baseURL: "https://api.writer.com/v1",
          fetch: writerFetch,
        },
        ...opts,
      });
    }

    case "azureopenai": {
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
      return new AzureChatOpenAI({
        model: process.env.AZURE_OPENAI_MODEL || "gpt-4o",
        azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
        azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
        azureOpenAIApiDeploymentName:
          process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
        azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
        ...opts,
      });
    }

    case "chatollama":
      return new ChatOllama({
        model: process.env.OLLAMA_MODEL || "llama3.2",
        baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
        temperature: opts.temperature,
      });

    default:
      throw new Error(`未知发言模型：${id}`);
  }
}
