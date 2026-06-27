import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { apiGet } from "../api/client";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import RoleBadge from "../components/ui/RoleBadge";
import SegmentedControl from "../components/ui/SegmentedControl";
import { MetaText, StatusText } from "../components/ui/StatusText";
import ToastHost, { type ToastItem } from "../components/ui/ToastHost";
import type { BaseRole } from "../utils/roles";
import { hasPermission, type Permission } from "../utils/permissions";

type DebugCapabilities = {
  enabled: boolean;
  fixture_only: boolean;
  environment: string;
};

type FixtureEvent = {
  title: string;
  body: string;
  tone: "info" | "warning" | "danger";
  state: string;
};

const CLIENT_ENABLED = String(import.meta.env.VITE_ENABLE_UI_DEBUG ?? "false").toLowerCase() === "true";
const ROLES: BaseRole[] = ["viewer", "editor", "admin", "root-admin"];
const PERMISSIONS: Permission[] = [
  "data.view",
  "crawler.run",
  "projects.edit",
  "events.view",
  "audit.view",
  "users.manage",
  "root_admins.manage",
];
const SURFACES: Array<{ label: string; permission: Permission }> = [
  { label: "Рабочая область и проекты", permission: "data.view" },
  { label: "Создание и настройки проекта", permission: "projects.edit" },
  { label: "Запуск и повтор прогонов", permission: "crawler.run" },
  { label: "Пользователи", permission: "users.manage" },
  { label: "Центр событий", permission: "events.view" },
  { label: "Журнал и мониторинг", permission: "audit.view" },
  { label: "Системные администраторы", permission: "root_admins.manage" },
];

const EVENT_FIXTURES: FixtureEvent[] = [
  {
    title: "Новый запрос доступа",
    body: "new.user@example.com запросил доступ к приложению.",
    tone: "info",
    state: "не прочитано",
  },
  {
    title: "Смена роли",
    body: "Администратор назначил пользователю роль «Редактор».",
    tone: "warning",
    state: "обработано",
  },
  {
    title: "Аномалия мониторинга",
    body: "Количество HTTP 5xx выше baseline для сайта Беларусь.",
    tone: "danger",
    state: "требует внимания",
  },
];

function toastFixture(accent: ToastItem["accent"], index: number): ToastItem {
  const labels: Record<string, string> = {
    info: "Информационный toast",
    success: "Операция выполнена",
    warning: "Требуется внимание",
    danger: "Критическая ошибка",
  };
  return {
    id: `ui-debug-${accent}-${index}`,
    title: labels[String(accent)] || "Debug toast",
    body:
      accent === "warning"
        ? "Длинный текст можно проверить наведением: таймер и progress должны остановиться до ухода курсора."
        : "Локальный UI fixture. Реальные данные и уведомления не создаются.",
    accent,
    actionLabel: "Действие",
    secondaryActionLabel: "Контекст",
  };
}

export default function UiDebugPage() {
  const [capabilities, setCapabilities] = useState<DebugCapabilities | null>(null);
  const [loadError, setLoadError] = useState("");
  const [previewRole, setPreviewRole] = useState<BaseRole>("viewer");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [toastSeq, setToastSeq] = useState(1);

  useEffect(() => {
    if (!CLIENT_ENABLED) return;
    apiGet<DebugCapabilities>("/auth/ui-debug-capabilities")
      .then(setCapabilities)
      .catch((error) => setLoadError(error instanceof Error ? error.message : "Не удалось проверить debug-режим."));
  }, []);

  const allowedPermissions = useMemo(
    () => PERMISSIONS.filter((permission) => hasPermission(previewRole, permission)),
    [previewRole],
  );

  if (!CLIENT_ENABLED) return <Navigate to="/" replace />;
  if (loadError) return <StatusText tone="danger">{loadError}</StatusText>;
  if (!capabilities) return <MetaText>Проверка UI Debug...</MetaText>;
  if (!capabilities.enabled) {
    return (
      <Card variant="warning">
        <StatusText tone="warning">
          UI Debug отключён backend-конфигурацией или приложение работает в production.
        </StatusText>
      </Card>
    );
  }

  function showToast(accent: ToastItem["accent"]) {
    const next = toastFixture(accent, toastSeq);
    setToastSeq((value) => value + 1);
    setToasts((current) => [next, ...current].slice(0, 3));
  }

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 980 }}>
      <ToastHost items={toasts} onClose={(id) => setToasts((items) => items.filter((item) => item.id !== id))} autoCloseMs={8000} />

      <Card variant="warning" style={{ position: "sticky", top: 0, zIndex: 5 }}>
        <div style={{ fontWeight: 800 }}>UI DEBUG — реальные права и данные не изменены</div>
        <MetaText>
          Fixture-only режим · environment: {capabilities.environment} · backend writes отсутствуют.
        </MetaText>
      </Card>

      <Card>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 800 }}>Preview роли</div>
          <SegmentedControl
            value={previewRole}
            onChange={setPreviewRole}
            options={ROLES.map((role) => ({ value: role, label: role }))}
          />
          <div><RoleBadge role={previewRole} /></div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PERMISSIONS.map((permission) => (
              <span
                key={permission}
                style={{
                  padding: "4px 8px",
                  borderRadius: 999,
                  fontSize: 12,
                  border: "1px solid rgba(255,255,255,0.15)",
                  opacity: allowedPermissions.includes(permission) ? 1 : 0.4,
                }}
              >
                {allowedPermissions.includes(permission) ? "✓" : "—"} {permission}
              </span>
            ))}
          </div>
          <MetaText>
            Preview влияет только на эту матрицу и fixtures. Текущий пользователь сохраняет реальные backend-права.
          </MetaText>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 8 }}>
            {SURFACES.map((surface) => {
              const available = hasPermission(previewRole, surface.permission);
              return (
                <Card key={surface.permission} style={{ opacity: available ? 1 : 0.48 }}>
                  <div style={{ fontWeight: 700 }}>{available ? "Доступно" : "Скрыто"}</div>
                  <MetaText>{surface.label}</MetaText>
                </Card>
              );
            })}
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 800 }}>Toast gallery</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button size="sm" variant="ghost" onClick={() => showToast("info")}>Info</Button>
            <Button size="sm" variant="ghost" onClick={() => showToast("success")}>Success</Button>
            <Button size="sm" variant="ghost" onClick={() => showToast("warning")}>Warning</Button>
            <Button size="sm" variant="ghost" onClick={() => showToast("danger")}>Danger</Button>
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 800 }}>Event Center fixtures</div>
          {EVENT_FIXTURES.map((event) => (
            <Card key={event.title} variant={event.tone === "danger" ? "danger" : event.tone === "warning" ? "warning" : "hint"}>
              <div style={{ display: "grid", gap: 5 }}>
                <div style={{ fontWeight: 700 }}>{event.title}</div>
                <MetaText>{event.body}</MetaText>
                <MetaText opacity={0.62}>Состояние: {event.state}</MetaText>
              </div>
            </Card>
          ))}
        </div>
      </Card>

      <Card>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 800 }}>Редкие состояния</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
            {["Пользователь ожидает подтверждения", "Пользователь заблокирован", "Проект не запускался", "Прогон выполняется", "Прогон завершён с ошибкой", "Недостаточно данных для anomaly baseline"].map((label) => (
              <Card key={label} style={{ minHeight: 72, display: "grid", alignContent: "center" }}>
                <MetaText>{label}</MetaText>
              </Card>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
