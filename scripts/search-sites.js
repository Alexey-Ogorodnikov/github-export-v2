import {
  buildLinkedInSearchUrl,
  formatSearchLocation,
  isLinkedInJobsSearchUrl,
  parseLinkedInSearchUrl,
  rewriteLinkedInPostedDays,
} from "./linkedin-search-url.js";
import {
  buildIndeedSearchUrl,
  INDEED_CA_ORIGIN,
  isIndeedJobsSearchUrl,
  parseIndeedSearchUrl,
  rewriteIndeedPostedDays,
} from "./indeed-search-url.js";

/** @typedef {{ id: string, label: string, origin: string }} SearchSite */

/** @type {SearchSite[]} */
export const AVAILABLE_SEARCH_SITES = [
  { id: "linkedin", label: "LinkedIn", origin: "https://www.linkedin.com" },
  { id: "indeed-ca", label: "Indeed Canada", origin: INDEED_CA_ORIGIN },
];

export const DEFAULT_SEARCH_SITE_IDS = AVAILABLE_SEARCH_SITES.map((site) => site.id);

const LINKEDIN_GEO_TO_INDEED_LOCATION = {
  "101174742": "Canada",
  "102237789": "Québec",
  "101330853": "Montreal, QC",
};

export function normalizeSearchSiteIds(raw) {
  const allowed = new Set(AVAILABLE_SEARCH_SITES.map((site) => site.id));
  if (!Array.isArray(raw)) {
    return [...DEFAULT_SEARCH_SITE_IDS];
  }
  const seen = new Set();
  const next = [];
  for (const item of raw) {
    const id = String(item || "").trim();
    if (!allowed.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    next.push(id);
  }
  return next.length ? next : [...DEFAULT_SEARCH_SITE_IDS];
}

function searchParamsFromUrl(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    return null;
  }
  if (isLinkedInJobsSearchUrl(trimmed)) {
    try {
      return parseLinkedInSearchUrl(trimmed);
    } catch {
      return null;
    }
  }
  if (isIndeedJobsSearchUrl(trimmed)) {
    try {
      return parseIndeedSearchUrl(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

function indeedLocationFromParams(params) {
  const formatted = formatSearchLocation({
    city: params.city,
    country: params.country,
  });
  if (formatted) {
    return formatted;
  }
  const geoId = String(params.geoId || "").trim();
  if (geoId && LINKEDIN_GEO_TO_INDEED_LOCATION[geoId]) {
    return LINKEDIN_GEO_TO_INDEED_LOCATION[geoId];
  }
  return "Canada";
}

/**
 * Build one search URL per enabled job board from a saved search (LinkedIn URL + fields).
 * @param {{ url?: string, keywords?: string, workType?: string, country?: string, city?: string, geoId?: string, days?: number, siteIds?: string[] }} opts
 * @returns {{ siteId: string, label: string, url: string }[]}
 */
export function buildEnabledSiteSearchUrls({
  url,
  keywords,
  workType,
  country,
  city,
  geoId,
  days,
  siteIds,
} = {}) {
  const enabled = normalizeSearchSiteIds(siteIds);
  const fromUrl = searchParamsFromUrl(url);
  const params = {
    keywords: String(keywords || fromUrl?.keywords || "").trim(),
    workType: workType || fromUrl?.workType || "any",
    country: country || fromUrl?.country || "",
    city: city || fromUrl?.city || "",
    geoId: geoId || fromUrl?.geoId || "",
    days: [1, 2, 7].includes(Number(days)) ? Number(days) : fromUrl?.days ?? 1,
  };

  const results = [];
  for (const siteId of enabled) {
    const site = AVAILABLE_SEARCH_SITES.find((item) => item.id === siteId);
    if (!site) {
      continue;
    }
    if (siteId === "linkedin") {
      let linkedInUrl = "";
      if (isLinkedInJobsSearchUrl(url)) {
        linkedInUrl = rewriteLinkedInPostedDays(String(url).trim(), params.days);
      } else if (params.keywords) {
        linkedInUrl = buildLinkedInSearchUrl(params);
      }
      if (linkedInUrl) {
        results.push({ siteId, label: site.label, url: linkedInUrl });
      }
      continue;
    }
    if (siteId === "indeed-ca") {
      let indeedUrl = "";
      if (isIndeedJobsSearchUrl(url)) {
        indeedUrl = rewriteIndeedPostedDays(String(url).trim(), params.days);
      } else if (params.keywords) {
        indeedUrl = buildIndeedSearchUrl({
          keywords: params.keywords,
          days: params.days,
          workType: params.workType,
          location: indeedLocationFromParams(params),
        });
      }
      if (indeedUrl) {
        results.push({ siteId, label: site.label, url: indeedUrl });
      }
    }
  }
  return results;
}
