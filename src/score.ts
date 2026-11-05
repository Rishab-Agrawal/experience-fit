import type { Job, Resume } from "./extract.ts";

type Position = Resume["positions"][number];
type Degree = Resume["highestDegree"];

// ponytail: hand-set priors. Calibrate against reply/interview rates per experience gap once outcome data is joined in.
const KIND_WEIGHT: Record<Position["kind"], number> = { full_time: 1, contract: 1, part_time: 0.5, internship: 0.5 };
const UNDER_TOLERANCE = { required: 0.6, preferred: 0.9, flexibleBonus: 0.3 };
const OVER_TOLERANCE = 1.5;

// Applied when the posting states no years, and as the cap when it states only a minimum.
const IMPLIED_RANGE: Record<Job["seniority"], [min: number, max: number | null]> = {
  intern: [0, 1],
  entry: [0, 2],
  mid: [2, 5],
  senior: [5, null],
  staff: [8, null],
  principal: [10, null],
  unspecified: [0, null],
};

const DEGREES: Degree[] = ["none", "associate", "bachelors", "masters", "phd"];

const toMonth = (yyyyMm: string) => {
  const [y, m] = yyyyMm.split("-").map(Number);
  return y * 12 + m - 1;
};
const formatMonth = (m: number) =>
  new Date(Math.floor(m / 12), m % 12).toLocaleString("en-US", { month: "short", year: "numeric" });
const currentMonth = (now: Date) => now.getFullYear() * 12 + now.getMonth();
const endMonth = (p: Position, now: Date) => Math.min(p.end ? toMonth(p.end) : currentMonth(now), currentMonth(now));

/**
 * A role started during a bachelor's or master's counts as an internship until the degree's final year.
 * Returns the last such month, or -Infinity. A role held before enrolling counts as stated.
 */
function studentUntil(p: Position, education: Resume["education"]): number {
  const start = toMonth(p.start);
  return Math.max(
    ...education
      .filter((e) => (e.degree === "bachelors" || e.degree === "masters") && toMonth(e.start) <= start)
      .map((e) => toMonth(e.end) - 12),
  );
}

/** Experience-weighted years, counting each calendar month once even when roles overlap. */
export function yearsOfExperience(positions: Position[], education: Resume["education"], now = new Date()): number {
  const months = new Map<number, number>();
  for (const p of positions) {
    const until = studentUntil(p, education);
    for (let m = toMonth(p.start), end = endMonth(p, now); m <= end; m++) {
      months.set(m, Math.max(months.get(m) ?? 0, KIND_WEIGHT[m <= until ? "internship" : p.kind]));
    }
  }
  return [...months.values()].reduce((a, b) => a + b, 0) / 12;
}

export function match(resume: Resume, job: Job, now = new Date()) {
  const isRelevant = (p: Position) => job.family === "other" || p.family === job.family;
  const totalYears = yearsOfExperience(resume.positions, resume.education, now);
  const years = yearsOfExperience(resume.positions.filter(isRelevant), resume.education, now);
  const exp = job.experience?.paths.length ? job.experience : null;
  const [impliedMin, impliedMax] = IMPLIED_RANGE[job.seniority];

  // The candidate meets the lowest bar among paths their degree qualifies for, else the lowest-degree path.
  const rank = (d: Degree) => DEGREES.indexOf(d);
  const paths = (exp?.paths ?? []).toSorted((a, b) => rank(a.degree) - rank(b.degree));
  const eligible = paths.filter((p) => rank(p.degree) <= rank(resume.highestDegree));
  const minYears = exp ? Math.min(...(eligible.length ? eligible : paths.slice(0, 1)).map((p) => p.minYears)) : impliedMin;
  const maxYears = exp?.maxYears ?? impliedMax;

  let tolerance = exp?.required ? UNDER_TOLERANCE.required : UNDER_TOLERANCE.preferred;
  if (exp?.flexible) tolerance += UNDER_TOLERANCE.flexibleBonus;

  // Gaps are relative (1 year short of 2 hurts more than of 8), floored at 2 years so tiny minimums don't explode.
  let fit = 1;
  if (years < minYears) fit = 1 - ((minYears - years) / Math.max(minYears, 2) / tolerance) ** 2;
  else if (maxYears !== null && years > maxYears) fit = 1 - ((years - maxYears) / Math.max(maxYears, 2) / OVER_TOLERANCE) ** 2;

  return {
    score: Math.round(100 * Math.max(0, fit)),
    years: round(years),
    totalYears: round(totalYears),
    minYears,
    maxYears,
    reasons: explain(),
    positions: resume.positions.map((p) => ({ ...p, counted: counted(p) })),
  };

  function counted(p: Position): string {
    if (!isRelevant(p)) return `No, ${p.family.replace("_", " ")}`;
    if (p.kind === "internship" || p.kind === "part_time") return `Half, ${p.kind.replace("_", "-")}`;
    const until = studentUntil(p, resume.education);
    if (until < toMonth(p.start)) return "Yes";
    return endMonth(p, now) <= until ? "Half, while studying" : `Half while studying, full from ${formatMonth(until + 1)}`;
  }

  function explain(): string[] {
    const asked = paths[0]?.minYears ?? minYears;
    const range = maxYears === null ? `${asked}+` : `${asked}–${maxYears}`;
    const reasons = [
      `${formatYears(years)} of relevant (${job.family.replace("_", " ")}) experience` +
        (totalYears > years ? `, ${formatYears(totalYears)} total.` : "."),
      exp
        ? `Posting asks for ${range} years (${exp.required ? "required" : "preferred"}): “${exp.quote}”`
        : `No years stated; assuming ${range} years for a ${job.seniority} title.`,
    ];
    if (exp && minYears < paths[0].minYears) {
      reasons.push(`Your ${resume.highestDegree} degree lowers the bar to ${formatYears(minYears)}.`);
    }
    if (exp?.flexible) reasons.push("The posting says it is flexible on experience.");
    if (years < minYears) reasons.push(`${formatYears(minYears - years)} short.`);
    else if (maxYears !== null && years > maxYears) reasons.push(`${formatYears(years - maxYears)} above the range.`);
    else reasons.push("Within range.");
    return reasons;
  }
}

const round = (n: number) => Math.round(n * 10) / 10;
const formatYears = (n: number) => `${round(n)} ${round(n) === 1 ? "year" : "years"}`;
