/**
 * 狼人杀 HTTP 路由
 * 流程：night → (首日 sheriff_speech → sheriff_vote [→ sheriff_pk → sheriff_vote]) → day_speech → day_vote → night …
 */

import {
  createGame,
  getGame,
  toPublicState,
  resolveNight,
  currentSpeakerId,
  recordSpeech,
  resolveVote,
  resolveSheriffVote,
  PHASE,
} from "./game.js";
import { generateSpeechWithDoubao } from "./ai.js";

const SPEAK_PHASES = new Set([
  PHASE.SHERIFF_SPEECH,
  PHASE.SHERIFF_PK,
  PHASE.DAY_SPEECH,
]);

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

  /** 结算夜晚（狼→女巫→预言家）；首日进入警长竞选，其后进入白天发言 */
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
   * 适用于：警长竞选发言 / PK / 白天发言
   */
  app.post("/werewolf/games/:id/speak", async (req, res) => {
    try {
      const game = getGame(req.params.id);
      if (!game) return res.status(404).json({ error: "对局不存在" });
      if (!SPEAK_PHASES.has(game.phase)) {
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

  /** 投票：警长竞选投票 或 白天放逐投票 */
  app.post("/werewolf/games/:id/vote", (req, res) => {
    try {
      const game = getGame(req.params.id);
      if (!game) return res.status(404).json({ error: "对局不存在" });

      if (game.phase === PHASE.SHERIFF_VOTE) {
        const result = resolveSheriffVote(game);
        return res.json({ ...result, kind: "sheriff", game: toPublicState(game) });
      }

      if (game.phase === PHASE.DAY_VOTE) {
        const result = resolveVote(game);
        return res.json({ ...result, kind: "exile", game: toPublicState(game) });
      }

      return res.status(400).json({
        error: `当前阶段为 ${game.phase}，无法投票`,
        game: toPublicState(game),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message ?? "投票失败" });
    }
  });
}
