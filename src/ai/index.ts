import { MockAiProvider } from "./mock";
import type { AiProvider } from "./types";

export { buildCategoriseItem, redactDescription, type CategorisePayloadItem } from "./redact";
export { MockAiProvider, mockCategory } from "./mock";
export * from "./types";

/**
 * The provider in use. Only the mock exists for now; the Claude provider is a
 * later phase and is never needed to run or test anything.
 */
export function getAiProvider(): AiProvider {
  const name = process.env.AI_PROVIDER ?? "mock";
  if (name === "mock") return new MockAiProvider();
  throw new Error(`AI provider "${name}" isn’t available yet. Leave AI_PROVIDER unset to use the built-in mock.`);
}
