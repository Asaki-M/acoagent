import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import type { Vector } from "./utils/vector.js";

export type EmbeddingProvider = {
  name: string;
  isConfigured(): boolean;
  embed(text: string): Promise<Vector>;
};

export function createEmbeddingProvider(): EmbeddingProvider {
  const requested = process.env.TOOL_EMBEDDING_PROVIDER;
  const providers = [createOpenAIEmbeddingProvider(), createVertexEmbeddingProvider()];

  if (requested) {
    return providers.find((provider) => provider.name === requested) ?? createMissingEmbeddingProvider(requested);
  }

  return providers.find((provider) => provider.isConfigured()) ?? createMissingEmbeddingProvider("unconfigured");
}

function createOpenAIEmbeddingProvider(): EmbeddingProvider {
  return {
    name: "openai",
    isConfigured() {
      return Boolean(process.env.OPENAI_API_KEY);
    },
    async embed(text: string) {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is required for OpenAI tool embeddings.");
      }

      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await client.embeddings.create({
        model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
        input: text,
        encoding_format: "float",
      });

      return response.data[0]?.embedding ?? [];
    },
  };
}

function createVertexEmbeddingProvider(): EmbeddingProvider {
  const project = process.env.VERTEX_AI_PROJECT;
  const location = process.env.VERTEX_AI_LOCATION || "us-central1";

  return {
    name: "vertex",
    isConfigured() {
      return Boolean(project);
    },
    async embed(text: string) {
      if (!project) {
        throw new Error("VERTEX_AI_PROJECT is required for Vertex tool embeddings.");
      }

      const client = new GoogleGenAI({
        enterprise: true,
        project,
        location,
      });
      const response = await client.models.embedContent({
        model: process.env.VERTEX_AI_EMBEDDING_MODEL || "text-embedding-004",
        contents: text,
      });

      return response.embeddings?.[0]?.values ?? [];
    },
  };
}

function createMissingEmbeddingProvider(name: string): EmbeddingProvider {
  return {
    name,
    isConfigured() {
      return false;
    },
    async embed() {
      throw new Error(
        "Tool vector search requires embeddings. Configure OPENAI_API_KEY or VERTEX_AI_PROJECT, or set TOOL_EMBEDDING_PROVIDER.",
      );
    },
  };
}
