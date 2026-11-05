export class InputError extends Error {}

// Server-side fetch of user URLs: allowlisted ATS hosts only, checked on every redirect hop.
const ATS_HOSTS = ["ashbyhq.com", "greenhouse.io", "lever.co", "workable.com", "smartrecruiters.com"];

export async function fetchJobText(url: string): Promise<string> {
  for (let hop = 0; hop < 5; hop++) {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:" || !ATS_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
      throw new InputError(`Links are supported for ${ATS_HOSTS.join(", ")}. Paste the posting text instead.`);
    }
    const res = await fetch(url, { redirect: "manual" });
    const location = res.headers.get("location");
    if (location) {
      url = new URL(location, url).href;
      continue;
    }
    if (!res.ok) throw new InputError(`Fetching the posting failed: HTTP ${res.status}`);
    return htmlToText(await res.text());
  }
  throw new InputError("Too many redirects");
}

// Prefers the schema.org JobPosting most ATS pages embed; falls back to the page text.
export function htmlToText(html: string): string {
  for (const [, json] of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(json);
      if (data["@type"] === "JobPosting") return stripTags(`${data.title}\n${data.description}`);
    } catch {}
  }
  return stripTags(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ""));
}

function stripTags(html: string): string {
  return html
    .replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
