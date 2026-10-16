/** `bun run fixtures`: writes the sample bank CSVs in fixtures/csv from tests/fixtures/csv-sources.ts. */
import { writeFileSync } from "node:fs";
import { FIXTURE_FILES, renderFixture } from "../tests/fixtures/csv-sources";

for (const f of FIXTURE_FILES) {
  writeFileSync(`fixtures/csv/${f.file}`, renderFixture(f));
  console.log(`wrote fixtures/csv/${f.file}`);
}
