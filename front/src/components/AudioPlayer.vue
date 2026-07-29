<template>
  <div class="audio-player">
    <div class="controls">
      <button type="button" class="ap-btn primary" :disabled="isLoading || !text" @click="togglePlay">
        <span v-if="isPlaying">暂停</span>
        <span v-else-if="isLoading">加载中…</span>
        <span v-else>播放语音</span>
      </button>
      <button type="button" class="ap-btn" :disabled="!isPlaying && !isLoading" @click="stopPlay">
        停止
      </button>
    </div>

    <div v-if="isPlaying || isLoading" class="progress">
      <div class="progress-bar" :style="{ width: progress + '%' }"></div>
    </div>

    <div v-if="currentText" class="current-text">{{ currentText }}</div>

    <div class="row">
      <label>
        音色
        <select v-model="selectedVoice">
          <option value="female">晓晓（女声）</option>
          <option value="male">云扬（男声）</option>
          <option value="youngMale">云希（年轻男声）</option>
        </select>
      </label>
      <label class="speed">
        语速 {{ Number(speed).toFixed(1) }}
        <input v-model.number="speed" type="range" min="0.5" max="2" step="0.1" />
      </label>
    </div>

    <p v-if="error" class="ap-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ttsService, type VoiceId } from '../services/ttsService'

const props = withDefaults(
  defineProps<{
    text: string
    voice?: VoiceId
    autoPlay?: boolean
  }>(),
  {
    voice: 'female',
    autoPlay: false,
  },
)

const emit = defineEmits<{
  playStart: []
  playEnd: []
  error: [message: string]
}>()

const isPlaying = ref(false)
const isLoading = ref(false)
const progress = ref(0)
const currentText = ref('')
const selectedVoice = ref<VoiceId>(props.voice)
const speed = ref(1.0)
const error = ref('')

watch(
  () => props.voice,
  (v) => {
    if (v) selectedVoice.value = v
  },
)

watch(
  () => props.text,
  async (text) => {
    if (props.autoPlay && text?.trim()) {
      await togglePlay(true)
    }
  },
)

async function togglePlay(forcePlay = false) {
  if (isPlaying.value && !forcePlay) {
    stopPlay()
    return
  }

  if (!props.text?.trim()) return

  try {
    error.value = ''
    isLoading.value = true
    currentText.value = props.text
    progress.value = 30
    emit('playStart')

    isPlaying.value = true
    isLoading.value = false
    progress.value = 70

    await ttsService.playStream(props.text, {
      voice: selectedVoice.value,
      speed: speed.value,
    })

    progress.value = 100
  } catch (e) {
    const msg = e instanceof Error ? e.message : '播放失败'
    error.value = msg
    emit('error', msg)
  } finally {
    isLoading.value = false
    isPlaying.value = false
    progress.value = 0
    emit('playEnd')
  }
}

function stopPlay() {
  ttsService.stopPlay()
  isPlaying.value = false
  isLoading.value = false
  progress.value = 0
}

defineExpose({ play: () => togglePlay(true), stop: stopPlay })
</script>

<style scoped>
.audio-player {
  padding: 12px 14px;
  border: 1px solid var(--border, #ddd);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg, #fff) 92%, #888 8%);
}

.controls {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.ap-btn {
  padding: 6px 14px;
  border: 1px solid var(--border, #ccc);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  background: var(--bg, #fff);
  color: var(--text-h, #222);
}

.ap-btn.primary {
  background: var(--accent, #3b82f6);
  border-color: transparent;
  color: #fff;
}

.ap-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.progress {
  width: 100%;
  height: 3px;
  background: color-mix(in srgb, var(--border, #ddd) 80%, transparent);
  border-radius: 2px;
  margin: 6px 0;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: var(--accent, #3b82f6);
  border-radius: 2px;
  transition: width 0.25s;
}

.current-text {
  padding: 8px 10px;
  border-radius: 6px;
  margin: 8px 0;
  font-size: 13px;
  line-height: 1.45;
  max-height: 72px;
  overflow: auto;
  border: 1px solid var(--border, #ddd);
  color: var(--text-h, #333);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  align-items: center;
  font-size: 13px;
  color: var(--text, #666);
}

.row label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.row select {
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid var(--border, #ccc);
  background: var(--bg, #fff);
  color: inherit;
}

.speed {
  flex: 1;
  min-width: 140px;
}

.speed input {
  flex: 1;
  min-width: 80px;
}

.ap-error {
  margin: 8px 0 0;
  font-size: 12px;
  color: #c0392b;
}
</style>
