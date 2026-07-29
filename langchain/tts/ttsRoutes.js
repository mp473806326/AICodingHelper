import { ttsController } from './ttsController.js';

/** 注册 TTS 路由：POST /tts/stream、POST /tts/batch */
export function registerTtsRoutes(app) {
  app.post('/tts/stream', (req, res) => ttsController.streamAudio(req, res));
  app.post('/tts/batch', (req, res) => ttsController.batchAudio(req, res));
}
