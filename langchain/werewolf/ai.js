/**
 * 狼人杀 AI：人物发言使用豆包模型
 * 支持：警长竞选发言 / PK / 白天发言
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createDoubaoChatModel } from "../models/doubao.js";
import { buildSpeechContext, ROLE_CN } from "./game.js";

let chatModel = null;

function getModel() {
  if (!chatModel) {
    chatModel = createDoubaoChatModel({ temperature: 0.9 });
  }
  return chatModel;
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
  const roleLine = `你是狼人杀「预女猎白」12人局里的 ${ctx.self.id} 号玩家，真实身份是【${ctx.self.roleCn}】（${ctx.self.camp === "evil" ? "狼人阵营" : "好人阵营"}）。`;

  const isSheriffPhase =
    ctx.speechKind === "sheriff" || ctx.speechKind === "sheriff_pk";

  const lengthRule = isSheriffPhase
    ? "1. 只用第一人称发言，像真人玩家，口语化、有逻辑，100～180字（上警/PK要充分展开）。"
    : "1. 只用第一人称发言，像真人玩家，口语化、有逻辑，80～160字。";

  const rules = `
硬性规则：
${lengthRule}
2. 禁止说「我发誓」「我是AI」「作为语言模型」等场外话。
3. 此板无狼人自爆，不要提自爆。
4. 不要直接说出自己的真实身份，除非你是预言家在报验、或白痴已翻牌、或按策略悍跳/半跳/诈身份。
5. 可以点名座位号讨论；结合昨夜死讯与前面玩家发言站边。
6. 只输出发言正文，不要加「发言：」前缀或引号。
`.trim();

  let phaseExtra = "";
  if (ctx.speechKind === "sheriff") {
    phaseExtra = `
当前是【警长竞选·上警发言】：
- 若你是预言家：必须报昨晚查验（几号金水/查杀），并报警徽流（今晚验谁、明晚验谁）。
- 若你是狼人且选择悍跳：编造假查验和假警徽流，逻辑尽量自洽，攻击真预言家或其他上警位。
- 若你是其他角色：可诈身份、报观点，或表明好人身份争取票；发言后系统可能安排退水。
`.trim();
  } else if (ctx.speechKind === "sheriff_pk") {
    phaseExtra = `
当前是【警长竞选·PK发言】（更短更冲）：
- 重点打对面逻辑漏洞，重申自己的验人/身份点，争取未上警玩家的票。
`.trim();
  } else if (ctx.sheriffId) {
    phaseExtra = `
当前是白天发言（警长已产生：${ctx.sheriffId}号）：
- 可回顾警长竞选对跳、点评警上发言，再给出今日站边与票型。
${ctx.self.isSheriff ? "- 你是警长，发言可带归票倾向。" : ""}
`.trim();
  }

  const strategy = `本局策略提示：${ctx.strategyHint}`;

  let privateInfo = "";
  if (ctx.wolfTeammates) {
    privateInfo += `\n你的狼队友：${ctx.wolfTeammates.map((t) => `${t.id}号(${t.alive ? "存活" : "出局"})`).join("、") || "无"}。互相认识，发言时配合但不要太明显。`;
  }
  if (ctx.seerChecks) {
    privateInfo += `\n你的查验记录：${
      ctx.seerChecks.length
        ? ctx.seerChecks.map((c) => `第${c.night}夜验${c.targetId}号→${c.result}`).join("；")
        : "尚无"
    }。`;
  }
  if (ctx.witchPotions) {
    privateInfo += `\n你的药剂：解药${ctx.witchPotions.antidote}瓶，毒药${ctx.witchPotions.poison}瓶。`;
  }
  if (ctx.self.revealed) {
    privateInfo += `\n你已翻牌亮明白痴，场上所有人都知道你是白痴。`;
  }

  return `${roleLine}\n${rules}\n${phaseExtra}\n${strategy}${privateInfo}`;
}

function buildUserPrompt(ctx) {
  const aliveStr = ctx.alive
    .map((p) => {
      const tags = [];
      if (p.isSheriff) tags.push("警长");
      if (p.revealed) tags.push(`已亮${p.revealedRole}`);
      return tags.length ? `${p.id}号(${tags.join("·")})` : `${p.id}号`;
    })
    .join("、");

  const deaths =
    ctx.lastNightDeaths.length > 0
      ? `昨夜死亡：${ctx.lastNightDeaths.map((id) => `${id}号`).join("、")}`
      : "昨夜平安夜";

  const speeches =
    ctx.recentSpeeches.length > 0
      ? `本轮已发言：\n${ctx.recentSpeeches.join("\n")}`
      : "你是本轮较早发言的玩家，前面发言很少或没有。";

  if (ctx.speechKind === "sheriff") {
    return [
      `现在是第 ${ctx.day} 天【警长竞选】，你已上警，轮到你发言。`,
      `上警名单：${(ctx.sheriffRunners || []).map((id) => `${id}号`).join("、")}`,
      `存活玩家：${aliveStr}`,
      deaths,
      speeches,
      `请以 ${ctx.self.id} 号发表上警竞选发言。`,
    ].join("\n");
  }

  if (ctx.speechKind === "sheriff_pk") {
    return [
      `现在是第 ${ctx.day} 天【警长竞选 PK】，平票玩家：${(ctx.sheriffPkCandidates || ctx.sheriffBallot || []).map((id) => `${id}号`).join("、")}`,
      `存活玩家：${aliveStr}`,
      deaths,
      speeches,
      `请以 ${ctx.self.id} 号发表 PK 发言，争取警徽。`,
    ].join("\n");
  }

  return [
    `现在是第 ${ctx.day} 天白天发言阶段。`,
    ctx.sheriffId ? `当前警长：${ctx.sheriffId}号` : "本局暂无警长",
    `存活玩家：${aliveStr}`,
    deaths,
    speeches,
    `请以 ${ctx.self.id} 号（${ROLE_CN[ctx.self.role]}视角，但勿无故自爆身份）发表本轮发言。`,
  ].join("\n");
}

/**
 * 用豆包生成指定玩家发言
 * @returns {Promise<string>}
 */
export async function generateSpeechWithDoubao(game, playerId) {
  const ctx = buildSpeechContext(game, playerId);
  const model = getModel();
  const result = await model.invoke([
    new SystemMessage(buildSystemPrompt(ctx)),
    new HumanMessage(buildUserPrompt(ctx)),
  ]);

  let text = normalizeText(result.content);
  text = text.replace(/^[\d一二三四五六七八九十]+号[:：\s]*/u, "");
  text = text.replace(/^发言[:：\s]*/u, "");
  if (!text) {
    text = fallbackSpeech(ctx);
  }
  return text;
}

function fallbackSpeech(ctx) {
  if (ctx.speechKind === "sheriff" || ctx.speechKind === "sheriff_pk") {
    if (ctx.self.role === "seer" && ctx.seerChecks?.length) {
      const last = ctx.seerChecks[ctx.seerChecks.length - 1];
      return `我是预言家，昨晚查了${last.targetId}号，他是${last.result}。警徽流我今晚验场上还没被点过的位置，希望好人站边我，把对跳狼投出去。`;
    }
    if (ctx.self.role === "werewolf") {
      return `我也是预言家视角，昨晚查验和前面那位对不上，他在撒谎。大家仔细听逻辑，别急着把警徽给出去，先把像狼的投掉。`;
    }
    return `我是${ctx.self.id}号，上来给个好人视角。目前更信发言扎实的一侧，警徽我会投给逻辑更清晰的人。`;
  }

  const deaths = ctx.lastNightDeaths;
  if (deaths.length) {
    return `我是${ctx.self.id}号。昨夜${deaths.map((id) => `${id}号`).join("、")}倒牌，我先听完再站边，目前更怀疑发言飘的人，先聊聊逻辑。`;
  }
  return `我是${ctx.self.id}号。平安夜信息少，我先从发言状态找突破口，待会票型出来再细聊。`;
}
