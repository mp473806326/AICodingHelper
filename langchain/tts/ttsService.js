import { Communicate } from '@travisvn/edge-tts';

/** 音色配置 */
const VOICE_CONFIG = {
  female: 'zh-CN-XiaoxiaoNeural',
  male: 'zh-CN-YunyangNeural',
  youngMale: 'zh-CN-YunxiNeural',
};

const CONNECT_TIMEOUT_MS = 8000;

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
   * 批量转换：将多段文本按角色语音合成后合并
   * @param {Array<{text: string, voice?: string, speed?: number}>} segments
   * @returns {Promise<Buffer>}
   */
  async batchTextToAudio(segments) {
    const audioBuffers = [];

    for (const segment of segments) {
      const stream = await this.textToStream(
        segment.text,
        segment.voice,
        segment.speed ?? 1.0,
      );
      const chunks = [];

      for await (const chunk of stream) {
        if (chunk.type === 'audio' && chunk.data) {
          chunks.push(chunk.data);
        }
      }

      if (chunks.length) {
        audioBuffers.push(Buffer.concat(chunks));
      }
    }

    return Buffer.concat(audioBuffers);
  }
}

export default new TTSService();
