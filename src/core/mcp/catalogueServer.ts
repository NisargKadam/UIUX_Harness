/**
 * The built-in component catalogue served as an in-process MCP server. The agent
 * uses the same catalogue__* tool interface whether the data comes from this
 * indexer or from Storybook. Swapping the source needs no prompt change.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Catalogue } from "../catalogue/types";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

export function createCatalogueServer(getCatalogue: () => Catalogue): McpServer {
  const server = new McpServer({ name: "uiux-harness-catalogue", version: "0.1.0" });

  server.registerTool(
    "list_components",
    {
      description:
        "List every component in the team's library with a one-line description, category and prop names. Call this before mapping a screen to components.",
      inputSchema: { category: z.string().optional().describe("Only components in this category, e.g. Inputs") },
    },
    async ({ category }) => {
      const cat = getCatalogue();
      const items = cat.components
        .filter((c) => !category || c.category?.toLowerCase() === category.toLowerCase())
        .map((c) => ({ name: c.name, category: c.category, description: c.description, props: c.props.map((p) => p.name) }));
      return json({ importFrom: cat.importFrom, components: items });
    },
  );

  server.registerTool(
    "get_component",
    {
      description:
        "Full details for one component: every prop with type, required flag, allowed values, default and description, plus usage examples. Check this before using a component's props.",
      inputSchema: { name: z.string().describe("Component name, e.g. Button") },
    },
    async ({ name }) => {
      const cat = getCatalogue();
      const found = cat.components.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (!found) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `No component named "${name}". Available: ${cat.components.map((c) => c.name).join(", ")}. If none fits, use the closest primitive and record a missing component.`,
            },
          ],
        };
      }
      return json({ importFrom: cat.importFrom, ...found });
    },
  );

  server.registerTool(
    "list_tokens",
    {
      description: "Design tokens (CSS custom properties or token objects) with their values, optionally filtered by group (color, space, radius, font, shadow).",
      inputSchema: { group: z.string().optional() },
    },
    async ({ group }) => {
      const tokens = getCatalogue().tokens.filter((t) => !group || t.group === group);
      return json(tokens.map(({ name, value, group: g }) => ({ name, value, group: g })));
    },
  );

  return server;
}
