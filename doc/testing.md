# Тестирование

Юнит-тесты проверяют **чистую логику** модулей: нормализацию данных, парсинг URL, извлечение зарплат, флаги вакансий. Без сети, браузера и Ollama.

Стек: встроенный **`node:test`** + **`node:assert/strict`**. Дополнительные зависимости не нужны.

## Запуск

```bash
npm test
```

Один файл:

```bash
node --test test/linkedin-search-url.test.js
```

Подробный вывод (имя каждого сценария):

```bash
node --test --test-reporter spec test/linkedin-search-url.test.js
```

`npm test` вызывает `test/run-all.js` — работает на Windows и Unix.

Live-скан (браузер + сессия, не входит в `npm test`):

```bash
npm run test:linkedin
npm run test:sites
npm run test:sites:full
```

## Как устроены сценарии

Каждый тест — **один документированный сценарий**:

1. **Имя** — краткое описание на русском (видно в выводе `npm test`).
2. **Блок-комментарий** в начале файла — оглавление всех сценариев модуля.
3. Хелпер `scenario(doc, fn)` из `test/helpers/scenario.js` — обёртка над `it()`.

Пример:

```js
import { scenario } from "./helpers/scenario.js";

describe("normalizeJobPostedDays", () => {
  scenario("3, 0, -1, NaN → default 1", () => {
    assert.equal(normalizeJobPostedDays(3), 1);
  });
});
```

## Файлы тестов

| Файл | Модуль | Сценариев |
|------|--------|-----------|
| `test/job-ollama-ask.test.js` | `extractCompensationLines` | 16 |
| `test/linkedin-search-url.test.js` | URL поиска LinkedIn | 50 |
| `test/dashboard-settings.test.js` | Настройки дашборда | 23 |
| `test/dashboard-scenarios.test.js` | Сохранённые поиски | 20 |
| `test/dashboard-db.test.js` | `extractJobKey` | 8 |
| `test/job-flags.test.js` | Applied / Not interested | 13 |
| `test/run-cli.test.js` | CLI-флаги, Ollama host | 12 |
| `test/dashboard-pipelines.test.js` | Пайплайны запуска | 2 |
| `test/jobs-dashboard-html.test.js` | HTML-инварианты UI | 7 |
| **Итого (`npm test`)** | | **153** |
| `test/live/linkedin-scan.test.js` | Live: открыть LinkedIn, 5 вакансий | 1 |
| `test/live/search-sites-scan.test.js` | Live: LinkedIn + Indeed Canada, Android Montreal | 1 |
| `test/live/search-sites-full.test.js` | Live: полный цикл (отчёты + Ollama + дашборд) | 1 |

---

## Каталог сценариев

### `extractCompensationLines`

| # | Сценарий |
|---|----------|
| 1 | Пустой ввод → `[]` |
| 2 | Только пробелы → `[]` |
| 3 | CA$/yr диапазон (Канада) |
| 4 | Wage ($): диапазон в CAD |
| 5 | `$X - $Y CAD` |
| 6 | Метка `Compensation:` |
| 7 | Метка `Salary range:` |
| 8 | Метка `Salaire` (FR) |
| 9 | Метка `Salary` + USD/yr |
| 10 | Обобщённый `$K - $K / year` |
| 11 | Несколько форматов в одном тексте |
| 12 | Дедупликация между фрагментами |
| 13 | Короткая строка с ключевым словом |
| 14 | Длинная строка (>140) без salary-regex — `[]` |
| 15 | Короткая строка без маркеров — игнор |
| 16 | Текст без зарплаты → `[]` |

### `formatSearchLocation`

| Сценарий |
|----------|
| город + страна → «City, Country» |
| только город / только страна |
| legacy `region=quebec` / `region=canada` |
| пустые поля → `""` |

### `daysFromLinkedInFTpr`

| Сценарий |
|----------|
| `f_TPR=a…` → 1 день |
| `r86400` → 1, `r172800` → 2, `r604800` → 7 |
| нестандартный интервал → округлённые дни |
| пусто / неизвестный формат → `undefined` |

### `canonicalizeLinkedInJobsSearchUrl`

| Сценарий |
|----------|
| стандартный `/jobs/search/` |
| `/search-results/` → `/search/` |
| удаление `currentJobId`, `referralSearchId`, `skipRedirect` |
| trim пробелов |
| пусто / не URL / не linkedin / не jobs search → `""` |

### `parseLinkedInSearchUrl` / `buildLinkedInSearchUrl`

| Сценарий |
|----------|
| keywords из `keywords` / `keyword` / `query` |
| location: city+country / country only |
| geoId → label из справочника |
| `f_WT` 1/2/3 → onsite/remote/hybrid; без f_WT → any |
| round-trip build ↔ parse |
| пустые keywords → исключение |
| days вне [1,2,7] → 1 |
| geoId по region quebec/canada |
| только geoId без location-текста |
| невалидный URL → исключение |

### `rewriteLinkedInPostedDays` / `applyLinkedInPostedDaysFromEnv`

| Сценарий |
|----------|
| валидный URL → `f_TPR=r{seconds}` |
| days ≤ 0 / NaN / пустой URL → без изменений |
| не LinkedIn / не job path / битый URL → без изменений |
| env не задан / `abc` / `0` → без изменений |
| env=7 → переписывает f_TPR |

### `normalizeMandatoryTags`

| Сценарий |
|----------|
| null / не массив / `[]` → дефолт |
| пустой label → пропуск |
| label ≤ 40 символов |
| id из label; дубликаты → `-2`, `-3` |
| cap `MAX_MANDATORY_TAGS` |
| валидный список сохраняется |

### `normalizeCompanyBlacklist`

| Сценарий |
|----------|
| undefined/null / не массив → дефолт |
| `[]` → `[]` |
| trim, dedup case-insensitive |
| имя ≤ 80 символов |

### `normalizeMaxJobsPerSearch` / `normalizeJobPostedDays`

| Сценарий |
|----------|
| валидные числа и строки |
| NaN / < 1 → default |
| > 1000 → 1000 |
| posted days: только 1, 2, 7 |

### `normalizeSearchParams` / `buildScenario*`

| Сценарий |
|----------|
| ручной ввод всех полей |
| invalid workType → any; invalid days → 1 |
| legacy region quebec/canada |
| LinkedIn URL > ручные поля |
| битый URL → fallback |
| title/description для всех workType и периодов |
| `buildScenarioFromParams`: manual / URL / custom title |
| без keywords / invalid URL → исключение |

### `extractJobKey`

| Сценарий |
|----------|
| `/jobs/view/{id}` (+ slash, case, query) |
| fallback trimmed link; число → `String(link)` |
| пустой / null / не строка → `""` |

### `mergeAppliedIntoJobs` / `mergeNotInterestedIntoJobs`

| Сценарий |
|----------|
| in map → true + timestamp |
| not in map → false |
| запись без timestamp → `""` |
| null map / не массив jobs |
| исходный массив не мутируется |
| несколько флагов одновременно |

### `normalizeOllamaHost` / `parseCliFlags`

| Сценарий |
|----------|
| default host, trailing slash |
| все CLI-флаги: `--live`, `--preprocess-only`, `--search-id`, `--url` |
| формы `=value` и отдельный аргумент |
| неизвестные аргументы игнорируются |

### `buildExecutePipelineFromUrl`

| Сценарий |
|----------|
| валидный URL → pipeline descriptor |
| пустой URL → `null` |

### `jobs-dashboard.html`

| Сценарий |
|----------|
| нет Ask Ollama (строки, атрибуты, API, CSS) |
| нет `card-head` |
| `card-actions` absolute + `padding-right` у `.card` |

### LinkedIn live scan (`npm run test:linkedin`)

| Сценарий |
|----------|
| открывает сохранённый поиск и перебирает 5 вакансий (preview, без reports) |

### Search sites live scan (`npm run test:sites`)

| Сценарий |
|----------|
| Android developer Montreal: LinkedIn и Indeed Canada, по 3 вакансии (preview) |

### Search sites full cycle (`npm run test:sites:full`)

| Сценарий |
|----------|
| Android developer Montreal: полный цикл на LinkedIn и Indeed Canada |

---

## Что пока не покрыто

| Область | Почему |
|---------|--------|
| Playwright / LinkedIn scrape | отдельный `npm run test:linkedin` (браузер + сессия) |
| Playwright / LinkedIn + Indeed | отдельный `npm run test:sites` (браузер + сессия) |
| Полный цикл scrape + Ollama | отдельный `npm run test:sites:full` |
| `serve-dashboard.js` API | нужен HTTP test server |
| Inline JS в `jobs-dashboard.html` | дублирует server-модули; нужен extract |

## Добавление нового сценария

1. Открой соответствующий `test/*.test.js`.
2. Добавь строку в блок-комментарий «Сценарии» вверху файла.
3. Добавь `scenario("краткое описание", () => { ... })`.
4. Запусти `npm test`.

## CI

Пока нет GitHub Actions. Перед merge локально:

```bash
npm test
```
