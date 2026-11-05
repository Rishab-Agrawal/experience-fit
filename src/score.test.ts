import assert from "node:assert/strict";
import { test } from "node:test";
import type { Job, Resume } from "./extract.ts";
import { htmlToText } from "./job-page.ts";
import { match, yearsOfExperience } from "./score.ts";

const now = new Date(2026, 10, 15); // Nov 2026

const swe = (start: string, end: string | null, kind: Resume["positions"][number]["kind"] = "full_time") =>
  ({ title: "Engineer", company: "Acme", start, end, kind, family: "software_engineering" }) as const;

const resume = (years: number, highestDegree: Resume["highestDegree"] = "bachelors"): Resume => ({
  highestDegree,
  positions: [swe(`${2026 - years}-12`, null)],
});

const job = (experience: Partial<NonNullable<Job["experience"]>> | null, seniority: Job["seniority"] = "unspecified"): Job => ({
  title: "Software Engineer",
  family: "software_engineering",
  seniority,
  experience: experience && {
    paths: [{ degree: "none", minYears: 3 }],
    maxYears: null,
    required: true,
    flexible: false,
    quote: "",
    ...experience,
  },
});

const score = (r: Resume, j: Job) => match(r, j, now).score;

test("overlapping roles count once, internships half, current roles up to now", () => {
  const positions = [swe("2024-01", "2024-12"), swe("2024-07", "2025-06"), swe("2023-01", "2023-12", "internship"), swe("2026-06", null)];
  // 2024-01..2025-06 = 18 months, internship 12 × 0.5 = 6, 2026-06..2026-11 = 6 → 30 months
  assert.equal(yearsOfExperience(positions, now), 2.5);
});

test("only roles in the job's family count as relevant", () => {
  const r: Resume = { highestDegree: "bachelors", positions: [swe("2024-12", null), { ...swe("2020-11", "2024-10"), family: "design" }] };
  const m = match(r, job({ paths: [{ degree: "none", minYears: 2 }] }), now);
  assert.deepEqual([m.years, m.totalYears, m.score], [2, 6, 100]);
});

test("within range scores 100; shortfalls are soft and ordered by strictness", () => {
  assert.equal(score(resume(4), job({ maxYears: 5 })), 100);
  assert.equal(score(resume(2), job({ maxYears: 5 })), 69); // 2 for "3–5 years"
  const five = { paths: [{ degree: "none" as const, minYears: 5 }] };
  const required = score(resume(3), job(five));
  const preferred = score(resume(3), job({ ...five, required: false }));
  const flexible = score(resume(3), job({ ...five, flexible: true }));
  assert.ok(required < preferred && required < flexible, `${required} ${preferred} ${flexible}`);
  assert.equal(score(resume(0), job({})), 0);
});

test("a qualifying degree path lowers the bar", () => {
  const paths = [{ degree: "bachelors" as const, minYears: 5 }, { degree: "masters" as const, minYears: 3 }];
  assert.equal(score(resume(3, "masters"), job({ paths })), 100);
  assert.ok(score(resume(3, "bachelors"), job({ paths })) < 100);
  assert.ok(score(resume(3, "none"), job({ paths })) < 100);
});

test("no stated years falls back to the title; entry titles cap a bare minimum", () => {
  assert.ok(score(resume(1), job(null, "senior")) < 50);
  assert.equal(score(resume(6), job(null, "senior")), 100);
  assert.ok(score(resume(8), job({ paths: [{ degree: "none", minYears: 0 }] }, "entry")) < 50);
  assert.equal(score(resume(6), job({ maxYears: 5 })), 98); // slightly over is fine
});

test("htmlToText prefers the JobPosting JSON-LD", () => {
  const html = `<html><script type="application/ld+json">{"@type":"JobPosting","title":"SWE","description":"<p>3+ years &amp; Go</p>"}</script><body>nav junk</body></html>`;
  assert.equal(htmlToText(html), "SWE\n3+ years & Go");
  assert.equal(htmlToText("<style>x{}</style><p>Hello</p><p>World</p>"), "Hello\nWorld");
});
