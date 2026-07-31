<script setup lang="ts">
import axios from 'axios'
import { computed, onUnmounted, ref, watch } from 'vue'
import avatarDefault from '../assets/OIP.webp'
import avatarDeepseek from '../assets/deepseek.webp'
import avatarQianwen from '../assets/qianwen.webp'
import { ttsService, type VoiceId } from '../services/ttsService'

/** 音色下拉选项 */
const VOICE_OPTIONS: { label: string; options: { value: VoiceId; label: string }[] }[] = [
  {
    label: '女声',
    options: [
      { value: 'xiaoxiao', label: '晓晓' },
      { value: 'xiaoyi', label: '晓伊' },
      { value: 'xiaochen', label: '晓辰' },
      { value: 'xiaohan', label: '晓涵' },
      { value: 'xiaomeng', label: '晓梦' },
      { value: 'xiaomo', label: '晓墨' },
      { value: 'xiaoqiu', label: '晓秋' },
      { value: 'xiaorui', label: '晓睿' },
      { value: 'xiaoshuang', label: '晓双' },
      { value: 'xiaoxuan', label: '晓萱' },
      { value: 'xiaoyan', label: '晓颜' },
      { value: 'xiaoyou', label: '晓悠' },
    ],
  },
  {
    label: '男声',
    options: [
      { value: 'yunyang', label: '云扬' },
      { value: 'yunxi', label: '云希' },
      { value: 'yunjian', label: '云健' },
      { value: 'yunfeng', label: '云枫' },
      { value: 'yunhao', label: '云皓' },
      { value: 'yunxia', label: '云夏' },
      { value: 'yunye', label: '云野' },
      { value: 'yunze', label: '云泽' },
    ],
  },
]

const MODEL_AVATARS: Record<string, string> = {
  deepseek: avatarDeepseek,
  tongyiqwen: avatarQianwen,
}

function avatarForModel(modelId?: string | null) {
  if (!modelId) return avatarDefault
  return MODEL_AVATARS[modelId] ?? avatarDefault
}

type Phase =
  | 'lobby'
  | 'night'
  | 'dawn'
  | 'last_words'
  | 'sheriff_speech'
  | 'sheriff_vote'
  | 'sheriff_pk'
  | 'day_speech'
  | 'day_vote'
  | 'ended'
type Camp = 'good' | 'evil'
type SpeechKind = 'day' | 'sheriff' | 'sheriff_pk' | 'last_words'

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
  modelId?: string
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
  boardDesc?: string | null
  playerCount: number
  modelId: string
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

interface ModelOption {
  id: string
  name: string
}

interface BoardOption {
  playerCount: number
  board: string
  boardDesc: string
}

const BOARD_OPTIONS: BoardOption[] = [
  { playerCount: 6, board: '预女', boardDesc: '2狼 / 2民 / 预言家 / 女巫' },
  { playerCount: 9, board: '预女猎', boardDesc: '3狼 / 3民 / 预言家 / 女巫 / 猎人' },
  { playerCount: 12, board: '预女猎白', boardDesc: '4狼 / 4民 / 预言家 / 女巫 / 猎人 / 白痴' },
]

const MODEL_STORAGE_KEY = 'werewolf-player-models'
const BOARD_STORAGE_KEY = 'werewolf-selected-board'

const SPEECH_PHASES = new Set<Phase>([
  'last_words',
  'day_speech',
  'sheriff_speech',
  'sheriff_pk',
])

const game = ref<GameState | null>(null)
const loading = ref(false)
const error = ref('')
const speaking = ref(false)
const autoSpeak = ref(false)
/** 一键自动跑完全局（夜→发言→投票循环） */
const autoPlay = ref(false)
/** 发言生成后自动朗读 */
const autoVoice = ref(true)
const voicePlaying = ref(false)
const playingSpeechKey = ref<string | null>(null)
const ttsSpeed = ref(1.0)
/** 停止自动时递增，打断进行中的自动循环 */
let autoPlayToken = 0

const models = ref<ModelOption[]>([])
const defaultModelId = ref('doubao')
/** 按座位下标 0..n-1 的发言模型 */
const playerModels = ref<string[]>([])
/** 按座位下标 0..n-1 的 TTS 音色 */
const playerVoices = ref<VoiceId[]>([])
/** 批量设置音色的默认值 */
const defaultVoiceId = ref<VoiceId>('xiaoxiao')
const selectedPlayerCount = ref(12)

const selectedBoard = computed(
  () =>
    BOARD_OPTIONS.find((b) => b.playerCount === selectedPlayerCount.value) ??
    BOARD_OPTIONS[2],
)

function modelDisplayName(modelId?: string | null) {
  if (!modelId || modelId === 'mixed') return '各座位独立'
  return models.value.find((m) => m.id === modelId)?.name ?? modelId
}

const headerSubtitle = computed(() => {
  if (game.value) {
    return `${game.value.playerCount}人${game.value.board} · 屠边 · 首日含警长竞选 · 各座位独立模型 · 观战`
  }
  return '可选 6 / 9 / 12 人局 · 屠边 · 首日含警长竞选 · 可为每个座位配置发言模型 · 观战模式'
})

function ensurePlayerModels(count: number, fillId?: string) {
  const fallback =
    fillId ||
    defaultModelId.value ||
    models.value[0]?.id ||
    'doubao'
  const next = playerModels.value.slice(0, count)
  while (next.length < count) next.push(fallback)
  playerModels.value = next
}

function applyDefaultToAll() {
  const id = defaultModelId.value
  if (!id) return
  playerModels.value = Array.from(
    { length: selectedPlayerCount.value },
    () => id,
  )
}

function ensurePlayerVoices(count: number) {
  // 默认：奇数男声、偶数年轻男声（保持原 getVoiceBySpeaker 逻辑）
  const next = playerVoices.value.slice(0, count)
  while (next.length < count) {
    const idx = next.length + 1 // 1-based 座位号
    next.push(idx % 2 === 1 ? 'yunyang' : 'yunxi')
  }
  playerVoices.value = next
}

function applyDefaultVoiceToAll() {
  playerVoices.value = Array.from(
    { length: selectedPlayerCount.value },
    () => defaultVoiceId.value,
  )
}

async function loadModels() {
  try {
    const { data } = await axios.get<{ models: ModelOption[] }>('/api/models')
    models.value = data.models
    if (data.models.some((m) => m.id === 'doubao')) {
      defaultModelId.value = 'doubao'
    } else if (data.models.length > 0) {
      defaultModelId.value = data.models[0].id
    }
  } catch {
    models.value = [
      { id: 'doubao', name: '豆包' },
      { id: 'deepseek', name: 'DeepSeek' },
      { id: 'tongyiqwen', name: '通义千问' },
    ]
    defaultModelId.value = 'doubao'
  }
  restorePlayerModels()
}

function restorePlayerModels() {
  const known = new Set(models.value.map((m) => m.id))
  const fallback = defaultModelId.value
  try {
    const raw = localStorage.getItem(MODEL_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        playerModels.value = parsed.map((id) =>
          known.has(id) || !known.size ? id : fallback,
        )
        ensurePlayerModels(selectedPlayerCount.value, fallback)
        return
      }
    }
  } catch {
    /* ignore */
  }
  ensurePlayerModels(selectedPlayerCount.value, fallback)
}

function restoreBoardChoice() {
  const saved = Number(localStorage.getItem(BOARD_STORAGE_KEY))
  if (BOARD_OPTIONS.some((b) => b.playerCount === saved)) {
    selectedPlayerCount.value = saved
  }
}

restoreBoardChoice()
loadModels()

watch(selectedPlayerCount, (n) => {
  ensurePlayerModels(n)
  ensurePlayerVoices(n)
})

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

const judgeVoice = ref<VoiceId>('female')

interface QueuePlayItem {
  /** judge=法官播报；speech=玩家发言正文；phase_commit=播到此处再落地 UI 阶段 */
  kind: 'judge' | 'speech' | 'phase_commit'
  text: string
  voice: VoiceId
  key: string
  /** 文本就绪后立即预取，播完上一段再取结果播放 */
  audioReady: Promise<ArrayBuffer | null>
  /** 座位高亮；法官流程播报为 null */
  highlightPlayerId: number | null
  /** 仅 phase_commit：按播放进度落地的流程阶段快照 */
  commitGame?: GameState
}

/** 连发+朗读：已生成且已发起 TTS 预取的待播队列 */
const speechPlayQueue = ref<QueuePlayItem[]>([])
/** 当前正在朗读的座位号（流程高亮跟语音走） */
const playbackSpeakerId = ref<number | null>(null)
const playPipelineRunning = ref(false)
/** 清空/停止时递增，丢弃进行中的预取播放 */
let playPipelineEpoch = 0
/**
 * 服务端最新状态（API 预取以此为准，可超前于播放）。
 * game.phase 等展示字段跟播放队列里的 phase_commit 走。
 */
const prefetchGame = ref<GameState | null>(null)
/** 播放队列中尚有未落地的阶段切换（用于禁用手动夜/投票按钮） */
const hasPendingPhaseCommit = computed(() =>
  speechPlayQueue.value.some((item) => item.kind === 'phase_commit'),
)

onUnmounted(() => {
  autoPlay.value = false
  autoSpeak.value = false
  autoPlayToken += 1
  ttsService.stopPlay()
})

const phaseLabel = computed(() => {
  const map: Record<Phase, string> = {
    lobby: '准备中',
    night: '夜晚行动',
    dawn: '天亮公布',
    last_words: '遗言',
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
  return SPEECH_PHASES.has(game.value.phase)
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

/** 座位高亮：优先当前朗读 / 待播队列，而非接口预生成进度 */
const displaySpeakerId = computed(() => {
  if (playbackSpeakerId.value != null) return playbackSpeakerId.value
  const next = speechPlayQueue.value.find((item) => item.highlightPlayerId != null)
  if (next?.highlightPlayerId != null) return next.highlightPlayerId
  return currentSpeakerId.value
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
    if (phase === 'last_words') {
      return s.kind === 'last_words'
    }
    if (phase === 'sheriff_speech' || phase === 'sheriff_vote') {
      return s.kind === 'sheriff' || s.kind === 'last_words'
    }
    if (phase === 'sheriff_pk') {
      return (
        s.kind === 'sheriff' ||
        s.kind === 'sheriff_pk' ||
        s.kind === 'last_words'
      )
    }
    // 白天：展示今日全部（含遗言/竞选回顾）
    return true
  })
})

/** 战报只保留流程信息，过滤玩家发言正文（「N 号：…」） */
const SPEECH_LOG_RE = /^(【上警】|【PK】|【遗言】)?\d+ 号：/
const flowLogs = computed(() => {
  if (!game.value) return []
  return game.value.logs.filter((item) => !SPEECH_LOG_RE.test(item.msg))
})

const speechPanelTitle = computed(() => {
  if (!game.value) return '发言'
  if (game.value.phase === 'last_words') return '遗言'
  if (game.value.phase === 'sheriff_speech') return '上警发言'
  if (game.value.phase === 'sheriff_pk') return 'PK 发言'
  if (game.value.phase === 'sheriff_vote') return '竞选发言记录'
  return '今日发言'
})

const speakButtonLabel = computed(() => {
  if (!game.value) return ''
  const id = currentSpeakerId.value
  if (speaking.value) {
    if (game.value.phase === 'last_words') return `豆包生成 ${id} 号遗言…`
    if (game.value.phase === 'sheriff_speech') return `豆包生成 ${id} 号上警发言…`
    if (game.value.phase === 'sheriff_pk') return `豆包生成 ${id} 号 PK 发言…`
    return `豆包生成 ${id} 号发言…`
  }
  if (id == null) return '发言已结束'
  if (game.value.phase === 'last_words') return `下一位遗言（${id}号）`
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

function clearSpeechPipeline(opts?: { applyPending?: boolean }) {
  const pendingCommits = opts?.applyPending
    ? speechPlayQueue.value.filter((item) => item.kind === 'phase_commit' && item.commitGame)
    : []
  playPipelineEpoch += 1
  speechPlayQueue.value = []
  playbackSpeakerId.value = null
  playPipelineRunning.value = false
  if (pendingCommits.length) {
    const last = pendingCommits[pendingCommits.length - 1]!
    applyPhaseCommit(last.commitGame!)
    autoSpeak.value = false
  }
}

function stopAutoPlay() {
  autoPlay.value = false
  autoSpeak.value = false
  autoPlayToken += 1
}

async function startGame() {
  loading.value = true
  error.value = ''
  stopAutoPlay()
  clearSpeechPipeline()
  try {
    ensurePlayerModels(selectedPlayerCount.value)
    ensurePlayerVoices(selectedPlayerCount.value)
    localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(playerModels.value))
    localStorage.setItem(BOARD_STORAGE_KEY, String(selectedPlayerCount.value))
    const { data } = await axios.post<{ game: GameState }>('/api/werewolf/games', {
      playerCount: selectedPlayerCount.value,
      model: defaultModelId.value,
      playerModels: playerModels.value,
    })
    game.value = data.game
    prefetchGame.value = data.game
    if (autoVoice.value) {
      enqueueJudgeLines(newFlowLogMessages([], data.game.logs))
    }
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    loading.value = false
  }
}

/** API 预取用的最新服务端状态 */
function logicalGame(): GameState | null {
  return prefetchGame.value ?? game.value
}

/** 合并战报/发言等缓存字段，不改展示用的 phase / day / night */
function mergeGameContent(target: GameState, nextGame: GameState): GameState {
  return {
    ...target,
    logs: nextGame.logs,
    speeches: nextGame.speeches,
    players: nextGame.players,
    aliveCount: nextGame.aliveCount,
    lastNightDeaths: nextGame.lastNightDeaths,
    lastExile: nextGame.lastExile,
    witch: nextGame.witch,
    votes: nextGame.votes,
    voteTally: nextGame.voteTally,
    winner: nextGame.winner,
    winnerReason: nextGame.winnerReason,
    sheriffId: nextGame.sheriffId,
    sheriffDone: nextGame.sheriffDone,
    sheriffRunners: nextGame.sheriffRunners,
    sheriffBallot: nextGame.sheriffBallot,
    sheriffWithdrawn: nextGame.sheriffWithdrawn,
    sheriffPkCandidates: nextGame.sheriffPkCandidates,
    sheriffElectResult: nextGame.sheriffElectResult,
  }
}

/** 播放进度追上时，只落地流程阶段，保留已预取的发言缓存 */
function applyPhaseCommit(commit: GameState) {
  if (!game.value) {
    game.value = commit
    return
  }
  const sameSpeechPhase =
    SPEECH_PHASES.has(commit.phase) && game.value.phase === commit.phase
  game.value = {
    ...game.value,
    phase: commit.phase,
    day: commit.day,
    night: commit.night,
    speechQueue: commit.speechQueue,
    speechKind: commit.speechKind,
    speechOrderMode: commit.speechOrderMode,
    speechOrderCn: commit.speechOrderCn,
    speechIndex: sameSpeechPhase
      ? Math.max(game.value.speechIndex, commit.speechIndex)
      : commit.speechIndex,
    sheriffId: commit.sheriffId,
    sheriffDone: commit.sheriffDone,
    sheriffRunners: commit.sheriffRunners,
    sheriffBallot: commit.sheriffBallot,
    sheriffWithdrawn: commit.sheriffWithdrawn,
    sheriffPkCandidates: commit.sheriffPkCandidates,
    sheriffElectResult: commit.sheriffElectResult,
    votes: commit.votes,
    voteTally: commit.voteTally,
    lastNightDeaths: commit.lastNightDeaths,
    lastExile: commit.lastExile,
    aliveCount: commit.aliveCount,
    players: commit.players,
    winner: commit.winner,
    winnerReason: commit.winnerReason,
  }
}

function enqueuePhaseCommit(nextGame: GameState) {
  speechPlayQueue.value.push({
    kind: 'phase_commit',
    text: '',
    voice: judgeVoice.value,
    key: `phase-${nextGame.phase}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    audioReady: Promise.resolve(null),
    highlightPlayerId: null,
    commitGame: nextGame,
  })
  void drainPlayQueue()
}

/**
 * 接口结果先写入前端缓存；开启朗读时阶段切换跟播放队列走。
 * 战报/发言等可提前合并；phase 等流程字段等播到 phase_commit 再落地。
 * 这样夜间播报未完即可预取警上，警上未播完即可预取投票与警下。
 */
function applyGameWithVoice(nextGame: GameState, judgeLines: string[]) {
  prefetchGame.value = nextGame
  const lines = judgeLines.map((t) => t.trim()).filter(Boolean)
  if (!autoVoice.value || !lines.length) {
    game.value = nextGame
    return
  }

  if (game.value) {
    game.value = mergeGameContent(game.value, nextGame)
  } else {
    game.value = nextGame
  }
  enqueueJudgeLines(lines)
  enqueuePhaseCommit(nextGame)
}

async function runNight() {
  const g = logicalGame()
  if (!g || loading.value || speaking.value) return
  if (g.phase !== 'night') return
  loading.value = true
  error.value = ''
  try {
    const prevLogs = game.value?.logs ?? g.logs
    const { data } = await axios.post<{ game: GameState }>(
      `/api/werewolf/games/${g.id}/night`,
    )
    const lines = newFlowLogMessages(prevLogs, data.game.logs)
    applyGameWithVoice(data.game, lines)
  } catch (e) {
    error.value = errMsg(e)
    stopAutoPlay()
  } finally {
    loading.value = false
  }
}

function speechKey(s: Speech) {
  return `${s.day}-${s.playerId}-${s.kind ?? 'day'}-${s.at}`
}

function voiceForPlayer(playerId: number): VoiceId {
  const idx = playerId - 1 // 转为 0-based
  return playerVoices.value[idx] ?? ttsService.getVoiceBySpeaker(playerId)
}

function logKey(item: { t: number; msg: string }) {
  return `${item.t}|${item.msg}`
}

/** 新增流程战报（过滤发言正文），按时间正序供法官朗读 */
function newFlowLogMessages(
  prevLogs: { t: number; msg: string }[],
  nextLogs: { t: number; msg: string }[],
): string[] {
  const prevKeys = new Set(prevLogs.map(logKey))
  const fresh = nextLogs.filter(
    (item) => !prevKeys.has(logKey(item)) && !SPEECH_LOG_RE.test(item.msg),
  )
  return fresh
    .slice()
    .reverse()
    .map((item) => item.msg)
}

function speechIntroText(speech: Speech) {
  if (speech.kind === 'last_words') return `请${speech.playerId}号玩家发表遗言。`
  if (speech.kind === 'sheriff') return `请${speech.playerId}号玩家进行上警发言。`
  if (speech.kind === 'sheriff_pk') return `请${speech.playerId}号玩家进行PK发言。`
  return `请${speech.playerId}号玩家发言。`
}

function pushQueueItem(item: Omit<QueuePlayItem, 'audioReady'> & { audioReady?: Promise<ArrayBuffer | null> }) {
  const audioReady =
    item.audioReady ??
    ttsService.prefetchAudio(item.text, {
      voice: item.voice,
      speed: ttsSpeed.value,
    })
  speechPlayQueue.value.push({ ...item, audioReady })
}

/** 法官播报：夜间信息、上警/退水、投票结果等 */
function enqueueJudgeLines(texts: string[]) {
  const lines = texts.map((t) => t.trim()).filter(Boolean)
  if (!lines.length) return
  for (const text of lines) {
    pushQueueItem({
      kind: 'judge',
      text,
      voice: judgeVoice.value,
      key: `judge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      highlightPlayerId: null,
    })
  }
  void drainPlayQueue()
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

async function playQueuedItem(item: QueuePlayItem, epoch: number) {
  voicePlaying.value = true
  playingSpeechKey.value = item.key
  try {
    const audioData = await item.audioReady
    if (epoch !== playPipelineEpoch) return
    await ttsService.playBuffered(item.text, audioData, {
      voice: item.voice,
      speed: ttsSpeed.value,
    })
  } catch (e) {
    console.error(e)
  } finally {
    if (playingSpeechKey.value === item.key) {
      voicePlaying.value = false
      playingSpeechKey.value = null
    }
  }
}

async function drainPlayQueue() {
  if (playPipelineRunning.value) return
  playPipelineRunning.value = true
  const epoch = playPipelineEpoch
  try {
    while (speechPlayQueue.value.length > 0) {
      if (epoch !== playPipelineEpoch) break
      const item = speechPlayQueue.value.shift()!
      if (item.kind === 'phase_commit') {
        if (item.commitGame) applyPhaseCommit(item.commitGame)
        continue
      }
      playbackSpeakerId.value = item.highlightPlayerId
      await playQueuedItem(item, epoch)
      if (epoch !== playPipelineEpoch) break
      playbackSpeakerId.value = null
    }
  } finally {
    if (epoch === playPipelineEpoch) {
      playPipelineRunning.value = false
      if (speechPlayQueue.value.length > 0) {
        void drainPlayQueue()
      }
    }
  }
}

/** 先播「N号玩家发言」，再播正文；文本一到立刻预取 */
function enqueueSpeechPlay(speech: Speech) {
  if (!speech?.text?.trim()) return
  const key = speechKey(speech)
  const intro = speechIntroText(speech)
  pushQueueItem({
    kind: 'judge',
    text: intro,
    voice: judgeVoice.value,
    key: `intro-${key}`,
    highlightPlayerId: speech.playerId,
  })
  pushQueueItem({
    kind: 'speech',
    text: speech.text,
    voice: voiceForPlayer(speech.playerId),
    key,
    highlightPlayerId: speech.playerId,
  })
  void drainPlayQueue()
}

/**
 * 发言接口返回：文本立刻缓存。
 * 展示 phase 仍落后于播放时只合并内容；同阶段则可同步 speechIndex。
 * 阶段切走时走 applyGameWithVoice（法官词 + phase_commit）。
 */
function applySpeechProgress(nextGame: GameState, stillSpeechPhase: boolean) {
  prefetchGame.value = nextGame
  const prevLogs = game.value?.logs ?? []
  const judgeLines = newFlowLogMessages(prevLogs, nextGame.logs)

  if (stillSpeechPhase) {
    if (!game.value || game.value.phase === nextGame.phase || !autoVoice.value) {
      // 展示已进入本发言阶段（或未开朗读）：可同步进度
      game.value = nextGame
    } else {
      // 仍在播上一阶段（如夜间），只缓存发言正文，不抢先改 phase
      game.value = mergeGameContent(game.value, nextGame)
    }
    if (autoVoice.value && judgeLines.length) {
      enqueueJudgeLines(judgeLines)
    }
    return
  }

  applyGameWithVoice(nextGame, judgeLines)
}

async function nextSpeech() {
  if (speaking.value || loading.value) return
  const g = logicalGame()
  if (!g) return

  // 自动预取跟服务端阶段；手动操作跟当前展示阶段
  const canSpeak = autoPlay.value || autoSpeak.value
    ? SPEECH_PHASES.has(g.phase)
    : isSpeechPhase.value
  if (!canSpeak) return

  speaking.value = true
  error.value = ''
  try {
    const { data } = await axios.post<{
      game: GameState
      speech?: Speech
    }>(`/api/werewolf/games/${g.id}/speak`)

    const stillSpeechPhase = SPEECH_PHASES.has(data.game.phase)
    prefetchGame.value = data.game

    if (autoVoice.value && data.speech?.text) {
      // 文本 + TTS 预取入队；连发时继续请求下一位（播放与请求并行）
      enqueueSpeechPlay(data.speech)
      applySpeechProgress(data.game, stillSpeechPhase)
      speaking.value = false
      if (autoSpeak.value && stillSpeechPhase) {
        await nextSpeech()
      } else if (!stillSpeechPhase) {
        autoSpeak.value = false
      }
      return
    }

    const prevLogs = game.value?.logs ?? g.logs
    const lines = newFlowLogMessages(prevLogs, data.game.logs)
    if (stillSpeechPhase) {
      applySpeechProgress(data.game, true)
    } else {
      applyGameWithVoice(data.game, lines)
    }

    if (autoSpeak.value && SPEECH_PHASES.has(data.game.phase)) {
      speaking.value = false
      await nextSpeech()
      return
    }
    autoSpeak.value = false
  } catch (e) {
    error.value = errMsg(e)
    stopAutoPlay()
  } finally {
    speaking.value = false
  }
}

async function runVote() {
  const g = logicalGame()
  if (!g || loading.value || speaking.value) return
  if (g.phase !== 'sheriff_vote' && g.phase !== 'day_vote') return
  loading.value = true
  error.value = ''
  autoSpeak.value = false
  try {
    const prevLogs = game.value?.logs ?? g.logs
    const { data } = await axios.post<{ game: GameState }>(
      `/api/werewolf/games/${g.id}/vote`,
    )
    const lines = newFlowLogMessages(prevLogs, data.game.logs)
    applyGameWithVoice(data.game, lines)
  } catch (e) {
    error.value = errMsg(e)
    stopAutoPlay()
  } finally {
    loading.value = false
  }
}

/** 只等 API 空闲；播放可并行，内容预取不阻塞 */
async function waitForPrefetchIdle(token: number): Promise<boolean> {
  for (;;) {
    if (!autoPlay.value || token !== autoPlayToken) return false
    if (loading.value || speaking.value) {
      await sleep(80)
      continue
    }
    return true
  }
}

async function runAutoPlayLoop() {
  const token = ++autoPlayToken
  autoPlay.value = true
  while (autoPlay.value && token === autoPlayToken) {
    const idle = await waitForPrefetchIdle(token)
    if (!idle) break

    const g = logicalGame()
    if (!g || g.phase === 'ended') {
      // 终局：若仍有播报在播，等队列自然播完即可
      if (
        speechPlayQueue.value.length > 0 ||
        playPipelineRunning.value ||
        voicePlaying.value
      ) {
        await sleep(80)
        continue
      }
      stopAutoPlay()
      break
    }

    if (g.phase === 'night') {
      await runNight()
      continue
    }

    if (SPEECH_PHASES.has(g.phase)) {
      autoSpeak.value = true
      await nextSpeech()
      continue
    }

    if (g.phase === 'sheriff_vote' || g.phase === 'day_vote') {
      await runVote()
      continue
    }

    stopAutoPlay()
    break
  }
}

async function toggleAutoPlay() {
  if (autoPlay.value) {
    stopAutoPlay()
    return
  }
  await runAutoPlayLoop()
}

/** 开局并自动跑完全程 */
async function startGameAuto() {
  await startGame()
  if (game.value && !error.value) {
    await runAutoPlayLoop()
  }
}

async function toggleAutoSpeak() {
  if (autoPlay.value) {
    stopAutoPlay()
    return
  }
  autoSpeak.value = !autoSpeak.value
  if (autoSpeak.value) {
    await nextSpeech()
  }
}

function resetLocal() {
  ttsService.stopPlay()
  game.value = null
  prefetchGame.value = null
  error.value = ''
  stopAutoPlay()
  voicePlaying.value = false
  playingSpeechKey.value = null
  clearSpeechPipeline()
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
  if (kind === 'last_words') return '遗言'
  if (kind === 'sheriff') return '上警'
  if (kind === 'sheriff_pk') return 'PK'
  return ''
}
</script>

<template>
  <div class="werewolf">
    <header class="header">
      <div>
        <h1>狼人杀 · {{ game?.board ?? selectedBoard.board }}</h1>
        <p>{{ headerSubtitle }}</p>
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
      <div class="setup-field">
        <span class="setup-label">人数板子</span>
        <div class="board-options" role="radiogroup" aria-label="人数板子">
          <button
            v-for="opt in BOARD_OPTIONS"
            :key="opt.playerCount"
            class="board-card"
            type="button"
            role="radio"
            :aria-checked="selectedPlayerCount === opt.playerCount"
            :class="{ active: selectedPlayerCount === opt.playerCount }"
            :disabled="loading"
            @click="selectedPlayerCount = opt.playerCount"
          >
            <strong>{{ opt.playerCount }}人 · {{ opt.board }}</strong>
            <span>{{ opt.boardDesc }}</span>
          </button>
        </div>
      </div>

      <!-- 音色设置 -->
      <div class="setup-field">
        <div class="setup-label-row">
          <span class="setup-label">法官 & 玩家音色</span>
          <div class="setup-bulk">
            <select
              v-model="defaultVoiceId"
              class="model-select model-select-sm"
              :disabled="loading"
              aria-label="批量填充音色"
            >
              <optgroup
                v-for="group in VOICE_OPTIONS"
                :key="group.label"
                :label="group.label"
              >
                <option
                  v-for="opt in group.options"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </option>
              </optgroup>
            </select>
            <button
              class="btn"
              type="button"
              :disabled="loading"
              @click="applyDefaultVoiceToAll"
            >
              全部设为该音色
            </button>
          </div>
        </div>
        <div class="voice-setup-row">
          <label class="voice-setup-label">法官</label>
          <select
            v-model="judgeVoice"
            class="voice-select-sm"
            :disabled="loading"
          >
            <optgroup
              v-for="group in VOICE_OPTIONS"
              :key="group.label"
              :label="group.label"
            >
              <option
                v-for="opt in group.options"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </option>
            </optgroup>
          </select>
        </div>
      </div>

      <div class="setup-field">
        <div class="setup-label-row">
          <span class="setup-label">各座位发言模型</span>
          <div class="setup-bulk">
            <select
              v-model="defaultModelId"
              class="model-select model-select-sm"
              :disabled="loading || !models.length"
              aria-label="批量填充模型"
            >
              <option v-for="m in models" :key="m.id" :value="m.id">
                {{ m.name }}
              </option>
            </select>
            <button
              class="btn"
              type="button"
              :disabled="loading || !models.length"
              @click="applyDefaultToAll"
            >
              全部设为该模型
            </button>
          </div>
        </div>
        <ul class="seat-model-list">
          <li v-for="(_, i) in playerModels" :key="i" class="seat-model-row">
            <img
              class="seat-model-avatar"
              :src="avatarForModel(playerModels[i])"
              :alt="`${i + 1}号`"
            />
            <span class="seat-model-name">{{ i + 1 }}号</span>
            <select
              v-model="playerModels[i]"
              class="model-select"
              :disabled="loading || !models.length"
              :aria-label="`${i + 1}号发言模型`"
            >
              <option v-for="m in models" :key="m.id" :value="m.id">
                {{ m.name }}
              </option>
            </select>
            <select
              v-model="playerVoices[i]"
              class="voice-select-xs"
              :disabled="loading"
              :aria-label="`${i + 1}号音色`"
            >
              <optgroup
                v-for="group in VOICE_OPTIONS"
                :key="group.label"
                :label="group.label"
              >
                <option
                  v-for="opt in group.options"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </option>
              </optgroup>
            </select>
          </li>
        </ul>
      </div>

      <p class="setup-desc">
        当前板子：{{ selectedBoard.boardDesc }}。流程：首夜 → 警长竞选（上警发言→退水→投票/PK）→
        白天发言放逐 → 循环夜昼。夜间由规则引擎结算，每位玩家发言调用其座位所选模型。
      </p>
      <div class="setup-actions">
        <button class="btn primary" type="button" :disabled="loading" @click="startGame">
          {{ loading ? '开局中…' : '开始新局' }}
        </button>
        <button class="btn" type="button" :disabled="loading" @click="startGameAuto">
          {{ loading ? '开局中…' : '一键自动完赛' }}
        </button>
      </div>
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
          <span class="value"
            >{{ game.aliveCount }} / {{ game.playerCount ?? game.players.length }}</span
          >
        </div>
        <div class="status-item">
          <span class="label">板子</span>
          <span class="value">{{ game.playerCount }}人·{{ game.board }}</span>
        </div>
        <div class="status-item">
          <span class="label">模型</span>
          <span class="value">{{ modelDisplayName(game.modelId) }}</span>
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
          v-if="game.phase !== 'ended'"
          class="btn"
          :class="{ primary: autoPlay }"
          type="button"
          :disabled="loading && !autoPlay"
          @click="toggleAutoPlay"
        >
          {{ autoPlay ? '停止自动' : '一键自动' }}
        </button>

        <button
          v-if="game.phase === 'night'"
          class="btn primary"
          type="button"
          :disabled="loading || autoPlay || hasPendingPhaseCommit"
          @click="runNight"
        >
          {{ loading ? '结算中…' : hasPendingPhaseCommit ? '播报中…' : '结算夜晚' }}
        </button>

        <template v-if="isSpeechPhase">
          <button
            class="btn primary"
            type="button"
            :disabled="
              speaking ||
              loading ||
              voicePlaying ||
              autoSpeak ||
              autoPlay ||
              playPipelineRunning ||
              speechPlayQueue.length > 0 ||
              currentSpeakerId == null
            "
            @click="nextSpeech"
          >
            {{ speakButtonLabel }}
          </button>
          <button
            class="btn"
            type="button"
            :disabled="!autoSpeak && !autoPlay && (speaking || loading || voicePlaying)"
            @click="toggleAutoSpeak"
          >
            {{ autoSpeak || autoPlay ? '停止连发' : '自动连发' }}
          </button>
        </template>

        <label class="voice-toggle">
          <input v-model="autoVoice" type="checkbox" />
          自动朗读（含法官）
        </label>
        <label class="voice-speed">
          语速 {{ ttsSpeed.toFixed(1) }}
          <input v-model.number="ttsSpeed" type="range" min="0.5" max="2" step="0.1" />
        </label>
        <label class="voice-select">
          法官
          <select v-model="judgeVoice">
            <optgroup
              v-for="group in VOICE_OPTIONS"
              :key="group.label"
              :label="group.label"
            >
              <option
                v-for="opt in group.options"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </option>
            </optgroup>
          </select>
        </label>
        <button
          v-if="voicePlaying || speechPlayQueue.length > 0"
          class="btn"
          type="button"
          @click="
            ttsService.stopPlay();
            voicePlaying = false;
            playingSpeechKey = null;
            clearSpeechPipeline({ applyPending: true })
          "
        >
          停止朗读
        </button>

        <button
          v-if="isVotePhase"
          class="btn primary"
          type="button"
          :disabled="loading || autoPlay || hasPendingPhaseCommit"
          @click="runVote"
        >
          {{ hasPendingPhaseCommit ? '播报中…' : voteButtonLabel }}
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
                  speaking: displaySpeakerId === p.id,
                  revealed: p.revealed,
                  sheriff: p.isSheriff,
                  runner: isRunner(p.id) && !game.sheriffDone,
                  ballot: isOnBallot(p.id) && (game.phase === 'sheriff_vote' || game.phase === 'sheriff_pk'),
                }"
              >
                <img class="avatar" :src="avatarForModel(p.modelId)" :alt="p.name" />
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
                  <span class="model-tag">{{ modelDisplayName(p.modelId) }}</span>
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
                  speaking: displaySpeakerId === p.id,
                  revealed: p.revealed,
                  sheriff: p.isSheriff,
                  runner: isRunner(p.id) && !game.sheriffDone,
                  ballot: isOnBallot(p.id) && (game.phase === 'sheriff_vote' || game.phase === 'sheriff_pk'),
                }"
              >
                <img class="avatar" :src="avatarForModel(p.modelId)" :alt="p.name" />
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
                  <span class="model-tag">{{ modelDisplayName(p.modelId) }}</span>
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

.setup-field {
  margin-bottom: 14px;
}

.setup-label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--text-h);
  font-weight: 500;
}

.setup-label-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.setup-label-row .setup-label {
  margin-bottom: 0;
}

.setup-bulk {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.seat-model-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}

.seat-model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
}

.seat-model-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.seat-model-name {
  flex-shrink: 0;
  width: 2.5em;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-h);
}

.seat-model-row .model-select {
  flex: 1;
  min-width: 0;
  width: auto;
}

.board-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.board-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  text-align: left;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.board-card strong {
  font-size: 14px;
  color: var(--text-h);
}

.board-card span {
  font-size: 12px;
  line-height: 1.35;
  color: var(--text);
}

.board-card:hover:not(:disabled) {
  border-color: var(--accent);
}

.board-card.active {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.board-card:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.model-select {
  width: min(280px, 100%);
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text-h);
  font-size: 14px;
}

.model-select-sm {
  width: min(160px, 100%);
  padding: 6px 8px;
  font-size: 13px;
}

.model-select:focus {
  outline: 2px solid color-mix(in srgb, var(--accent) 35%, transparent);
  outline-offset: 1px;
}

.model-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 音色设置区域 */
.voice-setup-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

.voice-setup-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-h);
  min-width: 3em;
}

.voice-select-sm,
.voice-select-xs {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text-h);
  font: inherit;
  font-size: 13px;
  outline: none;
  cursor: pointer;
  max-width: 160px;
}

.voice-select-xs {
  padding: 4px 6px;
  font-size: 12px;
  max-width: 110px;
  flex-shrink: 0;
}

.voice-select-sm:focus,
.voice-select-xs:focus {
  outline: 2px solid color-mix(in srgb, var(--accent) 35%, transparent);
  outline-offset: 1px;
}

.voice-select-sm:disabled,
.voice-select-xs:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.setup-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

@media (max-width: 720px) {
  .board-options {
    grid-template-columns: 1fr;
  }

  .seat-model-list {
    grid-template-columns: 1fr;
  }
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

.voice-select {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text);
}

.voice-select select {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text-h);
  font: inherit;
  font-size: 12px;
  outline: none;
  cursor: pointer;
}

.voice-select select:focus {
  border-color: var(--accent);
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

.model-tag {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text);
  opacity: 0.85;
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
