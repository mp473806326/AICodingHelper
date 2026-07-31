/**
 * 狼人杀 AI：人物发言（可选模型）
 * 支持：遗言 / 警长竞选发言 / PK / 白天发言
 * 所有模型必须遵守 logicRules.js 中的逻辑铁则。
 * 提示词刻意精简，避免把法官夜间预/狼私密信息塞进请求。
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { buildSpeechContext, ROLE_CN } from "./game.js";
import { createSpeechChatModel } from "./speechModels.js";
import {
  buildLogicTheoryBlock,
  buildFactsUserSection,
} from "./logicRules.js";

/** modelId → 已创建的 chat model */
const chatModelCache = new Map();

/** 单次发言不值得让整局流程干等，超时后走重试与兜底 */
const INVOKE_TIMEOUT_MS = 25000;
const MAX_ATTEMPTS = 2;

function getModel(modelId) {
  const id = modelId || "doubao";
  if (!chatModelCache.has(id)) {
    chatModelCache.set(
      id,
      createSpeechChatModel(id, {
        temperature: 0.65,
        timeout: INVOKE_TIMEOUT_MS,
        maxRetries: 0,
        maxTokens: 420,
      }),
    );
  }
  return chatModelCache.get(id);
}

function normalizeText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object") return p.text ?? p.content ?? "";
        return "";
      })
      .join("")
      .trim();
  }
  if (typeof content === "object") {
    return String(content.text ?? content.content ?? "").trim();
  }
  return String(content).trim();
}

function buildSystemPrompt(ctx) {
  const boardLabel = ctx.boardDesc
    ? `「${ctx.board}」${ctx.playerCount}人（${ctx.boardDesc}）`
    : `「${ctx.board}」${ctx.playerCount}人`;
  const isWolf = ctx.self.camp === "evil";
  const roleLine = `你是${boardLabel}的${ctx.self.id}号，身份【${ctx.self.roleCn}】（${isWolf ? "狼人" : "好人"}）。`;

  const isSheriffPhase =
    ctx.speechKind === "sheriff" || ctx.speechKind === "sheriff_pk";
  const isLastWords = ctx.speechKind === "last_words";

  const lengthRule = isLastWords
    ? "第一人称口语遗言，有信息量，70～130字。"
    : isSheriffPhase
      ? "第一人称口语，有逻辑链，90～160字。"
      : "第一人称口语，有逻辑链，80～140字。";

  const rules = `
硬性：
1. ${lengthRule}
2. 禁场外话；无自爆；勿无故亮真实身份（预报验/白痴翻牌/悍跳/遗言交待除外）。
3. 只输出发言正文。${isLastWords ? "遗言须留下可执行线索（怀疑谁/站边谁）。" : "必须有明确出人/保人结论。"}
4. 本板角色以配置为准，勿编造不存在身份。
`.trim();

  let phaseExtra = "";
  if (isLastWords) {
    phaseExtra =
      ctx.lastWordsReason === "exile"
        ? "【放逐遗言】你已被投票出局。总结今日发言与票型，指出狼坑或交待关键信息；狼人可搅混水但勿点名队友。"
        : "【昨夜出局遗言】你因刀/毒出局。留下查验、银水线索或怀疑对象，帮助存活玩家；狼人装好人搅局。";
  } else if (ctx.speechKind === "sheriff") {
    phaseExtra = isWolf
      ? "【上警】按狼队战术悍跳或倒钩，假验人自洽，白天搅混水。"
      : "【上警】预言家须报验+警徽流；其他人根据发言判断谁像真预/狼跳并表态。";
  } else if (ctx.speechKind === "sheriff_pk") {
    phaseExtra = "【PK】打对面逻辑漏洞，明确为什么你真/对面假。";
  } else if (isWolf) {
    phaseExtra = `【白天】搅混水带节奏，装好人逻辑，暗保队友。${ctx.sheriffId ? `警长${ctx.sheriffId}号。` : ""}`;
  } else {
    phaseExtra = `【白天】只根据公开死讯、票型、玩家发言判断狼坑并出人。${ctx.sheriffId ? `警长${ctx.sheriffId}号。` : ""}${ctx.self.isSheriff ? "你是警长可带归票倾向。" : ""}`;
  }

  const logicTheory = buildLogicTheoryBlock(ctx);
  const strategy = `策略：${ctx.strategyHint}`;

  let privateInfo = "";
  if (ctx.wolfTeammates) {
    privateInfo += `\n狼队友：${ctx.wolfTeammates.map((t) => `${t.id}号(${t.alive ? "活" : "死"})`).join("、") || "无"}。配合但别太明显。`;
  }
  if (ctx.seerChecks) {
    privateInfo += `\n你的查验：${
      ctx.seerChecks.length
        ? ctx.seerChecks.map((c) => `夜${c.night}验${c.targetId}→${c.result}`).join("；")
        : "无"
    }。查杀优先带票。`;
  }
  if (ctx.witchPotions) {
    privateInfo += `\n药剂：解${ctx.witchPotions.antidote}/毒${ctx.witchPotions.poison}。`;
  }
  if (ctx.self.revealed) {
    privateInfo += `\n你已翻牌白痴，场上皆知。`;
  }

  return `${roleLine}\n${rules}\n${phaseExtra}\n${logicTheory}\n${strategy}${privateInfo}`;
}

function buildUserPrompt(ctx) {
  const aliveStr = ctx.alive
    .map((p) => {
      const tags = [];
      if (p.isSheriff) tags.push("警");
      if (p.revealed) tags.push(p.revealedRole);
      return tags.length ? `${p.id}(${tags.join("/")})` : `${p.id}`;
    })
    .join(",");

  const deaths =
    ctx.lastNightDeaths.length > 0
      ? `昨夜死亡：${ctx.lastNightDeaths.map((id) => `${id}号`).join("、")}`
      : "昨夜平安夜";

  const speeches =
    ctx.recentSpeeches.length > 0
      ? `发言摘要：\n${ctx.recentSpeeches.join("\n")}`
      : "你是本轮较早发言。";

  const factsSection = buildFactsUserSection(ctx);

  if (ctx.speechKind === "last_words") {
    const why =
      ctx.lastWordsReason === "exile"
        ? "你刚被放逐出局"
        : "你昨夜被刀/毒出局";
    return [
      `第${ctx.day}天【遗言】${why}，轮到你发表遗言。`,
      `仍存活：${aliveStr}`,
      deaths,
      speeches,
      factsSection,
      `请以${ctx.self.id}号发表遗言（留下线索，有明确指向）。`,
    ].join("\n");
  }

  if (ctx.speechKind === "sheriff") {
    return [
      `第${ctx.day}天【上警】轮到你。上警：${(ctx.sheriffRunners || []).map((id) => `${id}号`).join("、")}`,
      `存活：${aliveStr}`,
      deaths,
      speeches,
      factsSection,
      `请以${ctx.self.id}号发表上警发言。`,
    ].join("\n");
  }

  if (ctx.speechKind === "sheriff_pk") {
    return [
      `第${ctx.day}天【PK】平票：${(ctx.sheriffPkCandidates || ctx.sheriffBallot || []).map((id) => `${id}号`).join("、")}`,
      `存活：${aliveStr}`,
      deaths,
      speeches,
      factsSection,
      `请以${ctx.self.id}号发表PK发言。`,
    ].join("\n");
  }

  return [
    `第${ctx.day}天白天发言。`,
    ctx.sheriffId ? `警长${ctx.sheriffId}号` : "无警长",
    `存活：${aliveStr}`,
    deaths,
    speeches,
    factsSection,
    `请以${ctx.self.id}号（${ROLE_CN[ctx.self.role]}视角，勿无故自爆）发言。`,
  ].join("\n");
}

function stripSpeechPrefix(text) {
  return text
    .replace(/^[\d一二三四五六七八九十]+号[:：\s]*/u, "")
    .replace(/^发言[:：\s]*/u, "")
    .replace(/^【[^】]*】\s*/u, "");
}

/**
 * 用选定模型生成指定玩家发言。
 * 模型报错/超时不向上抛：一天有十余次连续调用，任何一次失败都会打断整局自动流程，
 * 宁可这一位用兜底文案也要让流程走下去。
 * @returns {Promise<string>}
 */
export async function generateSpeechWithDoubao(game, playerId) {
  const ctx = buildSpeechContext(game, playerId);
  const player = game.players.find((p) => p.id === playerId);
  const modelId = player?.modelId || game.modelId || "doubao";
  const messages = [
    new SystemMessage(buildSystemPrompt(ctx)),
    new HumanMessage(buildUserPrompt(ctx)),
  ];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await getModel(modelId).invoke(messages);
      const text = stripSpeechPrefix(normalizeText(result.content));
      if (text) return text;
      console.warn(
        `${playerId} 号（${modelId}）发言返回空文本（第 ${attempt} 次）`,
      );
    } catch (error) {
      console.warn(
        `${playerId} 号（${modelId}）发言生成失败（第 ${attempt} 次）:`,
        error?.message ?? error,
      );
    }
  }

  console.warn(`${playerId} 号（${modelId}）发言改用兜底文案`);
  return fallbackSpeech(ctx);
}

function fallbackSpeech(ctx) {
  const fact =
    ctx.ironFacts?.length > 0
      ? ctx.ironFacts[ctx.ironFacts.length - 1]
      : ctx.lastNightDeaths?.length
        ? `昨夜${ctx.lastNightDeaths.map((id) => `${id}号`).join("、")}倒牌`
        : "目前信息偏少";

  if (ctx.speechKind === "last_words") {
    if (ctx.self.role === "seer" && ctx.seerChecks?.length) {
      const last = ctx.seerChecks[ctx.seerChecks.length - 1];
      return `我是预言家，这是我的遗言。我验过${last.targetId}号是${last.result}，这是铁逻辑。好人一定要站边我的查验，今天优先讨论这个位置。别被悍跳带节奏，我想听还没表态的人跟票。`;
    }
    if (ctx.self.camp === "evil") {
      return `我是${ctx.self.id}号，遗言就一句：场上发言最冲、逻辑最断层的人更像狼，别急着信单边跳的。今天先打发言最飘的那个，我想听他解释站边动机。`;
    }
    return `我是${ctx.self.id}号，这是遗言。结合${fact}，我最怀疑发言矛盾、票型抱团的人。好人白天跟这个思路排，别划水。我想听被点到的人正面回应。`;
  }

  if (ctx.speechKind === "sheriff" || ctx.speechKind === "sheriff_pk") {
    if (ctx.self.role === "seer" && ctx.seerChecks?.length) {
      const last = ctx.seerChecks[ctx.seerChecks.length - 1];
      return `我是预言家，昨晚验了${last.targetId}号，结果是${last.result}，这是铁逻辑。警徽流我今晚继续验还没被点过的位置。没人对跳就站边我；有人对跳就先把假预打穿。因此我要求好人今天跟我的查验走，我想听对跳位解释你的验人为何和死亡信息不打架。`;
    }
    if (ctx.self.role === "werewolf") {
      return `我也是预言家视角。前面那位的验人和警徽流对不上场上信息，他在硬编。基于发言矛盾，我更怀疑他是悍跳狼。所以警徽别急着给他，先把逻辑漏洞最大的人投出去。我想请他解释：你的查杀为什么经不起票型推敲？`;
    }
    return `我是${ctx.self.id}号。先摆事实：${fact}。基于目前上警发言，我站逻辑更自洽的一侧，警徽投给能报出清晰验人链的人。骑墙没意义，今天必须选出能带队的警徽。我想听发言飘的人解释一下站边动机。`;
  }

  const attack =
    ctx.stanceHint?.attackTarget && ctx.stanceHint.attackTarget !== "待定"
      ? ctx.stanceHint.attackTarget
      : "发言最空、票型最可疑的人";
  const side =
    ctx.stanceHint?.sideWith && !String(ctx.stanceHint.sideWith).includes("待定")
      ? ctx.stanceHint.sideWith
      : "逻辑更硬的一侧";

  if (ctx.self.camp === "evil") {
    return `我是${ctx.self.id}号。先说公开信息：${fact}。前面有人发言太冲、逻辑断层，我更怀疑那侧在带节奏。今天别被带偏，先出发言最飘、站边最飘的位置。我想听被点的人解释：你凭什么这么站？`;
  }

  return `我是${ctx.self.id}号。先说铁事实：${fact}。结合前面发言，我站${side}，主攻${attack}。因为我只能根据发言和票型排狼，所以今天先把最像狼的位置出去。另外我想听被点到的人解释一下：你为什么这样站边/这样出人？`;
}
