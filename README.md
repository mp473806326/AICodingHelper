# LangChain Project

基于 LangChain 的本地编程助手：后端提供多模型 Agent 与文件读写能力，前端为 Vue 聊天界面。可在指定工作区内浏览、读取、修改文件，并支持对本轮文件更改进行撤销 / 重做。

## 项目结构

```
langchainProject/
├── langchain/          # 后端（Express + LangChain Agent）
│   ├── agent.mjs       # HTTP 服务入口
│   ├── models/         # 各模型 Agent 工厂
│   ├── tools/fs.js     # 工作区文件工具与更改历史
│   └── scripts/        # 停止服务等脚本
└── front/              # 前端（Vue 3 + TypeScript + Vite）
```

## 功能概览

- **多模型对话**：DeepSeek、OpenAI、通义千问、豆包、Anthropic、Gemini、Ollama 等（按需配置 API Key）
- **本地文件工具**：`list_dir` / `read_file` / `write_file`，限制在工作区目录内
- **工作区切换**：前端或 API 可设置 Agent 读写的根目录
- **更改撤销 / 重做**：按聊天轮次管理文件修改批次

## 环境要求

- Node.js 18+（建议 LTS）
- 至少一个模型的 API Key（或本地 Ollama）

## 快速开始

### 1. 配置后端环境变量

在 `langchain/` 下创建 `.env`（可参考下列变量；只填你要用的模型即可）：

```env
# 服务端口（可选，默认 3000）
PORT=3000

# 默认工作区（可选，默认为本仓库上一级目录）
# WORKSPACE_ROOT=D:\path\to\your\project

DEEPSEEK_API_KEY=your_deepseek_api_key
OPENAI_API_KEY=your_openai_api_key
TONGYI_API_KEY=your_tongyi_api_key

# 豆包（火山方舟）；Agent Plan / Coding Plan 端点勿混用
DOUBAO_API_KEY=your_doubao_api_key
DOUBAO_BASE_URL=https://ark.cn-beijing.volces.com/api/plan/v3
DOUBAO_MODEL=ark-code-latest

ANTHROPIC_API_KEY=your_anthropic_api_key
GOOGLE_API_KEY=your_google_api_key
AI21_API_KEY=your_ai21_api_key
QIANFAN_ACCESS_KEY=your_qianfan_access_key
QIANFAN_SECRET_KEY=your_qianfan_secret_key
WRITER_API_KEY=your_writer_api_key

AZURE_OPENAI_API_KEY=your_azure_openai_api_key
AZURE_OPENAI_API_INSTANCE_NAME=your_azure_instance_name
AZURE_OPENAI_API_DEPLOYMENT_NAME=your_azure_deployment_name
AZURE_OPENAI_API_VERSION=2024-08-01-preview

# 本地 Ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2
```

> `.env` 已在 `langchain/.gitignore` 中忽略，请勿将密钥提交到仓库。

### 2. 启动后端

```bash
cd langchain
npm install
npm start
```

成功后终端会看到类似输出：

```
服务已启动: http://localhost:3000
```

常用脚本：

| 命令 | 说明 |
|------|------|
| `npm start` | 启动服务 |
| `npm run stop` | 停止占用端口的服务进程 |
| `npm run restart` | 先停止再启动 |

按 `Ctrl+C` 可优雅关闭服务。

### 3. 启动前端

另开一个终端：

```bash
cd front
npm install
npm start
```

浏览器会自动打开 Vite 开发页。前端通过 `/api` 代理到 `http://localhost:3000`，因此需保证后端已在运行。

## 使用说明

1. 打开前端聊天页，选择模型（需已在 `.env` 中配置对应 Key）。
2. 确认或修改工作区路径（Agent 只能读写该目录内的相对路径文件）。
3. 发送需求，例如「在 `src` 下新增一个组件」；Agent 会调用文件工具完成操作。
4. 若本轮产生了文件修改，可用界面上的撤销 / 重做确认或回滚更改。

## 后端 API（简要）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/models` | 可用模型列表 |
| `GET` | `/workspace` | 当前工作区路径 |
| `POST` | `/workspace` | 设置工作区，body: `{ "path": "绝对路径" }` |
| `POST` | `/chat` | 对话，body: `{ "message": "...", "model": "deepseek" }` |
| `GET` | `/file-changes/status` | 文件更改状态 |
| `POST` | `/file-changes/undo` | 撤销最近一轮更改 |
| `POST` | `/file-changes/redo` | 重做最近一次已撤销更改 |
| `POST` | `/file-changes/clear` | 清空更改历史 |

示例：

```bash
curl -X POST http://localhost:3000/chat ^
  -H "Content-Type: application/json" ^
  -d "{\"message\":\"列出工作区根目录\",\"model\":\"deepseek\"}"
```

## 模型 ID 对照

前端 / API 中的 `model` 字段取值：

| ID | 名称 |
|----|------|
| `deepseek` | DeepSeek（默认） |
| `openai` | OpenAI |
| `tongyiqwen` | 通义千问 |
| `doubao` | 豆包 |
| `anthropic` | Anthropic |
| `googlegemini` | Google Gemini |
| `baiduqianfan` | Baidu Qianfan |
| `ai21` | AI21 |
| `chatwriter` | ChatWriter |
| `azureopenai` | Azure OpenAI |
| `chatollama` | ChatOllama |

未配置对应 Key 的模型在首次选用时会报错；不影响其它已配置模型。

## 许可证

私有项目，按需自行约定使用范围。
