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
    /\bCompensation:\s*[^\n]{3,120}/gi,
    /\bSalary range:\s*[^\n]{3,120}/gi,
    /\bSalaire\s*:\s*[^\n]+/gi,
    /\bSalary[:\s]+[^\n]{3,120}/gi,
    /\$[\d,.]+K?\s*-\s*\$[\d,.]+K?\s*(?:CAD|USD|US)?(?:\s*\/\s*(?:yr|year|hour|hr))?/gi,
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
    if (/\b(CA\$[\d,.]+K?\/yr|Wage\s*\(\$\)|Salaire\s*:|Compensation\s*:|Salary range\s*:|\/yr\s*-)/i.test(t)) {
      found.add(t);
    }
  }
  return [...found];
}
