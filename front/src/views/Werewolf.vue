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

const judgeVoice = ref<VoiceId>('xiaoxiao')

/** 两段播报之间的留白，避免上一句尾音和下一句糊在一起 */
const STEP_GAP_MS = 260
/**
 * 未播语音步数上限。超过就先不发请求，
 * 否则接口能在几十秒内把整局跑完，而语音还停在第一夜。
 */
const PREFETCH_AHEAD_LIMIT = 3

interface TimelineStep {
  /** judge=法官播报；speech=玩家发言正文；silent=只落地状态、不发声 */
  kind: 'judge' | 'speech' | 'silent'
  text: string
  voice: VoiceId
  key: string
  /** 座位高亮；法官流程播报为 null */
  highlightPlayerId: number | null
  /**
   * 播这一步之前落地的状态增量。
   * 这是**唯一**推进展示状态的地方，所以进度严格跟着语音走。
   */
  patch: ((prev: GameState) => Partial<GameState>) | null
  /** 文本就绪后立即预取，播完上一段再取结果播放 */
  audioReady: Promise<ArrayBuffer | null> | null
}

/** 按播放顺序排布的播报时间线 */
const timeline = ref<TimelineStep[]>([])
/** 当前正在朗读的座位号（流程高亮跟语音走） */
const playbackSpeakerId = ref<number | null>(null)
const timelineRunning = ref(false)
/** 清空/停止时递增，丢弃进行中的预取播放 */
let timelineEpoch = 0
/** 已排进时间线的战报；用独立集合做差分，避免依赖会被改写的 game.logs */
const narratedLogKeys = new Set<string>()
/**
 * 服务端最新状态。只用于决定下一个请求打哪个接口，从不直接参与渲染。
 */
const prefetchGame = ref<GameState | null>(null)

/** 还没播的语音步数，用来给预取限速 */
const pendingAudioSteps = computed(
  () => timeline.value.filter((step) => step.kind !== 'silent').length,
)
/** 还有播报没走完：手动按钮要等它播完再放行 */
const timelinePending = computed(
  () => timeline.value.length > 0 || timelineRunning.value,
)

onUnmounted(() => {
  autoPlay.value = false
  autoSpeak.value = false
  autoPlayToken += 1
  timelineEpoch += 1
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

/** 座位高亮跟着正在朗读的那一步走；无朗读时才回落到展示进度 */
const displaySpeakerId = computed(
  () => playbackSpeakerId.value ?? currentSpeakerId.value,
)

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

/** 停止播报：丢掉剩余语音；applyPending 时把状态一次性追平到已请求的进度 */
function clearTimeline(opts?: { applyPending?: boolean }) {
  const rest = timeline.value
  timelineEpoch += 1
  timeline.value = []
  playbackSpeakerId.value = null
  timelineRunning.value = false
  ttsService.stopPlay()
  voicePlaying.value = false
  playingSpeechKey.value = null
  if (opts?.applyPending) {
    for (const step of rest) applyStepPatch(step)
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
  clearTimeline()
  narratedLogKeys.clear()
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
    // 战报留空由时间线逐条揭示，避免开局播报还没念就全列出来
    game.value = { ...data.game, logs: [] }
    enqueueServerUpdate(data.game)
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

async function runNight() {
  const g = logicalGame()
  if (!g || loading.value || speaking.value) return
  if (g.phase !== 'night') return
  loading.value = true
  error.value = ''
  try {
    const { data } = await axios.post<{ game: GameState }>(
      `/api/werewolf/games/${g.id}/night`,
    )
    enqueueServerUpdate(data.game)
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

type LogItem = { t: number; msg: string }

function logKey(item: LogItem) {
  return `${item.t}|${item.msg}`
}

/**
 * 取出还没排进时间线的战报，按发生顺序（旧→新）返回。
 * 同一毫秒的重复文案用出现次数区分，避免被误判成已播过而漏掉。
 */
function collectFreshLogs(nextLogs: LogItem[]): LogItem[] {
  const seen = new Map<string, number>()
  const fresh: LogItem[] = []
  for (const item of nextLogs.slice().reverse()) {
    const base = logKey(item)
    const nth = (seen.get(base) ?? 0) + 1
    seen.set(base, nth)
    const key = `${base}#${nth}`
    if (narratedLogKeys.has(key)) continue
    narratedLogKeys.add(key)
    fresh.push(item)
  }
  return fresh
}

function speechIntroText(speech: Speech) {
  if (speech.kind === 'last_words') return `请${speech.playerId}号玩家发表遗言。`
  if (speech.kind === 'sheriff') return `请${speech.playerId}号玩家进行上警发言。`
  if (speech.kind === 'sheriff_pk') return `请${speech.playerId}号玩家进行PK发言。`
  return `请${speech.playerId}号玩家发言。`
}

function stepId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 入队一步；关掉朗读时退化成 silent，走同一条落地路径 */
function pushStep(step: Omit<TimelineStep, 'audioReady'>) {
  const silent = step.kind === 'silent' || !autoVoice.value || !step.text.trim()
  timeline.value.push({
    ...step,
    kind: silent ? 'silent' : step.kind,
    audioReady: silent
      ? null
      : ttsService.prefetchAudio(step.text, {
          voice: step.voice,
          speed: ttsSpeed.value,
        }),
  })
}

/**
 * 把一次接口结果拆成按播放顺序落地的时间线。
 *
 * 请求只负责生产播报步骤，不碰展示状态：每一步的状态增量都在自己播之前才生效，
 * 末尾再补一份完整快照兜底，所以画面永远不会跑到语音前面去。
 */
function enqueueServerUpdate(nextGame: GameState, speech?: Speech | null) {
  prefetchGame.value = nextGame

  const fresh = collectFreshLogs(nextGame.logs)
  // 战报是新→旧存的，揭示到某条即从它开始往后切
  const revealLogs = (item: LogItem) =>
    nextGame.logs.slice(nextGame.logs.indexOf(item))

  const body = speech?.text?.trim() ? speech : null
  if (body) {
    pushStep({
      kind: 'judge',
      text: speechIntroText(body),
      voice: judgeVoice.value,
      key: `intro-${speechKey(body)}`,
      highlightPlayerId: body.playerId,
      patch: null,
    })
  }

  let bodyQueued = !body
  for (const item of fresh) {
    const isSpeechLog = SPEECH_LOG_RE.test(item.msg)
    if (isSpeechLog && !bodyQueued) {
      bodyQueued = true
      pushStep({
        kind: 'speech',
        text: body!.text,
        voice: voiceForPlayer(body!.playerId),
        key: speechKey(body!),
        highlightPlayerId: body!.playerId,
        // 发言正文和它的战报，念到才出现在面板上
        patch: (prev) => {
          const idx = prev.speechQueue.indexOf(body!.playerId)
          return {
            speeches: nextGame.speeches,
            logs: revealLogs(item),
            speechIndex: idx >= 0 ? idx + 1 : prev.speechIndex,
          }
        },
      })
      continue
    }
    // 别的发言正文由各自的发言步落地，这里只播流程播报
    if (isSpeechLog) continue
    pushStep({
      kind: 'judge',
      text: item.msg,
      voice: judgeVoice.value,
      key: stepId('judge'),
      highlightPlayerId: null,
      patch: () => ({ logs: revealLogs(item) }),
    })
  }

  if (!bodyQueued) {
    // 战报里没找到对应正文（不该发生）：仍要把发言播出来
    pushStep({
      kind: 'speech',
      text: body!.text,
      voice: voiceForPlayer(body!.playerId),
      key: speechKey(body!),
      highlightPlayerId: body!.playerId,
      patch: () => ({ speeches: nextGame.speeches }),
    })
  }

  pushStep({
    kind: 'silent',
    text: '',
    voice: judgeVoice.value,
    key: stepId('commit'),
    highlightPlayerId: null,
    patch: () => ({ ...nextGame }),
  })

  void drainTimeline()
}

/** 唯一推进展示状态的入口 */
function applyStepPatch(step: TimelineStep) {
  if (!step.patch || !game.value) return
  game.value = { ...game.value, ...step.patch(game.value) }
}

async function playStep(step: TimelineStep, epoch: number) {
  voicePlaying.value = true
  playingSpeechKey.value = step.key
  try {
    const audioData = await step.audioReady
    if (epoch !== timelineEpoch) return
    await ttsService.playBuffered(step.text, audioData, {
      voice: step.voice,
      speed: ttsSpeed.value,
    })
  } catch (e) {
    console.error(e)
  } finally {
    if (playingSpeechKey.value === step.key) {
      voicePlaying.value = false
      playingSpeechKey.value = null
    }
  }
}

async function drainTimeline() {
  if (timelineRunning.value) return
  timelineRunning.value = true
  const epoch = timelineEpoch
  try {
    while (timeline.value.length > 0) {
      if (epoch !== timelineEpoch) break
      const step = timeline.value.shift()!
      applyStepPatch(step)
      if (step.kind === 'silent') continue
      playbackSpeakerId.value = step.highlightPlayerId
      await playStep(step, epoch)
      if (epoch !== timelineEpoch) break
      playbackSpeakerId.value = null
      await sleep(STEP_GAP_MS)
    }
  } finally {
    if (epoch === timelineEpoch) {
      timelineRunning.value = false
      if (timeline.value.length > 0) void drainTimeline()
    }
  }
}

/** 手动朗读某条发言；自动播报进行中不插播，否则会打断队列里那一段 */
async function playSpeechText(text: string, playerId: number, key: string) {
  if (!text?.trim()) return
  if (playingSpeechKey.value === key && voicePlaying.value) {
    ttsService.stopPlay()
    voicePlaying.value = false
    playingSpeechKey.value = null
    return
  }
  if (timelinePending.value) return

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

async function nextSpeech() {
  if (speaking.value || loading.value) return
  const g = logicalGame()
  if (!g || !SPEECH_PHASES.has(g.phase)) return

  speaking.value = true
  error.value = ''
  try {
    const { data } = await axios.post<{
      game: GameState
      speech?: Speech
    }>(`/api/werewolf/games/${g.id}/speak`)
    enqueueServerUpdate(data.game, data.speech)
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
  try {
    const { data } = await axios.post<{ game: GameState }>(
      `/api/werewolf/games/${g.id}/vote`,
    )
    enqueueServerUpdate(data.game)
  } catch (e) {
    error.value = errMsg(e)
    stopAutoPlay()
  } finally {
    loading.value = false
  }
}

/**
 * 等一个可以发请求的档口：接口空闲，且待播语音没堆积。
 * 留一点缓冲让语音不断档，但不让请求把整局跑到语音前面去。
 */
async function waitForPrefetchSlot(token: number): Promise<boolean> {
  for (;;) {
    if (token !== autoPlayToken) return false
    if (
      loading.value ||
      speaking.value ||
      pendingAudioSteps.value > PREFETCH_AHEAD_LIMIT
    ) {
      await sleep(120)
      continue
    }
    return true
  }
}

async function runAutoPlayLoop() {
  const token = ++autoPlayToken
  autoPlay.value = true
  while (autoPlay.value && token === autoPlayToken) {
    if (!(await waitForPrefetchSlot(token))) break
    if (!autoPlay.value || token !== autoPlayToken) break

    const g = logicalGame()
    if (!g || g.phase === 'ended') {
      // 终局：等剩下的播报自然播完再收工
      if (timelinePending.value || voicePlaying.value) {
        await sleep(120)
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

/** 只连发言、不接管夜/投票 */
async function runAutoSpeakLoop() {
  const token = ++autoPlayToken
  autoSpeak.value = true
  while (autoSpeak.value && token === autoPlayToken) {
    if (!(await waitForPrefetchSlot(token))) break
    if (!autoSpeak.value || token !== autoPlayToken) break

    const g = logicalGame()
    if (!g || !SPEECH_PHASES.has(g.phase)) break
    await nextSpeech()
    if (error.value) break
  }
  if (token === autoPlayToken) autoSpeak.value = false
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
  if (autoPlay.value || autoSpeak.value) {
    stopAutoPlay()
    return
  }
  await runAutoSpeakLoop()
}

/** 关掉朗读时把剩下的播报丢掉，状态直接追平到已请求的进度 */
watch(autoVoice, (on) => {
  if (!on) clearTimeline({ applyPending: true })
})

function resetLocal() {
  stopAutoPlay()
  clearTimeline()
  narratedLogKeys.clear()
  game.value = null
  prefetchGame.value = null
  error.value = ''
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
          :disabled="loading || autoPlay || timelinePending"
          @click="runNight"
        >
          {{ loading ? '结算中…' : timelinePending ? '播报中…' : '结算夜晚' }}
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
              timelinePending ||
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
          v-if="voicePlaying || timelinePending"
          class="btn"
          type="button"
          @click="clearTimeline({ applyPending: true })"
        >
          停止朗读
        </button>

        <button
          v-if="isVotePhase"
          class="btn primary"
          type="button"
          :disabled="loading || autoPlay || timelinePending"
          @click="runVote"
        >
          {{ timelinePending ? '播报中…' : voteButtonLabel }}
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
                    :disabled="timelinePending"
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
