/**
 * 狼人杀发言逻辑铁则
 * 所有模型（豆包 / DeepSeek 等）生成白天/警长发言时必须遵守。
 * 注意：本文件勿 import game.js，避免循环依赖。
 */

const ROLE_CN = {
  werewolf: "狼人",
  villager: "村民",
  seer: "预言家",
  witch: "女巫",
  hunter: "猎人",
  idiot: "白痴",
};

/** 各身份胜利条件（面向发言者自我约束） */
export const WIN_CONDITION = {
  werewolf: "狼人阵营屠边获胜：消灭全部神职，或消灭全部村民。",
  seer: "好人阵营获胜：通过验人信息带队找出并放逐全部狼人。",
  witch: "好人阵营获胜：合理使用解药/毒药，协助放逐全部狼人。",
  hunter: "好人阵营获胜：存活时震慑狼人，出局开枪带走狼人。",
  idiot: "好人阵营获胜：可翻牌免死扰乱狼队票型，协助放逐狼人。",
  villager: "好人阵营获胜：站边真神、投出狼人，不要被狼带节奏。",
};

/** 从发言文本识别「跳预言家」 */
const SEER_CLAIM_RE =
  /我(?:是|就是|乃)?\s*预言家|预言家(?:视角|发话|报验)|(?:悍跳|认)预言家|验了\s*\d{1,2}\s*号.{0,12}(?:查杀|金水|狼人|好人)/;

/** 从发言识别站边/出击倾向 */
const ATTACK_RE = /(?:出|投|放逐|带走|刀|打)\s*(\d{1,2})\s*号|(\d{1,2})\s*号(?:是狼|是狼人|查杀|很狼|必狼)/g;
const PROTECT_RE = /(?:保|信|站)\s*(\d{1,2})\s*号|(\d{1,2})\s*号(?:是好人|金水|是神|没问题)/g;

/**
 * 分析场上公开的预言家声称与「单边预言家逻辑锁」
 * 规则：唯一跳预且无人对跳，持续 ≥2 个完整白天后锁定为真预。
 */
export function analyzeSeerClaims(game) {
  const claimsByPlayer = new Map(); // playerId -> { firstDay, days:Set, samples[] }

  for (const s of game.speeches) {
    if (!SEER_CLAIM_RE.test(s.text)) continue;
    const entry = claimsByPlayer.get(s.playerId) || {
      playerId: s.playerId,
      firstDay: s.day,
      days: new Set(),
      samples: [],
    };
    entry.days.add(s.day);
    if (entry.samples.length < 2) {
      entry.samples.push(summarizeSpeech(s.text, 40));
    }
    claimsByPlayer.set(s.playerId, entry);
  }

  const claimants = [...claimsByPlayer.values()].map((c) => ({
    playerId: c.playerId,
    firstDay: c.firstDay,
    claimDays: [...c.days].sort((a, b) => a - b),
    sample: c.samples[0] || "",
  }));

  const aliveClaimants = claimants.filter((c) => {
    const p = game.players.find((x) => x.id === c.playerId);
    return p?.alive;
  });

  let lock = null;
  if (aliveClaimants.length === 1) {
    const only = aliveClaimants[0];
    const span = game.day - only.firstDay;
    // 跨越至少 2 个完整白天轮次（首跳当天算 day0，次日白天起可锁）
    const locked = span >= 2 || only.claimDays.length >= 2;
    lock = {
      playerId: only.playerId,
      locked,
      reason: locked
        ? `${only.playerId}号单边跳预言家且无人对跳已持续，视为真预言家，禁止再无故质疑其身份。`
        : `${only.playerId}号目前单边跳预言家，暂可观察一轮，但不得空口划水质疑。`,
    };
  } else if (aliveClaimants.length >= 2) {
    lock = {
      playerId: null,
      locked: false,
      reason: `场上对跳预言家：${aliveClaimants.map((c) => `${c.playerId}号`).join("、")}，必须明确站边其中一侧，禁止骑墙。`,
    };
  }

  return { claimants: aliveClaimants, lock };
}

function summarizeSpeech(text, maxLen = 60) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

function extractStanceFromText(text, selfId) {
  const attack = new Set();
  const protect = new Set();
  let m;
  const attackRe = new RegExp(ATTACK_RE.source, "g");
  const protectRe = new RegExp(PROTECT_RE.source, "g");
  while ((m = attackRe.exec(text))) {
    const id = Number(m[1] || m[2]);
    if (id && id !== selfId) attack.add(id);
  }
  while ((m = protectRe.exec(text))) {
    const id = Number(m[1] || m[2]);
    if (id && id !== selfId) protect.add(id);
  }
  return {
    attack: [...attack],
    protect: [...protect],
  };
}

/** 上一轮自己的发言摘要 + 曾表态的站边 */
export function buildOwnSpeechMemory(game, playerId) {
  const mine = game.speeches.filter((s) => s.playerId === playerId);
  if (!mine.length) {
    return {
      lastSpeechSummary: "（你尚未发过言）",
      priorStance: { attack: [], protect: [] },
    };
  }
  const last = mine[mine.length - 1];
  const priorStance = extractStanceFromText(last.text, playerId);
  return {
    lastSpeechSummary: `第${last.day}天${kindLabel(last.kind)}：${summarizeSpeech(last.text, 80)}`,
    priorStance,
  };
}

function kindLabel(kind) {
  if (kind === "sheriff") return "上警";
  if (kind === "sheriff_pk") return "PK";
  if (kind === "last_words") return "遗言";
  return "白天";
}

/** 夜间私密信息（刀口/查验/用药）不得进入 AI 提示 */
const PRIVATE_NIGHT_RE =
  /预言家查验|狼人商议|狼人刀了|女巫使用解药|女巫毒了|女巫今晚未用药|狼队密谈|查验了\s*\d/;

/** 公开死讯去掉刀/毒归因，避免泄露夜间私密 */
function sanitizePublicFact(line) {
  return String(line || "")
    .replace(/\(毒\)|\(刀\)/g, "")
    .replace(/毒死|刀死/g, "出局");
}

/**
 * 汇总铁逻辑事实（不可被发言推翻）
 * 仅公开信息：死讯、票型、白痴翻牌；不含法官夜间预/狼详情。
 */
export function buildIronFacts(game) {
  const facts = [];

  if (game.history?.length) {
    for (const h of game.history) {
      if (PRIVATE_NIGHT_RE.test(h)) continue;
      facts.push(sanitizePublicFact(h));
    }
  } else {
    // 兼容未写入 history 的旧对局
    if (game.sheriffElectResult?.sheriffId) {
      facts.push(
        `警长选举：${game.sheriffElectResult.sheriffId}号当选警长。`,
      );
    }
    if (game.lastNightDeaths?.length) {
      facts.push(
        `昨夜死亡：${game.lastNightDeaths.map((d) => `${d.id}号`).join("、")}。`,
      );
    } else if (game.day >= 1) {
      facts.push("昨夜平安夜（无死亡）。");
    }
    if (game.lastExile) {
      const e = game.lastExile;
      facts.push(
        e.flipped
          ? `上日放逐：${e.id}号亮出白痴翻牌免死。`
          : `上日放逐：${e.id}号出局。`,
      );
    }
  }

  // 已翻牌身份永远是铁事实
  for (const p of game.players) {
    if (p.revealed) {
      facts.push(`${p.id}号已翻牌亮明【${ROLE_CN[p.role]}】。`);
    }
  }

  // 控制长度：只保留最近事实，降低发言请求体积
  return facts.slice(-10);
}

/**
 * 把发言压成短行，供 AI 上下文使用（旧发言摘要、最近发言稍长）
 */
export function compressSpeechLines(entries, { recentFull = 2, recentLen = 100, oldLen = 42 } = {}) {
  if (!entries?.length) return [];
  const n = entries.length;
  return entries.map((e, i) => {
    const keep = i >= n - recentFull ? recentLen : oldLen;
    return `${e.playerId}号：${summarizeSpeech(e.text, keep)}`;
  });
}

/**
 * 根据角色与场况给出建议站边/攻击/保护目标（供思考步骤填充，非强制）
 */
export function inferStanceHint(game, player, seerAnalysis) {
  const hint = {
    sideWith: "待定（请根据铁逻辑自行确认）",
    attackTarget: "待定",
    protectTarget: "待定",
  };

  const lock = seerAnalysis.lock;
  if (lock?.locked && lock.playerId) {
    hint.sideWith = `${lock.playerId}号（锁定真预言家）`;
  } else if (lock && !lock.locked && seerAnalysis.claimants.length >= 2) {
    hint.sideWith = "必须在对跳预言家中二选一，禁止骑墙";
  }

  if (player.role === "seer") {
    const lastKill = [...(game.seerChecks || [])]
      .reverse()
      .find((c) => c.camp === "evil");
    const lastGold = [...(game.seerChecks || [])]
      .reverse()
      .find((c) => c.camp === "good");
    if (lastKill) {
      hint.attackTarget = `${lastKill.targetId}号（你的查杀）`;
    }
    if (lastGold) {
      hint.protectTarget = `${lastGold.targetId}号（你的金水）`;
    }
    hint.sideWith = "自己（真预言家，带队报验）";
  } else if (player.role === "werewolf") {
    const teammates = game.players
      .filter((p) => p.role === "werewolf" && p.id !== player.id && p.alive)
      .map((p) => p.id);
    hint.protectTarget = teammates.length
      ? `狼队友${teammates.map((id) => `${id}号`).join("、")}（暗保，勿露馅）`
      : "存活狼队友";
    if (lock?.locked && lock.playerId) {
      // 真预已锁，狼应冲其他坑或倒钩
      hint.attackTarget = "真预金水以外的可冲锋位，或倒钩卖已暴露队友";
    } else if (seerAnalysis.claimants.length >= 2) {
      hint.attackTarget = "对跳中的真预言家（冲锋咬真预）";
    }
  } else if (lock?.locked && lock.playerId) {
    hint.protectTarget = `${lock.playerId}号`;
    // 从锁定预言家近期发言里挖查杀目标
    const seerSpeeches = game.speeches.filter(
      (s) => s.playerId === lock.playerId,
    );
    const last = seerSpeeches[seerSpeeches.length - 1];
    if (last) {
      const kill = last.text.match(
        /(\d{1,2})\s*号.{0,8}(?:查杀|是狼|狼人)/,
      );
      if (kill) hint.attackTarget = `${kill[1]}号（跟票真预查杀）`;
    }
  }

  return hint;
}

/**
 * 写入对局公开历史（投票/死亡等铁事实）
 */
export function pushPublicHistory(game, line) {
  if (!game.history) game.history = [];
  game.history.push(line);
  if (game.history.length > 40) game.history.shift();
}

/**
 * 组装逻辑铁则正文（注入 system prompt）——精简版，控制请求体积
 */
export function buildLogicTheoryBlock(ctx) {
  const role = ctx.self.roleCn;
  const win = ctx.winCondition || WIN_CONDITION[ctx.self.role] || "按阵营获胜";
  const lastSummary = ctx.lastSpeechSummary || "（尚无）";
  const stance = ctx.stanceHint || {};
  const seerLockLine = ctx.seerLockReason
    ? `\n预言家局势：${ctx.seerLockReason}`
    : "";
  const isWolf = ctx.self.camp === "evil";
  const infoBarrier = isWolf
    ? "你是狼人：可用夜间战术搅局，但发言必须装成好人逻辑，勿自爆身份。"
    : "信息屏障：你不知道夜间真实刀口/查验/用药（除非你是预言家且仅限自己的查验）。只能根据公开死讯、票型、翻牌、玩家发言判断谁是狼。禁止假装知道法官夜间信息。";

  return `
【逻辑铁则】你是${role}，胜利条件：${win}
1. 铁逻辑=公开死讯/票型/白痴翻牌；软逻辑=语气站边，勿把软当铁。
2. 单边预言家无人对跳且持续两轮→视为真预；对跳必须二选一站边。${seerLockLine}
3. 时间轴：上轮「${lastSummary}」；改口须给理由。
4. 禁止场外/划水骑墙；必须给出出人/保人结论。
5. 查杀优先；票型是证据；银水慎出；只有明确翻牌的身份才是公开铁事实。
6. ${infoBarrier}
立场锚点：站边${stance.sideWith || "待定"}；主攻${stance.attackTarget || "待定"}；保护${stance.protectTarget || "待定"}。
发言结构：事实→逻辑→结论→提问。只输出正文。
`.trim();
}

/**
 * 为 user prompt 附加「本局铁事实清单」，迫使模型先用事实再发言
 */
export function buildFactsUserSection(ctx) {
  const lines = [];
  if (ctx.ironFacts?.length) {
    lines.push("【公开铁事实】");
    ctx.ironFacts.forEach((f, i) => lines.push(`${i + 1}.${f}`));
  }
  if (ctx.seerLockReason) {
    lines.push(`【预言家局势】${ctx.seerLockReason}`);
  }
  if (ctx.stanceHint) {
    lines.push(
      `【立场】站${ctx.stanceHint.sideWith}；出${ctx.stanceHint.attackTarget}；保${ctx.stanceHint.protectTarget}`,
    );
  }
  if (ctx.self?.camp !== "evil") {
    lines.push(
      "【推理要求】仅根据上方公开事实与本轮发言摘要判断狼坑，点名矛盾发言/票型，给出今日出人。",
    );
  } else {
    lines.push("【狼队】按夜间战术搅混水，装好人逻辑，勿自爆。");
  }
  return lines.join("\n");
}
