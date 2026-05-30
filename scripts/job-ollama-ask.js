import { readFile } from "node:fs/promises";
import path from "node:path";
import { isOllamaReady, normalizeOllamaHost } from "./run-cli.js";

const MAX_QUESTION_LEN = 2000;
const MAX_RAW_SECTION_LEN = 32000;

function pickLongerText(a, b) {
  const sa = String(a || "").trim();
  const sb = String(b || "").trim();
  return sb.length > sa.length ? sb : sa;
}

function normalizeJobLinkId(link) {
  const m = String(link || "").match(/\/jobs\/view\/(\d+)/);
  return m ? m[1] : String(link || "").trim();
}

/** @param {...string} texts */
export function extractCompensationLines(...texts) {
  const haystack = texts
    .map((t) => String(t || ""))
    .filter(Boolean)
    .join("\n");
  if (!haystack.trim()) return [];

  const found = new Set();
  const patterns = [
    /\bCA\$[\d,.]+K?\/yr\s*-\s*CA\$[\d,.]+[KM]?\/yr\b/gi,
    /\bWage\s*\(\$\):\s*\$[\d,]+\s*-\s*\$[\d,]+(?:\s*CAD)?\b/gi,
    /\$[\d,]+\s*-\s*\$[\d,]+\s*CAD\b/gi,
    /\bSalaire\s*:\s*[^\n]+/gi,
    /\bSalary[:\s]+[^\n]{3,120}/gi,
  ];
  for (const re of patterns) {
    for (const m of haystack.matchAll(re)) {
      const line = m[0].trim();
      if (line) found.add(line);
    }
  }
  for (const line of haystack.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length > 140) continue;
    if (/\b(CA\$[\d,.]+K?\/yr|Wage\s*\(\$\)|Salaire\s*:|\/yr\s*-)/i.test(t)) {
      found.add(t);
    }
  }
  return [...found];
}

/**
 * @param {string} markdown
 * @param {string} jobLink
 */
export function extractJobSectionFromRawMarkdown(markdown, jobLink) {
  const targetId = normalizeJobLinkId(jobLink);
  if (!targetId) {
    return { fullSection: "", jobCard: "", fullDescription: "" };
  }
  const content = String(markdown || "");
  const matches = [...content.matchAll(/^###\s+\d+\.\s+(.+)$/gm)];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? content.length) : content.length;
    const section = content.slice(start, end);
    const link = section.match(/^Link:\s*(.+)$/m)?.[1]?.trim() ?? "";
    if (normalizeJobLinkId(link) !== targetId) continue;
    const jobCard = section.match(/Job card text:\s*```text([\s\S]*?)```/m)?.[1]?.trim() ?? "";
    const fullDescription =
      section.match(/Full description:\s*```text([\s\S]*?)```/m)?.[1]?.trim() ?? "";
    return {
      fullSection: section.trim(),
      jobCard,
      fullDescription,
    };
  }
  return { fullSection: "", jobCard: "", fullDescription: "" };
}

/**
 * @param {Record<string, unknown>} stored
 * @param {Record<string, unknown>} [client]
 */
export function mergeJobRecordsForOllama(stored, client = {}) {
  return {
    ...client,
    ...stored,
    title: stored.title || client.title,
    company: stored.company || client.company,
    location: stored.location || client.location,
    work_type: stored.work_type || client.work_type,
    link: stored.link || client.link,
    short_summary: pickLongerText(stored.short_summary, client.short_summary),
    description_preview: pickLongerText(stored.description_preview, client.description_preview),
    job_card_text: pickLongerText(stored.job_card_text, client.job_card_text),
    raw_section_markdown: pickLongerText(stored.raw_section_markdown, client.raw_section_markdown),
    ai_verdict: stored.ai_verdict ?? client.ai_verdict,
    ai_reason: stored.ai_reason || client.ai_reason,
    ai_reason_ru: stored.ai_reason_ru || client.ai_reason_ru,
    ai_keywords: Array.isArray(stored.ai_keywords) ? stored.ai_keywords : client.ai_keywords,
    source_file: stored.source_file || client.source_file,
    raw_report_path_posix: stored.raw_report_path_posix || client.raw_report_path_posix,
    raw_page_title: stored.raw_page_title || client.raw_page_title,
  };
}

/**
 * @param {Record<string, unknown>} job
 * @param {string} projectRoot
 */
export async function enrichJobFromRawReport(job, projectRoot) {
  const rel = String(job.raw_report_path_posix || "").trim();
  const sourceFile = String(job.source_file || "").trim();
  const relPath = rel || (sourceFile ? `reports/${sourceFile}` : "");
  if (!relPath) return job;

  const filePath = path.join(projectRoot, relPath.replace(/^\/+/, "").replace(/\\/g, "/"));
  let markdown = "";
  try {
    markdown = await readFile(filePath, "utf8");
  } catch {
    return job;
  }

  const { fullSection, jobCard, fullDescription } = extractJobSectionFromRawMarkdown(
    markdown,
    job.link,
  );
  if (!fullSection && !jobCard && !fullDescription) {
    return job;
  }

  const next = { ...job };
  if (fullSection) {
    next.raw_section_markdown = fullSection.slice(0, MAX_RAW_SECTION_LEN);
  }
  if (jobCard) {
    next.job_card_text = pickLongerText(job.job_card_text, jobCard);
  }
  if (fullDescription) {
    next.description_preview = pickLongerText(job.description_preview, fullDescription);
  }
  return next;
}

/**
 * @param {Record<string, unknown>} job
 */
export function buildJobPromptContext(job) {
  const parts = [];

  const reportTitle = String(job.raw_page_title || "").trim();
  const sourceFile = String(job.source_file || "").trim();
  if (reportTitle || sourceFile) {
    const meta = [reportTitle, sourceFile ? `raw: ${sourceFile}` : ""].filter(Boolean).join(" · ");
    parts.push(`Scrape report: ${meta}`);
  }

  const compLines = extractCompensationLines(
    job.raw_section_markdown,
    job.job_card_text,
    job.description_preview,
  );
  if (compLines.length > 0) {
    parts.push(`Compensation lines found in posting (quote exactly):\n${compLines.join("\n")}`);
  }

  const raw = String(job.raw_section_markdown || "").trim().slice(0, MAX_RAW_SECTION_LEN);
  if (raw) {
    parts.push(
      `Complete job entry from raw .md (title, link, job card, full description — use everything below):\n${raw}`,
    );
  } else {
    parts.push(
      `Title: ${String(job.title || "").trim()}`,
      `Company: ${String(job.company || "").trim()}`,
      `Location: ${String(job.location || "").trim()}`,
      `Work type: ${String(job.work_type || "").trim()}`,
      `Link: ${String(job.link || "").trim()}`,
    );
    const card = String(job.job_card_text || "").trim();
    if (card) {
      parts.push(`Job card text:\n${card}`);
    }
    const desc = String(job.description_preview || "").trim().slice(0, MAX_RAW_SECTION_LEN);
    if (desc) {
      parts.push(`Full description:\n${desc}`);
    } else {
      const summary = String(job.short_summary || "").trim();
      if (summary) parts.push(`Summary: ${summary}`);
    }
  }

  const verdict = String(job.ai_verdict || "").trim();
  if (verdict) parts.push(`AI verdict (preprocess): ${verdict}`);
  const reason = String(job.ai_reason || job.ai_reason_ru || "").trim();
  if (reason) parts.push(`AI note: ${reason}`);
  const keywords = Array.isArray(job.ai_keywords) ? job.ai_keywords.join(", ") : "";
  if (keywords) parts.push(`Topics: ${keywords}`);

  return parts.filter(Boolean).join("\n\n");
}

async function runOllamaGenerate(prompt) {
  const base = normalizeOllamaHost(process.env.OLLAMA_HOST || "http://127.0.0.1:11434");
  const model = process.env.OLLAMA_MODEL || "llama3.2:3b";
  const response = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.15, num_predict: 900 },
    }),
    signal: AbortSignal.timeout(180000),
  });
  const result = await response.json().catch(() => ({}));
  const message = typeof result.error === "string" ? result.error : "";
  const text = typeof result.response === "string" ? result.response.trim() : "";
  if (!response.ok || message) {
    throw new Error(message || `Ollama HTTP ${response.status}`);
  }
  if (!text) {
    throw new Error("Empty Ollama response");
  }
  return text;
}

/**
 * @param {Record<string, unknown>} job
 * @param {string} question
 * @param {{ projectRoot?: string }} [options]
 */
export async function askOllamaAboutJob(job, question, options = {}) {
  if (!(await isOllamaReady())) {
    throw new Error("Ollama is not running. Start Ollama and try again.");
  }
  const q = String(question || "").trim().slice(0, MAX_QUESTION_LEN);
  if (!q) {
    throw new Error("question required");
  }
  let record = job;
  if (options.projectRoot) {
    record = await enrichJobFromRawReport(record, options.projectRoot);
  }

  const context = buildJobPromptContext(record);
  const prompt = `You help a job seeker analyze a LinkedIn job posting. Answer in the same language as the question. Reply in 1-4 short sentences.

Rules:
- Use ONLY the job data below (one posting: card + full description together).
- Quote compensation exactly as written; never invent dollar amounts.
- Do not say "not in description but in card" — search the entire text below.

${context}

Question:
${q}

Answer:`;
  return runOllamaGenerate(prompt);
}
