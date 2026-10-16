import { createDb } from "@/db";
import { ukDate } from "@/lib/time";
import { findDemoMembership, seedDatabase } from "@/seed";

const db = await createDb();
if (await findDemoMembership(db)) {
  console.log("The demo household is already seeded. Run bun run setup to rebuild the database.");
  process.exit(0);
}
const result = await seedDatabase(db, { endDate: ukDate() });
console.log(
  `Seeded the demo household: ${result.transactionCount} transactions from ${result.startDate} to ${result.endDate}.`,
);
