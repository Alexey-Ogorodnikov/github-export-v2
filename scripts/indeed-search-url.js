/**
 * Indeed Canada job search URLs.
 * fromage = days since posted; sc=0kf:attr(DSQF7); = Remote filter.
 */
export const INDEED_CA_ORIGIN = "https://ca.indeed.com";
export const INDEED_REMOTE_SC = "0kf:attr(DSQF7);";

export function rewriteIndeedPostedDays(urlString, days) {
  if (!urlString || typeof days !== "number" || !Number.isFinite(days) || days <= 0) {
    return urlString;
  }
  try {
    const url = new URL(urlString);
    if (!/indeed\.com$/i.test(url.hostname)) return urlString;
    const pathname = url.pathname.toLowerCase();
    if (!pathname.includes("job")) return urlString;
    url.searchParams.set("fromage", String(Math.round(days)));
    return url.toString();
  } catch {
    return urlString;
  }
}

export function canonicalizeIndeedJobsSearchUrl(urlString) {
  const trimmed = String(urlString || "").trim();
  if (!trimmed) return "";
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return "";
  }
  if (!/indeed\.com$/i.test(u.hostname)) return "";
  const pathLower = u.pathname.toLowerCase();
  if (pathLower !== "/jobs" && !pathLower.startsWith("/jobs")) return "";
  return u.toString();
}

export function isIndeedJobsSearchUrl(urlString) {
  return Boolean(canonicalizeIndeedJobsSearchUrl(urlString));
}

function indeedSearchParam(u, name) {
  const raw = u.searchParams.get(name);
  if (!raw) return "";
  return String(raw).replace(/\+/g, " ").trim();
}

export function parseIndeedSearchUrl(urlString) {
  const url = canonicalizeIndeedJobsSearchUrl(urlString);
  if (!url) {
    throw new Error("invalid Indeed search url");
  }
  const u = new URL(url);
  const keywords = indeedSearchParam(u, "q") || indeedSearchParam(u, "query") || "";
  const locationParam = indeedSearchParam(u, "l") || indeedSearchParam(u, "location") || "";
  let country = "";
  let city = "";
  if (locationParam) {
    const parts = locationParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      city = parts[0];
      country = parts.slice(1).join(", ");
    } else if (parts.length === 1) {
      country = parts[0];
    }
  }
  const sc = indeedSearchParam(u, "sc");
  const workType = /attr\(DSQF7\)/i.test(sc) ? "remote" : "any";
  const fromage = Number.parseInt(u.searchParams.get("fromage") || "", 10);
  const days = [1, 2, 7].includes(fromage) ? fromage : Number.isFinite(fromage) && fromage > 0 ? fromage : 1;
  return { keywords, days, workType, country, city, url };
}

export function buildIndeedSearchUrl({
  keywords,
  days = 1,
  workType = "any",
  location = "",
  origin = INDEED_CA_ORIGIN,
}) {
  const trimmed = String(keywords || "").trim();
  if (!trimmed) {
    throw new Error("keywords required");
  }
  const safeDays = [1, 2, 7].includes(Number(days)) ? Number(days) : 1;
  const url = new URL("/jobs", origin);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("l", String(location || "").trim() || "Canada");
  url.searchParams.set("fromage", String(safeDays));
  url.searchParams.set("sort", "date");
  if (String(workType || "any").toLowerCase() === "remote") {
    url.searchParams.set("sc", INDEED_REMOTE_SC);
  }
  return url.toString();
}
