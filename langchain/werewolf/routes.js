/**
 * 狼人杀 HTTP 路由
 */

import {
  createGame,
  getGame,
  toPublicState,
  resolveNight,
  currentSpeakerId,
  recordSpeech,
  resolveVote,
  PHASE,
} from "./game.js";
import { generateSpeechWithDoubao } from "./ai.js";

export function registerWerewolfRoutes(app) {
  /** 开新局（固定 12 人预女猎白） */
  app.post("/werewolf/games", (_req, res) => {
    try {
      const game = createGame();
      res.json({ game: toPublicState(game) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message ?? "创建对局失败" });
    }
  });

  /** 查询对局 */
  app.get("/werewolf/games/:id", (req, res) => {
    const game = getGame(req.params.id);
    if (!game) return res.status(404).json({ error: "对局不存在" });
    res.json({ game: toPublicState(game) });
  });

  /** 结算夜晚（狼→女巫→预言家）并进入白天发言 */
  app.post("/werewolf/games/:id/night", (req, res) => {
    try {
      const game = getGame(req.params.id);
      if (!game) return res.status(404).json({ error: "对局不存在" });
      if (game.phase === PHASE.ENDED) {
        return res.status(400).json({ error: "游戏已结束", game: toPublicState(game) });
      }
      if (game.phase !== PHASE.NIGHT) {
        return res.status(400).json({
          error: `当前阶段为 ${game.phase}，无法结算夜晚`,
          game: toPublicState(game),
        });
      }
      const result = resolveNight(game);
      res.json({ ...result, game: toPublicState(game) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message ?? "夜晚结算失败" });
    }
  });

  /**
   * 下一位发言（豆包生成）
   * body 可选：{ playerId } 不传则按队列下一位
   */
  app.post("/werewolf/games/:id/speak", async (req, res) => {
    try {
      const game = getGame(req.params.id);
      if (!game) return res.status(404).json({ error: "对局不存在" });
      if (game.phase !== PHASE.DAY_SPEECH) {
        return res.status(400).json({
          error: `当前阶段为 ${game.phase}，无法发言`,
          game: toPublicState(game),
        });
      }

      const playerId = currentSpeakerId(game);
      if (playerId == null) {
        return res.status(400).json({
          error: "发言队列已结束，请进入投票",
          game: toPublicState(game),
        });
      }

      const text = await generateSpeechWithDoubao(game, playerId);
      const speech = recordSpeech(game, playerId, text);

      res.json({
        speech,
        nextSpeakerId: currentSpeakerId(game),
        game: toPublicState(game),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message ?? "发言生成失败" });
    }
  });

  /** 投票放逐（含白痴翻牌 / 猎人开枪） */
  app.post("/werewolf/games/:id/vote", (req, res) => {
    try {
      const game = getGame(req.params.id);
      if (!game) return res.status(404).json({ error: "对局不存在" });
      if (game.phase !== PHASE.DAY_VOTE) {
        return res.status(400).json({
          error: `当前阶段为 ${game.phase}，无法投票`,
          game: toPublicState(game),
        });
      }
      const result = resolveVote(game);
      res.json({ ...result, game: toPublicState(game) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message ?? "投票失败" });
    }
  });
}
