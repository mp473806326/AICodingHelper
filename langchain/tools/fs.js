import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tool } from "langchain";
import * as z from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default: project root (parent of langchain/) */
export const WORKSPACE_ROOT = path.resolve(
  process.env.WORKSPACE_ROOT || path.join(__dirname, "..", ".."),
);

function resolveSafePath(relativePath) {
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("路径不能为空");
  }
  const normalized = relativePath.replace(/\\/g, "/");
  if (path.isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath)) {
    throw new Error("请使用相对工作区的路径，不要使用绝对路径");
  }
  const resolved = path.resolve(WORKSPACE_ROOT, normalized);
  const rootWithSep = WORKSPACE_ROOT.endsWith(path.sep)
    ? WORKSPACE_ROOT
    : WORKSPACE_ROOT + path.sep;
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new Error(`路径超出工作区范围: ${relativePath}`);
  }
  return resolved;
}

/* ========== 文件更改历史管理 ========== */

/**
 * 文件更改历史条目
 * @typedef {Object} ChangeEntry
 * @property {string} filePath - 相对路径
 * @property {string|null} previousContent - 更改前的内容（若文件不存在则为 null）
 * @property {string} newContent - 更改后的内容
 * @property {number} timestamp - 时间戳
 */

/**
 * 按「聊天轮次」分组的更改历史（每轮一次对话产生的全部写文件操作）
 * @type {ChangeEntry[][]}
 */
let changeBatches = [];

/**
 * 被撤销的批次（用于重做；栈顶为最近一次撤销）
 * @type {ChangeEntry[][]}
 */
let undoneBatches = [];

/** 下一轮写文件时是否开启新批次（由 beginChangeBatch 置位） */
let pendingNewBatch = false;

/**
 * 标记即将开始一轮新的聊天；本轮内的写文件会记入同一批次
 */
export function beginChangeBatch() {
  pendingNewBatch = true;
}

/**
 * 记录一次文件更改（归入当前聊天轮次批次）
 * @param {string} relativePath
 * @param {string|null} previousContent
 * @param {string} newContent
 */
export function recordChange(relativePath, previousContent, newContent) {
  if (pendingNewBatch || changeBatches.length === 0) {
    changeBatches.push([]);
    pendingNewBatch = false;
    // 新更改产生后清空可重做状态
    undoneBatches = [];
  }
  changeBatches[changeBatches.length - 1].push({
    filePath: relativePath,
    previousContent,
    newContent,
    timestamp: Date.now(),
  });
}

/**
 * 撤销最后一次聊天产生的文件更改
 * @returns {{ success: boolean, entries?: ChangeEntry[], error?: string }}
 */
export async function undoLastChange() {
  if (changeBatches.length === 0) {
    return { success: false, error: "没有可撤销的更改" };
  }
  const batch = changeBatches[changeBatches.length - 1];
  const toUndo = [...batch].reverse();
  const restored = [];
  try {
    for (const entry of toUndo) {
      const target = resolveSafePath(entry.filePath);
      // 如果之前文件不存在，则删除；否则还原
      if (entry.previousContent === null) {
        await fs.unlink(target).catch(() => {});
      } else {
        await fs.writeFile(target, entry.previousContent, "utf8");
      }
      restored.push(entry);
    }
    changeBatches.pop();
    // 保持原写入顺序以便重做
    undoneBatches.push(batch);
    return { success: true, entries: restored };
  } catch (err) {
    return { success: false, error: `撤销失败: ${err.message}` };
  }
}

/**
 * 重做（重新应用）最近一次已撤销的聊天更改
 * @returns {{ success: boolean, entries?: ChangeEntry[], error?: string }}
 */
export async function redoLastUndone() {
  if (undoneBatches.length === 0) {
    return { success: false, error: "没有可重做的更改" };
  }
  const toRedo = undoneBatches[undoneBatches.length - 1];
  const applied = [];
  try {
    for (const entry of toRedo) {
      const target = resolveSafePath(entry.filePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, entry.newContent, "utf8");
      applied.push(entry);
    }
    undoneBatches.pop();
    changeBatches.push(toRedo);
    return { success: true, entries: applied };
  } catch (err) {
    return { success: false, error: `重做失败: ${err.message}` };
  }
}

/**
 * 获取当前更改状态
 * @returns {{ hasChanges: boolean, changes: ChangeEntry[], canUndo: boolean, canRedo: boolean }}
 */
export function getChangeStatus() {
  const changes = changeBatches.flat();
  return {
    hasChanges: changeBatches.length > 0 || undoneBatches.length > 0,
    changes,
    canUndo: changeBatches.length > 0,
    canRedo: undoneBatches.length > 0,
  };
}

/** 清空更改历史 */
export function clearChangeHistory() {
  changeBatches = [];
  undoneBatches = [];
  pendingNewBatch = false;
}

/* ========== 工具函数 ========== */

export const listDir = tool(
  async ({ dir_path }) => {
    const target = resolveSafePath(dir_path || ".");
    const entries = await fs.readdir(target, { withFileTypes: true });
    const lines = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => `${e.isDirectory() ? "[dir] " : "[file]"} ${e.name}`);
    return lines.length
      ? `工作区: ${WORKSPACE_ROOT}\n目录: ${dir_path || "."}\n${lines.join("\n")}`
      : `(空目录) ${dir_path || "."}`;
  },
  {
    name: "list_dir",
    description:
      "列出工作区内某个目录的文件和子目录。路径相对于工作区根目录。",
    schema: z.object({
      dir_path: z
        .string()
        .optional()
        .describe("相对工作区的目录路径，默认为根目录 '.'"),
    }),
  },
);

export const readFile = tool(
  async ({ file_path }) => {
    const target = resolveSafePath(file_path);
    const content = await fs.readFile(target, "utf8");
    return content;
  },
  {
    name: "read_file",
    description: "读取工作区内某个文本文件的完整内容。路径相对于工作区根目录。",
    schema: z.object({
      file_path: z.string().describe("相对工作区的文件路径，例如 front/src/App.vue"),
    }),
  },
);

export const writeFile = tool(
  async ({ file_path, content }) => {
    const target = resolveSafePath(file_path);
    // 读取更改前的内容（如果文件存在）
    let previousContent = null;
    try {
      previousContent = await fs.readFile(target, "utf8");
    } catch {
      // 文件不存在，previousContent 保持 null
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    // 记录更改历史
    recordChange(file_path, previousContent, content);
    return `已写入: ${file_path}（${Buffer.byteLength(content, "utf8")} 字节）`;
  },
  {
    name: "write_file",
    description:
      "写入或覆盖工作区内的文本文件。会自动创建缺失的父目录。路径相对于工作区根目录。",
    schema: z.object({
      file_path: z.string().describe("相对工作区的文件路径"),
      content: z.string().describe("要写入的完整文件内容"),
    }),
  },
);

export const fileTools = [listDir, readFile, writeFile];
