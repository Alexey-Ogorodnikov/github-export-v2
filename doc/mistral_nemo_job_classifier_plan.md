# План классификации вакансий для Mistral-NeMo 12B

## 1. Цель

Настроить `mistral-nemo:12b` как локального классификатора вакансий, который:

1. определяет реальный тип роли;
2. сравнивает требования вакансии с профилем кандидата;
3. отделяет обязательные требования от желательных;
4. выявляет блокеры, пробелы и неизвестные данные;
5. оценивает вероятность прохождения первичного отбора;
6. оценивает способность кандидата выполнять работу;
7. оценивает карьерную ценность и риски;
8. возвращает структурированный JSON;
9. на основе JSON формирует краткий понятный разбор на русском языке.

Модель не должна сама открывать LinkedIn-ссылки. Перед анализом системе необходимо извлечь текст вакансии отдельным инструментом или предоставить его вручную.

---

## 2. Архитектура решения

Рекомендуемый процесс:

```text
LinkedIn URL или текст вакансии
        ↓
Извлечение и очистка текста
        ↓
Нормализация описания вакансии
        ↓
Профиль кандидата в JSON
        ↓
Mistral-NeMo: анализ вакансии в JSON
        ↓
Программная проверка JSON
        ↓
Программный расчёт итогового балла
        ↓
Mistral-NeMo: краткое объяснение результата
```

Разделяй анализ и написание объяснения на два разных запроса. Это уменьшает нестабильность и количество выдуманных выводов.

---

## 3. Входные данные

### 3.1. Профиль кандидата

Храни профиль отдельно в JSON или YAML. Не вставляй каждый раз свободный текст резюме.

Пример:

```json
{
  "candidate": {
    "name": "Example Candidate",
    "location": "Example City, Country",
    "work_preferences": {
      "remote": true,
      "hybrid_local": true,
      "hybrid_other_city_weekly": false,
      "relocation": false
    },
    "languages": {
      "english": "professional"
    },
    "experience_years": {
      "software_engineering": 6,
      "android": 5,
      "people_management": 1
    },
    "primary_skills": [
      "Android",
      "Kotlin",
      "Java"
    ],
    "secondary_skills": [
      "TypeScript"
    ],
    "leadership": [
      "mentoring",
      "code reviews"
    ],
    "achievements": [
      "Shipped a mobile app used by a sample retail chain",
      "Led a small mobile feature team"
    ],
    "known_gaps": [
      "Deep native iOS and Swift expertise",
      "Long-term backend ownership"
    ]
  }
}
```

Все значения должны быть фактическими. Не завышай количество лет ради вакансии.

### 3.2. Текст вакансии

Перед отправкой в модель очисти текст от:

- меню LinkedIn;
- похожих вакансий;
- рекламы;
- служебных кнопок;
- повторяющихся фрагментов;
- tracking-параметров;
- информации, не относящейся к роли.

Желательный вход:

```json
{
  "job": {
    "title": "Senior Android Developer",
    "company": "Example Company",
    "location": "Example City",
    "employment_type": "Full-time",
    "workplace_type": "Hybrid",
    "description": "Полный очищенный текст вакансии",
    "source_url": "..."
  }
}
```

---

## 4. Основные категории классификации

Модель должна сначала определить реальный характер работы, а не доверять заголовку.

Допустимые основные типы:

```text
android_developer
mobile_cross_platform
ios_developer
mobile_tech_lead
mobile_architect
engineering_manager
senior_engineering_manager
product_manager
solution_architect
solutions_engineer_presales
frontend_web
full_stack
backend
platform_engineering
production_support
infrastructure
security
ai_training_contractor
freelance_project
staffing_contract
other
```

Также модель должна оценить предполагаемое распределение работы:

```json
{
  "work_mix": {
    "hands_on_coding_percent": 60,
    "architecture_percent": 20,
    "people_management_percent": 10,
    "product_stakeholder_percent": 10
  }
}
```

Это приблизительная оценка. Сумма должна составлять 100.

---

## 5. Разделение требований

Каждое требование вакансии классифицируется как:

- `must_have` — явно обязательное;
- `preferred` — преимущество;
- `inferred_core` — не написано как обязательное, но является центральным для работы;
- `unknown` — невозможно определить.

Для каждого требования модель возвращает:

```json
{
  "requirement": "5+ years of native Android development",
  "importance": "must_have",
  "candidate_status": "direct_match",
  "evidence": "Candidate has 5 years of native Android experience",
  "gap_severity": "none"
}
```

Допустимые значения `candidate_status`:

```text
direct_match
transferable_match
partial_match
unknown
missing
```

Допустимые значения `gap_severity`:

```text
none
minor
moderate
major
blocker
```

### Примеры

- Нет опыта Turbine → `minor`.
- Есть Kotlin, но роль требует Java backend → `transferable_match` или `partial_match`.
- Нет пяти лет .NET для Senior .NET Developer → `blocker`.
- Нет Swift для iOS Architect → `blocker`.
- Нет банковского домена, но он preferred → `minor`.
- Неизвестен опыт с App Store → `unknown`, а не `missing`.

---

## 6. Отдельные оценки

Не объединяй всё сразу в один процент. Сначала оцени отдельные измерения по шкале от 0 до 10.

```json
{
  "scores": {
    "core_stack_fit": 0,
    "experience_depth_fit": 0,
    "role_type_fit": 0,
    "leadership_fit": 0,
    "formal_hr_fit": 0,
    "location_fit": 0,
    "employment_conditions_fit": 0,
    "career_value": 0,
    "company_transparency": 0,
    "ability_to_do_job": 0,
    "screening_probability": 0
  }
}
```

### Значение оценок

#### `core_stack_fit`
Совпадение основного стека, который будет использоваться большую часть времени.

#### `experience_depth_fit`
Соответствие ожидаемой глубине: junior, senior, lead, staff, manager.

#### `role_type_fit`
Соответствие реальному типу работы карьерному профилю кандидата.

#### `leadership_fit`
People management, mentoring, technical leadership, budget, hiring и управление несколькими командами.

#### `formal_hr_fit`
Формальное совпадение с количеством лет, титулами, сертификатами и обязательными ключевыми словами.

#### `location_fit`
Провинция, город, офисные дни, возможность удалённой работы и необходимость переезда.

#### `employment_conditions_fit`
Full-time, contract, C2C, гарантированные часы, benefits и стабильность.

#### `career_value`
Польза вакансии для следующих 1–3 лет карьеры.

#### `company_transparency`
Насколько понятны работодатель, клиент, ставка, продукт и формат найма.

#### `ability_to_do_job`
Сможет ли кандидат реально выполнять работу после разумной адаптации.

#### `screening_probability`
Вероятность пройти ATS и первичный recruiter screening.

---

## 7. Программный итоговый балл

Не разрешай модели самостоятельно придумывать итоговый процент. Рассчитывай его кодом.

Рекомендуемые веса:

```text
core_stack_fit:             25%
experience_depth_fit:       15%
role_type_fit:              15%
leadership_fit:             10%
formal_hr_fit:              15%
location_fit:               10%
employment_conditions_fit:  5%
career_value:                5%
```

Формула:

```text
overall_fit =
    core_stack_fit × 0.25 +
    experience_depth_fit × 0.15 +
    role_type_fit × 0.15 +
    leadership_fit × 0.10 +
    formal_hr_fit × 0.15 +
    location_fit × 0.10 +
    employment_conditions_fit × 0.05 +
    career_value × 0.05
```

Так как оценки находятся в диапазоне 0–10:

```text
overall_fit_percent = overall_fit × 10
```

### Ограничения сверху

После расчёта применяй правила:

- один подтверждённый `blocker` по обязательному основному стеку → максимум 59%;
- два подтверждённых `blocker` → максимум 44%;
- географический запрет без готовности к переезду → максимум 49%;
- роль требует другую профессию, например security вместо Android → максимум 44%;
- если критические данные неизвестны, итог помечается как предварительный.

---

## 8. Приоритет заявки

На основе итогового балла, карьерной ценности и рисков:

```text
high_priority
medium_priority
low_priority
skip
```

Рекомендуемые правила:

### High priority
- overall fit ≥ 80%;
- нет блокеров;
- location fit ≥ 7;
- career value ≥ 7.

### Medium priority
- overall fit 65–79%;
- нет более одного крупного пробела;
- кандидат способен выполнять работу.

### Low priority
- overall fit 45–64%;
- роль смежная или условия непрозрачны;
- заявка имеет смысл только без больших затрат времени.

### Skip
- overall fit < 45%;
- есть географический блокер;
- основной стек или профессия не совпадает;
- ставка/условия явно не соответствуют ответственности.

---

## 9. Риски и красные флаги

Модель должна отдельно искать:

```text
hidden_end_client
duplicate_agency_submission
unclear_salary
wide_salary_range
no_guaranteed_hours
contract_without_duration
contract_to_hire_without_commitment
unpaid_assessment
ai_training_funnel
freelance_scope_creep
multiple_roles_in_one
underpaid_for_scope
mandatory_relocation
province_restriction
heavy_on_call
legacy_stack_mismatch
job_title_misleading
reposted_job
unknown_company
```

Каждый риск:

```json
{
  "risk": "multiple_roles_in_one",
  "severity": "high",
  "evidence": "Role combines Android lead, iOS lead, cloud architecture and delivery ownership"
}
```

Нельзя утверждать наличие риска без текстового основания.

---

## 10. Правила против галлюцинаций

System prompt должен содержать следующие правила:

1. Не приписывай кандидату навыки, которых нет в профиле.
2. Не превращай `unknown` в `missing`.
3. Не считай потребление REST API полноценным backend-опытом.
4. Не считай mentoring полноценным people management.
5. Не считай React Native равным React web.
6. Не считай Kotlin равным Java/Spring backend.
7. Не считай мобильную авторизацию глубоким enterprise IAM.
8. Не считай BLE опытом полноценного IoT/cloud engineering.
9. Не считай применение AI coding tools опытом создания AI-продуктов.
10. Не делай актуальных выводов о компании без предоставленных веб-данных.
11. Не угадывай конечного клиента. Допускается только явно помеченная гипотеза.
12. Все выводы должны иметь поле `evidence`.
13. При недостатке данных возвращай `unknowns`.
14. Не используй процент с точностью до единицы как объективную истину.
15. Отделяй способность выполнять работу от вероятности пройти HR-фильтр.

---

## 11. JSON-схема результата

Рекомендуемый формат:

```json
{
  "job_summary": {
    "normalized_title": "",
    "company": "",
    "primary_role_type": "",
    "secondary_role_types": [],
    "seniority": "",
    "employment_type": "",
    "location": "",
    "workplace_type": "",
    "real_role_summary": ""
  },
  "work_mix": {
    "hands_on_coding_percent": 0,
    "architecture_percent": 0,
    "people_management_percent": 0,
    "product_stakeholder_percent": 0
  },
  "requirements": [
    {
      "requirement": "",
      "importance": "must_have",
      "candidate_status": "unknown",
      "evidence": "",
      "gap_severity": "none"
    }
  ],
  "scores": {
    "core_stack_fit": 0,
    "experience_depth_fit": 0,
    "role_type_fit": 0,
    "leadership_fit": 0,
    "formal_hr_fit": 0,
    "location_fit": 0,
    "employment_conditions_fit": 0,
    "career_value": 0,
    "company_transparency": 0,
    "ability_to_do_job": 0,
    "screening_probability": 0
  },
  "blockers": [],
  "minor_gaps": [],
  "unknowns": [],
  "strengths": [],
  "risks": [
    {
      "risk": "",
      "severity": "low",
      "evidence": ""
    }
  ],
  "recommended_resume_angle": [],
  "interview_topics_to_prepare": [],
  "questions_for_recruiter": [],
  "recommendation": {
    "priority": "medium_priority",
    "reason": "",
    "confidence": 0.0
  }
}
```

`confidence` — от 0 до 1 и зависит от полноты описания вакансии и профиля, а не от уверенного тона модели.

---

## 12. System prompt для этапа анализа

```text
Ты — строгий классификатор вакансий.

Твоя задача — сравнить структурированный профиль кандидата с очищенным описанием вакансии и вернуть только валидный JSON по заданной схеме.

Не пиши итоговый процент: он будет рассчитан программно.
Не приписывай кандидату навыки, которых нет в профиле.
Если навык не указан, используй unknown.
Отделяй:
1) способность выполнять работу;
2) формальное соответствие вакансии;
3) вероятность пройти recruiter screening.

Сначала определи реальный характер роли по обязанностям, а не по названию.
Раздели требования на must_have, preferred, inferred_core и unknown.
Для каждого вывода укажи evidence.
Не делай актуальных выводов о компании, если данные о компании не предоставлены.
Не угадывай скрытого клиента.
Не используй markdown.
Верни только JSON.
```

---

## 13. User prompt для этапа анализа

```text
ПРОФИЛЬ КАНДИДАТА:
{{candidate_profile_json}}

ВАКАНСИЯ:
{{job_json}}

Проанализируй соответствие и верни JSON строго по схеме:
{{output_json_schema}}
```

Для Ollama желательно:

```text
temperature: 0.0–0.2
top_p: 0.8–0.9
repeat_penalty: 1.05
num_ctx: 16384 или выше
```

---

## 14. Второй промпт для человеческого объяснения

После программного расчёта балла передай модели:

- исходный JSON;
- рассчитанный `overall_fit_percent`;
- применённые ограничения;
- итоговый приоритет.

System prompt:

```text
Ты — карьерный аналитик.
На основе предоставленного структурированного анализа напиши краткий разбор на русском языке.

Структура:
1. Что это за работа на самом деле.
2. Потянет ли её кандидат.
3. Три главные сильные стороны.
4. Главные пробелы или блокеры.
5. Условия и риски.
6. Итог: подаваться или нет.

Не добавляй фактов, которых нет в JSON.
Отдельно укажи:
- ability to do the job;
- formal fit;
- screening probability.

Не превращай неизвестные данные в отрицательные выводы.
```

User prompt:

```text
СТРУКТУРИРОВАННЫЙ АНАЛИЗ:
{{analysis_json}}

РАССЧИТАННЫЙ ИТОГ:
{{computed_score_json}}

Сформируй краткий разбор.
```

---

## 15. Проверка результата кодом

После ответа модели проверь:

1. JSON валиден.
2. Все обязательные поля присутствуют.
3. Все оценки — числа от 0 до 10.
4. Сумма `work_mix` равна 100.
5. Используются только разрешённые enum-значения.
6. Каждый blocker связан с must-have или inferred-core требованием.
7. Каждый вывод имеет evidence.
8. Нет навыков кандидата, отсутствующих во входном профиле.
9. Нет утверждений о компании без предоставленных company research данных.
10. Confidence находится от 0 до 1.

Если проверка не пройдена, отправь модели исправляющий запрос:

```text
Предыдущий JSON нарушил следующие правила:
{{validation_errors}}

Исправь только эти ошибки.
Не добавляй новые факты.
Верни только полный исправленный JSON.
```

---

## 16. Отдельный модуль проверки компании

Не поручай Mistral-NeMo самостоятельно исследовать компанию.

Сначала отдельный агент или поисковый модуль собирает:

```json
{
  "company_research": {
    "official_company_description": "",
    "company_type": "",
    "public_or_private": "",
    "employee_count": "",
    "recent_funding_or_financials": "",
    "recent_layoffs": "",
    "employee_review_summary": "",
    "job_reposting_signals": "",
    "sources": []
  }
}
```

После этого NeMo может оценить:

- стабильность;
- прозрачность;
- тип работодателя;
- риски consulting/staffing;
- признаки AI-training funnel;
- соответствие компенсации уровню роли.

Без такого блока модель должна писать: `company assessment unavailable`.

---

## 17. Набор few-shot примеров

Добавь 8–15 проверенных примеров разных типов:

1. Почти идеальный Senior Android Developer.
2. Lead Android с умеренным management.
3. Senior Manager с недостатком people-management years.
4. React Native роль с сильным Android, но слабым TypeScript.
5. Senior .NET backend с нерелевантным Android-профилем.
6. Product Security Engineer.
7. AI-training contractor.
8. Freelance-проект с огромным scope.
9. Mobile title, но фактически production support.
10. Remote role that excludes the candidate's region.

Для каждого примера храни:

- профиль;
- вакансию;
- правильный JSON;
- вычисленный итог;
- краткий финальный разбор.

Не используй слишком похожие примеры: модель должна научиться различать типы ролей.

---

## 18. Тестирование качества

Создай тестовый набор минимум из 50 вакансий.

Проверяй:

### Классификация роли
Правильно ли определён настоящий тип работы.

### Must-have extraction
Не пропущены ли ключевые обязательные требования.

### Blocker precision
Не объявляет ли модель блокером небольшие пробелы.

### Hallucination rate
Не приписывает ли она кандидату несуществующий опыт.

### Screening realism
Отличает ли она способность выполнять работу от прохождения HR.

### Stability
Насколько результат меняется между тремя запусками.

### Recommendation agreement
Совпадает ли рекомендация модели с экспертной оценкой.

Целевые показатели первой версии:

```text
Role classification accuracy: ≥ 85%
Critical blocker precision: ≥ 85%
Critical blocker recall: ≥ 80%
Hallucinated candidate skills: ≤ 3%
Valid JSON responses: ≥ 98%
Recommendation agreement: ≥ 80%
```

---

## 19. Улучшение стабильности

1. Используй температуру 0–0.2.
2. Храни профиль кандидата в структурированном виде.
3. Не передавай лишний HTML.
4. Требуй JSON.
5. Рассчитывай балл программно.
6. Применяй rule-based ограничения.
7. Используй повторную валидацию.
8. Делай отдельный запрос для объяснения.
9. Не проси модель одновременно исследовать интернет и классифицировать.
10. Логируй все версии промптов и результаты.

---

## 20. Минимальная версия MVP

Для первой рабочей версии достаточно:

1. вручную вставлять текст вакансии;
2. хранить профиль кандидата в JSON;
3. отправлять оба объекта в Mistral-NeMo;
4. получать структурированный JSON;
5. валидировать JSON;
6. рассчитывать итоговый процент кодом;
7. генерировать краткое объяснение вторым запросом;
8. сохранять результат в локальную базу или Markdown.

Fine-tuning для MVP не нужен.

---

## 21. Следующий этап

После накопления 200–500 проверенных примеров можно:

- скорректировать веса;
- обучить небольшой LoRA-адаптер;
- добавить персональные карьерные предпочтения;
- научить модель ранжировать несколько вакансий;
- добавить автоматический поиск повторных публикаций;
- сравнивать ставки с типом занятости;
- генерировать адаптацию резюме под высокоприоритетные вакансии.

---

## 22. Итоговая логика решения

```text
Сильное совпадение стека
        +
Подходящий уровень ответственности
        +
Реалистичный HR-fit
        +
Допустимая география
        +
Хорошая карьерная ценность
        -
Блокеры
        -
Непрозрачные условия
        -
Несоответствие профессии
        =
Приоритет заявки
```

Mistral-NeMo должна оценивать признаки и давать структурированное объяснение. Итоговый процент и жёсткие правила должны контролироваться обычным кодом, а не языковой моделью.
