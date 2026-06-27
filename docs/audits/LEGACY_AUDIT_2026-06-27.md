# Legacy audit — 2026-06-27

Цель: убрать старые сущности и названия, которые мешают целевой модели `Project → ProjectSite → CrawlPersona → Run → Page`, без сохранения лишней compatibility ради самой compatibility. Проект находится в разработке, поэтому breaking cleanup допустим, если он упрощает модель.

## Целевая модель

- `Project` — рабочий контейнер, права, настройки верхнего уровня.
- `ProjectSite` — самостоятельный сайт внутри проекта: `start_url`, `scope`, allowlist, limits, role.
- `CrawlPersona` — контекст просмотра сайта: `Гость`, позднее авторизованный/партнёр.
- `Run` принадлежит `ProjectSite` и `CrawlPersona`; `profile_id` допустим только как временный project-container bridge до переименования.

## Категории

### 1. Удалить сейчас / при ближайшем backend cleanup

| Legacy | Где найдено | Почему удалить | Безопасный следующий шаг |
| --- | --- | --- | --- |
| Legacy run listing `GET /runs/by-profile/{profile_id}` | `backend/app/api/runs.py` | История должна быть site-scoped (`/runs/by-site/{site_id}`) либо project aggregate, но не смешивать сайты проекта. | Заменено на `/runs/by-project/{project_id}` в route/API wave; следующий шаг — решить, нужен ли отдельный `/projects/{id}/runs` aggregate. |

### 2. Переименовать / перенести жёсткой волной

| Legacy | Где найдено | Целевое имя | Комментарий |
| --- | --- | --- | --- |
| DB table/model `Profile` / `profiles` | `backend/app/db/models/profile.py`, migrations | `Project` / `projects` | Оставлено до отдельной DB migration wave. Переименование затронет FK `runs.profile_id`, `project_sites.profile_id`, migrations и historical data. |

### 3. Оставить временно с deadline

| Legacy | Почему временно оставить | Deadline |
| --- | --- | --- |
| `Profile.start_url`, `Profile.allowed_domains_csv`, `Profile.exclude_*`, `respect_robots`, `max_pages`, `concurrency`, `is_enabled` | Миграционно backfilled в primary `ProjectSite`, но часть list/summary/search ещё использует эти поля. | Удалить после route/API rename и перевода summary на `ProjectSite` aggregate. |
| `Run.profile_id` | Удобный project-container FK для aggregate/delete/events, но не должен определять crawl scope. | Переименовать в `project_id` вместе с `profiles → projects`; затем решить, нужен ли он как denormalized aggregate FK. |
| API prefix `/profiles/{profile_id}/sites` | Семантически уже `ProjectSite`, но prefix устарел. | Заменено на `/projects/{project_id}/sites` в route/API wave. |
| `allowed_domains_csv` on `ProjectSite` | Это уже не список сравниваемых сайтов, а технический allowlist. Само поле не legacy по смыслу, но имя формата `_csv` и UX-история сбивают. | Позже заменить на normalized array/table или `technical_allowlist` после стабилизации crawler scope. |

### 4. Оставить как есть

| Сущность | Почему не трогать сейчас |
| --- | --- |
| `ProjectSite` | Целевая модель для сайтов проекта. |
| `CrawlPersona` | Целевая модель для гостевого/авторизованного/партнёрского контекста. |
| `Page` scoped through `Run.project_site_id` | Правильная связь для page results. |
| `allowed_domains` как концепт technical allowlist | Нужен crawler guard; проблема не в функции, а в старой трактовке как compare-sites. |

## Рекомендуемый порядок cleanup

1. **Safe docs/contract cleanup**: README/TODO wording, audit doc, убрать упоминания “profiles” из пользовательских текстов, где это не API/path.
2. **Remove obsolete compatibility endpoints**: `POST /runs/start/{profile_id}` удалён; `GET /runs/by-profile/{profile_id}` заменён на `/runs/by-project/{project_id}`.
3. **Frontend terminology wave**: closed for page/component/cache names and frontend props/utils.
4. **API route wave**: closed for `/profiles → /projects`, `/profiles/{id}/sites → /projects/{id}/sites`, permissions `profiles.edit → projects.edit`.
5. **DB migration wave**: `profiles → projects`, `profile_id → project_id`; удалить дублирующие site-поля из project container after summary/search are site-aware.

## Immediate recommendation

`POST /runs/start/{profile_id}` compatibility endpoint удалён после подтверждения отсутствия frontend usage. Route/API wave перевела внешний контракт на `/projects/*`; следующая безопасная implementation wave — DB/model rename `Profile/profiles/profile_id → Project/projects/project_id`.

## Completed in this audit wave

- README wording “краулинг-профили” заменён на проекты мониторинга сайтов.
- Compatibility endpoint `POST /runs/start/{profile_id}` удалён.
- Backend tests переведены на `POST /runs/start-site/{site_id}`.
- Frontend terminology wave закрыта: `ProjectDashboardPage`, `ProjectNewPage`, `projectListCache`, project-oriented live update and site settings props.
- Route/API wave закрыта: `/projects/*`, `/projects/{project_id}/sites`, `/runs/by-project/{project_id}`, `projects.edit`, `ProjectOut`.
