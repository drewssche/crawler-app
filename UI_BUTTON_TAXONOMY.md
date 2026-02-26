# UI Button Taxonomy (Baseline 2026-02-25)

Цель: единая схема кнопок по контекстам UI, чтобы новые страницы/окна собирались без style-drift.

## Category Map

1. `primary`
   - Назначение: главное действие блока/экрана.
   - Примеры: `Сохранить`, `Применить`, `Подтвердить`.

2. `secondary`
   - Назначение: вторичное важное действие.
   - Примеры: `Обновить`, `Открыть`.

3. `ghost`
   - Назначение: нейтральные/вспомогательные действия.
   - Примеры: `Закрыть`, `Отмена`, дополнительные действия.

4. `danger`
   - Назначение: деструктивные действия.
   - Примеры: `Удалить`, `Отозвать`, irreversible операции.

5. `accent`
   - Назначение: навигационный/контекстный CTA.
   - Примеры: переходы в разделы, акцентные кнопки layout/sidebar/workspace.

6. `export`
   - Назначение: экспортные действия.
   - Правило: только через `variant="export"` + `exportProgress`.

7. `panel-toggle`
   - Назначение: раскрыть/свернуть секции.
   - Правило: обязательно с `active`.

## Context -> Canonical Component

1. `drawer`
   - `Button` (`ghost/secondary/danger`) + domain wrappers.

2. `sidebar card actions`
   - `EventCardActions` (+ `CardActionButton`) и `IconGhostButton`.

3. `modal footer`
   - `ModalActionRow` + `Button` (`ghost/primary` или `danger`).

4. `table/toolbar`
   - `Button` (`secondary/export/panel-toggle`) без page-level style-override.

5. `inline text actions`
   - `InlineActionButton` (не `Button` со style-reset).

## Size Contract

1. Outside controls (вне карточек/строк)
   - Базовый размер: `md` (визуальный baseline как у primary).

2. Inside controls (внутри карточек/строк/list items)
   - Базовый размер: compact contract через `CardActionButton` (`sm` + уменьшенные токены).

## Motion Contract

1. Единый hover/press паттерн
   - hover: небольшой lift + мягкий shadow.
   - active: возврат к baseline + легкий press-scale.

2. Variant-specific motion
   - Допускаются только цветовые/контурные отличия.
   - Геометрия и timing остаются в общем паттерне.

## Color Accent Contract

1. `primary`: blue action accent.
2. `accent`: teal/cyan navigation accent.
3. `secondary`: neutral utility tone.
4. `ghost`: light neutral helper tone.
5. `danger`: red destructive accent.
6. `export`: dedicated export accent.
7. `panel-toggle`: muted blue toggle accent.

## Single-Use Pilot Patterns

1. `RangePresetGroup`
   - Контекст: quick range presets (`15м/1ч/6ч/24ч`) в Monitoring.
   - Статус: pilot pattern, готов к reuse при 2-м call-site.

2. `ActionStateMarker`
   - Контекст: compact state marker (`i/!`) в action details.
   - Статус: pilot pattern, готов к reuse при 2-м call-site.

## Reuse Rule

- Новые кнопочные кейсы: сначала выбрать категорию и context-контракт из этой матрицы.
- Если кейс не укладывается: фиксируем `single-use` в backlog.
- Вынос в shared обязателен при `>=2 call-sites` или при согласованном pilot-exception (как в этой волне).
