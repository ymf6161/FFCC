import { z } from "zod";
import type { CategorisePayloadItem } from "./redact";

/** All AI work goes through a provider. Tests and development use the mock. */
export interface AiProvider {
  readonly name: string;
  /** One call per batch of unique merchants. Output is unvalidated; callers parse it. */
  categoriseMerchants(items: CategorisePayloadItem[], categories: string[]): Promise<unknown>;
  /** Web lookup of a normalised merchant name (nothing else is sent). */
  lookupMerchant(name: string): Promise<unknown>;
}

export const categoriseResponseSchema = z.object({
  results: z.array(
    z.object({
      key: z.string(),
      category: z.string(),
      confidence: z.number().int().min(0).max(100),
    }),
  ),
});
export type CategoriseResult = z.infer<typeof categoriseResponseSchema>["results"][number];

export const lookupResponseSchema = z.object({
  isBusiness: z.boolean(),
  canonicalName: z.string().min(1).max(120),
  suggestedCategory: z.string().max(80).nullable(),
});
export type LookupResult = z.infer<typeof lookupResponseSchema>;

export class AiUnavailableError extends Error {
  constructor(message = "The AI service didn’t answer.") {
    super(message);
    this.name = "AiUnavailableError";
  }
}
