/** TTS API 调用服务（经 Vite 代理到后端 /tts，失败时降级为浏览器语音） */
const API_BASE = '/api'
/** 需大于后端 Edge TTS 超时（约 10s），否则会 abort 导致 DevTools「无法加载响应数据」 */
const FETCH_TIMEOUT_MS = 20000

export type VoiceId = 'female' | 'male' | 'youngMale'

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
  /** Edge TTS 连续失败后本会话内直接用浏览器语音，避免每次等待超时 */
  private edgeUnavailable = false

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
   * 请求并播放一段语音；Edge TTS 失败/超时时降级为 Web Speech API
   */
  async playStream(text: string, options: TTSOptions = {}): Promise<void> {
    const { voice = 'female', speed = 1.0 } = options
    const trimmed = text?.trim()
    if (!trimmed) return

    this.stopPlay()
    const token = ++this.playToken

    if (!this.edgeUnavailable) {
      try {
        const audioData = await this.fetchAudio(trimmed, voice, speed)
        if (token !== this.playToken) return
        await this.playArrayBuffer(audioData, token)
        return
      } catch (error) {
        this.edgeUnavailable = true
        console.warn('Edge TTS 不可用，后续改用浏览器语音:', error)
      }
    }

    if (token !== this.playToken) return
    await this.fallbackSpeak(trimmed, voice, speed, token)
  }

  private async fetchAudio(text: string, voice: VoiceId, speed: number): Promise<ArrayBuffer> {
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

      return await response.arrayBuffer()
    } finally {
      clearTimeout(timer)
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

  private fallbackSpeak(
    text: string,
    voice: VoiceId,
    speed: number,
    token: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      if (typeof speechSynthesis === 'undefined') {
        resolve()
        return
      }

      let started = false
      const speak = () => {
        if (started || token !== this.playToken) {
          if (!started) resolve()
          return
        }
        started = true
        speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.lang = 'zh-CN'
        utterance.rate = Math.min(2, Math.max(0.5, speed))
        const picked = this.pickBrowserVoice(voice)
        if (picked) utterance.voice = picked
        utterance.onend = () => resolve()
        utterance.onerror = () => resolve()
        speechSynthesis.speak(utterance)
      }

      // Chrome：voices 可能异步加载
      const voices = speechSynthesis.getVoices()
      if (!voices.length) {
        speechSynthesis.addEventListener('voiceschanged', speak, { once: true })
        setTimeout(speak, 300)
      } else {
        speak()
      }
    })
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
