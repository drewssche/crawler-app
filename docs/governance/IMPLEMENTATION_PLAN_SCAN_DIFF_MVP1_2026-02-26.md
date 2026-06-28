# Implementation Plan: Scan & Diff MVP-1

Цель: внедрить MVP-1 сканирования и индекса изменений без auth-контекстов, с подготовкой к будущим режимам `Визуальный/Код`.

## Этап 0. Контракт и границы

1. Утвердить фиксированный набор артефактов:
- HTML (raw),
- DOM (post-render),
- screenshot,
- meta,
- links/resources + status.
2. Зафиксировать anti-goals:
- без auth-контекстов,
- первый storage slice без сложного UI diff;
- cross-site compare не входит в первый storage slice, но schema/API не должны блокировать будущую модель `Project -> ProjectSite[]`.

> Update 2026-06-24: прежняя трактовка `allowed_domains_csv` как нескольких сравниваемых сайтов отклонена.
> Сравниваемые/наблюдаемые сайты моделируются отдельными `ProjectSite`; `allowed_domains` остаётся техническим allowlist сайта.
> Полный порядок внедрения и section scope зафиксированы в корневом `TODO.md`.

## Этап 1. Backend storage (минимальный)

1. Добавить таблицы/модели:
- `scan_runs` (run-level metadata),
- `page_snapshots` (snapshot-level metadata + refs/hashes),
- `page_diff_index` (быстрый индекс изменений).
2. Добавить миграции + индексы:
- `(project_id, run_id, url)`,
- `(project_id, run_prev_id, run_last_id, changed_code, changed_visual)`.
3. Хранить тяжелые артефакты через ref/путь (не в основных полях таблиц).
4. Ввести retention-политику хранения raw-артефактов:
- хранить только 2 последних завершенных run (`latest + previous`) на проект;
- для run старше пары удалять raw payload, оставляя агрегаты/индексы.
5. Добавить таблицы аудита/аналитики:
- `project_deletion_log` (трассировка удаления проекта);
- `project_stats_history` (перманентные агрегаты для long-term отчетов).

## Этап 2. Crawl pipeline MVP-1

1. На run:
- запустить обход каждого `ProjectSite` в его canonical scope (`whole_site` или `path_prefix`),
- собрать артефакты,
- нормализовать шумные поля (timestamp/nonce-подобные).
2. Для каждой страницы:
- посчитать hash по HTML/DOM/meta/resources,
- сохранить snapshot.
3. После run:
- построить `page_diff_index` между `previous` и `latest`.
4. После успешного run:
- применить retention-cleanup (prune raw-артефактов старше `latest + previous`);
- обновить `project_stats_history` (суточные/периодные агрегаты impact-метрик).

## Этап 3. API контракт

1. Run-level endpoints:
- запуск первого run вручную,
- получение статуса run.
2. Scheduler policy (этап внедрения после базового run):
- регулярный автозапуск по расписанию;
- рекомендация по default-окнам запуска: непиковые часы.
3. Snapshot/index endpoints:
- список изменений по проекту (`page_diff_index`),
- детали snapshot по URL.
4. Export-ready shape:
- выдавать достаточно полей для будущего UI `Визуальный/Код`.
5. Project list summary endpoint:
- единый `/projects/summary` с полями `runs_total` + `last_run` для списков (sidebar/workspace) без `N+1`.
6. Site-level contracts:
- list/create/update `ProjectSite`;
- отдельные status/pages/coverage/failure для каждого сайта;
- project-level aggregation не заменяет site-level diagnostics.
7. Delete project endpoint policy:
- delete-flow выполняется в одной транзакции;
- запись в `project_deletion_log` обязательна;
- статистика из `project_stats_history` не удаляется.

## Этап 4. UI (Project Page MVP-1)

1. На `ProjectDashboardPage`:
- карточка состояния проекта (`не запускался / выполняется / успешно / ошибка`),
- карточка последнего прогона (`started/finished/duration/pages/changed`),
- таблица измененных страниц (из `page_diff_index`),
- фильтры: changed code/meta/resources/links.
2. Режимы сравнения `Визуальный/Код`:
- не включаем в текущий шаг карточки проекта;
- выносим в отдельный экран/шаг после MVP-1 базового сбора и индекса.
3. Детали страницы:
- ссылки на артефакты,
- базовая сводка “что изменилось”.

## Этап 5. Валидация

1. Пилот: `https://books.toscrape.com/`
2. Проверить:
- run создается и завершается,
- snapshots сохраняются,
- индекс изменений строится корректно.
3. Техпроверки:
- backend integration tests (targeted),
- frontend build,
- smoke сценарий из UI.

## Риски и смягчение

1. Ложные diff из динамики:
- нормализация шумов до hash.
2. Рост storage:
- хранить refs/hashes, а не дубли payload.
3. Нагрузка:
- лимит concurrency и batch-size.
4. Память/диск:
- строгий retention (`2 run raw`) + cleanup после каждого завершенного run.

## Политика удаления проекта (утверждено)

1. Удаление проекта выполняется транзакционно:
- mark/delete проекта,
- фиксация audit-записи удаления,
- обновление ссылочной целостности retention/summary указателей.
2. Исторические статистические значения не удаляются:
- данные остаются для экспортов за период (`месяц/квартал/полугодие/год`).
3. Sensitive data policy:
- cookie/token значения не сохраняются в открытом виде в snapshot-хранилище.

## Что после MVP-1

1. Auth contexts (`Гость`/`Авторизован`/`подконтексты`).
2. UI toggle режимов сравнения:
- `Визуальный` (две версии рядом),
- `Код` (diff-подсветка).

## Текущий прогресс (2026-02-26)

- `runs.start` уже использует базовый BFS crawl в пределах allowed domains + `max_pages`.
- `pages_total/pages_changed` заполняются по фактическому обходу (с сравнением по `url/html_hash` к предыдущему FINISHED run).
