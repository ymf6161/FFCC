import type { CategorisePayloadItem } from "./redact";
import type { AiProvider } from "./types";

/**
 * A deterministic stand-in for the AI, used in development and tests. It
 * recognises merchants from a keyword table (English and Hebrew) and gives
 * anything else a low-confidence guess, so the question flow is exercised.
 * It keeps every payload it receives, so tests can check what would leave the app.
 */

type Entry = { pattern: RegExp; category: string; confidence: number };

const TABLE: Entry[] = [
  { pattern: /\batm\b|cash withdrawal|cash machine/i, category: "Cash withdrawal", confidence: 93 },
  { pattern: /card payment$|payment received/i, category: "Credit card repayment", confidence: 86 },
  { pattern: /transfer|העברה|\btfr\b|top up/i, category: "Transfer", confidence: 85 },
  { pattern: /salary|payroll|wages|משכורת/i, category: "Salary", confidence: 97 },
  { pattern: /interest paid|interest/i, category: "Interest", confidence: 95 },
  { pattern: /mortgage|building soc|\bbs\b/i, category: "Mortgage", confidence: 96 },
  { pattern: /council tax/i, category: "Council tax", confidence: 97 },
  { pattern: /energy|electric|gas\b/i, category: "Energy", confidence: 93 },
  { pattern: /water/i, category: "Water", confidence: 93 },
  { pattern: /broadband|mobile|talkstar|linkwave|phone/i, category: "Broadband and phone", confidence: 92 },
  { pattern: /supermarket|grocer|bakery|kosher korner|kosher corner|freshways|greenleaf|מכולת/i, category: "Groceries", confidence: 92 },
  { pattern: /fuel|petrol|service station/i, category: "Fuel", confidence: 94 },
  { pattern: /subscription|streambox|cloudsafe|news digital/i, category: "Subscriptions", confidence: 91 },
  { pattern: /kidswear|clothing|little steps|shoes/i, category: "Clothing", confidence: 90 },
  { pattern: /homeware/i, category: "Household", confidence: 88 },
  { pattern: /tzedakah|tzedaka|chesed|charity|צדקה|תרומה|גמ״ח|גמ"ח|גמח/i, category: "Charity", confidence: 94 },
  // A fund or appeal might be charity, or might not: a guess, so the family is asked.
  { pattern: /קרן|fund|appeal/i, category: "Charity", confidence: 55 },
];

export function mockCategory(text: string): { category: string; confidence: number } {
  // A refund is sorted like the purchase it refunds, so refund words are ignored.
  const cleaned = text.replace(/\b(refund|rfnd|refunded)\b|החזר/gi, " ");
  const hit = TABLE.find((e) => e.pattern.test(cleaned));
  if (!hit) return { category: "Household", confidence: 35 };
  return { category: hit.category, confidence: hit.confidence };
}

export class MockAiProvider implements AiProvider {
  readonly name = "mock";
  readonly seenCategorise: CategorisePayloadItem[][] = [];
  readonly seenLookups: string[] = [];
  /** Set to make the provider fail, to test outages. */
  failWith: Error | null = null;

  async categoriseMerchants(items: CategorisePayloadItem[], categories: string[]): Promise<unknown> {
    this.seenCategorise.push(items);
    if (this.failWith) throw this.failWith;
    return {
      results: items.map((item) => {
        const guess = mockCategory(`${item.merchant} ${item.description}`);
        const category = categories.includes(guess.category) ? guess.category : (categories[0] ?? "Household");
        return { key: item.key, category, confidence: guess.confidence };
      }),
    };
  }

  async lookupMerchant(name: string): Promise<unknown> {
    this.seenLookups.push(name);
    if (this.failWith) throw this.failWith;
    const guess = mockCategory(name);
    const known = guess.confidence >= 80;
    return {
      isBusiness: known,
      canonicalName: name,
      suggestedCategory: known ? guess.category : null,
    };
  }
}
