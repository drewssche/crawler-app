# Legacy audit — 2026-06-27

Цель: убрать старые сущности и названия, которые мешают целевой модели `Project → ProjectSite → CrawlPersona → Run → Page`, без сохранения лишней compatibility ради самой compatibility. Проект находится в разработке, поэтому breaking cleanup допустим, если он упрощает модель.

## Целевая модель

- `Project` — рабочий контейнер, права, настройки верхнего уровня.
- `ProjectSite` — самостоятельный сайт внутри проекта: `start_url`, `scope`, allowlist, limits, role.
- `CrawlPersona` — контекст просмотра сайта: `Гость`, позднее авторизованный/партнёр.
- `Run` принадлежит `ProjectSite` и `CrawlPersona`; `project_id` остаётся denormalized project-container bridge для aggregate/delete/events.

## Категории

### 1. Удалить сейчас / при ближайшем backend cleanup

| Legacy | Где найдено | Почему удалить | Безопасный следующий шаг |
| --- | --- | --- | --- |
| — | — | Активных runtime compatibility endpoints по project/profile не осталось. | Новые находки добавлять отдельным audit-пунктом. |

### 2. Переименовать / перенести жёсткой волной

| Legacy | Где найдено | Целевое имя | Комментарий |
| --- | --- | --- | --- |

### 3. Оставить временно с deadline

| Legacy | Почему временно оставить | Deadline |
| --- | --- | --- |
| `Run.project_id` | Удобный project-container FK для aggregate/delete/events, но не должен определять crawl scope. | Оставить как denormalized aggregate FK, если project delete/events/history остаются project-level. |
| `allowed_domains_csv` on `ProjectSite` | Это уже не список сравниваемых сайтов, а технический allowlist. Само поле не legacy по смыслу, но имя формата `_csv` и UX-история сбивают. | Позже заменить на normalized array/table или `technical_allowlist` после стабилизации crawler scope. |

### 4. Оставить как есть

| Сущность | Почему не трогать сейчас |
| --- | --- |
| `ProjectSite` | Целевая модель для сайтов проекта. |
| `CrawlPersona` | Целевая модель для гостевого/авторизованного/партнёрского контекста. |
| `Page` scoped through `Run.project_site_id` | Правильная связь для page results. |
| `allowed_domains` как концепт technical allowlist | Нужен crawler guard; проблема не в функции, а в старой трактовке как compare-sites. |

## Рекомендуемый порядок cleanup

1. **Safe docs/contract cleanup**: README/TODO wording, audit doc, убрать упоминания “profiles” из пользовательских текстов, где это не API/path — закрыто.
2. **Remove obsolete compatibility endpoints**: `POST /runs/start/{profile_id}` удалён; `GET /runs/by-profile/{profile_id}` заменён на `/runs/by-project/{project_id}` — закрыто.
3. **Frontend terminology wave**: closed for page/component/cache names and frontend props/utils.
4. **API route wave**: closed for `/profiles → /projects`, `/profiles/{id}/sites → /projects/{id}/sites`, permissions `profiles.edit → projects.edit`.
5. **DB migration wave**: closed for `profiles → projects`, `profile_id → project_id`.
6. **Project container cleanup**: closed for duplicate site fields; `ProjectSite` is the source for URL/scope/limits/allowlist and project summary/search aggregate.

## Immediate recommendation

`POST /runs/start/{profile_id}` compatibility endpoint удалён после подтверждения отсутствия frontend usage. Route/API wave перевела внешний контракт на `/projects/*`; DB/model wave перевела runtime-модель на `Project/projects/project_id`.

## Completed in this audit wave

- README wording “краулинг-профили” заменён на проекты мониторинга сайтов.
- Compatibility endpoint `POST /runs/start/{profile_id}` удалён.
- Compatibility endpoint `GET /runs/by-profile/{profile_id}` отсутствует; используется `/runs/by-project/{project_id}` и site-scoped `/runs/by-site/{site_id}`.
- Live user-facing role hints use `редактирование проектов`, not `редактирование профилей`.
- Breadcrumb legacy normalizer for names like `Профиль #1` removed from live frontend.
- Backend tests переведены на `POST /runs/start-site/{site_id}`.
- Frontend terminology wave закрыта: `ProjectDashboardPage`, `ProjectNewPage`, `projectListCache`, project-oriented live update and site settings props.
- Route/API wave закрыта: `/projects/*`, `/projects/{project_id}/sites`, `/runs/by-project/{project_id}`, `projects.edit`, `ProjectOut`.
- DB/model wave закрыта: `Project` model, `projects` table, `project_id` FK/payload fields, Alembic rename migration.
- Project container cleanup закрыт: duplicate crawl/site columns removed from `projects`, project summary/get derives URL/allowlist from first `ProjectSite`.
