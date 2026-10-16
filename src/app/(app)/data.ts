import "server-only";
import { cache } from "react";
import { getDb } from "@/db";
import { countOpenQuestions } from "@/db/queries";

/** Open question count, fetched once per request and shared by the layout and pages. */
export const getOpenQuestionCount = cache(async (householdId: string) => countOpenQuestions(await getDb(), householdId));
