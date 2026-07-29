<script setup lang="ts">
import axios from 'axios'
import { computed, ref } from 'vue'
import avatarImg from '../assets/OIP.webp'

type Phase = 'lobby' | 'night' | 'dawn' | 'day_speech' | 'day_vote' | 'ended'
type Camp = 'good' | 'evil'

interface Player {
  id: number
  name: string
  role: string
  roleCn: string
  camp: Camp
  alive: boolean
  revealed: boolean
  canVote: boolean
}

interface Speech {
  day: number
  playerId: number
  name: string
  roleCn: string
  text: string
  at: number
}

interface GameState {
  id: string
  board: string
  phase: Phase
  day: number
  night: number
  players: Player[]
  speeches: Speech[]
  speechQueue: number[]
  speechIndex: number
  votes: Record<string, number>
  lastNightDeaths: { id: number; name: string; roleCn: string }[]
  lastExile: { id: number; flipped: boolean; roleCn: string } | null
  pendingHunterShot: number | null
  winner: 'good' | 'werewolf' | null
  winnerReason: string | null
  logs: { t: number; msg: string }[]
  aliveCount: number
  witch: { antidote: number; poison: number }
}

const game = ref<GameState | null>(null)
const loading = ref(false)
const error = ref('')
const speaking = ref(false)
const autoSpeak = ref(false)

const phaseLabel = computed(() => {
  const map: Record<Phase, string> = {
    lobby: '准备中',
    night: '夜晚行动',
    dawn: '天亮公布',
    day_speech: '白天发言',
    day_vote: '投票放逐',
    ended: '游戏结束',
  }
  return game.value ? map[game.value.phase] : '未开始'
})

const currentSpeakerId = computed(() => {
  if (!game.value || game.value.phase !== 'day_speech') return null
  const { speechQueue, speechIndex } = game.value
  if (speechIndex >= speechQueue.length) return null
  return speechQueue[speechIndex]
})

const leftColumn = computed(() => {
  const list = game.value?.players ?? []
  return list.slice(0, Math.ceil(list.length / 2))
})

const rightColumn = computed(() => {
  const list = game.value?.players ?? []
  return list.slice(Math.ceil(list.length / 2))
})

const todaySpeeches = computed(() => {
  if (!game.value) return []
  return game.value.speeches.filter((s) => s.day === game.value!.day)
})

function errMsg(err: unknown) {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string } | undefined
    return data?.error || err.message
  }
  return err instanceof Error ? err.message : '请求失败'
}

async function startGame() {
  loading.value = true
  error.value = ''
  autoSpeak.value = false
  try {
    const { data } = await axios.post<{ game: GameState }>('/api/werewolf/games')
    game.value = data.game
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    loading.value = false
  }
}

async function runNight() {
  if (!game.value || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const { data } = await axios.post<{ game: GameState }>(
      `/api/werewolf/games/${game.value.id}/night`,
    )
    game.value = data.game
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    loading.value = false
  }
}

async function nextSpeech() {
  if (!game.value || speaking.value || loading.value) return
  if (game.value.phase !== 'day_speech') return

  speaking.value = true
  error.value = ''
  try {
    const { data } = await axios.post<{ game: GameState }>(
      `/api/werewolf/games/${game.value.id}/speak`,
    )
    game.value = data.game
    if (autoSpeak.value && game.value.phase === 'day_speech') {
      speaking.value = false
      await nextSpeech()
      return
    }
  } catch (e) {
    error.value = errMsg(e)
    autoSpeak.value = false
  } finally {
    speaking.value = false
  }
}

async function runVote() {
  if (!game.value || loading.value) return
  loading.value = true
  error.value = ''
  autoSpeak.value = false
  try {
    const { data } = await axios.post<{ game: GameState }>(
      `/api/werewolf/games/${game.value.id}/vote`,
    )
    game.value = data.game
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    loading.value = false
  }
}

async function toggleAutoSpeak() {
  autoSpeak.value = !autoSpeak.value
  if (autoSpeak.value) {
    await nextSpeech()
  }
}

function resetLocal() {
  game.value = null
  error.value = ''
  autoSpeak.value = false
}

function roleClass(p: Player) {
  if (p.role === 'werewolf') return 'role-wolf'
  if (['seer', 'witch', 'hunter', 'idiot'].includes(p.role)) return 'role-god'
  return 'role-villager'
}
</script>

<template>
  <div class="werewolf">
    <header class="header">
      <div>
        <h1>狼人杀 · 预女猎白</h1>
        <p>12人屠边局 · 发言由豆包生成 · 观战模式</p>
      </div>
      <button
        v-if="game"
        class="btn"
        type="button"
        :disabled="loading || speaking"
        @click="resetLocal"
      >
        退出本局
      </button>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <!-- 开局 -->
    <section v-if="!game" class="panel setup">
      <p class="setup-desc">
        固定板子：4狼 / 4民 / 预言家 / 女巫 / 猎人 / 白痴。夜间行动由规则引擎结算，白天发言调用豆包。
      </p>
      <button class="btn primary" type="button" :disabled="loading" @click="startGame">
        {{ loading ? '开局中…' : '开始新局' }}
      </button>
    </section>

    <template v-else>
      <section class="panel status">
        <div class="status-item">
          <span class="label">阶段</span>
          <span class="value">{{ phaseLabel }}</span>
        </div>
        <div class="status-item">
          <span class="label">天数</span>
          <span class="value">第 {{ game.day }} 天 / 第 {{ game.night }} 夜</span>
        </div>
        <div class="status-item">
          <span class="label">存活</span>
          <span class="value">{{ game.aliveCount }} / 12</span>
        </div>
        <div class="status-item">
          <span class="label">女巫药</span>
          <span class="value">解{{ game.witch.antidote }} / 毒{{ game.witch.poison }}</span>
        </div>
      </section>

      <section v-if="game.phase === 'ended'" class="panel ended">
        <h2>
          {{ game.winner === 'good' ? '好人阵营获胜' : '狼人阵营获胜' }}
        </h2>
        <p>{{ game.winnerReason }}</p>
        <button class="btn primary" type="button" :disabled="loading" @click="startGame">
          再来一局
        </button>
      </section>

      <section class="panel actions">
        <button
          v-if="game.phase === 'night'"
          class="btn primary"
          type="button"
          :disabled="loading"
          @click="runNight"
        >
          {{ loading ? '结算中…' : '结算夜晚' }}
        </button>

        <template v-if="game.phase === 'day_speech'">
          <button
            class="btn primary"
            type="button"
            :disabled="speaking || loading || currentSpeakerId == null"
            @click="nextSpeech"
          >
            {{
              speaking
                ? `豆包生成 ${currentSpeakerId} 号发言…`
                : currentSpeakerId
                  ? `下一位发言（${currentSpeakerId}号）`
                  : '发言已结束'
            }}
          </button>
          <button
            class="btn"
            type="button"
            :disabled="speaking || loading"
            @click="toggleAutoSpeak"
          >
            {{ autoSpeak ? '停止连发' : '自动连发' }}
          </button>
        </template>

        <button
          v-if="game.phase === 'day_vote'"
          class="btn primary"
          type="button"
          :disabled="loading"
          @click="runVote"
        >
          {{ loading ? '计票中…' : '全体投票' }}
        </button>
      </section>

      <div class="layout">
        <section class="panel players">
          <h2>座位（观战可见身份）</h2>
          <div class="seat-board">
            <ul class="seat-col">
              <li
                v-for="p in leftColumn"
                :key="p.id"
                class="player"
                :class="{
                  dead: !p.alive,
                  speaking: currentSpeakerId === p.id,
                  revealed: p.revealed,
                }"
              >
                <img class="avatar" :src="avatarImg" :alt="p.name" />
                <div class="player-main">
                  <strong>{{ p.name }}</strong>
                  <span class="role" :class="roleClass(p)">
                    {{ p.roleCn }}
                    <template v-if="p.revealed"> · 已翻牌</template>
                    <template v-if="!p.canVote && p.alive"> · 无票权</template>
                  </span>
                </div>
                <span class="alive-tag">{{ p.alive ? '存活' : '出局' }}</span>
              </li>
            </ul>
            <ul class="seat-col">
              <li
                v-for="p in rightColumn"
                :key="p.id"
                class="player"
                :class="{
                  dead: !p.alive,
                  speaking: currentSpeakerId === p.id,
                  revealed: p.revealed,
                }"
              >
                <img class="avatar" :src="avatarImg" :alt="p.name" />
                <div class="player-main">
                  <strong>{{ p.name }}</strong>
                  <span class="role" :class="roleClass(p)">
                    {{ p.roleCn }}
                    <template v-if="p.revealed"> · 已翻牌</template>
                    <template v-if="!p.canVote && p.alive"> · 无票权</template>
                  </span>
                </div>
                <span class="alive-tag">{{ p.alive ? '存活' : '出局' }}</span>
              </li>
            </ul>
          </div>
        </section>

        <div class="side">
          <section class="panel speeches">
            <h2>今日发言</h2>
            <ul v-if="todaySpeeches.length" class="speech-list">
              <li v-for="(s, i) in todaySpeeches" :key="i">
                <div class="speech-meta">
                  <strong>{{ s.playerId }}号</strong>
                  <span class="speech-role">{{ s.roleCn }}</span>
                </div>
                <p class="speech-text">{{ s.text }}</p>
              </li>
            </ul>
            <p v-else class="empty">暂无发言</p>
          </section>

          <section class="panel log">
            <h2>战报</h2>
            <ul v-if="game.logs.length" class="log-list">
              <li v-for="(item, i) in game.logs" :key="i">{{ item.msg }}</li>
            </ul>
            <p v-else class="empty">暂无记录</p>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.werewolf {
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px;
  box-sizing: border-box;
  text-align: left;
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}

.header h1 {
  margin: 0;
  font-size: 22px;
  letter-spacing: -0.3px;
}

.header p {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text);
}

.error {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, #e74c3c 12%, var(--bg));
  color: #c0392b;
  font-size: 13px;
}

.panel {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 12px;
  background: var(--bg);
}

.panel h2 {
  margin: 0 0 10px;
  font-size: 15px;
}

.status {
  display: flex;
  flex-wrap: wrap;
  gap: 20px 28px;
}

.status-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.label {
  font-size: 12px;
  color: var(--text);
}

.value {
  font-size: 15px;
  color: var(--text-h);
  font-weight: 500;
}

.setup-desc {
  margin: 0 0 14px;
  font-size: 14px;
  color: var(--text);
  line-height: 1.5;
}

.ended h2 {
  margin-bottom: 6px;
}

.ended p {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--text);
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.layout {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 12px;
  align-items: start;
}

.side {
  min-width: 0;
}

.seat-board {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
}

.seat-col {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.player {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  transition: border-color 0.2s, background 0.2s;
}

.player.speaking {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.player.revealed {
  border-style: dashed;
}

.player.dead {
  opacity: 0.45;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  background: #d6eaf8;
}

.player-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.player-main strong {
  color: var(--text-h);
  font-size: 14px;
}

.role {
  font-size: 12px;
  color: var(--text);
}

.role-wolf {
  color: #c0392b;
}

.role-god {
  color: #2980b9;
}

.role-villager {
  color: var(--text);
}

.alive-tag {
  font-size: 12px;
  color: var(--text);
  white-space: nowrap;
}

.speech-list,
.log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 360px;
  overflow: auto;
}

.log-list {
  max-height: 220px;
  gap: 6px;
}

.speech-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.speech-meta strong {
  font-size: 13px;
  color: var(--text-h);
}

.speech-role {
  font-size: 12px;
  color: var(--text);
}

.speech-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-h);
}

.log-list li {
  font-size: 13px;
  color: var(--text-h);
  line-height: 1.4;
}

.empty {
  margin: 0;
  font-size: 13px;
  color: var(--text);
}

.btn {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 14px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  background: var(--bg);
  color: var(--text-h);
  transition: border-color 0.2s, opacity 0.2s;
}

.btn:hover:not(:disabled) {
  border-color: var(--accent);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn.primary:hover:not(:disabled) {
  opacity: 0.9;
}

@media (max-width: 860px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .seat-board {
    grid-template-columns: 1fr;
  }
}
</style>
