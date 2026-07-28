<script setup lang="ts">
import axios from 'axios'
import { nextTick, ref } from 'vue'

interface Message {
  role: 'user' | 'ai'
  content: string
}

const messages = ref<Message[]>([])
const input = ref('')
const loading = ref(false)
const listRef = ref<HTMLElement | null>(null)
const copiedIndex = ref<number | null>(null)

async function scrollToBottom() {
  await nextTick()
  listRef.value?.scrollTo({ top: listRef.value.scrollHeight, behavior: 'smooth' })
}

async function send() {
  const text = input.value.trim()
  if (!text || loading.value) return

  messages.value.push({ role: 'user', content: text })
  input.value = ''
  loading.value = true
  await scrollToBottom()

  try {
    const { data } = await axios.post<{ reply?: string; error?: string }>(
      '/api/chat',
      { message: text },
    )
    messages.value.push({
      role: 'ai',
      content: data.reply || data.error || '(空回复)',
    })
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
</script>

<template>
  <div class="chat">
    <header class="chat-header">
      <h1>AI Chat</h1>
      <p>简易聊天 · POST /api/chat</p>
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

.chat-header p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text);
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
