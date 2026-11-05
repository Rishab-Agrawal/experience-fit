import { isDeepStrictEqual } from "node:util";
import { extractJob } from "../src/extract.ts";
import cases from "./cases.json" with { type: "json" };

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const results = await Promise.all(
  cases.map(async ({ name, text, expect }) => {
    const job = await extractJob(text);
    const exp = job.experience;
    const got: Record<string, unknown> = {
      family: job.family,
      seniority: job.seniority,
      experience: exp,
      paths: exp?.paths.toSorted((a, b) => b.minYears - a.minYears),
      minYears: exp && Math.max(...exp.paths.map((p) => p.minYears)),
      maxYears: exp?.maxYears,
      required: exp?.required,
      flexible: exp?.flexible,
      countsInternships: exp?.countsInternships,
    };
    const misses = Object.entries(expect)
      .filter(([k, v]) => !isDeepStrictEqual(got[k], v))
      .map(([k, v]) => `${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(got[k])}`);
    if (exp && !squash(text).includes(squash(exp.quote))) misses.push(`quote not in posting: ${exp.quote}`);
    console.log(`${misses.length ? "FAIL" : "pass"}  ${name}`);
    for (const miss of misses) console.log(`      ${miss}`);
    return !misses.length;
  }),
);

console.log(`\n${results.filter(Boolean).length}/${results.length} cases pass`);
