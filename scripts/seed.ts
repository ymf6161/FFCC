import { createDb } from "@/db";
import { ukDate } from "@/lib/time";
import { seedDatabase } from "@/seed";

const db = await createDb();
const result = await seedDatabase(db, { endDate: ukDate() });
console.log(
  `Seeded the demo household: ${result.transactionCount} transactions from ${result.startDate} to ${result.endDate}.`,
);
