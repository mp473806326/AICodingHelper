/**
 * 狼人杀·可配置人数局
 * 6人预女 / 9人预女猎 / 12人预女猎白
 * 流程：首夜 → 警长竞选 → 白天发言放逐 → 循环夜/昼
 */

import { randomUUID } from "crypto";
import {
  WIN_CONDITION,
  analyzeSeerClaims,
  buildOwnSpeechMemory,
  buildIronFacts,
  compressSpeechLines,
  inferStanceHint,
  pushPublicHistory,
} from "./logicRules.js";

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

/** 各人数板子配置 */
export const BOARD_CONFIGS = {
  6: {
    playerCount: 6,
    board: "预女",
    boardDesc: "2狼 / 2民 / 预言家 / 女巫",
    roles: [
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.VILLAGER,
      ROLES.VILLAGER,
      ROLES.SEER,
      ROLES.WITCH,
    ],
  },
  9: {
    playerCount: 9,
    board: "预女猎",
    boardDesc: "3狼 / 3民 / 预言家 / 女巫 / 猎人",
    roles: [
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.VILLAGER,
      ROLES.VILLAGER,
      ROLES.VILLAGER,
      ROLES.SEER,
      ROLES.WITCH,
      ROLES.HUNTER,
    ],
  },
  12: {
    playerCount: 12,
    board: "预女猎白",
    boardDesc: "4狼 / 4民 / 预言家 / 女巫 / 猎人 / 白痴",
    roles: [
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
    ],
  },
};

/** @deprecated 使用 BOARD_CONFIGS[12]；保留兼容 */
export const PLAYER_COUNT = 12;
export const ROLE_POOL = BOARD_CONFIGS[12].roles;

export const PHASE = {
  LOBBY: "lobby",
  NIGHT: "night",
  DAWN: "dawn",
  LAST_WORDS: "last_words",
  SHERIFF_SPEECH: "sheriff_speech",
  SHERIFF_VOTE: "sheriff_vote",
  SHERIFF_PK: "sheriff_pk",
  DAY_SPEECH: "day_speech",
  DAY_VOTE: "day_vote",
  ENDED: "ended",
};

const SPEECH_PHASES = new Set([
  PHASE.LAST_WORDS,
  PHASE.SHERIFF_SPEECH,
  PHASE.SHERIFF_PK,
  PHASE.DAY_SPEECH,
]);

/** 遗言结束后的去向 */
const AFTER_LAST_WORDS = {
  SHERIFF: "sheriff",
  DAY: "day",
  POST_EXILE: "post_exile",
};

const GOD_ROLES = new Set([ROLES.SEER, ROLES.WITCH, ROLES.HUNTER, ROLES.IDIOT]);

const SPEECH_ORDER_CN = {
  sheriff_left: "从警左开始顺时针",
  sheriff_right: "从警右开始逆时针",
  death_left: "从死者左开始顺时针",
  death_right: "从死者右开始逆时针",
};

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

/**
 * 夜间私密行动：写入 privateNightLogs。
 * 前端战报会合并展示；发言 AI 上下文只用 history / ironFacts，不读这些。
 */
function pushNightPrivateLog(game, msg) {
  if (!game.privateNightLogs) game.privateNightLogs = [];
  game.privateNightLogs.unshift({ t: Date.now(), msg });
  if (game.privateNightLogs.length > 100) game.privateNightLogs.length = 100;
}

/** 夜间私密文案（刀口/查验/用药）——不得进入发言用 history，但可进战报展示 */
const PRIVATE_NIGHT_LOG_RE =
  /狼人商议|狼人空刀|狼人刀了|预言家查验|女巫使用解药|女巫毒了|女巫今晚未用药|狼队密谈|夜间刀口/;

/** 流程战报（不含夜间刀验毒）；若误写入私密文案则清掉，避免污染 history 同源数据 */
function flowLogsOnly(game) {
  const logs = game.logs || [];
  const cleaned = logs.filter((item) => !PRIVATE_NIGHT_LOG_RE.test(item.msg));
  if (cleaned.length !== logs.length) {
    game.logs = cleaned;
  }
  return cleaned;
}

/** API 战报：流程日志 + 夜间刀验毒，按时间新→旧，供观战 UI 展示 */
function displayLogs(game) {
  const merged = [
    ...flowLogsOnly(game),
    ...(game.privateNightLogs || []),
  ];
  return merged.sort((a, b) => (b.t ?? 0) - (a.t ?? 0));
}

/**
 * 狼队夜间商议战术（规则生成，不额外调模型）
 * 结果只注入狼人发言上下文，白天负责搅混水。
 */
function planWolfNightTactics(game, killTargetId) {
  const wolves = alivePlayers(game).filter((p) => p.role === ROLES.WEREWOLF);
  const wolfIds = wolves.map((p) => p.id);
  const jumper = pickRandom(wolves);
  const seerAnalysis = analyzeSeerClaims(game);
  const killTxt =
    killTargetId != null ? `夜间刀口约定 ${killTargetId}号` : "夜间选择空刀/观察";

  let dayTactic;
  if (!game.sheriffDone) {
    dayTactic = `${killTxt}。${jumper ? `${jumper.id}号悍跳预言家抢警徽` : "择一狼悍跳"}；其余狼倒钩装好人、勿同时冲锋暴露抱团。白天用软逻辑搅混水，把火力引向真预或真预金水。`;
  } else if (seerAnalysis.claimants.length >= 2) {
    dayTactic = `${killTxt}。对跳局：冲锋咬你认为的真预言家，带节奏出真预；队友装好人倒钩，发言多谈语气少留硬破绽。暗保狼队友${wolfIds.map((id) => `${id}号`).join("、")}。`;
  } else if (seerAnalysis.claimants.length === 1) {
    const claimId = seerAnalysis.claimants[0].playerId;
    dayTactic = `${killTxt}。场上单边跳预${claimId}号：白天质疑其动机/警徽流，搅混水冲非狼位；勿同时给队友投票暴露。装好人逻辑，禁止自爆。`;
  } else {
    dayTactic = `${killTxt}。白天搅混水：制造多个狼坑、跟票冲锋或倒钩卖已暴露队友；用「好人逻辑」包装，暗保${wolfIds.map((id) => `${id}号`).join("、")}。禁止自爆。`;
  }

  game.wolfNightPlan = {
    night: game.night,
    killTargetId,
    jumperId: jumper?.id ?? null,
    teammates: wolfIds,
    dayTactic,
  };
  // 战术只写入 wolfNightPlan 供狼人 AI 使用，不进公开 history / 发言请求
}

/** 票型明细：按得票人分组「X号(N票)←A号、B号」 */
function formatVoteDetails(ballot, tally) {
  const groups = new Map();
  for (const [voterStr, targetId] of Object.entries(ballot)) {
    const list = groups.get(targetId) ?? [];
    list.push(Number(voterStr));
    groups.set(targetId, list);
  }
  return [...groups.entries()]
    .sort(
      (a, b) =>
        (tally[b[0]] ?? b[1].length) - (tally[a[0]] ?? a[1].length) ||
        a[0] - b[0],
    )
    .map(([targetId, voters]) => {
      const count = tally[targetId] ?? voters.length;
      const names = voters
        .sort((a, b) => a - b)
        .map((id) => `${id}号`)
        .join("、");
      return `${targetId}号(${count}票)←${names}`;
    })
    .join("；");
}

function alivePlayers(game) {
  return game.players.filter((p) => p.alive);
}

function findByRole(game, role) {
  return game.players.find((p) => p.role === role);
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

/**
 * 解析座位模型配置
 * @param {number} playerCount
 * @param {{ modelId?: string, playerModels?: string[] | Record<string, string> }} options
 * @returns {string[]}
 */
function resolvePlayerModels(playerCount, options = {}) {
  const fallback =
    typeof options.modelId === "string" && options.modelId.trim()
      ? options.modelId.trim()
      : "doubao";
  const raw = options.playerModels;
  const list = Array.from({ length: playerCount }, (_, i) => {
    let id = null;
    if (Array.isArray(raw)) {
      id = raw[i];
    } else if (raw && typeof raw === "object") {
      id = raw[String(i + 1)] ?? raw[i + 1] ?? raw[i];
    }
    return typeof id === "string" && id.trim() ? id.trim() : fallback;
  });
  return list;
}

/**
 * 创建新局
 * @param {{ playerCount?: number, modelId?: string, playerModels?: string[] | Record<string, string> }} [options]
 */
export function createGame(options = {}) {
  const playerCount = Number(options.playerCount) || 12;
  const config = BOARD_CONFIGS[playerCount];
  if (!config) {
    throw new Error(`不支持的人数：${playerCount}，可选 6 / 9 / 12`);
  }
  const playerModels = resolvePlayerModels(config.playerCount, options);
  /** 兼容旧字段：多数座位相同时展示该模型，否则标记为 mixed */
  const uniqueModels = [...new Set(playerModels)];
  const modelId = uniqueModels.length === 1 ? uniqueModels[0] : "mixed";

  const roles = shuffle(config.roles);
  const players = roles.map((role, i) => ({
    id: i + 1,
    name: `${i + 1}号`,
    role,
    camp: campOf(role),
    alive: true,
    revealed: false,
    canVote: true,
    poisonedMute: false,
    modelId: playerModels[i],
  }));

  const game = {
    id: randomUUID(),
    board: config.board,
    boardDesc: config.boardDesc,
    playerCount: config.playerCount,
    modelId,
    phase: PHASE.NIGHT,
    day: 0,
    night: 1,
    players,
    witch: {
      antidote: 1,
      poison: 1,
      firstNightSelfSave: true,
    },
    seerChecks: [],
    speeches: [],
    speechQueue: [],
    speechIndex: 0,
    speechKind: null, // day | sheriff | sheriff_pk | last_words
    speechOrderMode: null,
    /** 遗言结束后：sheriff | day | post_exile */
    afterLastWords: null,
    /** 遗言原因：night_death | exile */
    lastWordsReason: null,
    votes: {},
    voteTally: {},
    lastNightDeaths: [],
    lastExile: null,
    pendingHunterShot: null,
    // 警长竞选
    sheriffId: null,
    sheriffDone: false,
    sheriffRunners: [], // 上警并发言过的
    sheriffBallot: [], // 退水后仍在竞选
    sheriffWithdrawn: [],
    sheriffPkCandidates: null,
    sheriffElectResult: null,
    winner: null,
    winnerReason: null,
    /** 公开铁事实时间线（供 AI 发言引用） */
    history: [],
    /** 狼队夜间商议的今日战术（仅狼人 AI 可见） */
    wolfNightPlan: null,
    /** 流程战报（死讯/票型/阶段）；发言 AI 不直接读 logs */
    logs: [],
    /** 夜间刀/毒/验：合并进 API 战报展示，不进发言 AI 的 history */
    privateNightLogs: [],
    createdAt: Date.now(),
  };

  const modelSummary = players
    .map((p) => `${p.id}号=${p.modelId}`)
    .join("，");
  pushLog(
    game,
    `发牌完成（${config.playerCount}人·${config.board}）：${config.boardDesc}。各座位发言模型：${modelSummary}。进入第 1 夜。`,
  );
  games.set(game.id, game);
  return game;
}

export function getGame(id) {
  return games.get(id) ?? null;
}

export function deleteGame(id) {
  return games.delete(id);
}

/**
 * 对外可见状态（观战）：战报含夜间刀验毒；
 * 发言模型另走 buildSpeechContext，不会把这些塞进请求。
 */
export function toPublicState(game) {
  const playerCount = game.playerCount ?? game.players.length;
  return {
    id: game.id,
    board: game.board,
    boardDesc: game.boardDesc ?? null,
    playerCount,
    modelId: game.modelId ?? "doubao",
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
      isSheriff: game.sheriffId === p.id,
      modelId: p.modelId ?? game.modelId ?? "doubao",
    })),
    witch: { ...game.witch },
    // 查验明细仅服务端持有；战报文案里已有「预言家查验了…」，发言请求不读此字段
    seerChecks: [],
    speeches: game.speeches,
    speechQueue: game.speechQueue,
    speechIndex: game.speechIndex,
    speechKind: game.speechKind,
    speechOrderMode: game.speechOrderMode,
    speechOrderCn: game.speechOrderMode
      ? SPEECH_ORDER_CN[game.speechOrderMode]
      : null,
    afterLastWords: game.afterLastWords,
    lastWordsReason: game.lastWordsReason,
    votes: game.votes,
    voteTally: game.voteTally,
    // 公开只报谁死了，不带刀/毒归因与身份细节
    lastNightDeaths: (game.lastNightDeaths || []).map((d) => ({
      id: d.id,
      name: d.name,
    })),
    lastExile: game.lastExile,
    pendingHunterShot: game.pendingHunterShot,
    sheriffId: game.sheriffId,
    sheriffDone: game.sheriffDone,
    sheriffRunners: game.sheriffRunners,
    sheriffBallot: game.sheriffBallot,
    sheriffWithdrawn: game.sheriffWithdrawn,
    sheriffPkCandidates: game.sheriffPkCandidates,
    sheriffElectResult: game.sheriffElectResult,
    winner: game.winner,
    winnerReason: game.winnerReason,
    logs: displayLogs(game),
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
  // 优先刀明神（已跳预言家等）：用发言里自称预言家的启发较复杂，简化为已翻牌
  const revealed = targets.filter((p) => p.revealed);
  if (revealed.length) return pickRandom(revealed);
  // 若有警长且是好人，夜间可优先刀警长
  if (game.sheriffId) {
    const sheriff = targets.find((p) => p.id === game.sheriffId);
    if (sheriff && Math.random() < 0.45) return sheriff;
  }
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
      const rate = isSelf ? 0.9 : game.night === 1 ? 0.8 : 0.55;
      save = Math.random() < rate;
    }
  }

  let poisonTargetId = null;
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
  candidates.sort((a, b) => a.id - b.id);
  return candidates[0].id;
}

function clearSheriffBadgeIfDead(game) {
  if (game.sheriffId == null) return;
  const sheriff = game.players.find((p) => p.id === game.sheriffId);
  if (sheriff && !sheriff.alive) {
    pushLog(game, `${game.sheriffId} 号警长出局，警徽破碎。`);
    game.sheriffId = null;
  }
}

/**
 * 结算一整夜：狼刀 → 女巫 → 预言家
 * 首日天亮后进入警长竞选；之后进入白天发言
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
  // 先定刀口并形成狼队白天战术（仅狼人 AI 使用）
  planWolfNightTactics(game, wolfTargetId);
  events.push({
    type: "wolf_kill",
    targetId: wolfTargetId,
    private: true,
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
      private: true,
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
      private: true,
      msg: `女巫毒了 ${poisonedId} 号`,
    });
  } else {
    events.push({
      type: "witch_pass",
      private: true,
      msg: "女巫今晚未用药",
    });
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
      private: true,
      msg: `预言家查验了 ${seerTargetId} 号 → ${
        camp === CAMP.EVIL ? "狼人" : "好人"
      }`,
    });
  }

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

  // 夜间刀验毒：写 privateNightLogs → API 战报合并展示；不进 history（发言请求不用）
  for (const e of events) pushNightPrivateLog(game, e.msg);
  if (deaths.length === 0) {
    pushLog(game, "天亮了，昨晚是平安夜。");
    pushPublicHistory(game, `第${game.night}夜→天亮：平安夜。`);
  } else {
    pushLog(
      game,
      `天亮了，昨晚死亡：${deaths.map((d) => `${d.id}号`).join("、")}`,
    );
    // 公开只报死讯，不标注刀/毒，避免好人 AI 拿到夜间私密
    pushPublicHistory(
      game,
      `第${game.night}夜→天亮死亡：${deaths.map((d) => `${d.id}号`).join("、")}。`,
    );
  }

  clearSheriffBadgeIfDead(game);

  // 猎人开枪延后到遗言之后（若有遗言）
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

  game.day += 1;

  const nextAfter = !game.sheriffDone
    ? AFTER_LAST_WORDS.SHERIFF
    : AFTER_LAST_WORDS.DAY;

  // 夜间死亡（刀/毒）→ 先发表遗言，再进入警长竞选或白天发言
  if (deaths.length > 0) {
    startLastWords(
      game,
      deaths.map((d) => d.id),
      nextAfter,
      "night_death",
    );
    return { events, deaths, hunterShot: null };
  }

  // 平安夜：若有猎人开枪（理论上夜间死亡才会触发），仍先处理
  const hunterShot = resolvePendingHunterShot(game);
  if (game.phase === PHASE.ENDED) {
    return { events, deaths, hunterShot };
  }

  if (!game.sheriffDone) {
    startSheriffElection(game);
  } else {
    startDaySpeech(game);
  }

  return { events, deaths, hunterShot };
}

/**
 * 开始遗言阶段（死者按座位号顺序发言）
 * @param {'sheriff'|'day'|'post_exile'} after
 * @param {'night_death'|'exile'} reason
 */
function startLastWords(game, playerIds, after, reason) {
  const queue = [...new Set(playerIds)]
    .filter((id) => {
      const p = game.players.find((x) => x.id === id);
      return p && !p.alive;
    })
    .sort((a, b) => a - b);

  if (!queue.length) {
    game.afterLastWords = after;
    game.lastWordsReason = reason;
    finishLastWords(game);
    return;
  }

  game.speechQueue = queue;
  game.speechIndex = 0;
  game.speechKind = "last_words";
  game.phase = PHASE.LAST_WORDS;
  game.afterLastWords = after;
  game.lastWordsReason = reason;
  game.votes = {};
  game.voteTally = {};

  const reasonCn =
    reason === "exile" ? "被放逐" : "昨夜出局";
  pushLog(
    game,
    `请${queue.map((id) => `${id}号`).join("、")}玩家发表遗言（${reasonCn}）。`,
  );
}

function resolvePendingHunterShot(game) {
  if (game.pendingHunterShot == null) return null;
  const hunterId = game.pendingHunterShot;
  game.pendingHunterShot = null;
  const hunterShot = resolveHunterShot(game, hunterId);
  clearSheriffBadgeIfDead(game);
  applyWinner(game, checkWinner(game));
  return hunterShot;
}

/** 遗言结束：猎人开枪（若有）→ 胜负判定 → 进入下一阶段 */
function finishLastWords(game) {
  const after = game.afterLastWords;
  game.afterLastWords = null;
  game.lastWordsReason = null;
  game.speechKind = null;
  game.speechQueue = [];
  game.speechIndex = 0;

  // 遗言后处理猎人开枪，再判定胜负
  resolvePendingHunterShot(game);
  if (game.phase === PHASE.ENDED) return;
  if (applyWinner(game, checkWinner(game))) return;

  if (after === AFTER_LAST_WORDS.POST_EXILE) {
    advanceToNight(game);
    return;
  }

  if (after === AFTER_LAST_WORDS.SHERIFF) {
    startSheriffElection(game);
    return;
  }

  startDaySpeech(game);
}

/**
 * 上警名单：建议 3~5 人；预言家必须上警；至少一名狼人悍跳上警
 */
function selectSheriffCandidates(game) {
  const alive = alivePlayers(game);
  const seer = alive.find((p) => p.role === ROLES.SEER);
  const wolves = alive.filter((p) => p.role === ROLES.WEREWOLF);
  const others = alive.filter(
    (p) => p.role !== ROLES.SEER && p.role !== ROLES.WEREWOLF,
  );

  const set = new Set();
  if (seer) set.add(seer.id);

  const wolfJumper = pickRandom(wolves);
  if (wolfJumper) set.add(wolfJumper.id);

  const target = Math.min(
    alive.length,
    Math.max(3, 3 + Math.floor(Math.random() * 3)),
  ); // 3~5

  const pool = shuffle([
    ...others,
    ...wolves.filter((w) => w.id !== wolfJumper?.id),
  ]);
  for (const p of pool) {
    if (set.size >= target) break;
    set.add(p.id);
  }

  // 人数过少时尽量凑到 2 人以上
  if (set.size < 2) {
    for (const p of alive) {
      set.add(p.id);
      if (set.size >= 2) break;
    }
  }

  return shuffle([...set]);
}

function startSheriffElection(game) {
  const runners = selectSheriffCandidates(game);
  game.sheriffRunners = runners;
  game.sheriffBallot = [...runners];
  game.sheriffWithdrawn = [];
  game.sheriffPkCandidates = null;
  game.sheriffElectResult = null;
  game.speechQueue = [...runners];
  game.speechIndex = 0;
  game.speechKind = "sheriff";
  game.phase = PHASE.SHERIFF_SPEECH;
  game.votes = {};
  game.voteTally = {};

  pushLog(
    game,
    `现在开始警长竞选，想要竞选警长的玩家请举手。上警玩家：${runners
      .map((id) => `${id}号`)
      .join("、")}。`,
  );
  pushLog(game, "上警玩家按随机顺序依次发言。");
}

/** 发言结束后处理退水，进入警长投票 */
function finishSheriffSpeeches(game) {
  const withdrawn = [];
  for (const id of game.sheriffRunners) {
    const p = game.players.find((x) => x.id === id);
    if (!p || !p.alive) {
      withdrawn.push(id);
      continue;
    }
    // 真预言家不上退水
    if (p.role === ROLES.SEER) continue;
    // 悍跳狼较少退水
    if (p.role === ROLES.WEREWOLF) {
      if (Math.random() < 0.12) withdrawn.push(id);
      continue;
    }
    // 其他角色可诈身份后退水
    if (Math.random() < 0.38) withdrawn.push(id);
  }

  let ballot = game.sheriffRunners.filter((id) => !withdrawn.includes(id));
  // 至少保留 2 人竞选，否则投票无意义
  if (ballot.length < 2) {
    const restore = withdrawn.filter((id) => {
      const p = game.players.find((x) => x.id === id);
      return p?.alive;
    });
    while (ballot.length < 2 && restore.length) {
      const id = restore.pop();
      const idx = withdrawn.indexOf(id);
      if (idx >= 0) withdrawn.splice(idx, 1);
      ballot.push(id);
    }
  }
  // 若只剩 1 人（全场仅一人上警），直接当选
  if (ballot.length === 1) {
    game.sheriffWithdrawn = withdrawn;
    game.sheriffBallot = ballot;
    if (withdrawn.length) {
      pushLog(
        game,
        `退水玩家：${withdrawn.map((id) => `${id}号`).join("、")}。`,
      );
    }
    electSheriff(game, ballot[0], { [ballot[0]]: 0 }, {});
    return;
  }

  game.sheriffWithdrawn = withdrawn;
  game.sheriffBallot = ballot;
  game.phase = PHASE.SHERIFF_VOTE;
  game.votes = {};
  game.voteTally = {};

  if (withdrawn.length) {
    pushLog(
      game,
      `现在开始退水。退水玩家：${withdrawn.map((id) => `${id}号`).join("、")}。`,
    );
  } else {
    pushLog(game, "无人退水。");
  }
  pushLog(
    game,
    `不上警的玩家请投票。候选人：${ballot.map((id) => `${id}号`).join("、")}。`,
  );
}

function startSheriffPk(game, tiedIds) {
  game.sheriffPkCandidates = tiedIds;
  game.sheriffBallot = [...tiedIds];
  game.speechQueue = shuffle([...tiedIds]);
  game.speechIndex = 0;
  game.speechKind = "sheriff_pk";
  game.phase = PHASE.SHERIFF_PK;
  game.votes = {};
  game.voteTally = {};
  pushLog(
    game,
    `警长竞选平票：${tiedIds.map((id) => `${id}号`).join("、")}，进入 PK 发言。`,
  );
}

function finishSheriffPk(game) {
  game.phase = PHASE.SHERIFF_VOTE;
  game.votes = {};
  game.voteTally = {};
  pushLog(
    game,
    `PK 发言结束，请再次投票。候选人：${game.sheriffBallot
      .map((id) => `${id}号`)
      .join("、")}。`,
  );
}

function electSheriff(game, sheriffId, tally, ballot) {
  game.sheriffId = sheriffId;
  game.sheriffDone = true;
  game.sheriffElectResult = {
    sheriffId,
    tally,
    ballot,
    pk: game.sheriffPkCandidates,
  };
  game.sheriffPkCandidates = null;
  pushLog(game, `投票结束，${sheriffId} 号当选警长（归票权 1.5 票）。`);
  const detail = formatVoteDetails(ballot, tally);
  pushPublicHistory(
    game,
    `警长选举：${sheriffId}号当选。票型：${detail || "无明细"}。`,
  );
  startDaySpeech(game);
}

/**
 * 未上警玩家投票选警长；平票则 PK
 */
export function resolveSheriffVote(game) {
  if (game.phase !== PHASE.SHERIFF_VOTE) {
    throw new Error("当前不是警长投票阶段");
  }

  const ballotIds = new Set(game.sheriffBallot);
  const candidates = alivePlayers(game).filter((p) => ballotIds.has(p.id));
  // 不上警（含退水）的存活玩家投票
  const voters = alivePlayers(game).filter(
    (p) => p.canVote && !ballotIds.has(p.id),
  );

  const tally = Object.fromEntries(candidates.map((c) => [c.id, 0]));
  const ballot = {};

  const wolfIds = new Set(
    game.players.filter((p) => p.role === ROLES.WEREWOLF).map((p) => p.id),
  );

  for (const voter of voters) {
    let target = null;
    if (voter.role === ROLES.WEREWOLF) {
      // 狼人优先投给悍跳队友，否则搅混水
      const wolfOnBallot = candidates.filter((p) => wolfIds.has(p.id));
      const preferJumper =
        game.wolfNightPlan?.jumperId != null
          ? candidates.find((p) => p.id === game.wolfNightPlan.jumperId)
          : null;
      target =
        preferJumper ||
        pickRandom(wolfOnBallot.length ? wolfOnBallot : candidates);
    } else {
      // 好人（含预言家未上警）：只根据上警发言点名判断，不知真实狼坑
      const mentioned = mentionScores(game, voter.id, "sheriff");
      const ranked = [...candidates].sort(
        (a, b) => (mentioned[b.id] || 0) - (mentioned[a.id] || 0),
      );
      if (ranked.length && (mentioned[ranked[0].id] || 0) > 0 && Math.random() < 0.7) {
        target = ranked[0];
      } else {
        target = pickRandom(candidates);
      }
    }
    if (target) {
      ballot[voter.id] = target.id;
      tally[target.id] = (tally[target.id] || 0) + 1;
    }
  }

  game.votes = ballot;
  game.voteTally = tally;

  const tallyText = Object.entries(tally)
    .map(([id, n]) => `${id}号 ${n}票`)
    .join("，");
  const detailText = formatVoteDetails(ballot, tally);
  pushLog(
    game,
    `警长选票：${tallyText || "无人得票"}。${detailText ? `明细：${detailText}` : ""}`,
  );

  let max = -1;
  let top = [];
  for (const [id, n] of Object.entries(tally)) {
    if (n > max) {
      max = n;
      top = [Number(id)];
    } else if (n === max) {
      top.push(Number(id));
    }
  }

  if (top.length === 0) {
    // 无人投票：随机指定候选人
    const fallback = pickRandom(candidates);
    if (fallback) {
      electSheriff(game, fallback.id, tally, ballot);
      return { ballot, tally, sheriffId: fallback.id, pk: false };
    }
    game.sheriffDone = true;
    pushLog(game, "无人当选警长，本局无警长。");
    startDaySpeech(game);
    return { ballot, tally, sheriffId: null, pk: false };
  }

  if (top.length === 1) {
    electSheriff(game, top[0], tally, ballot);
    return { ballot, tally, sheriffId: top[0], pk: false };
  }

  // 已 PK 过仍平票：随机决出
  if (game.sheriffPkCandidates) {
    const winner = pickRandom(top.map((id) => candidates.find((c) => c.id === id)).filter(Boolean));
    pushLog(game, `PK 后再平票，随机决出警长。`);
    electSheriff(game, winner.id, tally, ballot);
    return { ballot, tally, sheriffId: winner.id, pk: false };
  }

  startSheriffPk(game, top);
  return { ballot, tally, sheriffId: null, pk: true, pkCandidates: top };
}

function seatCount(game) {
  return game.playerCount ?? game.players.length;
}

/** 按座位环找下一个存活玩家 */
function nextAliveFrom(game, fromId, direction) {
  const n = seatCount(game);
  let id = fromId;
  for (let i = 0; i < n; i++) {
    id += direction;
    if (id > n) id = 1;
    if (id < 1) id = n;
    const p = game.players.find((x) => x.id === id);
    if (p?.alive) return id;
  }
  return null;
}

function buildOrderedSpeechQueue(game, startId, direction) {
  const n = seatCount(game);
  const queue = [];
  let cur = startId;
  for (let i = 0; i < n && cur != null; i++) {
    if (!queue.includes(cur)) queue.push(cur);
    const next = nextAliveFrom(game, cur, direction);
    if (next == null || next === startId) break;
    cur = next;
  }
  // 补全遗漏（理论上不应有）
  for (const p of alivePlayers(game)) {
    if (!queue.includes(p.id)) queue.push(p.id);
  }
  return queue;
}

function startDaySpeech(game) {
  const aliveIds = alivePlayers(game).map((p) => p.id);
  let queue;
  let mode = null;

  if (game.sheriffId && aliveIds.includes(game.sheriffId)) {
    const modes = ["sheriff_left", "sheriff_right"];
    if (game.lastNightDeaths.length > 0) {
      modes.push("death_left", "death_right");
    }
    mode = pickRandom(modes);
    game.speechOrderMode = mode;

    if (mode === "sheriff_left") {
      const start = nextAliveFrom(game, game.sheriffId, 1);
      queue = buildOrderedSpeechQueue(game, start ?? game.sheriffId, 1);
    } else if (mode === "sheriff_right") {
      const start = nextAliveFrom(game, game.sheriffId, -1);
      queue = buildOrderedSpeechQueue(game, start ?? game.sheriffId, -1);
    } else if (mode === "death_left") {
      const deathId = game.lastNightDeaths[0].id;
      const start = nextAliveFrom(game, deathId, 1);
      queue = buildOrderedSpeechQueue(game, start ?? aliveIds[0], 1);
    } else {
      const deathId = game.lastNightDeaths[0].id;
      const start = nextAliveFrom(game, deathId, -1);
      queue = buildOrderedSpeechQueue(game, start ?? aliveIds[0], -1);
    }

    pushLog(
      game,
      `警长 ${game.sheriffId} 号决定发言顺序：${SPEECH_ORDER_CN[mode]}。`,
    );
  } else {
    game.speechOrderMode = null;
    queue = shuffle(aliveIds);
    pushLog(game, `第 ${game.day} 天白天，开始发言。`);
  }

  game.speechQueue = queue;
  game.speechIndex = 0;
  game.speechKind = "day";
  game.phase = PHASE.DAY_SPEECH;
  game.votes = {};
  game.voteTally = {};

  if (game.sheriffId && aliveIds.includes(game.sheriffId)) {
    pushLog(game, `第 ${game.day} 天白天发言开始。`);
  }
}

/** 猎人开枪 */
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
  if (!SPEECH_PHASES.has(game.phase)) return null;
  if (game.speechIndex >= game.speechQueue.length) return null;
  return game.speechQueue[game.speechIndex];
}

export function recordSpeech(game, playerId, text) {
  if (!SPEECH_PHASES.has(game.phase)) {
    throw new Error("当前不是发言阶段");
  }
  const expected = currentSpeakerId(game);
  if (expected !== playerId) {
    throw new Error(`当前应发言的是 ${expected} 号，不是 ${playerId} 号`);
  }
  const player = game.players.find((p) => p.id === playerId);
  const kind =
    game.phase === PHASE.LAST_WORDS
      ? "last_words"
      : game.phase === PHASE.SHERIFF_SPEECH
        ? "sheriff"
        : game.phase === PHASE.SHERIFF_PK
          ? "sheriff_pk"
          : "day";

  const speech = {
    day: game.day,
    playerId,
    name: player.name,
    roleCn: ROLE_CN[player.role],
    text,
    kind,
    at: Date.now(),
  };
  game.speeches.push(speech);
  const prefix =
    kind === "sheriff"
      ? "【上警】"
      : kind === "sheriff_pk"
        ? "【PK】"
        : kind === "last_words"
          ? "【遗言】"
          : "";
  pushLog(game, `${prefix}${playerId} 号：${text}`);
  game.speechIndex += 1;

  if (game.speechIndex >= game.speechQueue.length) {
    if (game.phase === PHASE.LAST_WORDS) {
      finishLastWords(game);
    } else if (game.phase === PHASE.SHERIFF_SPEECH) {
      finishSheriffSpeeches(game);
    } else if (game.phase === PHASE.SHERIFF_PK) {
      finishSheriffPk(game);
    } else {
      // 白天发言结束 → 警长归票 → 投票
      maybeSheriffRecommend(game);
      game.phase = PHASE.DAY_VOTE;
      game.votes = {};
      game.voteTally = {};
      pushLog(game, "发言结束，进入投票。");
    }
  }
  return speech;
}

/** 警长归票（启发式） */
function maybeSheriffRecommend(game) {
  if (!game.sheriffId) return;
  const sheriff = game.players.find((p) => p.id === game.sheriffId);
  if (!sheriff?.alive) return;

  const scores = mentionScores(game, game.sheriffId, "day");
  const alive = alivePlayers(game).filter((p) => p.id !== game.sheriffId);
  const ranked = [...alive].sort(
    (a, b) => (scores[b.id] || 0) - (scores[a.id] || 0),
  );
  const target = ranked[0];
  if (target) {
    pushLog(
      game,
      `警长 ${game.sheriffId} 号归票：建议放逐 ${target.id} 号。`,
    );
  }
}

/** AI 投票：警长票计 1.5 */
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
      const goods = candidates.filter(
        (p) => !wolfIds.has(p.id) && p.id !== voter.id,
      );
      const revealed = goods.filter((p) => p.revealed);
      target = pickRandom(revealed.length ? revealed : goods);
    } else if (voter.role === ROLES.SEER) {
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
      const mentioned = mentionScores(game, voter.id, "day");
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
      const weight = voter.id === game.sheriffId ? 1.5 : 1;
      tally[target.id] = (tally[target.id] || 0) + weight;
    }
  }

  game.votes = ballot;
  game.voteTally = tally;

  const tallyText = Object.entries(tally)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${id}号 ${n}票`)
    .join("，");
  const detailText = formatVoteDetails(ballot, tally);
  pushLog(
    game,
    `放逐投票：${tallyText || "无人得票"}。${detailText ? `明细：${detailText}` : ""}`,
  );

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
    pushLog(game, `平票（${top.join("、")}号），本轮无人出局。`);
    pushPublicHistory(
      game,
      `第${game.day}天放逐平票（${top.join("、")}号），无人出局。票型：${detailText || "无"}。`,
    );
    game.lastExile = null;
    advanceToNight(game);
    return { ballot, tally, exiled: null, idiotFlip: false, hunterShot: null };
  } else {
    pushLog(game, "无人投票，本轮无人出局。");
    pushPublicHistory(game, `第${game.day}天无人投票，无人出局。`);
    game.lastExile = null;
    advanceToNight(game);
    return { ballot, tally, exiled: null, idiotFlip: false, hunterShot: null };
  }

  const exiled = game.players.find((p) => p.id === exiledId);
  let idiotFlip = false;

  if (exiled.role === ROLES.IDIOT && !exiled.revealed) {
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
    pushPublicHistory(
      game,
      `第${game.day}天放逐：${exiled.id}号亮白痴翻牌免死。票型：${detailText || "无"}。`,
    );
    // 白痴翻牌未出局，无遗言
    if (applyWinner(game, checkWinner(game))) {
      return { ballot, tally, exiled: game.lastExile, idiotFlip, hunterShot: null };
    }
    advanceToNight(game);
    return { ballot, tally, exiled: game.lastExile, idiotFlip, hunterShot: null };
  }

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
  pushPublicHistory(
    game,
    `第${game.day}天放逐：${exiled.id}号出局，身份【${ROLE_CN[exiled.role]}】。票型：${detailText || "无"}。`,
  );

  if (exiled.id === game.sheriffId) {
    pushLog(game, `${exiled.id} 号警长被放逐，警徽破碎。`);
    game.sheriffId = null;
  }

  // 猎人开枪延后到遗言之后；胜负也在遗言后结算，避免冲掉遗言阶段
  game.pendingHunterShot =
    exiled.role === ROLES.HUNTER && !exiled.poisonedMute ? exiled.id : null;

  startLastWords(game, [exiled.id], AFTER_LAST_WORDS.POST_EXILE, "exile");
  return { ballot, tally, exiled: game.lastExile, idiotFlip, hunterShot: null };
}

function advanceToNight(game) {
  if (game.phase === PHASE.ENDED) return;
  game.night += 1;
  game.phase = PHASE.NIGHT;
  pushLog(game, `夜幕降临，进入第 ${game.night} 夜……`);
}

/**
 * 从发言中粗略统计被点名的座位号
 * @param {'day'|'sheriff'|'all'} kindFilter
 */
function mentionScores(game, excludeId, kindFilter = "all") {
  const scores = {};
  const daySpeeches = game.speeches.filter((s) => {
    if (s.day !== game.day) return false;
    if (kindFilter === "all") return true;
    if (kindFilter === "sheriff") {
      return s.kind === "sheriff" || s.kind === "sheriff_pk";
    }
    return s.kind === "day" || !s.kind;
  });
  for (const s of daySpeeches) {
    const matches = s.text.match(/(\d{1,2})\s*号/g) || [];
    for (const m of matches) {
      const id = Number(m.replace(/\D/g, ""));
      if (id >= 1 && id <= seatCount(game) && id !== excludeId) {
        scores[id] = (scores[id] || 0) + 1;
      }
    }
  }
  return scores;
}

/** 构建某玩家发言用的私有上下文（体积受控，不含法官夜间预/狼详情） */
export function buildSpeechContext(game, playerId) {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在");

  const alive = alivePlayers(game).map((p) => ({
    id: p.id,
    revealed: p.revealed,
    revealedRole: p.revealed ? ROLE_CN[p.role] : null,
    isSheriff: game.sheriffId === p.id,
  }));

  const kind =
    game.phase === PHASE.LAST_WORDS
      ? "last_words"
      : game.phase === PHASE.SHERIFF_SPEECH
        ? "sheriff"
        : game.phase === PHASE.SHERIFF_PK
          ? "sheriff_pk"
          : "day";

  const sheriffEntries = game.speeches.filter(
    (s) =>
      s.day === game.day &&
      (s.kind === "sheriff" || s.kind === "sheriff_pk"),
  );
  const dayEntries = game.speeches.filter(
    (s) => s.day === game.day && (s.kind === "day" || !s.kind),
  );
  const upEntries = game.speeches.filter(
    (s) => s.day === game.day && s.kind === "sheriff",
  );
  const lastWordsEntries = game.speeches.filter(
    (s) => s.day === game.day && s.kind === "last_words",
  );

  // 发言全文太大：旧发言压摘要，最近 2 条稍长
  let recentSpeeches;
  if (kind === "last_words") {
    // 遗言：昨夜遗言几乎无白天发言；放逐遗言带今日摘要
    const dayLines = compressSpeechLines(dayEntries, {
      recentFull: 2,
      recentLen: 90,
      oldLen: 40,
    });
    const sheriffLines = compressSpeechLines(sheriffEntries, {
      recentFull: 1,
      recentLen: 60,
      oldLen: 32,
    });
    recentSpeeches = [
      ...(sheriffLines.length ? ["【警上摘要】", ...sheriffLines] : []),
      ...(dayLines.length ? ["【今日发言】", ...dayLines] : []),
      ...(lastWordsEntries.length
        ? [
            "【已发表遗言】",
            ...compressSpeechLines(lastWordsEntries, {
              recentFull: 2,
              recentLen: 80,
              oldLen: 40,
            }),
          ]
        : []),
    ];
  } else if (kind === "day") {
    const lwLines = compressSpeechLines(lastWordsEntries, {
      recentFull: 2,
      recentLen: 72,
      oldLen: 36,
    });
    const sheriffLines = compressSpeechLines(sheriffEntries, {
      recentFull: 1,
      recentLen: 72,
      oldLen: 36,
    });
    const dayLines = compressSpeechLines(dayEntries, {
      recentFull: 2,
      recentLen: 110,
      oldLen: 48,
    });
    recentSpeeches = [
      ...(lwLines.length ? ["【遗言摘要】", ...lwLines] : []),
      ...(sheriffLines.length ? ["【警上摘要】", ...sheriffLines] : []),
      ...(dayLines.length ? ["【白天发言】", ...dayLines] : []),
    ];
  } else if (kind === "sheriff_pk") {
    recentSpeeches = compressSpeechLines(sheriffEntries, {
      recentFull: 2,
      recentLen: 100,
      oldLen: 48,
    });
  } else {
    // 上警：可带昨夜遗言摘要
    const lwLines = compressSpeechLines(lastWordsEntries, {
      recentFull: 2,
      recentLen: 72,
      oldLen: 36,
    });
    recentSpeeches = [
      ...(lwLines.length ? ["【遗言摘要】", ...lwLines] : []),
      ...compressSpeechLines(upEntries, {
        recentFull: 2,
        recentLen: 110,
        oldLen: 48,
      }),
    ];
  }

  const seerAnalysis = analyzeSeerClaims(game);
  const { lastSpeechSummary, priorStance } = buildOwnSpeechMemory(
    game,
    playerId,
  );
  const stanceHint = inferStanceHint(game, player, seerAnalysis);
  if (priorStance.attack.length) {
    stanceHint.attackTarget = `${priorStance.attack.map((id) => `${id}号`).join("、")}（沿用上轮，改口须给理由）`;
  }
  if (priorStance.protect.length) {
    stanceHint.protectTarget = `${priorStance.protect.map((id) => `${id}号`).join("、")}（沿用上轮）`;
  }

  const ctx = {
    day: game.day,
    speechKind: kind,
    board: game.board ?? "预女猎白",
    boardDesc: game.boardDesc ?? "",
    playerCount: seatCount(game),
    self: {
      id: player.id,
      role: player.role,
      roleCn: ROLE_CN[player.role],
      camp: player.camp,
      revealed: player.revealed,
      isSheriff: game.sheriffId === player.id,
    },
    alive,
    lastNightDeaths: game.lastNightDeaths.map((d) => d.id),
    recentSpeeches,
    sheriffId: game.sheriffId,
    sheriffRunners: game.sheriffRunners,
    sheriffBallot: game.sheriffBallot,
    sheriffPkCandidates: game.sheriffPkCandidates,
    strategyHint: strategyHint(player, game, kind),
    winCondition: WIN_CONDITION[player.role] || WIN_CONDITION.villager,
    lastSpeechSummary,
    ironFacts: buildIronFacts(game),
    seerLockReason: seerAnalysis.lock?.reason || null,
    stanceHint,
    lastWordsReason: game.lastWordsReason,
  };

  // 私密信息按身份注入；绝不把法官夜间预/狼详情给好人
  if (player.role === ROLES.WEREWOLF) {
    ctx.wolfTeammates = game.players
      .filter((p) => p.role === ROLES.WEREWOLF && p.id !== player.id)
      .map((p) => ({ id: p.id, alive: p.alive }));
    if (game.wolfNightPlan) {
      ctx.wolfNightPlan = {
        jumperId: game.wolfNightPlan.jumperId,
        dayTactic: game.wolfNightPlan.dayTactic,
      };
    }
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

function strategyHint(player, game, kind) {
  const plan = game.wolfNightPlan?.dayTactic;

  if (kind === "last_words") {
    if (game.lastWordsReason === "exile") {
      return player.role === ROLES.WEREWOLF
        ? "放逐遗言：可留线索搅混水或倒钩，勿直接点名狼队友；可咬真预/带节奏。"
        : "放逐遗言：根据今日发言与票型指出最可疑狼坑，给好人留下可执行信息；可亮关键身份线索。";
    }
    return player.role === ROLES.SEER
      ? "昨夜出局遗言：务必报出已有查验与警徽流，要求好人站边。"
      : player.role === ROLES.WEREWOLF
        ? "昨夜出局遗言：装好人留线索，可咬真预或冲锋；勿暴露狼队友。"
        : "昨夜出局遗言：留下你掌握的信息与怀疑对象，帮助好人白天排狼。";
  }

  if (kind === "sheriff" || kind === "sheriff_pk") {
    switch (player.role) {
      case ROLES.SEER:
        return kind === "sheriff_pk"
          ? "PK：重申查验与警徽流，痛打对跳，要求站边。"
          : "上警报验（金水/查杀）+警徽流，要求好人站边。";
      case ROLES.WEREWOLF:
        return plan
          ? `执行狼队战术：${plan}`
          : kind === "sheriff_pk"
            ? "PK继续悍跳或咬真预，假验人自洽；禁止自爆。"
            : "择一狼悍跳抢警徽，其余倒钩搅混水；禁止自爆。";
      case ROLES.WITCH:
        return "可谨慎上警；救过人可暗示银水，勿轻易跳明女巫。";
      case ROLES.HUNTER:
        return "可穿神衣服，勿明说猎人（防毒哑）。";
      case ROLES.IDIOT:
        return "可装民上警，略作死吸火力。";
      default:
        return "根据上警发言判断谁像真预/狼跳，给票权表态；勿乱跳预言家。";
    }
  }

  switch (player.role) {
    case ROLES.SEER:
      return "结合发言对跳与你的查验带票出狼；继续报验/警徽流。";
    case ROLES.WITCH:
      return "隐藏身份；听发言找狼坑。银水可暗示，毒留给铁狼。";
    case ROLES.HUNTER:
      return "根据发言站边出狼；可半跳猎人衣服，防毒哑。";
    case ROLES.IDIOT:
      return player.revealed
        ? "已翻牌，凭发言与票型强逻辑出狼。"
        : "听发言找矛盾与抱团，明确出人。";
    case ROLES.WEREWOLF:
      return plan
        ? `白天搅混水。战术：${plan}`
        : "装好人逻辑带节奏，暗保队友，冲锋或倒钩；禁止自爆。";
    default:
      return "只凭发言矛盾、站边动机、票型判断狼坑，明确今日出人；拒绝骑墙。";
  }
}
