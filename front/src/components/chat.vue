<script setup lang="ts">
import axios from 'axios'
import { nextTick, ref, watch, onMounted } from 'vue'

interface ToolResult {
  name?: string
  content: string
}

interface Message {
  role: 'user' | 'ai' | 'tool'
  content: string
  toolName?: string
}

interface ChatResponse {
  reply?: string
  error?: string
  toolResults?: ToolResult[]
}

interface ModelOption {
  id: string
  name: string
}

const STORAGE_KEY = 'ai-chat-messages'
const MODEL_STORAGE_KEY = 'ai-chat-selected-model'

function loadMessages(): Message[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const messages = ref<Message[]>(loadMessages())
const input = ref('')
const loading = ref(false)
const listRef = ref<HTMLElement | null>(null)
const copiedIndex = ref<number | null>(null)

/* ---------- 模型选择 ---------- */
const models = ref<ModelOption[]>([])
const selectedModel = ref('')

/** 从后端加载可用模型列表 */
async function loadModels() {
  try {
    const { data } = await axios.get<{ models: ModelOption[] }>('/api/models')
    models.value = data.models
    // 优先使用上次选中的模型
    const saved = sessionStorage.getItem(MODEL_STORAGE_KEY)
    if (saved && data.models.some((m) => m.id === saved)) {
      selectedModel.value = saved
    } else if (data.models.length > 0) {
      selectedModel.value = data.models[0].id
    }
  } catch {
    // 获取失败时提供兜底选项
    models.value = [
      { id: 'deepseek', name: 'DeepSeek' },
      { id: 'openai', name: 'OpenAI' },
    ]
    selectedModel.value = 'deepseek'
  }
}

watch(selectedModel, (val) => {
  if (val) sessionStorage.setItem(MODEL_STORAGE_KEY, val)
})

onMounted(loadModels)

/* ---------- 消息列表 ---------- */
watch(
  messages,
  (value) => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  },
  { deep: true },
)

async function scrollToBottom() {
  await nextTick()
  listRef.value?.scrollTo({ top: listRef.value.scrollHeight, behavior: 'smooth' })
}

function formatAiContent(reply: string, toolResults?: ToolResult[]) {
  const parts: string[] = []
  if (toolResults?.length) {
    for (const t of toolResults) {
      const title = t.name ? `[工具 ${t.name}]` : '[工具]'
      parts.push(`${title}\n${t.content}`)
    }
  }
  if (reply.trim()) parts.push(reply)
  return parts.join('\n\n') || '(空回复)'
}

async function send() {
  const text = input.value.trim()
  if (!text || loading.value) return

  messages.value.push({ role: 'user', content: text })
  input.value = ''
  loading.value = true
  await scrollToBottom()

  try {
    const { data } = await axios.post<ChatResponse>('/api/chat', {
      message: text,
      model: selectedModel.value,
    })
    if (data.error && !data.reply && !data.toolResults?.length) {
      messages.value.push({ role: 'ai', content: data.error })
    } else {
      messages.value.push({
        role: 'ai',
        content: formatAiContent(data.reply || '', data.toolResults),
      })
    }
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? (err.response?.data as { error?: string })?.error || err.message
      : err instanceof Error
        ? err.message
        : '请求失败'
    messages.value.push({ role: 'ai', content: `出错了：${msg}` })
  } finally {
    loading.value = false
    await scrollToBottom()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

async function copyMessage(content: string, index: number) {
  try {
    await navigator.clipboard.writeText(content)
    copiedIndex.value = index
    setTimeout(() => {
      if (copiedIndex.value === index) {
        copiedIndex.value = null
      }
    }, 1500)
  } catch {
    copiedIndex.value = null
  }
}

/** 清空所有聊天消息 */
function clearMessages() {
  if (messages.value.length === 0) return
  messages.value = []
}
</script>

<template>
  <div class="chat">
    <header class="chat-header">
      <h1>AI 编程助手</h1>
      <div class="header-row">
        <p>编程助手</p>
        <div class="header-actions">
          <!-- 清空按钮 -->
          <button
            class="clear-btn"
            type="button"
            :disabled="!messages.length"
            @click="clearMessages"
          >
            清空内容
          </button>
          <!-- 模型选择下拉框 -->
          <div class="model-selector">
            <label for="model-select">模型：</label>
            <select
              id="model-select"
              v-model="selectedModel"
              :disabled="loading || !models.length"
            >
              <option v-for="m in models" :key="m.id" :value="m.id">
                {{ m.name }}
              </option>
            </select>
          </div>
        </div>
      </div>
    </header>

    <div ref="listRef" class="chat-list">
      <p v-if="!messages.length" class="chat-empty">输入消息开始对话</p>
      <div
        v-for="(m, i) in messages"
        :key="i"
        class="bubble"
        :class="m.role"
      >
        <div class="meta">
          <span class="label">{{ m.role === 'user' ? '你' : 'AI' }}</span>
          <button class="copy-btn" type="button" @click="copyMessage(m.content, i)">
            {{ copiedIndex === i ? '已复制' : '复制' }}
          </button>
        </div>
        <div class="content">{{ m.content }}</div>
      </div>
      <div v-if="loading" class="bubble ai">
        <span class="label">AI</span>
        <div class="content thinking">思考中…</div>
      </div>
    </div>

    <form class="chat-input" @submit.prevent="send">
      <textarea
        v-model="input"
        rows="1"
        placeholder="输入消息，Enter 发送"
        :disabled="loading"
        @keydown="onKeydown"
      />
      <button type="submit" :disabled="loading || !input.trim()">发送</button>
    </form>
  </div>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100svh;
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
  text-align: left;
}

.chat-header {
  padding: 20px 20px 12px;
  border-bottom: 1px solid var(--border);
}

.chat-header h1 {
  margin: 0;
  font-size: 22px;
  letter-spacing: -0.3px;
}

.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.header-row p {
  margin: 0;
  font-size: 13px;
  color: var(--text);
}

/* 头部右侧操作区 */
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 清空按钮 */
.clear-btn {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px 12px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}

.clear-btn:hover:not(:disabled) {
  border-color: #e53e3e;
  color: #e53e3e;
}

.clear-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 模型选择器 */
.model-selector {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text);
}

.model-selector select {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text-h);
  font: inherit;
  font-size: 13px;
  outline: none;
  cursor: pointer;
}

.model-selector select:focus {
  border-color: var(--accent);
}

.model-selector select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-empty {
  margin: auto;
  color: var(--text);
  font-size: 14px;
}

.bubble {
  max-width: 85%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bubble.user {
  align-self: flex-end;
}

.bubble.ai {
  align-self: flex-start;
}

.label {
  font-size: 12px;
  color: var(--text);
}

.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.copy-btn {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 2px 8px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.copy-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.content {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 15px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-h);
}

.user .content {
  background: var(--accent-bg);
  border: 1px solid var(--accent-border);
}

.ai .content {
  background: var(--code-bg);
  border: 1px solid var(--border);
}

.thinking {
  opacity: 0.7;
}

.chat-input {
  display: flex;
  gap: 10px;
  padding: 12px 20px 20px;
  border-top: 1px solid var(--border);
}

.chat-input textarea {
  flex: 1;
  resize: none;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text-h);
  font: inherit;
  font-size: 15px;
  outline: none;
}

.chat-input textarea:focus {
  border-color: var(--accent);
}

.chat-input button {
  padding: 0 18px;
  border: none;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.chat-input button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
