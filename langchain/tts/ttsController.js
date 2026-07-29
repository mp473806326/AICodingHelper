import ttsService from './ttsService.js';

export const ttsController = {
  /** 流式返回音频（边生成边推送） */
  async streamAudio(req, res) {
    try {
      const { text, voice = 'female', speed = 1.0 } = req.body ?? {};

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: '缺少文本参数' });
      }

      const trimmed = text.trim();
      if (!trimmed) {
        return res.status(400).json({ error: '文本不能为空' });
      }
      if (trimmed.length > 5000) {
        return res.status(400).json({ error: '单次文本请控制在 5000 字以内' });
      }

      const stream = await ttsService.textToStream(trimmed, voice, Number(speed) || 1.0);

      let started = false;
      for await (const chunk of stream) {
        if (chunk.type === 'audio' && chunk.data) {
          if (!started) {
            started = true;
            res.status(200);
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Cache-Control', 'no-cache');
          }
          res.write(chunk.data);
        }
      }

      if (!started) {
        return res.status(502).json({ error: '未生成到音频数据' });
      }

      res.end();
    } catch (error) {
      console.error('流式音频生成失败:', error);
      if (!res.headersSent) {
        const msg = error?.message?.includes('超时')
          ? '语音服务连接超时（需能访问微软 Edge TTS，可在 .env 设置 EDGE_TTS_PROXY）'
          : '语音生成失败';
        res.status(500).json({ error: msg });
      } else {
        res.end();
      }
    }
  },

  /** 批量生成音频（适合完整对局多段发言） */
  async batchAudio(req, res) {
    try {
      const { segments } = req.body ?? {};

      if (!segments || !Array.isArray(segments) || segments.length === 0) {
        return res.status(400).json({ error: '缺少语音片段数据' });
      }

      const normalized = segments
        .filter((s) => s && typeof s.text === 'string' && s.text.trim())
        .map((s) => ({
          text: s.text.trim(),
          voice: s.voice || 'female',
          speed: Number(s.speed) || 1.0,
        }));

      if (!normalized.length) {
        return res.status(400).json({ error: '没有有效的语音文本' });
      }

      const audioBuffer = await ttsService.batchTextToAudio(normalized);

      res.setHeader('Content-Type', 'audio/mpeg');
      res.send(audioBuffer);
    } catch (error) {
      console.error('批量音频生成失败:', error);
      const msg = error?.message?.includes('超时')
        ? '语音服务连接超时（需能访问微软 Edge TTS，可在 .env 设置 EDGE_TTS_PROXY）'
        : '批量语音生成失败';
      res.status(500).json({ error: msg });
    }
  },
};
