<script setup lang="ts">
import axios from 'axios'
import { computed, onUnmounted, ref } from 'vue'
import avatarImg from '../assets/OIP.webp'
import { ttsService, type VoiceId } from '../services/ttsService'

type Phase =
  | 'lobby'
  | 'night'
  | 'dawn'
  | 'sheriff_speech'
  | 'sheriff_vote'
  | 'sheriff_pk'
  | 'day_speech'
  | 'day_vote'
  | 'ended'
type Camp = 'good' | 'evil'
type SpeechKind = 'day' | 'sheriff' | 'sheriff_pk'

interface Player {
  id: number
  name: string
  role: string
  roleCn: string
  camp: Camp
  alive: boolean
  revealed: boolean
  canVote: boolean
  isSheriff?: boolean
}

interface Speech {
  day: number
  playerId: number
  name: string
  roleCn: string
  text: string
  kind?: SpeechKind
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
  speechKind: SpeechKind | null
  speechOrderMode: string | null
  speechOrderCn: string | null
  votes: Record<string, number>
  voteTally: Record<string, number>
  lastNightDeaths: { id: number; name: string; roleCn: string }[]
  lastExile: { id: number; flipped: boolean; roleCn: string } | null
  pendingHunterShot: number | null
  sheriffId: number | null
  sheriffDone: boolean
  sheriffRunners: number[]
  sheriffBallot: number[]
  sheriffWithdrawn: number[]
  sheriffPkCandidates: number[] | null
  sheriffElectResult: { sheriffId: number } | null
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
/** 发言生成后自动朗读 */
const autoVoice = ref(true)
const voicePlaying = ref(false)
const playingSpeechKey = ref<string | null>(null)
const ttsSpeed = ref(1.0)

onUnmounted(() => {
  ttsService.stopPlay()
})

const phaseLabel = computed(() => {
  const map: Record<Phase, string> = {
    lobby: '准备中',
    night: '夜晚行动',
    dawn: '天亮公布',
    sheriff_speech: '警长竞选·上警发言',
    sheriff_vote: '警长竞选·投票',
    sheriff_pk: '警长竞选·PK',
    day_speech: '白天发言',
    day_vote: '投票放逐',
    ended: '游戏结束',
  }
  return game.value ? map[game.value.phase] : '未开始'
})

const isSpeechPhase = computed(() => {
  if (!game.value) return false
  return (
    game.value.phase === 'day_speech' ||
    game.value.phase === 'sheriff_speech' ||
    game.value.phase === 'sheriff_pk'
  )
})

const isVotePhase = computed(() => {
  if (!game.value) return false
  return game.value.phase === 'day_vote' || game.value.phase === 'sheriff_vote'
})

const currentSpeakerId = computed(() => {
  if (!game.value || !isSpeechPhase.value) return null
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
  const day = game.value.day
  const phase = game.value.phase
  return game.value.speeches.filter((s) => {
    if (s.day !== day) return false
    if (phase === 'sheriff_speech' || phase === 'sheriff_vote') {
      return s.kind === 'sheriff'
    }
    if (phase === 'sheriff_pk') {
      return s.kind === 'sheriff' || s.kind === 'sheriff_pk'
    }
    // 白天：展示今日全部（含竞选回顾）
    return true
  })
})

/** 战报只保留流程信息，过滤玩家发言正文（「N 号：…」） */
const SPEECH_LOG_RE = /^(【上警】|【PK】)?\d+ 号：/
const flowLogs = computed(() => {
  if (!game.value) return []
  return game.value.logs.filter((item) => !SPEECH_LOG_RE.test(item.msg))
})

const speechPanelTitle = computed(() => {
  if (!game.value) return '发言'
  if (game.value.phase === 'sheriff_speech') return '上警发言'
  if (game.value.phase === 'sheriff_pk') return 'PK 发言'
  if (game.value.phase === 'sheriff_vote') return '竞选发言记录'
  return '今日发言'
})

const speakButtonLabel = computed(() => {
  if (!game.value) return ''
  const id = currentSpeakerId.value
  if (speaking.value) {
    if (game.value.phase === 'sheriff_speech') return `豆包生成 ${id} 号上警发言…`
    if (game.value.phase === 'sheriff_pk') return `豆包生成 ${id} 号 PK 发言…`
    return `豆包生成 ${id} 号发言…`
  }
  if (id == null) return '发言已结束'
  if (game.value.phase === 'sheriff_speech') return `下一位上警发言（${id}号）`
  if (game.value.phase === 'sheriff_pk') return `下一位 PK（${id}号）`
  return `下一位发言（${id}号）`
})

const voteButtonLabel = computed(() => {
  if (!game.value) return ''
  if (loading.value) return '计票中…'
  if (game.value.phase === 'sheriff_vote') return '未上警玩家投票选警长'
  return '全体投票放逐'
})

/** 按得票人分组：谁投了谁 */
const voteDetails = computed(() => {
  if (!game.value?.votes) return []
  const votes = game.value.votes
  const groups = new Map<number, number[]>()
  for (const [voterStr, targetId] of Object.entries(votes)) {
    const voterId = Number(voterStr)
    const list = groups.get(targetId) ?? []
    list.push(voterId)
    groups.set(targetId, list)
  }
  return [...groups.entries()]
    .map(([targetId, voters]) => ({
      targetId,
      voters: voters.sort((a, b) => a - b),
      count: game.value!.voteTally[String(targetId)] ?? voters.length,
    }))
    .sort((a, b) => b.count - a.count || a.targetId - b.targetId)
})

const hasVoteResult = computed(() => {
  if (!game.value) return false
  return (
    Object.keys(game.value.votes ?? {}).length > 0 ||
    Object.keys(game.value.voteTally ?? {}).length > 0
  )
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

function speechKey(s: Speech) {
  return `${s.day}-${s.playerId}-${s.kind ?? 'day'}-${s.at}`
}

function voiceForPlayer(playerId: number): VoiceId {
  return ttsService.getVoiceBySpeaker(playerId)
}

async function playSpeechText(text: string, playerId: number, key: string) {
  if (!text?.trim()) return
  if (playingSpeechKey.value === key && voicePlaying.value) {
    ttsService.stopPlay()
    voicePlaying.value = false
    playingSpeechKey.value = null
    return
  }

  ttsService.stopPlay()
  voicePlaying.value = true
  playingSpeechKey.value = key
  try {
    await ttsService.playStream(text, {
      voice: voiceForPlayer(playerId),
      speed: ttsSpeed.value,
    })
  } catch (e) {
    console.error(e)
  } finally {
    if (playingSpeechKey.value === key) {
      voicePlaying.value = false
      playingSpeechKey.value = null
    }
  }
}

async function playLatestSpeech(speech: Speech) {
  const key = speechKey(speech)
  await playSpeechText(speech.text, speech.playerId, key)
}

async function nextSpeech() {
  if (!game.value || speaking.value || loading.value) return
  if (!isSpeechPhase.value) return

  speaking.value = true
  error.value = ''
  try {
    const { data } = await axios.post<{
      game: GameState
      speech?: Speech
    }>(`/api/werewolf/games/${game.value.id}/speak`)
    game.value = data.game

    if (autoVoice.value && data.speech?.text) {
      speaking.value = false
      await playLatestSpeech(data.speech)
    }

    if (autoSpeak.value && isSpeechPhase.value) {
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
  ttsService.stopPlay()
  game.value = null
  error.value = ''
  autoSpeak.value = false
  voicePlaying.value = false
  playingSpeechKey.value = null
}

function roleClass(p: Player) {
  if (p.role === 'werewolf') return 'role-wolf'
  if (['seer', 'witch', 'hunter', 'idiot'].includes(p.role)) return 'role-god'
  return 'role-villager'
}

function isRunner(id: number) {
  return game.value?.sheriffRunners?.includes(id) ?? false
}

function isOnBallot(id: number) {
  return game.value?.sheriffBallot?.includes(id) ?? false
}

function speechKindTag(kind?: SpeechKind) {
  if (kind === 'sheriff') return '上警'
  if (kind === 'sheriff_pk') return 'PK'
  return ''
}
</script>

<template>
  <div class="werewolf">
    <header class="header">
      <div>
        <h1>狼人杀 · 预女猎白</h1>
        <p>12人屠边局 · 首日含警长竞选 · 发言由豆包生成 · 观战模式</p>
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

    <section v-if="!game" class="panel setup">
      <p class="setup-desc">
        固定板子：4狼 / 4民 / 预言家 / 女巫 / 猎人 / 白痴。流程：首夜 → 警长竞选（上警发言→退水→投票/PK）→
        白天发言放逐 → 循环夜昼。夜间由规则引擎结算，发言调用豆包。
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
          <span class="label">警长</span>
          <span class="value">{{ game.sheriffId ? `${game.sheriffId}号` : '未产生' }}</span>
        </div>
        <div class="status-item">
          <span class="label">女巫药</span>
          <span class="value">解{{ game.witch.antidote }} / 毒{{ game.witch.poison }}</span>
        </div>
      </section>

      <section
        v-if="
          game.sheriffRunners?.length &&
          (game.phase === 'sheriff_speech' ||
            game.phase === 'sheriff_vote' ||
            game.phase === 'sheriff_pk' ||
            (!game.sheriffDone && game.day === 1))
        "
        class="panel sheriff-banner"
      >
        <h2>警长竞选</h2>
        <p>
          上警：
          <strong>{{ game.sheriffRunners.map((id) => `${id}号`).join('、') }}</strong>
        </p>
        <p v-if="game.sheriffWithdrawn?.length">
          退水：{{ game.sheriffWithdrawn.map((id) => `${id}号`).join('、') }}
        </p>
        <p v-if="game.sheriffBallot?.length && game.phase !== 'sheriff_speech'">
          候选人：{{ game.sheriffBallot.map((id) => `${id}号`).join('、') }}
        </p>
        <p v-if="game.sheriffPkCandidates?.length">
          PK：{{ game.sheriffPkCandidates.map((id) => `${id}号`).join('、') }}
        </p>
        <p v-if="game.speechOrderCn" class="hint">发言顺序：{{ game.speechOrderCn }}</p>
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

        <template v-if="isSpeechPhase">
          <button
            class="btn primary"
            type="button"
            :disabled="speaking || loading || voicePlaying || currentSpeakerId == null"
            @click="nextSpeech"
          >
            {{ speakButtonLabel }}
          </button>
          <button
            class="btn"
            type="button"
            :disabled="speaking || loading || voicePlaying"
            @click="toggleAutoSpeak"
          >
            {{ autoSpeak ? '停止连发' : '自动连发' }}
          </button>
        </template>

        <label class="voice-toggle">
          <input v-model="autoVoice" type="checkbox" />
          自动朗读
        </label>
        <label class="voice-speed">
          语速 {{ ttsSpeed.toFixed(1) }}
          <input v-model.number="ttsSpeed" type="range" min="0.5" max="2" step="0.1" />
        </label>
        <button
          v-if="voicePlaying"
          class="btn"
          type="button"
          @click="
            ttsService.stopPlay();
            voicePlaying = false;
            playingSpeechKey = null
          "
        >
          停止朗读
        </button>

        <button
          v-if="isVotePhase"
          class="btn primary"
          type="button"
          :disabled="loading"
          @click="runVote"
        >
          {{ voteButtonLabel }}
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
                  sheriff: p.isSheriff,
                  runner: isRunner(p.id) && !game.sheriffDone,
                  ballot: isOnBallot(p.id) && (game.phase === 'sheriff_vote' || game.phase === 'sheriff_pk'),
                }"
              >
                <img class="avatar" :src="avatarImg" :alt="p.name" />
                <div class="player-main">
                  <strong>
                    {{ p.name }}
                    <span v-if="p.isSheriff" class="badge-sheriff">警</span>
                    <span
                      v-else-if="isRunner(p.id) && !game.sheriffDone"
                      class="badge-run"
                    >上警</span>
                  </strong>
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
                  sheriff: p.isSheriff,
                  runner: isRunner(p.id) && !game.sheriffDone,
                  ballot: isOnBallot(p.id) && (game.phase === 'sheriff_vote' || game.phase === 'sheriff_pk'),
                }"
              >
                <img class="avatar" :src="avatarImg" :alt="p.name" />
                <div class="player-main">
                  <strong>
                    {{ p.name }}
                    <span v-if="p.isSheriff" class="badge-sheriff">警</span>
                    <span
                      v-else-if="isRunner(p.id) && !game.sheriffDone"
                      class="badge-run"
                    >上警</span>
                  </strong>
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
            <h2>{{ speechPanelTitle }}</h2>
            <ul v-if="todaySpeeches.length" class="speech-list">
              <li v-for="s in todaySpeeches" :key="speechKey(s)">
                <div class="speech-meta">
                  <strong>{{ s.playerId }}号</strong>
                  <span v-if="speechKindTag(s.kind)" class="speech-kind">{{
                    speechKindTag(s.kind)
                  }}</span>
                  <span class="speech-role">{{ s.roleCn }}</span>
                  <button
                    class="btn-speak"
                    type="button"
                    :class="{ active: playingSpeechKey === speechKey(s) }"
                    :title="playingSpeechKey === speechKey(s) ? '停止' : '朗读'"
                    @click="playSpeechText(s.text, s.playerId, speechKey(s))"
                  >
                    {{ playingSpeechKey === speechKey(s) ? '停' : '读' }}
                  </button>
                </div>
                <p class="speech-text">{{ s.text }}</p>
              </li>
            </ul>
            <p v-else class="empty">暂无发言</p>
          </section>

          <section v-if="hasVoteResult" class="panel tally">
            <h2>票型</h2>
            <ul v-if="voteDetails.length" class="tally-list">
              <li v-for="row in voteDetails" :key="row.targetId">
                <span class="tally-target"
                  >{{ row.targetId }}号（{{ row.count }}票）</span
                >
                <span class="tally-voters"
                  >← {{ row.voters.map((id) => `${id}号`).join('、') }}</span
                >
              </li>
            </ul>
            <ul v-else class="tally-list">
              <li v-for="(n, id) in game.voteTally" :key="id">
                {{ id }}号：{{ n }} 票
              </li>
            </ul>
          </section>

          <section class="panel log">
            <h2>战报</h2>
            <ul v-if="flowLogs.length" class="log-list">
              <li v-for="(item, i) in flowLogs" :key="i">{{ item.msg }}</li>
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

.sheriff-banner p {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--text-h);
  line-height: 1.45;
}

.sheriff-banner .hint {
  color: var(--text);
  margin-bottom: 0;
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
  align-items: center;
}

.voice-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-h);
  cursor: pointer;
  user-select: none;
}

.voice-speed {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text);
  min-width: 140px;
}

.voice-speed input {
  width: 90px;
}

.btn-speak {
  margin-left: auto;
  padding: 2px 8px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-h);
  cursor: pointer;
}

.btn-speak.active {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent);
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

.player.sheriff {
  border-color: #c9a227;
}

.player.runner:not(.sheriff) {
  border-color: color-mix(in srgb, #e67e22 55%, var(--border));
}

.player.ballot {
  background: color-mix(in srgb, #e67e22 8%, var(--bg));
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
  display: flex;
  align-items: center;
  gap: 6px;
}

.badge-sheriff,
.badge-run {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  line-height: 1.4;
}

.badge-sheriff {
  background: #c9a227;
  color: #fff;
}

.badge-run {
  background: color-mix(in srgb, #e67e22 18%, var(--bg));
  color: #d35400;
  border: 1px solid color-mix(in srgb, #e67e22 40%, var(--border));
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
.log-list,
.tally-list {
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

.tally-list {
  max-height: 220px;
  gap: 8px;
}

.tally-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 10px;
  font-size: 13px;
  color: var(--text-h);
  line-height: 1.45;
}

.tally-target {
  font-weight: 600;
  color: var(--text-h);
  white-space: nowrap;
}

.tally-voters {
  color: var(--text);
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

.speech-kind {
  font-size: 11px;
  padding: 0 5px;
  border-radius: 3px;
  background: color-mix(in srgb, #e67e22 16%, var(--bg));
  color: #d35400;
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
