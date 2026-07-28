/**
 * 百度千帆（Baidu Qianfan）模型接入
 *
 * 依赖 @langchain/baidu-qianfan。
 *
 * 在 .env 中配置：
 *   QIANFAN_ACCESS_KEY=你的 Access Key
 *   QIANFAN_SECRET_KEY=你的 Secret Key
 *
 * 密钥获取：https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application
 */

import "dotenv/config";
import { ChatBaiduQianfan } from "@langchain/baidu-qianfan";
import { createAgent } from "langchain";
import { tool } from "langchain";
import * as z from "zod";
import { WORKSPACE_ROOT, fileTools } from "../tools/fs.js";

/** 默认使用的千帆模型
 * 可选值：ERNIE-Lite-8K, ERNIE-4.0-8K, ERNIE-3.5-8K, ERNIE-Speed-8K 等
 * 详见 https://cloud.baidu.com/doc/WENXINWORKSHOP/s/Nlksjicvf
 */
const DEFAULT_QIANFAN_MODEL = "ERNIE-Lite-8K";

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

function assertQianfanCredentials() {
  if (!process.env.QIANFAN_ACCESS_KEY || !process.env.QIANFAN_SECRET_KEY) {
    throw new Error(
      "请在 .env 中设置 QIANFAN_ACCESS_KEY 与 QIANFAN_SECRET_KEY（百度千帆）",
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

/** 创建一个由百度千帆驱动的 LangChain Agent */
export function createBaiduQianfanAgent() {
  assertQianfanCredentials();

  const model = new ChatBaiduQianfan({
    model: DEFAULT_QIANFAN_MODEL,
    qianfanAccessKey: process.env.QIANFAN_ACCESS_KEY,
    qianfanSecretKey: process.env.QIANFAN_SECRET_KEY,
  });

  return createAgent({
    model,
    tools: [getWeather, ...fileTools],
    systemPrompt: SYSTEM_PROMPT,
  });
}

export const baiduQianfan = {
  DEFAULT_QIANFAN_MODEL,
  createBaiduQianfanAgent,
};
