import { Communicate } from 'edge-tts-universal';

/** 音色配置 */
const VOICE_CONFIG = {
  female: 'zh-CN-XiaoxiaoNeural',
  male: 'zh-CN-YunyangNeural',
  youngMale: 'zh-CN-YunxiNeural',
};

const CONNECT_TIMEOUT_MS = 8000;
/** 断流是偶发的，整段重合成一次通常就能拿到完整音频 */
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 500;
/**
 * Edge TTS 并发一高就整批连接超时（实测 6 并发全通过、12 并发全失败），
 * 服务端排队远比让请求一起撞上去再全军覆没要好。
 */
const MAX_CONCURRENT = 4;

/** 简易信号量：超出并发的调用排队等待，不占用上游连接 */
class Semaphore {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.waiting = [];
  }

  acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  release() {
    this.active -= 1;
    const next = this.waiting.shift();
    if (next) next();
  }
}

const gate = new Semaphore(MAX_CONCURRENT);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 可选代理：EDGE_TTS_PROXY > HTTPS_PROXY > HTTP_PROXY（国内访问微软 TTS 常需代理） */
function resolveProxy() {
  const proxy =
    process.env.EDGE_TTS_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    '';
  return proxy.trim() || undefined;
}

/**
 * 将 0.5–2.0 倍速转为 edge-tts rate 字符串（如 "+20%"）
 * @param {number} speed
 */
function toRate(speed) {
  const n = Number(speed);
  if (!Number.isFinite(n) || n === 1) return '+0%';
  const pct = Math.round((n - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

/**
 * 仅对首个 chunk 做连接超时；后续 chunk 不再 race，并清理定时器避免泄漏
 * @param {AsyncGenerator} stream
 * @param {number} ms
 */
async function* withConnectTimeout(stream, ms) {
  const iter = stream[Symbol.asyncIterator]();
  let first = true;

  try {
    while (true) {
      let timer;
      try {
        const next = first
          ? await Promise.race([
              iter.next(),
              new Promise((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error('TTS 连接超时，请检查网络或配置 EDGE_TTS_PROXY')),
                  ms,
                );
              }),
            ])
          : await iter.next();

        if (next.done) break;
        first = false;
        yield next.value;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  } finally {
    // 超时/中断时关闭底层连接。这里不能 await：连接已经卡住时 return() 同样不会 settle
    void Promise.resolve(iter.return?.()).catch(() => {});
  }
}

class TTSService {
  /**
   * 将文本转换为音频流
   * @param {string} text
   * @param {string} voice female | male | youngMale
   * @param {number} speed 0.5–2.0
   */
  async textToStream(text, voice = 'female', speed = 1.0) {
    try {
      const voiceName = VOICE_CONFIG[voice] || VOICE_CONFIG.female;
      const proxy = resolveProxy();
      const options = {
        voice: voiceName,
        rate: toRate(speed),
        connectionTimeout: CONNECT_TIMEOUT_MS,
      };
      if (proxy) options.proxy = proxy;

      const communicate = new Communicate(String(text), options);
      return withConnectTimeout(communicate.stream(), CONNECT_TIMEOUT_MS + 2000);
    } catch (error) {
      console.error('TTS转换失败:', error);
      throw new Error('语音合成服务暂时不可用');
    }
  }

  /**
   * 完整合成一段音频。中途断流会抛错而不是返回已收到的部分，
   * 避免调用方把半截音频当成功结果播放（听感上就是念一半突然停）。
   * @param {string} text
   * @param {string} voice
   * @param {number} speed
   * @returns {Promise<Buffer>}
   */
  async textToBuffer(text, voice = 'female', speed = 1.0) {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await gate.acquire();
      try {
        const stream = await this.textToStream(text, voice, speed);
        const chunks = [];
        for await (const chunk of stream) {
          if (chunk.type === 'audio' && chunk.data) {
            chunks.push(chunk.data);
          }
        }
        if (!chunks.length) {
          throw new Error('未生成到音频数据');
        }
        return Buffer.concat(chunks);
      } catch (error) {
        lastError = error;
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`TTS 合成失败，重试 ${attempt}/${MAX_ATTEMPTS - 1}:`, error?.message);
        }
      } finally {
        gate.release();
      }

      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BACKOFF_MS);
      }
    }

    throw lastError ?? new Error('语音合成失败');
  }

  /**
   * 批量转换：将多段文本按角色语音合成后合并
   * @param {Array<{text: string, voice?: string, speed?: number}>} segments
   * @returns {Promise<Buffer>}
   */
  async batchTextToAudio(segments) {
    const audioBuffers = [];

    for (const segment of segments) {
      audioBuffers.push(
        await this.textToBuffer(segment.text, segment.voice, segment.speed ?? 1.0),
      );
    }

    return Buffer.concat(audioBuffers);
  }
}

export default new TTSService();
