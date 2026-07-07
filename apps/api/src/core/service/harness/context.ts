import type { ChatRequestBody, CodeFile } from "../../types/chat.js";
import type { ModelMessage, ModelProviderName, ModelRequest } from "./types.js";
import { buildMemorySystemInstruction } from "../../memory/tools.js";

const MAX_FILE_CHARS = 12_000;

// 将前端传入的文件压缩成模型可读的上下文片段，并限制单文件长度。
function compactFiles(files: CodeFile[]) {
  if (!files.length) {
    return "No project files were provided.";
  }

  return files
    .map((file) =>
      [
        `### ${file.path}`,
        `Language: ${file.language}`,
        "```",
        file.content.slice(0, MAX_FILE_CHARS),
        "```",
      ].join("\n"),
    )
    .join("\n\n");
}

// 将 HTTP chat 请求组装成统一的模型请求，包括记忆、文件上下文和模型参数。
export function buildCodeQuestionRequest(
  body: ChatRequestBody,
  memory?: {
    shortTermMessages?: ModelMessage[];
    workMemory?: string;
  },
): ModelRequest {
  const provider = normalizeProvider(body.provider ?? process.env.MODEL_PROVIDER ?? "vertex");
  const projectName = body.projectName || "Local project";
  const projectPath = body.projectPath || projectName;
  const sessionId = body.sessionId || "default";
  const question = body.question?.trim() ?? "";
  const files = body.files ?? [];
  const model = body.model || defaultModelFor(provider);

  const messages: ModelMessage[] = [
    {
      role: "system",
      content:
        [
          "You are an expert codebase assistant. Answer from the provided local project files. Be precise, cite file paths when useful, and say when the provided context is insufficient.",
          buildMemorySystemInstruction(memory?.workMemory ?? ""),
        ].join("\n\n"),
    },
    ...(memory?.shortTermMessages ?? []),
    {
      role: "user",
      content: [
        `Project: ${projectName}`,
        `Question: ${question}`,
        "Relevant files:",
        compactFiles(files),
      ].join("\n\n"),
    },
  ];

  return {
    provider,
    model,
    projectName,
    projectPath,
    sessionId,
    question,
    files,
    messages,
    temperature: Number(process.env.MODEL_TEMPERATURE ?? 0.2),
    maxOutputTokens: Number(process.env.MODEL_MAX_OUTPUT_TOKENS ?? 2048),
  };
}

// 归一化 provider 名称，非法值回退到 Vertex。
function normalizeProvider(provider: string): ModelProviderName {
  if (provider === "openai" || provider === "mock" || provider === "vertex") {
    return provider;
  }
  return "vertex";
}

// 根据 provider 选择默认模型，允许环境变量覆盖。
function defaultModelFor(provider: ModelProviderName) {
  if (provider === "openai") return process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (provider === "mock") return "mock-code-assistant";
  return process.env.VERTEX_AI_MODEL || "gemini-2.5-flash";
}
