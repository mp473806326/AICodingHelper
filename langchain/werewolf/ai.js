/**
 * 狼人杀 AI：人物发言使用豆包模型
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

  const rules = `
硬性规则：
1. 只用第一人称发言，像真人玩家，口语化、有逻辑，80～160字。
2. 禁止说「我发誓」「我是AI」「作为语言模型」等场外话。
3. 此板无狼人自爆，不要提自爆。
4. 不要直接说出自己的真实身份，除非你是预言家在报验、或白痴已翻牌、或按策略悍跳/半跳。
5. 可以点名座位号讨论；结合昨夜死讯与前面玩家发言站边。
6. 只输出发言正文，不要加「发言：」前缀或引号。
`.trim();

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

  return `${roleLine}\n${rules}\n${strategy}${privateInfo}`;
}

function buildUserPrompt(ctx) {
  const aliveStr = ctx.alive
    .map((p) =>
      p.revealed ? `${p.id}号(已亮${p.revealedRole})` : `${p.id}号`,
    )
    .join("、");

  const deaths =
    ctx.lastNightDeaths.length > 0
      ? `昨夜死亡：${ctx.lastNightDeaths.map((id) => `${id}号`).join("、")}`
      : "昨夜平安夜";

  const speeches =
    ctx.recentSpeeches.length > 0
      ? `今日已发言：\n${ctx.recentSpeeches.join("\n")}`
      : "你是今日较早发言的玩家，前面发言很少或没有。";

  return [
    `现在是第 ${ctx.day} 天白天发言阶段。`,
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
  // 去掉可能的角色前缀
  text = text.replace(/^[\d一二三四五六七八九十]+号[:：\s]*/u, "");
  text = text.replace(/^发言[:：\s]*/u, "");
  if (!text) {
    text = fallbackSpeech(ctx);
  }
  return text;
}

function fallbackSpeech(ctx) {
  const deaths = ctx.lastNightDeaths;
  if (deaths.length) {
    return `我是${ctx.self.id}号。昨夜${deaths.map((id) => `${id}号`).join("、")}倒牌，我先听完再站边，目前更怀疑发言飘的人，先聊聊逻辑。`;
  }
  return `我是${ctx.self.id}号。平安夜信息少，我先从发言状态找突破口，待会票型出来再细聊。`;
}
