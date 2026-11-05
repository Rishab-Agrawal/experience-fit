import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod";

const Family = z
  .enum(["software_engineering", "data_science", "product", "design", "other"])
  .describe(
    "software_engineering: building software (backend, frontend, mobile, infra, ML/data engineering, test automation). " +
      "data_science: analytics, data science, ML research. product: product/program management. " +
      "design: product/UX/visual design. other: anything else.",
  );

const Degree = z.enum(["none", "associate", "bachelors", "masters", "phd"]);

const Month = z.string().regex(/^\d{4}-\d{2}$/).describe("YYYY-MM");

export const Resume = z.object({
  highestDegree: Degree.describe("Highest degree completed"),
  positions: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      start: Month,
      end: Month.nullable().describe("YYYY-MM, or null for a current role"),
      kind: z.enum(["full_time", "contract", "part_time", "internship"]),
      family: Family,
    }),
  ),
});

export const Job = z.object({
  title: z.string(),
  family: Family,
  seniority: z.enum(["intern", "entry", "mid", "senior", "staff", "principal", "unspecified"]),
  experience: z
    .object({
      paths: z
        .array(z.object({ degree: Degree.describe("none = no degree condition"), minYears: z.number() }))
        .describe("Each way to qualify. '3+ years' → [{none, 3}]. 'BS + 5 years or MS + 3' → [{bachelors, 5}, {masters, 3}]."),
      maxYears: z.number().nullable().describe("Upper end of a range like '3-5 years', else null"),
      required: z.boolean().describe("false when phrased as preferred, ideally, or nice to have"),
      flexible: z
        .boolean()
        .describe(
          "The posting explicitly softens the years requirement: considers candidates with fewer years, " +
            "or encourages applying without meeting every requirement. " +
            "A degree replaceable by 'equivalent experience' is not flexibility on years.",
        ),
      quote: z.string().describe("The sentence from the posting that states the requirement, verbatim"),
    })
    .nullable()
    .describe("null when the posting states no years of experience"),
});

export type Resume = z.infer<typeof Resume>;
export type Job = z.infer<typeof Job>;

const client = new Anthropic();

async function extract<S extends z.ZodType>(
  schema: S,
  system: string,
  content: Anthropic.ContentBlockParam[],
): Promise<z.infer<S>> {
  const message = await client.messages.parse({
    model: "claude-haiku-5-5",
    max_tokens: 8000,
    output_config: { effort: "low", format: zodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content }],
  });
  if (!message.parsed_output) throw new Error(`Extraction failed: stop_reason ${message.stop_reason}`);
  return message.parsed_output;
}

export function extractResume(resume: { pdfBase64: string } | { text: string }): Promise<Resume> {
  return extract(
    Resume,
    "Extract the work history from this resume. Include jobs, internships, co-ops, contract work, and research or teaching assistantships. " +
      "Exclude education, personal projects, and volunteering. If a date has only a year, use January for a start and December for an end.",
    [
      "pdfBase64" in resume
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: resume.pdfBase64 } }
        : { type: "text", text: resume.text },
    ],
  );
}

export function extractJob(text: string): Promise<Job> {
  return extract(
    Job,
    "Extract the role and its years-of-experience requirement from this job posting. " +
      "Capture the overall requirement for the role, not per-skill ones: for '5+ years of software engineering, 2+ with Go', use 5.",
    [{ type: "text", text }],
  );
}
