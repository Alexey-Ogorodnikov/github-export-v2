/**
 * extractCompensationLines — извлечение строк с зарплатой из текста вакансии.
 *
 * Сценарии:
 * 1. Пустой ввод → []
 * 2. Только пробелы → []
 * 3. CA$/yr диапазон (Канада)
 * 4. Wage ($): диапазон в CAD
 * 5. $X - $Y CAD
 * 6. Метка Compensation:
 * 7. Метка Salary range:
 * 8. Метка Salaire (FR)
 * 9. Метка Salary + USD/yr
 * 10. Обобщённый $K - $K / year
 * 11. Несколько форматов в одном тексте
 * 12. Дедупликация между несколькими фрагментами
 * 13. Короткая строка с ключевым словом (построчный проход)
 * 14. Длинная строка (>140 символов) без regex — игнорируется
 * 15. Короткая строка без зарплатных маркеров — игнорируется
 * 16. Текст без зарплаты → []
 */
import assert from "node:assert/strict";
import { describe } from "node:test";

import { extractCompensationLines } from "../scripts/job-ollama-ask.js";
import { scenario } from "./helpers/scenario.js";

describe("extractCompensationLines", () => {
  scenario("1. Пустой ввод → []", () => {
    assert.deepEqual(extractCompensationLines(), []);
    assert.deepEqual(extractCompensationLines(null, undefined), []);
  });

  scenario("2. Только пробелы → []", () => {
    assert.deepEqual(extractCompensationLines("   ", "\n"), []);
  });

  scenario("3. CA$/yr диапазон (Канада)", () => {
    const lines = extractCompensationLines("Pay: CA$120K/yr - CA$150K/yr plus bonus.");
    assert.ok(lines.some((l) => /CA\$120K\/yr\s*-\s*CA\$150K\/yr/i.test(l)));
  });

  scenario("4. Wage ($): диапазон в CAD", () => {
    const lines = extractCompensationLines("Wage ($): $80,000 - $95,000 CAD");
    assert.ok(lines.some((l) => /Wage \(\$\)/.test(l)));
  });

  scenario("5. $X - $Y CAD", () => {
    const lines = extractCompensationLines("Band: $70,000 - $85,000 CAD annually.");
    assert.ok(lines.some((l) => /\$70,000\s*-\s*\$85,000\s*CAD/i.test(l)));
  });

  scenario("6. Метка Compensation:", () => {
    const lines = extractCompensationLines("Compensation: $90,000 - $110,000 base salary");
    assert.ok(lines.some((l) => /^Compensation:/i.test(l)));
  });

  scenario("7. Метка Salary range:", () => {
    const lines = extractCompensationLines("Salary range: $100K - $130K depending on experience");
    assert.ok(lines.some((l) => /^Salary range:/i.test(l)));
  });

  scenario("8. Метка Salaire (FR)", () => {
    const lines = extractCompensationLines("Salaire : 75 000 $ - 95 000 $ par année");
    assert.ok(lines.some((l) => /Salaire\s*:/i.test(l)));
  });

  scenario("9. Метка Salary + USD/yr", () => {
    const lines = extractCompensationLines("Salary: $70K - $90K USD / yr");
    assert.ok(lines.some((l) => /Salary:/i.test(l)));
  });

  scenario("10. Обобщённый $K - $K / year", () => {
    const lines = extractCompensationLines("Offer: $120K - $160K / year");
    assert.ok(lines.some((l) => /\$120K\s*-\s*\$160K/i.test(l)));
  });

  scenario("11. Несколько форматов в одном тексте", () => {
    const text = [
      "Compensation: $50,000 - $60,000",
      "Salary range: up to $65,000",
    ].join("\n");
    const lines = extractCompensationLines(text);
    assert.ok(lines.some((l) => /Compensation:/i.test(l)));
    assert.ok(lines.some((l) => /Salary range:/i.test(l)));
  });

  scenario("12. Дедупликация между несколькими фрагментами", () => {
    const duplicate = "Salary: $70K - $90K USD / yr";
    const lines = extractCompensationLines(duplicate, duplicate);
    assert.equal(lines.filter((l) => /Salary:/i.test(l)).length, 1);
  });

  scenario("13. Короткая строка с ключевым словом (построчный проход)", () => {
    const text = "Details\nCA$95K/yr - CA$110K/yr\nFooter";
    const lines = extractCompensationLines(text);
    assert.ok(lines.some((l) => /CA\$95K\/yr/i.test(l)));
  });

  scenario("14. Длинная строка (>140) без salary-маркеров → []", () => {
    const longLine =
      "This paragraph is intentionally longer than one hundred forty characters and mentions compensation philosophy but has no dollar amounts or structured pay labels in it at all.";
    assert.ok(longLine.length > 140);
    assert.deepEqual(extractCompensationLines(longLine), []);
  });

  scenario("15. Короткая строка без зарплатных маркеров — игнорируется", () => {
    const lines = extractCompensationLines("Great team culture and flexible hours.");
    assert.deepEqual(lines, []);
  });

  scenario("16. Текст без зарплаты → []", () => {
    assert.deepEqual(
      extractCompensationLines("Senior engineer. React, TypeScript. Remote-friendly."),
      [],
    );
  });
});
