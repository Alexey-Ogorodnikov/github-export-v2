/**
 * LinkedIn job search uses f_TPR for "date posted" (r = seconds, e.g. r604800 = 7 days).
 * Some LinkedIn alert links use f_TPR=a... which narrows to ~24h.
 */
export function rewriteLinkedInPostedDays(urlString, days) {
  if (!urlString || typeof days !== "number" || !Number.isFinite(days) || days <= 0) {
    return urlString;
  }
  try {
    const url = new URL(urlString);
    if (!/linkedin\.com/i.test(url.hostname)) return urlString;
    const pathname = url.pathname.toLowerCase();
    if (!pathname.includes("job")) return urlString;

    const seconds = Math.round(days * 86400);
    url.searchParams.set("f_TPR", `r${seconds}`);
    return url.toString();
  } catch {
    return urlString;
  }
}

export function applyLinkedInPostedDaysFromEnv(urlString) {
  const raw = process.env.LINKEDIN_JOB_POSTED_DAYS;
  if (raw === undefined || raw === "") return urlString;
  const days = Number.parseFloat(raw);
  if (!Number.isFinite(days) || days <= 0) return urlString;
  return rewriteLinkedInPostedDays(urlString, days);
}

/** LinkedIn f_WT: 1 = on-site, 2 = remote, 3 = hybrid */
const WORK_TYPE_TO_F_WT = {
  onsite: "1",
  remote: "2",
  hybrid: "3",
};

export const SEARCH_REGIONS = {
  quebec: { geoId: "102237789", label: "Québec" },
  canada: { geoId: "101174742", label: "Canada" },
};

const DEFAULT_GEO_ID = SEARCH_REGIONS.quebec.geoId;

function legacyRegionToFields(region) {
  const normalized = String(region || "").toLowerCase();
  if (normalized === "canada") return { country: "Canada", city: "" };
  if (normalized === "quebec") return { country: "Canada", city: "Québec" };
  return { country: "", city: "" };
}

/**
 * @param {{ city?: string, country?: string, region?: string }} opts
 */
export function formatSearchLocation({ city, country, region } = {}) {
  const cityTrim = String(city || "").trim();
  const countryTrim = String(country || "").trim();
  if (cityTrim && countryTrim) return `${cityTrim}, ${countryTrim}`;
  if (cityTrim) return cityTrim;
  if (countryTrim) return countryTrim;
  if (region) {
    return formatSearchLocation(legacyRegionToFields(region));
  }
  return "";
}

/**
 * @param {{ keywords: string, days?: number, workType?: string, geoId?: string, region?: string, city?: string, country?: string }} opts
 */
const F_WT_TO_WORK_TYPE = { "1": "onsite", "2": "remote", "3": "hybrid" };

/**
 * @param {string} urlString
 * @returns {string}
 */
export function canonicalizeLinkedInJobsSearchUrl(urlString) {
  const trimmed = String(urlString || "").trim();
  if (!trimmed) return "";
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return "";
  }
  if (!/linkedin\.com$/i.test(u.hostname)) return "";
  const pathLower = u.pathname.toLowerCase();
  if (!pathLower.includes("/jobs/search")) return "";

  if (/\/jobs\/search-results\b/i.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\/jobs\/search-results\/?/i, "/jobs/search/");
  }

  u.searchParams.delete("currentJobId");
  u.searchParams.delete("referralSearchId");
  u.searchParams.delete("skipRedirect");

  return u.toString();
}

/**
 * @param {string} urlString
 */
export function isLinkedInJobsSearchUrl(urlString) {
  return Boolean(canonicalizeLinkedInJobsSearchUrl(urlString));
}

/**
 * @param {string} fTpr
 * @returns {number|undefined}
 */
export function daysFromLinkedInFTpr(fTpr) {
  const raw = String(fTpr || "").trim();
  if (!raw) return undefined;
  if (/^a/i.test(raw)) return 1;
  const m = raw.match(/^r(\d+)$/i);
  if (!m) return undefined;
  const seconds = Number(m[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const days = Math.round(seconds / 86400);
  return [1, 2, 7].includes(days) ? days : days;
}

/**
 * @param {string} urlString
 */
function linkedInSearchParam(u, name) {
  const raw = u.searchParams.get(name);
  if (!raw) return "";
  return String(raw).replace(/\+/g, " ").trim();
}

export function parseLinkedInSearchUrl(urlString) {
  const url = canonicalizeLinkedInJobsSearchUrl(urlString);
  if (!url) {
    throw new Error("invalid LinkedIn search url");
  }
  const u = new URL(url);
  const keywords =
    linkedInSearchParam(u, "keywords") ||
    linkedInSearchParam(u, "keyword") ||
    linkedInSearchParam(u, "query") ||
    "";
  const locationParam = linkedInSearchParam(u, "location");
  const geoId = u.searchParams.get("geoId") || "";
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
  } else if (geoId) {
    const regionEntry = Object.values(SEARCH_REGIONS).find((r) => r.geoId === geoId);
    if (regionEntry) {
      country = regionEntry.label;
    }
  }
  const fWt = u.searchParams.get("f_WT") || "";
  const workType = F_WT_TO_WORK_TYPE[fWt] || "any";
  const daysRaw = daysFromLinkedInFTpr(u.searchParams.get("f_TPR") || "");
  const days = [1, 2, 7].includes(daysRaw) ? daysRaw : daysRaw ?? 1;
  return { keywords, days, workType, country, city, geoId, url };
}

export function buildLinkedInSearchUrl({
  keywords,
  days = 1,
  workType = "any",
  geoId,
  region,
  city,
  country,
}) {
  const trimmed = String(keywords || "").trim();
  if (!trimmed) {
    throw new Error("keywords required");
  }
  const safeDays = [1, 2, 7].includes(days) ? days : 1;
  const locationText = formatSearchLocation({ city, country, region });
  const url = new URL("https://www.linkedin.com/jobs/search/");
  url.searchParams.set("keywords", trimmed);
  if (locationText) {
    url.searchParams.set("location", locationText);
  } else {
    const normalizedRegion =
      String(region || "quebec").toLowerCase() === "canada" ? "canada" : "quebec";
    const resolvedGeoId =
      geoId || SEARCH_REGIONS[normalizedRegion]?.geoId || DEFAULT_GEO_ID;
    url.searchParams.set("geoId", String(resolvedGeoId));
  }
  url.searchParams.set("f_TPR", `r${Math.round(safeDays * 86400)}`);
  url.searchParams.set("origin", "JOB_SEARCH_PAGE_JOB_FILTER");
  url.searchParams.set("refresh", "true");
  const fWt = WORK_TYPE_TO_F_WT[String(workType || "any").toLowerCase()];
  if (fWt) {
    url.searchParams.set("f_WT", fWt);
  }
  return url.toString();
}
