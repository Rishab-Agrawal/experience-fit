import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { json } from "node:stream/consumers";
import * as z from "zod";
import { extractJob, extractResume } from "./extract.ts";
import { fetchJobText, InputError } from "./job-page.ts";
import { match } from "./score.ts";

const MAX_BODY = 3 * 1024 * 1024; // a ~2 MB PDF once base64-encoded
const MAX_TEXT = 50_000;
const DAILY = 30;

const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const scriptHash = createHash("sha256").update(page.match(/<script>([\s\S]*?)<\/script>/)![1]).digest("base64");
const pageHeaders = {
  "content-type": "text/html",
  "content-security-policy":
    `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline' https://fonts.googleapis.com; ` +
    "font-src https://fonts.gstatic.com; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const Body = z
  .object({ resumePdf: z.string(), resumeText: z.string().max(MAX_TEXT), jobUrl: z.string().max(2000), jobText: z.string().max(MAX_TEXT) })
  .partial()
  .refine((b) => (b.resumePdf || b.resumeText) && (b.jobUrl || b.jobText), "Provide a resume and a job posting");

// ponytail: in-memory counter for one instance, reset on redeploy. Move to Redis if this runs on several instances.
let hitsToday = 0;
setInterval(() => (hitsToday = 0), 24 * 60 * 60 * 1000).unref();

const send = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { "content-type": "application/json", "x-content-type-options": "nosniff" }).end(JSON.stringify(body));

/** Messages the owner on Telegram when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set. */
const notify = (text: string) => {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: text.slice(0, 4096) }),
  })
    .then(async (r) => r.ok || console.error("Telegram", r.status, await r.text()))
    .catch(console.error);
};

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") return res.writeHead(200, pageHeaders).end(page);
  if (req.method !== "POST" || req.url !== "/api/match") return res.writeHead(404).end();

  // Railway's proxy sets x-real-ip to the client address.
  const ip = String(req.headers["x-real-ip"] ?? req.socket.remoteAddress);
  const fail = (status: number, error: string) => {
    send(res, status, { error });
    notify(`${ip}\n${status}: ${error}`);
  };
  if (!(Number(req.headers["content-length"]) <= MAX_BODY)) return fail(413, "Upload a PDF under 2 MB");

  try {
    const body = Body.parse(await json(req));
    if (hitsToday >= DAILY) return fail(429, "The demo's daily limit is used up. Try again tomorrow, or run it locally.");
    hitsToday++;

    const jobText = body.jobText || (await fetchJobText(body.jobUrl!));
    if (jobText.length > MAX_TEXT) throw new InputError("That posting page is too long. Paste the posting text instead.");
    const [resume, job] = await Promise.all([
      extractResume(body.resumePdf ? { pdfBase64: body.resumePdf } : { text: body.resumeText! }),
      extractJob(jobText),
    ]);
    const result = match(resume, job);
    send(res, 200, result);
    notify(
      [
        ip,
        `${result.score}% for ${job.title}${body.jobUrl ? `, ${body.jobUrl}` : ""}`,
        ...result.reasons,
        "",
        ...result.positions.map((p) => `${p.title}, ${p.company}, ${p.start} to ${p.end ?? "now"}: ${p.counted}`),
      ].join("\n"),
    );
  } catch (e) {
    const userError = e instanceof InputError || e instanceof z.ZodError || e instanceof SyntaxError || e instanceof Anthropic.BadRequestError;
    if (!userError) console.error(e);
    const message = e instanceof z.ZodError ? z.prettifyError(e) : userError ? (e as Error).message : "Something went wrong";
    fail(userError ? 400 : 500, message);
  }
}).listen(Number(process.env.PORT ?? 3000));
