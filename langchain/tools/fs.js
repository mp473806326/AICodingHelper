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
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
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
