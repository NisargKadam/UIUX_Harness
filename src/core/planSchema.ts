/** Shared zod schemas for plans and saved prototype state. */
import { z } from "zod";

export const planSchema = z.object({
  prototypeName: z.string().describe('Short kebab-case folder name, e.g. "account-settings".'),
  title: z.string(),
  summary: z.string().describe("One or two sentences in plain language."),
  screens: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        route: z.string().describe('Hash route, e.g. "/settings/profile".'),
        purpose: z.string(),
        components: z.array(z.string()).describe("Catalogue components this screen uses."),
      }),
    )
    .min(1),
  flow: z.array(z.object({ from: z.string(), action: z.string(), to: z.string() })),
  missingComponents: z
    .array(
      z.object({
        need: z.string(),
        usingInstead: z.string(),
        reason: z.string(),
        screens: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  assumptions: z.array(z.string()).default([]),
});

/** A saved .harness/state.json. Anything that does not match is ignored rather than trusted. */
export const prototypeRecordSchema = z.object({
  name: z.string(),
  brief: z.string(),
  figmaUrl: z.string().optional(),
  plan: planSchema.optional(),
  missingComponents: planSchema.shape.missingComponents,
  feedback: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
