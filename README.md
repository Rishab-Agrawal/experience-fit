# Experience fit

Scores how well a resume's years of experience fit a job posting, accounting for how postings are written: a "3–5 years" range can still consider 2, "5+ preferred" is softer than "5+ required", "BS + 5 or MS + 3" depends on your degree, and "exceptional candidates with fewer years will be considered" means what it says.

## How it works

```
resume ──LLM──▶ positions (dates, type, role family), degree ─┐
                                                              ├─▶ deterministic score + reasons
job    ──LLM──▶ role family, seniority, requirement paths ────┘
```

The LLM (Claude Haiku 5.5) only extracts facts, with structured outputs (`src/extract.ts`). Plain code computes the score (`src/score.ts`). That split matters at scale:

- **Cost is O(resumes + jobs), not O(resumes × jobs).** Each posting is extracted once when it is ingested; scoring a user against the whole feed costs nothing.
- **Reproducible and explainable.** The same inputs always give the same score, and every score comes with the reasons behind it.
- **Tunable without prompting.** The curve is a few constants, ready to fit to outcome data.

### Scoring rules

- **Relevant years.** Only roles in the job's family count (software engineering, data science, product, design). Overlapping roles count once per month. Part-time roles count half. Internships count only when the posting says they do, and so do roles started during a bachelor's or master's, except in the degree's final year; a job held before enrolling counts in full. Year-only degree dates are read as the shortest program they allow, and without degree dates this rule is skipped.
- **Requirement.** Takes the lowest bar among the degree paths the candidate qualifies for. With no stated years, a range is assumed from the title (for example, 5+ for senior). An entry-level title also caps a bare "0+ years".
- **Shortfall.** Measured relative to the requirement (1 year short of 2 is worse than 1 short of 8) and penalized quadratically. Small gaps cost little; large ones cost a lot. Tolerance widens for "preferred" and again for postings that state flexibility.
- **Overqualification.** Penalized more gently than a shortfall.

| Candidate | Posting | Score |
|---|---|---|
| 2 years | 3–5 years, required | 69 |
| 3 years | 5+ years, required | 56 |
| 3 years | 5+ years, flexible | 80 |
| 3 years, MS | BS + 5 or MS + 3 | 100 |
| 1 year | "Senior Engineer", no years stated | 21 |
| 6 years | 3–5 years | 98 |

## Eval

`eval/cases.json` holds the posting phrasings that break naive parsing: ranges, "ideally", degree paths, title-only, new grad, "equivalent practical experience" (a degree substitution, not flexibility on years), per-skill sub-requirements, "apply even if you don't meet every requirement", and whether internships count. It also checks that the quoted requirement really appears in the posting.

Haiku 5.5 passes 14/14. Sonnet 5.5 matched it on the first 11 cases and on a test resume, at about 20 times the cost.

```
npm run eval
```

## Calibration

The tolerances in `src/score.ts` are hand-set priors. Fitting the curve to reply and interview rates by experience gap would turn this from a reasonable heuristic into a measured one. The same data would also show where a match threshold should sit.

## Run it

Requires Node 22.18+ (runs TypeScript directly).

```
npm install
echo "ANTHROPIC_API_KEY=..." > .env
npm run dev        # http://localhost:3000
npm test           # scoring unit tests
npm run check      # typecheck
```

API: `POST /api/match` with `{ resumeText | resumePdf (base64), jobText | jobUrl }`. The demo allows 30 checks per day in total.

## Not covered

- Per-skill years ("3+ years of Go") are not scored. That needs skill tags per position.
- Job links work for ATS pages that serve the posting in HTML (Ashby, Greenhouse, Lever, Workable, SmartRecruiters). For anything else, paste the text.
