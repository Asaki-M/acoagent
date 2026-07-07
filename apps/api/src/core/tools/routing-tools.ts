import { z } from "zod";
import { createTool, jsonObjectSchema } from "./adapters.js";
import type { RegisteredTool } from "./types.js";
import type { ToolPool } from "./pool.js";

const searchToolsParameters = z
  .object({
    query: z.string().min(1),
    topK: z.number().int().positive().max(20).optional(),
  })
  .strict();

const callToolParameters = z
  .object({
    name: z.string().min(1),
    arguments: jsonObjectSchema.optional(),
  })
  .strict();

// 创建给模型使用的工具路由工具：先搜索工具，再按名称调用工具。
export function createToolRoutingTools(toolPool: ToolPool): RegisteredTool[] {
  return [
    createTool({
      name: "searchTools",
      description:
        "Search the tool pool for tools relevant to a user goal. Returns the top matching tools and their schemas.",
      parameters: searchToolsParameters,
      outputSchema: z.object({
        tools: z.array(
          z.object({
            name: z.string(),
            description: z.string(),
            inputSchema: jsonObjectSchema,
            outputSchema: jsonObjectSchema,
            source: jsonObjectSchema,
            tags: z.array(z.string()).optional(),
            score: z.number(),
          }),
        ),
      }),
      source: {
        type: "builtin",
        id: "tool-routing",
        label: "Tool Routing",
      },
      tags: ["tool-routing", "search"],
      async execute(args) {
        const input = searchToolsParameters.parse(args);
        return {
          tools: await toolPool.searchTools(input.query, input.topK),
        };
      },
    }),
    createTool({
      name: "callTool",
      description: "Call a selected tool from the tool pool by name with validated JSON arguments.",
      parameters: callToolParameters,
      source: {
        type: "builtin",
        id: "tool-routing",
        label: "Tool Routing",
      },
      tags: ["tool-routing", "call"],
      async execute(args, context) {
        const input = callToolParameters.parse(args);
        return toolPool.callTool(input.name, input.arguments ?? {}, context);
      },
    }),
  ];
}
