/**
 * 狼人杀·预女猎白标准局 (12人)
 * 板子：4狼 / 4民 / 预言家 / 女巫 / 猎人 / 白痴
 */

import { randomUUID } from "crypto";

export const PLAYER_COUNT = 12;

export const ROLES = {
  WEREWOLF: "werewolf",
  VILLAGER: "villager",
  SEER: "seer",
  WITCH: "witch",
  HUNTER: "hunter",
  IDIOT: "idiot",
};

export const ROLE_CN = {
  werewolf: "狼人",
  villager: "村民",
  seer: "预言家",
  witch: "女巫",
  hunter: "猎人",
  idiot: "白痴",
};

export const CAMP = {
  EVIL: "evil",
  GOOD: "good",
};

/** 固定角色池：4狼4民+预女猎白 */
export const ROLE_POOL = [
  ROLES.WEREWOLF,
  ROLES.WEREWOLF,
  ROLES.WEREWOLF,
  ROLES.WEREWOLF,
  ROLES.VILLAGER,
  ROLES.VILLAGER,
  ROLES.VILLAGER,
  ROLES.VILLAGER,
  ROLES.SEER,
  ROLES.WITCH,
  ROLES.HUNTER,
  ROLES.IDIOT,
];

export const PHASE = {
  LOBBY: "lobby",
  NIGHT: "night",
  DAWN: "dawn",
  DAY_SPEECH: "day_speech",
  DAY_VOTE: "day_vote",
  ENDED: "ended",
};

const GOD_ROLES = new Set([ROLES.SEER, ROLES.WITCH, ROLES.HUNTER, ROLES.IDIOT]);

const games = new Map();

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function campOf(role) {
  return role === ROLES.WEREWOLF ? CAMP.EVIL : CAMP.GOOD;
}

function pushLog(game, msg) {
  game.logs.unshift({ t: Date.now(), msg });
  if (game.logs.length > 200) game.logs.length = 200;
}

function alivePlayers(game) {
  return game.players.filter((p) => p.alive);
}

function findByRole(game, role) {
  return game.players.find((p) => p.role === role);
}

function countAliveRoles(game, roles) {
  const set = new Set(roles);
  return alivePlayers(game).filter((p) => set.has(p.role)).length;
}

/** 屠边胜负判定 */
export function checkWinner(game) {
  const alive = alivePlayers(game);
  const wolves = alive.filter((p) => p.role === ROLES.WEREWOLF);
  const gods = alive.filter((p) => GOD_ROLES.has(p.role));
  const villagers = alive.filter((p) => p.role === ROLES.VILLAGER);
  const good = alive.filter((p) => p.role !== ROLES.WEREWOLF);

  if (wolves.length === 0) {
    return { winner: "good", reason: "所有狼人已被放逐" };
  }
  if (gods.length === 0) {
    return { winner: "werewolf", reason: "神职已被屠尽（屠边）" };
  }
  if (villagers.length === 0) {
    return { winner: "werewolf", reason: "平民已被屠尽（屠边）" };
  }
  // 狼人人数不少于好人 → 票权碾压
  if (wolves.length >= good.length) {
    return { winner: "werewolf", reason: "狼人票权已碾压好人" };
  }
  return null;
}

function applyWinner(game, result) {
  if (!result) return false;
  game.phase = PHASE.ENDED;
  game.winner = result.winner;
  game.winnerReason = result.reason;
  const label = result.winner === "good" ? "好人阵营" : "狼人阵营";
  pushLog(game, `游戏结束：${label}获胜 — ${result.reason}`);
  return true;
}

/** 创建新局 */
export function createGame() {
  const roles = shuffle(ROLE_POOL);
  const players = roles.map((role, i) => ({
    id: i + 1,
    name: `${i + 1}号`,
    role,
    camp: campOf(role),
    alive: true,
    revealed: false, // 白痴翻牌
    canVote: true,
    poisonedMute: false, // 猎人被毒 → 枪哑
  }));

  const game = {
    id: randomUUID(),
    board: "预女猎白",
    phase: PHASE.NIGHT,
    day: 0,
    night: 1,
    players,
    witch: {
      antidote: 1,
      poison: 1,
      // 首夜允许自救
      firstNightSelfSave: true,
    },
    seerChecks: [], // { night, targetId, camp }
    speeches: [],
    speechQueue: [],
    speechIndex: 0,
    votes: {},
    lastNightDeaths: [],
    lastExile: null,
    pendingHunterShot: null, // playerId who may shoot
    winner: null,
    winnerReason: null,
    logs: [],
    createdAt: Date.now(),
  };

  pushLog(game, "发牌完成：4狼 / 4民 / 预言家 / 女巫 / 猎人 / 白痴。进入第 1 夜。");
  games.set(game.id, game);
  return game;
}

export function getGame(id) {
  return games.get(id) ?? null;
}

export function deleteGame(id) {
  return games.delete(id);
}

/** 对外可见状态（观战：展示身份便于演示） */
export function toPublicState(game) {
  return {
    id: game.id,
    board: game.board,
    phase: game.phase,
    day: game.day,
    night: game.night,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      roleCn: ROLE_CN[p.role],
      camp: p.camp,
      alive: p.alive,
      revealed: p.revealed,
      canVote: p.canVote,
    })),
    witch: { ...game.witch },
    seerChecks: game.seerChecks,
    speeches: game.speeches,
    speechQueue: game.speechQueue,
    speechIndex: game.speechIndex,
    votes: game.votes,
    lastNightDeaths: game.lastNightDeaths,
    lastExile: game.lastExile,
    pendingHunterShot: game.pendingHunterShot,
    winner: game.winner,
    winnerReason: game.winnerReason,
    logs: game.logs,
    aliveCount: alivePlayers(game).length,
  };
}

function pickRandom(list) {
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/** 狼人刀人：互认同伴，不知其余身份；优先已翻牌亮明者 */
function decideWolfKill(game) {
  const targets = alivePlayers(game).filter((p) => p.role !== ROLES.WEREWOLF);
  if (!targets.length) return null;
  const revealed = targets.filter((p) => p.revealed);
  if (revealed.length) return pickRandom(revealed);
  return pickRandom(targets);
}

/** 女巫决策 */
function decideWitch(game, killedId) {
  const witch = findByRole(game, ROLES.WITCH);
  if (!witch || !witch.alive) {
    return { save: false, poisonTargetId: null };
  }

  let save = false;
  if (killedId != null && game.witch.antidote > 0) {
    const isSelf = killedId === witch.id;
    const canSelf =
      !isSelf || (game.night === 1 && game.witch.firstNightSelfSave);
    if (canSelf) {
      // 首夜救人约 80%；自救更倾向救
      const rate = isSelf ? 0.9 : game.night === 1 ? 0.8 : 0.55;
      save = Math.random() < rate;
    }
  }

  let poisonTargetId = null;
  // 同夜不可双开；毒药慎用
  if (!save && game.witch.poison > 0 && game.night >= 2 && Math.random() < 0.2) {
    const unknowns = alivePlayers(game).filter(
      (p) => p.id !== witch.id && p.id !== killedId,
    );
    poisonTargetId = pickRandom(unknowns)?.id ?? null;
  }

  return { save, poisonTargetId };
}

/** 预言家查验 */
function decideSeerCheck(game) {
  const seer = findByRole(game, ROLES.SEER);
  if (!seer || !seer.alive) return null;
  const checked = new Set(game.seerChecks.map((c) => c.targetId));
  const candidates = alivePlayers(game).filter(
    (p) => p.id !== seer.id && !checked.has(p.id),
  );
  if (!candidates.length) return null;
  // 优先未查过的高位
  candidates.sort((a, b) => a.id - b.id);
  return candidates[0].id;
}

/**
 * 结算一整夜：狼刀 → 女巫 → 预言家
 */
export function resolveNight(game) {
  if (game.phase !== PHASE.NIGHT && game.phase !== PHASE.DAWN) {
    throw new Error(`当前阶段 ${game.phase} 无法结算夜晚`);
  }
  if (game.phase === PHASE.ENDED) {
    throw new Error("游戏已结束");
  }

  const events = [];
  const wolfTarget = decideWolfKill(game);
  const wolfTargetId = wolfTarget?.id ?? null;
  events.push({
    type: "wolf_kill",
    targetId: wolfTargetId,
    msg: wolfTargetId
      ? `狼人商议后刀了 ${wolfTargetId} 号`
      : "狼人空刀",
  });

  const witchAct = decideWitch(game, wolfTargetId);
  let savedId = null;
  let poisonedId = null;

  if (witchAct.save && wolfTargetId != null && game.witch.antidote > 0) {
    game.witch.antidote -= 1;
    savedId = wolfTargetId;
    events.push({
      type: "witch_save",
      targetId: savedId,
      msg: `女巫使用解药救了 ${savedId} 号`,
    });
  } else if (
    witchAct.poisonTargetId != null &&
    game.witch.poison > 0 &&
    !witchAct.save
  ) {
    game.witch.poison -= 1;
    poisonedId = witchAct.poisonTargetId;
    const victim = game.players.find((p) => p.id === poisonedId);
    if (victim?.role === ROLES.HUNTER) {
      victim.poisonedMute = true;
    }
    events.push({
      type: "witch_poison",
      targetId: poisonedId,
      msg: `女巫毒了 ${poisonedId} 号`,
    });
  } else {
    events.push({ type: "witch_pass", msg: "女巫今晚未用药" });
  }

  const seerTargetId = decideSeerCheck(game);
  if (seerTargetId != null) {
    const target = game.players.find((p) => p.id === seerTargetId);
    const camp = target.camp;
    game.seerChecks.push({
      night: game.night,
      targetId: seerTargetId,
      camp,
      campCn: camp === CAMP.EVIL ? "狼人阵营" : "好人阵营",
    });
    events.push({
      type: "seer_check",
      targetId: seerTargetId,
      camp,
      msg: `预言家查验了 ${seerTargetId} 号 → ${
        camp === CAMP.EVIL ? "狼人" : "好人"
      }`,
    });
  }

  // 结算死亡（对白天公开：不知死因细节时可只报人）
  const deathIds = new Set();
  if (wolfTargetId != null && savedId !== wolfTargetId) {
    deathIds.add(wolfTargetId);
  }
  if (poisonedId != null) {
    deathIds.add(poisonedId);
  }

  const deaths = [];
  for (const id of deathIds) {
    const p = game.players.find((x) => x.id === id);
    if (p && p.alive) {
      p.alive = false;
      deaths.push({
        id: p.id,
        name: p.name,
        role: p.role,
        roleCn: ROLE_CN[p.role],
        byPoison: id === poisonedId,
      });
    }
  }
  game.lastNightDeaths = deaths;

  for (const e of events) pushLog(game, e.msg);
  if (deaths.length === 0) {
    pushLog(game, "天亮了，昨夜是平安夜。");
  } else {
    pushLog(
      game,
      `天亮了，昨夜死亡：${deaths.map((d) => `${d.id}号`).join("、")}`,
    );
  }

  // 猎人被刀（非毒）可开枪
  game.pendingHunterShot = null;
  for (const d of deaths) {
    const p = game.players.find((x) => x.id === d.id);
    if (p?.role === ROLES.HUNTER && !p.poisonedMute) {
      game.pendingHunterShot = p.id;
      break;
    }
  }

  if (applyWinner(game, checkWinner(game))) {
    return { events, deaths, hunterShot: null };
  }

  // 猎人夜间死亡开枪
  let hunterShot = null;
  if (game.pendingHunterShot != null) {
    hunterShot = resolveHunterShot(game, game.pendingHunterShot);
    game.pendingHunterShot = null;
    if (applyWinner(game, checkWinner(game))) {
      return { events, deaths, hunterShot };
    }
  }

  // 进入白天发言
  game.day += 1;
  game.phase = PHASE.DAY_SPEECH;
  const speakers = alivePlayers(game)
    .filter((p) => p.alive)
    .map((p) => p.id);
  // 随机发言顺序
  game.speechQueue = shuffle(speakers);
  game.speechIndex = 0;
  game.speeches = game.speeches; // keep history
  pushLog(game, `第 ${game.day} 天白天，开始发言。`);

  return { events, deaths, hunterShot };
}

/** 猎人开枪：依发言点名；无把握则可能不开枪 */
function resolveHunterShot(game, hunterId) {
  const hunter = game.players.find((p) => p.id === hunterId);
  if (!hunter || hunter.poisonedMute) {
    pushLog(game, `${hunterId} 号猎人被毒哑，无法开枪。`);
    return null;
  }
  const candidates = alivePlayers(game).filter((p) => p.id !== hunterId);
  if (!candidates.length) {
    pushLog(game, `${hunterId} 号猎人没有可开枪目标。`);
    return { hunterId, targetId: null, skipped: true };
  }

  const scores = mentionScores(game, hunterId);
  const ranked = [...candidates].sort(
    (a, b) => (scores[b.id] || 0) - (scores[a.id] || 0),
  );
  const best = ranked[0];
  const hasLock = best && (scores[best.id] || 0) >= 2;

  if (!hasLock && Math.random() < 0.45) {
    pushLog(game, `${hunterId} 号猎人选择不开枪。`);
    return { hunterId, targetId: null, skipped: true };
  }

  const target = hasLock ? best : pickRandom(candidates);
  target.alive = false;
  pushLog(
    game,
    `${hunterId} 号猎人开枪带走了 ${target.id} 号（${ROLE_CN[target.role]}）。`,
  );
  return {
    hunterId,
    targetId: target.id,
    targetRole: target.role,
    skipped: false,
  };
}

export function currentSpeakerId(game) {
  if (game.phase !== PHASE.DAY_SPEECH) return null;
  if (game.speechIndex >= game.speechQueue.length) return null;
  return game.speechQueue[game.speechIndex];
}

export function recordSpeech(game, playerId, text) {
  if (game.phase !== PHASE.DAY_SPEECH) {
    throw new Error("当前不是发言阶段");
  }
  const expected = currentSpeakerId(game);
  if (expected !== playerId) {
    throw new Error(`当前应发言的是 ${expected} 号，不是 ${playerId} 号`);
  }
  const player = game.players.find((p) => p.id === playerId);
  const speech = {
    day: game.day,
    playerId,
    name: player.name,
    roleCn: ROLE_CN[player.role],
    text,
    at: Date.now(),
  };
  game.speeches.push(speech);
  pushLog(game, `${playerId} 号：${text}`);
  game.speechIndex += 1;

  if (game.speechIndex >= game.speechQueue.length) {
    game.phase = PHASE.DAY_VOTE;
    game.votes = {};
    pushLog(game, "发言结束，进入投票。");
  }
  return speech;
}

/** AI 投票：简单站边 */
export function resolveVote(game) {
  if (game.phase !== PHASE.DAY_VOTE) {
    throw new Error("当前不是投票阶段");
  }

  const voters = alivePlayers(game).filter((p) => p.canVote);
  const candidates = alivePlayers(game);
  const tally = Object.fromEntries(candidates.map((c) => [c.id, 0]));
  const ballot = {};

  const wolfIds = new Set(
    game.players.filter((p) => p.role === ROLES.WEREWOLF).map((p) => p.id),
  );

  for (const voter of voters) {
    let target;
    if (voter.role === ROLES.WEREWOLF) {
      // 狼人互认，刀好人；优先已翻牌白痴或发言被点名者（简化：非狼队友）
      const goods = candidates.filter(
        (p) => !wolfIds.has(p.id) && p.id !== voter.id,
      );
      const revealed = goods.filter((p) => p.revealed);
      target = pickRandom(revealed.length ? revealed : goods);
    } else if (voter.role === ROLES.SEER) {
      // 只根据查验结果投票，不开天眼
      const lastEvil = [...game.seerChecks]
        .reverse()
        .find((c) => c.camp === CAMP.EVIL);
      if (lastEvil) {
        target = candidates.find(
          (p) => p.id === lastEvil.targetId && p.alive,
        );
      }
      if (!target) {
        const checkedGood = new Set(
          game.seerChecks
            .filter((c) => c.camp === CAMP.GOOD)
            .map((c) => c.targetId),
        );
        target = pickRandom(
          candidates.filter(
            (p) => p.id !== voter.id && !checkedGood.has(p.id),
          ),
        );
      }
    } else {
      // 好人：结合今日发言里被点名较多的号（简化启发）
      const mentioned = mentionScores(game, voter.id);
      const ranked = candidates
        .filter((p) => p.id !== voter.id)
        .sort((a, b) => (mentioned[b.id] || 0) - (mentioned[a.id] || 0));
      if (ranked.length && (mentioned[ranked[0].id] || 0) > 0 && Math.random() < 0.7) {
        target = ranked[0];
      } else {
        target = pickRandom(candidates.filter((p) => p.id !== voter.id));
      }
    }
    if (target) {
      ballot[voter.id] = target.id;
      tally[target.id] = (tally[target.id] || 0) + 1;
    }
  }

  game.votes = ballot;

  let max = 0;
  let top = [];
  for (const [id, n] of Object.entries(tally)) {
    if (n > max) {
      max = n;
      top = [Number(id)];
    } else if (n === max && n > 0) {
      top.push(Number(id));
    }
  }

  let exiledId = null;
  if (top.length === 1) {
    exiledId = top[0];
  } else if (top.length > 1) {
    // 平票：本轮无人出局
    pushLog(game, `平票（${top.join("、")}号），本轮无人出局。`);
    game.lastExile = null;
    advanceToNight(game);
    return { ballot, tally, exiled: null, idiotFlip: false, hunterShot: null };
  } else {
    pushLog(game, "无人投票，本轮无人出局。");
    game.lastExile = null;
    advanceToNight(game);
    return { ballot, tally, exiled: null, idiotFlip: false, hunterShot: null };
  }

  const exiled = game.players.find((p) => p.id === exiledId);
  let idiotFlip = false;
  let hunterShot = null;

  if (exiled.role === ROLES.IDIOT && !exiled.revealed) {
    // 白痴被投票翻牌免死，失去投票权
    exiled.revealed = true;
    exiled.canVote = false;
    idiotFlip = true;
    game.lastExile = {
      id: exiled.id,
      flipped: true,
      role: exiled.role,
      roleCn: ROLE_CN[exiled.role],
    };
    pushLog(
      game,
      `${exiled.id} 号被投票，亮出白痴身份翻牌免死，此后失去投票权。`,
    );
  } else {
    exiled.alive = false;
    game.lastExile = {
      id: exiled.id,
      flipped: false,
      role: exiled.role,
      roleCn: ROLE_CN[exiled.role],
    };
    pushLog(
      game,
      `${exiled.id} 号被放逐，身份是【${ROLE_CN[exiled.role]}】。`,
    );

    if (exiled.role === ROLES.HUNTER && !exiled.poisonedMute) {
      hunterShot = resolveHunterShot(game, exiled.id);
    }
  }

  if (applyWinner(game, checkWinner(game))) {
    return { ballot, tally, exiled: game.lastExile, idiotFlip, hunterShot };
  }

  advanceToNight(game);
  return { ballot, tally, exiled: game.lastExile, idiotFlip, hunterShot };
}

function advanceToNight(game) {
  if (game.phase === PHASE.ENDED) return;
  game.night += 1;
  game.phase = PHASE.NIGHT;
  pushLog(game, `夜幕降临，进入第 ${game.night} 夜……`);
}

/** 从今日发言中粗略统计被点名的座位号 */
function mentionScores(game, excludeId) {
  const scores = {};
  const daySpeeches = game.speeches.filter((s) => s.day === game.day);
  for (const s of daySpeeches) {
    const matches = s.text.match(/(\d{1,2})\s*号/g) || [];
    for (const m of matches) {
      const id = Number(m.replace(/\D/g, ""));
      if (id >= 1 && id <= 12 && id !== excludeId) {
        scores[id] = (scores[id] || 0) + 1;
      }
    }
  }
  return scores;
}

/** 构建某玩家发言用的私有上下文 */
export function buildSpeechContext(game, playerId) {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在");

  const alive = alivePlayers(game).map((p) => ({
    id: p.id,
    name: p.name,
    revealed: p.revealed,
    revealedRole: p.revealed ? ROLE_CN[p.role] : null,
  }));

  const recentSpeeches = game.speeches
    .filter((s) => s.day === game.day)
    .map((s) => `${s.playerId}号：${s.text}`);

  const ctx = {
    day: game.day,
    night: game.night,
    self: {
      id: player.id,
      role: player.role,
      roleCn: ROLE_CN[player.role],
      camp: player.camp,
      revealed: player.revealed,
    },
    alive,
    lastNightDeaths: game.lastNightDeaths.map((d) => d.id),
    recentSpeeches,
    strategyHint: strategyHint(player, game),
  };

  if (player.role === ROLES.WEREWOLF) {
    ctx.wolfTeammates = game.players
      .filter((p) => p.role === ROLES.WEREWOLF && p.id !== player.id)
      .map((p) => ({ id: p.id, alive: p.alive }));
  }
  if (player.role === ROLES.SEER) {
    ctx.seerChecks = game.seerChecks.map((c) => ({
      night: c.night,
      targetId: c.targetId,
      result: c.camp === CAMP.EVIL ? "狼人" : "好人",
    }));
  }
  if (player.role === ROLES.WITCH) {
    ctx.witchPotions = { ...game.witch };
  }

  return ctx;
}

function strategyHint(player, game) {
  const day = game.day;
  switch (player.role) {
    case ROLES.SEER:
      return day === 1
        ? "首日应积极上警/强势报验人，给出金水或查杀，并留警徽流（今晚验谁）。"
        : "继续输出查验信息，为好人排坑，寻找狼人破绽。";
    case ROLES.WITCH:
      return "隐藏身份；若救过人可考虑报银水。毒药留给铁狼，不要乱跳神职。";
    case ROLES.HUNTER:
      return "可半跳穿猎人衣服威胁狼人；发言要有逻辑，不怕死但怕毒哑。";
    case ROLES.IDIOT:
      return player.revealed
        ? "已翻牌，专注强力逻辑输出。"
        : "平民打法潜藏，票型可略奇葩吸引火力。";
    case ROLES.WEREWOLF:
      return day === 1
        ? "可悍跳预言家报假查杀/金水，或倒钩卖队友；禁止自爆；不要贴脸发誓。"
        : "配合屠边：明神优先、注意银水；发言带节奏带票。";
    default:
      return "站边逻辑，投出像狼的玩家；可用票权，拒绝划水。";
  }
}
