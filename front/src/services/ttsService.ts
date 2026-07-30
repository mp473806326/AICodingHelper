/** TTS API 调用服务（经 Vite 代理到后端 /tts，失败时降级为浏览器语音） */
const API_BASE = '/api'
/**
 * 必须大于后端最坏单次耗时：连接超时 10s + 退避 0.5s + 重合成约 8s。
 * 否则后端重试成功了，前端却已经 abort，白白掉一段。
 */
const FETCH_TIMEOUT_MS = 45000
/**
 * 预取是提前一整轮发起的，不加闸门会一次压十几个请求。
 * 浏览器同源只开 6 条 HTTP/1.1 连接，排队的请求还没发出就会被超时 abort。
 */
const MAX_CONCURRENT_FETCH = 3
/** 连续失败到此次数才降级为浏览器语音，避免一次偶发抖动毁掉整局 */
const EDGE_FAILURE_THRESHOLD = 3
/** 降级后的冷却时间，过后重新尝试 Edge TTS */
const EDGE_COOLDOWN_MS = 60000
/** Chrome 单条 utterance 超过约 15 秒会被静默掐断，按此长度切句连读 */
const SPEECH_CHUNK_MAX_LEN = 60

export type VoiceId =
  | 'female' | 'male' | 'youngMale'  // 别名（兼容旧版）
  | 'xiaoxiao' | 'xiaoyi' | 'xiaochen' | 'xiaohan' | 'xiaomeng'
  | 'xiaomo' | 'xiaoqiu' | 'xiaorui' | 'xiaoshuang' | 'xiaoxuan'
  | 'xiaoyan' | 'xiaoyou'
  | 'yunyang' | 'yunxi' | 'yunjian' | 'yunfeng' | 'yunhao'
  | 'yunxia' | 'yunye' | 'yunze'
  | 'hiumaan' | 'wanlung' | 'hiugaai'

/** 限制同时在途的请求数；未获得令牌的调用不占用浏览器连接，也不开始超时计时 */
class Semaphore {
  private active = 0
  private waiting: (() => void)[] = []

  constructor(private readonly limit: number) {}

  acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.active += 1
        resolve()
      })
    })
  }

  release() {
    this.active -= 1
    this.waiting.shift()?.()
  }
}

export interface TTSOptions {
  voice?: VoiceId
  speed?: number
}

interface ScriptSegment {
  speaker: string
  text: string
}

export class TTSService {
  private audioContext: AudioContext | null = null
  private currentSource: AudioBufferSourceNode | null = null
  private currentObjectUrl: string | null = null
  private currentAudio: HTMLAudioElement | null = null
  private playToken = 0
  private readonly fetchGate = new Semaphore(MAX_CONCURRENT_FETCH)
  private edgeFailures = 0
  private edgeDisabledUntil = 0

  /** 连续失败达到阈值后暂时改用浏览器语音，冷却结束后自动恢复 */
  private get edgeUnavailable(): boolean {
    if (!this.edgeDisabledUntil) return false
    if (Date.now() >= this.edgeDisabledUntil) {
      this.edgeDisabledUntil = 0
      this.edgeFailures = 0
      return false
    }
    return true
  }

  private noteEdgeFailure(error: unknown) {
    this.edgeFailures += 1
    if (this.edgeFailures >= EDGE_FAILURE_THRESHOLD && !this.edgeDisabledUntil) {
      this.edgeDisabledUntil = Date.now() + EDGE_COOLDOWN_MS
      console.warn(`Edge TTS 连续 ${this.edgeFailures} 次失败，暂时改用浏览器语音:`, error)
    }
  }

  private noteEdgeSuccess() {
    this.edgeFailures = 0
    this.edgeDisabledUntil = 0
  }

  /** 按座位号映射音色：奇数男声、偶数年轻男声，法官女声 */
  getVoiceBySpeaker(speaker: string | number): VoiceId {
    if (typeof speaker === 'number') {
      return speaker % 2 === 1 ? 'male' : 'youngMale'
    }
    const num = parseInt(String(speaker), 10)
    if (Number.isNaN(num)) return 'female'
    return num % 2 === 1 ? 'male' : 'youngMale'
  }

  /**
   * 仅预取音频，不播放。成功返回 ArrayBuffer；Edge TTS 不可用时返回 null（播放时走浏览器语音）
   */
  async prefetchAudio(text: string, options: TTSOptions = {}): Promise<ArrayBuffer | null> {
    const { voice = 'female', speed = 1.0 } = options
    const trimmed = text?.trim()
    if (!trimmed) return null
    if (this.edgeUnavailable) return null

    try {
      const buffer = await this.fetchAudio(trimmed, voice, speed)
      this.noteEdgeSuccess()
      return buffer
    } catch (error) {
      this.noteEdgeFailure(error)
      return null
    }
  }

  /**
   * 播放已预取的音频；buffer 为空时降级为浏览器语音
   */
  async playBuffered(
    text: string,
    audioData: ArrayBuffer | null,
    options: TTSOptions = {},
  ): Promise<void> {
    const { voice = 'female', speed = 1.0 } = options
    const trimmed = text?.trim()
    if (!trimmed) return

    this.stopPlay()
    const token = ++this.playToken

    if (audioData) {
      await this.playArrayBuffer(audioData, token)
      return
    }

    if (!this.edgeUnavailable) {
      try {
        const fetched = await this.fetchAudio(trimmed, voice, speed)
        this.noteEdgeSuccess()
        if (token !== this.playToken) return
        await this.playArrayBuffer(fetched, token)
        return
      } catch (error) {
        this.noteEdgeFailure(error)
      }
    }

    if (token !== this.playToken) return
    await this.fallbackSpeak(trimmed, voice, speed, token)
  }

  /**
   * 请求并播放一段语音；Edge TTS 失败/超时时降级为 Web Speech API
   */
  async playStream(text: string, options: TTSOptions = {}): Promise<void> {
    const { voice = 'female', speed = 1.0 } = options
    const trimmed = text?.trim()
    if (!trimmed) return

    this.stopPlay()
    const audioData = this.edgeUnavailable
      ? null
      : await this.prefetchAudio(trimmed, { voice, speed })
    await this.playBuffered(trimmed, audioData, { voice, speed })
  }

  private async fetchAudio(text: string, voice: VoiceId, speed: number): Promise<ArrayBuffer> {
    await this.fetchGate.acquire()
    // 计时器在拿到令牌后才启动，否则排队等待也会算进超时
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(`${API_BASE}/tts/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, speed }),
        signal: controller.signal,
      })

      if (!response.ok) {
        let msg = '语音生成失败'
        try {
          const err = (await response.json()) as { error?: string }
          if (err.error) msg = err.error
        } catch {
          /* ignore */
        }
        throw new Error(msg)
      }

      const buffer = await response.arrayBuffer()
      if (!buffer.byteLength) {
        throw new Error('语音数据为空')
      }
      return buffer
    } finally {
      clearTimeout(timer)
      this.fetchGate.release()
    }
  }

  private async playArrayBuffer(audioData: ArrayBuffer, token: number): Promise<void> {
    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext()
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }

      const audioBuffer = await this.audioContext.decodeAudioData(audioData.slice(0))
      if (token !== this.playToken) return

      await new Promise<void>((resolve, reject) => {
        const source = this.audioContext!.createBufferSource()
        source.buffer = audioBuffer
        source.connect(this.audioContext!.destination)
        source.onended = () => {
          if (this.currentSource === source) this.currentSource = null
          resolve()
        }
        try {
          source.start()
          this.currentSource = source
        } catch (e) {
          reject(e)
        }
      })
    } catch {
      if (token !== this.playToken) return
      await this.playViaHtmlAudio(audioData, token)
    }
  }

  private playViaHtmlAudio(audioData: ArrayBuffer, token: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.currentObjectUrl) {
        URL.revokeObjectURL(this.currentObjectUrl)
        this.currentObjectUrl = null
      }
      const blob = new Blob([audioData], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      this.currentObjectUrl = url
      const audio = new Audio(url)
      this.currentAudio = audio
      const done = () => {
        if (this.currentAudio === audio) this.currentAudio = null
        if (this.currentObjectUrl === url) {
          URL.revokeObjectURL(url)
          this.currentObjectUrl = null
        }
        resolve()
      }
      audio.onended = done
      audio.onerror = done
      void audio.play().catch(done)
      if (token !== this.playToken) {
        audio.pause()
        done()
      }
    })
  }

  private pickBrowserVoice(voice: VoiceId): SpeechSynthesisVoice | null {
    if (typeof speechSynthesis === 'undefined') return null
    const voices = speechSynthesis.getVoices()
    const zh = voices.filter((v) => /zh|chinese|中文/i.test(`${v.lang} ${v.name}`))
    const pool = zh.length ? zh : voices
    if (!pool.length) return null

    if (voice === 'female') {
      return (
        pool.find((v) => /female|woman|xiaoxiao|xiaoyi|huihui|女/i.test(v.name)) ||
        pool.find((v) => /zh-CN/i.test(v.lang)) ||
        pool[0]
      )
    }
    return (
      pool.find((v) => /male|man|yunyang|yunxi|kangkang|男/i.test(v.name)) ||
      pool.find((v) => /zh-CN/i.test(v.lang)) ||
      pool[pool.length - 1]
    )
  }

  /** 整段发言直接交给 speechSynthesis 会被 Chrome 掐断，按标点切成短句 */
  private splitForSpeech(text: string): string[] {
    const parts: string[] = []
    let buf = ''
    for (const ch of text) {
      buf += ch
      const isSentenceEnd = /[。！？；!?;\n]/.test(ch)
      const isClauseEnd = /[，、,]/.test(ch)
      if ((isSentenceEnd && buf.length >= 12) || (isClauseEnd && buf.length >= SPEECH_CHUNK_MAX_LEN)) {
        parts.push(buf.trim())
        buf = ''
      }
    }
    if (buf.trim()) parts.push(buf.trim())
    return parts.filter(Boolean)
  }

  /** Chrome 的 voices 可能异步加载 */
  private waitForVoices(): Promise<void> {
    return new Promise((resolve) => {
      if (speechSynthesis.getVoices().length) {
        resolve()
        return
      }
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        resolve()
      }
      speechSynthesis.addEventListener('voiceschanged', done, { once: true })
      setTimeout(done, 500)
    })
  }

  private speakChunk(
    text: string,
    picked: SpeechSynthesisVoice | null,
    speed: number,
    token: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'zh-CN'
      utterance.rate = Math.min(2, Math.max(0.5, speed))
      if (picked) utterance.voice = picked

      let settled = false
      let keepAlive: ReturnType<typeof setInterval> | undefined
      const done = () => {
        if (settled) return
        settled = true
        if (keepAlive) clearInterval(keepAlive)
        resolve()
      }

      utterance.onend = done
      utterance.onerror = done
      // Chrome 朗读期间可能自行进入 paused，需要定期唤醒
      keepAlive = setInterval(() => {
        if (token !== this.playToken) {
          done()
          return
        }
        if (speechSynthesis.paused) speechSynthesis.resume()
      }, 3000)

      speechSynthesis.speak(utterance)
    })
  }

  private async fallbackSpeak(
    text: string,
    voice: VoiceId,
    speed: number,
    token: number,
  ): Promise<void> {
    if (typeof speechSynthesis === 'undefined') return

    await this.waitForVoices()
    if (token !== this.playToken) return

    speechSynthesis.cancel()
    const picked = this.pickBrowserVoice(voice)
    for (const chunk of this.splitForSpeech(text)) {
      if (token !== this.playToken) return
      await this.speakChunk(chunk, picked, speed, token)
    }
  }

  stopPlay() {
    this.playToken += 1
    if (this.currentSource) {
      try {
        this.currentSource.stop()
      } catch {
        /* already stopped */
      }
      this.currentSource = null
    }
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.currentAudio = null
    }
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl)
      this.currentObjectUrl = null
    }
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel()
    }
  }

  /** 按段落依次播放整段对局文本 */
  async playGameScript(script: string, callback?: (segment: string) => void) {
    const segments = this.parseScriptToSegments(script)
    for (const seg of segments) {
      const voice = this.getVoiceBySpeaker(seg.speaker)
      await this.playStream(seg.text, { voice })
      callback?.(seg.text)
      await this.sleep(300)
    }
  }

  private parseScriptToSegments(script: string): ScriptSegment[] {
    const regex = /(\d+号(?:玩家)?[：:])/g
    const segments: ScriptSegment[] = []
    let lastIndex = 0
    let lastSpeaker = '法官'
    let match: RegExpExecArray | null

    while ((match = regex.exec(script)) !== null) {
      if (match.index > lastIndex) {
        const text = script.substring(lastIndex, match.index).trim()
        if (text) {
          segments.push({ speaker: lastSpeaker, text })
        }
      }
      lastSpeaker = match[1]
      lastIndex = match.index + match[1].length
    }

    if (lastIndex < script.length) {
      const text = script.substring(lastIndex).trim()
      if (text) {
        segments.push({ speaker: lastSpeaker, text })
      }
    }

    if (!segments.length && script.trim()) {
      segments.push({ speaker: '法官', text: script.trim() })
    }

    return segments
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export const ttsService = new TTSService()
