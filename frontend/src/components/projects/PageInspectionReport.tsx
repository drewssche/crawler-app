import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createConsentAudit, type ConsentAuditResult, type PageContext } from "../../api/pageContext";
import { useAuth } from "../../hooks/auth";
import { hasPermission } from "../../utils/permissions";
import AccentPill from "../ui/AccentPill";
import Button from "../ui/Button";
import Card from "../ui/Card";
import ClearableInput from "../ui/ClearableInput";
import SegmentedControl from "../ui/SegmentedControl";
import { MetaText, StatusText } from "../ui/StatusText";

const SECTIONS = [
  ["summary", "Сводка"],
  ["seo", "SEO"],
  ["links", "Ссылки"],
  ["assets", "Ассеты"],
  ["tracking", "Аналитика"],
  ["consent", "Cookies"],
  ["retries", "Повторы"],
] as const;

type LinkFilter = "all" | "internal" | "external" | "broken";
type AssetFilter = "images" | "scripts" | "styles";

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={`inspector-${id}`} style={{ scrollMarginTop: 64, display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 800, fontSize: 15, paddingTop: 4 }}>{title}</div>
      {children}
    </section>
  );
}

function originLabel(resourceUrl: string, pageUrl: string): { label: string; tone: "info" | "neutral" } {
  try {
    const resource = new URL(resourceUrl, pageUrl);
    const page = new URL(pageUrl);
    return resource.origin === page.origin
      ? { label: "Свой сайт", tone: "info" }
      : { label: "Сторонний", tone: "neutral" };
  } catch {
    return { label: "Источник не определён", tone: "neutral" };
  }
}

function PageLinksInventory({ context }: { context: PageContext }) {
  const [filter, setFilter] = useState<LinkFilter>("all");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return context.links.items.filter((item) => {
      if (filter === "internal" && !item.internal) return false;
      if (filter === "external" && item.internal) return false;
      if (filter === "broken" && !item.broken) return false;
      if (!normalized) return true;
      return item.url.toLowerCase().includes(normalized) || item.text.toLowerCase().includes(normalized);
    });
  }, [context.links.items, filter, query]);

  return (
    <Card style={{ display: "grid", gap: 9 }}>
      <MetaText>
        Всего: {context.links.total} · внутренних: {context.links.internal} · внешних: {context.links.external} · известных битых: {context.links.known_broken}
      </MetaText>
      <SegmentedControl
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: `Все · ${context.links.items.length}` },
          { value: "internal", label: `Внутренние · ${context.links.internal}` },
          { value: "external", label: `Внешние · ${context.links.external}` },
          { value: "broken", label: `Битые · ${context.links.known_broken}` },
        ]}
      />
      <ClearableInput
        value={query}
        onChange={setQuery}
        placeholder="Найти ссылку по адресу или тексту…"
      />
      <MetaText opacity={0.65}>
        HTTP показывается только для адресов, которые встретились в этом же прогоне. Внешние ссылки пока не проверяются отдельным запросом.
      </MetaText>
      <div className="inspector-inventory-list">
        {filtered.map((item, index) => (
          <Card key={`${item.url}-${index}`} style={{ padding: 9, display: "grid", gap: 5 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <AccentPill tone={item.internal ? "info" : "neutral"}>
                {item.internal ? "Внутренняя" : "Внешняя"}
              </AccentPill>
              {item.broken && <AccentPill tone="danger">Недоступна · HTTP {item.known_status || "—"}</AccentPill>}
              {!item.broken && item.known_status !== null && <AccentPill tone="success">HTTP {item.known_status}</AccentPill>}
              {!item.internal && item.known_status === null && <AccentPill tone="neutral">Не проверена</AccentPill>}
            </div>
            <div className="inspector-resource-url">{item.url}</div>
            <MetaText opacity={0.72}>
              Текст ссылки: {item.text || "не задан"}
            </MetaText>
          </Card>
        ))}
        {filtered.length === 0 && (
          <MetaText>
            {query.trim() ? "По текущему поиску ссылок не найдено." : "В этой категории ссылок нет."}
          </MetaText>
        )}
      </div>
      {context.links.total > context.links.items.length && (
        <MetaText opacity={0.65}>
          Показаны первые {context.links.items.length} из {context.links.total} ссылок сохранённого анализа.
        </MetaText>
      )}
    </Card>
  );
}

function PageAssetsInventory({ context }: { context: PageContext }) {
  const [filter, setFilter] = useState<AssetFilter>("images");
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const imageRows = context.assets.images.items.filter((item) =>
    !normalized || item.url.toLowerCase().includes(normalized) || (item.alt || "").toLowerCase().includes(normalized),
  );
  const urlRows = (filter === "scripts" ? context.assets.scripts.items : context.assets.styles.items)
    .filter((url) => !normalized || url.toLowerCase().includes(normalized));

  return (
    <Card style={{ display: "grid", gap: 9 }}>
      <MetaText>
        Изображения: {context.assets.images.total} · без alt: {context.assets.images.missing_alt} · scripts: {context.assets.scripts.total} · styles: {context.assets.styles.total}
      </MetaText>
      <SegmentedControl
        value={filter}
        onChange={setFilter}
        options={[
          { value: "images", label: `Изображения · ${context.assets.images.total}` },
          { value: "scripts", label: `Scripts · ${context.assets.scripts.total}` },
          { value: "styles", label: `Styles · ${context.assets.styles.total}` },
        ]}
      />
      <ClearableInput
        value={query}
        onChange={setQuery}
        placeholder="Найти ассет по адресу или alt…"
      />
      <div className="inspector-inventory-list">
        {filter === "images" && imageRows.map((item, index) => {
          const origin = originLabel(item.url, context.page.url);
          return (
            <Card key={`${item.url}-${index}`} style={{ padding: 9, display: "grid", gap: 5 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <AccentPill tone={origin.tone}>{origin.label}</AccentPill>
                <AccentPill tone={item.missing_alt ? "warning" : "success"}>
                  {item.missing_alt ? "Alt отсутствует" : "Alt задан"}
                </AccentPill>
              </div>
              <div className="inspector-resource-url">{item.url}</div>
              <MetaText opacity={0.72}>Alt: {item.alt || "не задан"}</MetaText>
            </Card>
          );
        })}
        {filter !== "images" && urlRows.map((url, index) => {
          const origin = originLabel(url, context.page.url);
          return (
            <Card key={`${url}-${index}`} style={{ padding: 9, display: "grid", gap: 5 }}>
              <div><AccentPill tone={origin.tone}>{origin.label}</AccentPill></div>
              <div className="inspector-resource-url">{url}</div>
            </Card>
          );
        })}
        {((filter === "images" && imageRows.length === 0) || (filter !== "images" && urlRows.length === 0)) && (
          <MetaText>{query.trim() ? "По текущему поиску ассетов не найдено." : "Ассеты этой категории не обнаружены."}</MetaText>
        )}
      </div>
    </Card>
  );
}

function ScriptCard({
  script,
  index,
}: {
  script: PageContext["tracking"]["scripts"]["items"][number];
  index: number;
}) {
  return (
    <Card style={{ padding: 9, display: "grid", gap: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>{script.provider}</div>
        <AccentPill tone={script.consent_state === "blocked_until_consent" ? "success" : "warning"}>
          {script.consent_state === "blocked_until_consent" ? "Ожидает согласия" : "Запуск не проверен"}
        </AccentPill>
      </div>
      <MetaText>{script.purpose}</MetaText>
      <div className="inspector-resource-url">{script.source || `Inline script #${index + 1}`}</div>
      <MetaText opacity={0.68}>{script.consent_explanation}</MetaText>
    </Card>
  );
}

function PageTrackingInventory({ context }: { context: PageContext }) {
  const recognized = context.tracking.scripts.items.filter((script) => script.provider !== "Не определён");
  const unknown = context.tracking.scripts.items.filter((script) => script.provider === "Не определён");
  return (
    <div style={{ display: "grid", gap: 9 }}>
      <Card variant={context.tracking.identifiers.length > 0 ? "hint" : "default"} style={{ display: "grid", gap: 7 }}>
        <div style={{ fontWeight: 700 }}>
          {context.tracking.identifiers.length > 0
            ? `Распознано идентификаторов: ${context.tracking.identifiers.length}`
            : "Идентификаторы аналитики не обнаружены"}
        </div>
        <MetaText opacity={0.7}>
          Найденный script или ID означает присутствие в сохранённом HTML, но не подтверждает фактическую отправку данных.
        </MetaText>
        {context.tracking.identifiers.map((item) => (
          <Card key={`${item.provider_key}-${item.id}`} style={{ padding: 9, display: "grid", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <AccentPill tone="success">{item.provider}</AccentPill>
              <code>{item.id}</code>
            </div>
            <MetaText>Тип: {item.type} · источников: {item.sources.length}</MetaText>
          </Card>
        ))}
      </Card>

      {recognized.length > 0 && (
        <div style={{ display: "grid", gap: 7 }}>
          <div style={{ fontWeight: 700 }}>Распознанные scripts · {recognized.length}</div>
          {recognized.map((script, index) => <ScriptCard key={`${script.source || "inline"}-${index}`} script={script} index={index} />)}
        </div>
      )}

      {unknown.length > 0 && (
        <details className="inspector-details">
          <summary>Прочие scripts · {unknown.length}</summary>
          <MetaText opacity={0.68} style={{ margin: "7px 0" }}>
            Назначение этих scripts нельзя достоверно определить только по статическому HTML.
          </MetaText>
          <div style={{ display: "grid", gap: 7 }}>
            {unknown.map((script, index) => <ScriptCard key={`${script.source || "inline"}-${index}`} script={script} index={index} />)}
          </div>
        </details>
      )}

      {context.tracking.scripts.total === 0 && <MetaText>Scripts в сохранённом HTML не найдены.</MetaText>}
    </div>
  );
}

function RequestSummary({
  title,
  cookies,
  requests,
}: {
  title: string;
  cookies: string[];
  requests: ConsentAuditResult["before_consent"]["requests"];
}) {
  return (
    <Card style={{ padding: 9, display: "grid", gap: 6 }}>
      <div style={{ fontWeight: 700 }}>{title}</div>
      <MetaText>Cookies: {cookies.join(", ") || "не обнаружены"}</MetaText>
      <MetaText>Requests: всего {requests.total} · scripts {requests.script} · xhr/fetch {requests.xhr_fetch}</MetaText>
      <MetaText>Providers: {requests.tracking_providers.join(", ") || "не распознаны"}</MetaText>
      {requests.sample.length > 0 && (
        <details className="inspector-details">
          <summary>Примеры запросов · {requests.sample.length}</summary>
          <div style={{ display: "grid", gap: 4, marginTop: 7 }}>
            {requests.sample.map((url) => (
              <div key={url} className="inspector-resource-url">{url}</div>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}

function ConsentRuntimeAudit({ context }: { context: PageContext }) {
  const { user } = useAuth();
  const canRunAudit = hasPermission(user?.role, "crawler.run");
  const [audit, setAudit] = useState<ConsentAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runAudit() {
    setLoading(true);
    setError("");
    try {
      const result = await createConsentAudit(context.page.run_id, context.page.url);
      setAudit(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить browser-аудит.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 9 }}>
      <Card variant="hint" style={{ display: "grid", gap: 7 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 700 }}>Browser-аудит до/после согласия</div>
            <MetaText opacity={0.72}>
              Запускается только по кнопке. Проверяет наблюдаемое поведение, а не юридическую корректность баннера.
            </MetaText>
          </div>
          <Button
            size="sm"
            variant="primary"
            disabled={!canRunAudit || loading}
            onClick={() => void runAudit()}
          >
            {loading ? "Проверяем..." : "Проверить до/после"}
          </Button>
        </div>
        {!canRunAudit && (
          <MetaText opacity={0.68}>
            У вашей роли есть доступ к результатам, но запуск browser-аудита доступен только ролям с правом запуска crawler.
          </MetaText>
        )}
        <MetaText opacity={0.68}>
          Во время аудита scripts могут загрузиться с сайта. Значения cookies/tokens не показываются — только имена и типы запросов.
        </MetaText>
      </Card>

      {error && <StatusText tone="danger">{error}</StatusText>}

      {audit && (
        <div style={{ display: "grid", gap: 9 }}>
          <Card variant={audit.after_consent.attempted ? "hint" : "warning"} style={{ display: "grid", gap: 5 }}>
            <div style={{ fontWeight: 700 }}>
              {audit.after_consent.attempted ? "Кнопка согласия нажата" : "Кнопка согласия не найдена"}
            </div>
            <MetaText>{audit.consent_action.explanation}</MetaText>
            {audit.after_consent.action_label && <MetaText>Кнопка: {audit.after_consent.action_label}</MetaText>}
            <MetaText opacity={0.68}>{audit.explanation}</MetaText>
          </Card>
          <RequestSummary
            title="До согласия"
            cookies={audit.before_consent.cookies}
            requests={audit.before_consent.requests}
          />
          <RequestSummary
            title="После согласия"
            cookies={audit.after_consent.cookies}
            requests={audit.after_consent.requests}
          />
          <Card style={{ padding: 9, display: "grid", gap: 5 }}>
            <div style={{ fontWeight: 700 }}>Что изменилось после согласия</div>
            <MetaText>Новые cookies: {audit.after_consent.new_cookies.join(", ") || "не появились"}</MetaText>
            <MetaText>
              Новые tracking providers: {audit.after_consent.new_tracking_providers.join(", ") || "не появились или не распознаны"}
            </MetaText>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function PageInspectionReport({ context }: { context: PageContext }) {
  const [activeSection, setActiveSection] = useState("summary");

  useEffect(() => {
    const nodes = SECTIONS
      .map(([id]) => document.getElementById(`inspector-${id}`))
      .filter(Boolean) as HTMLElement[];
    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
        if (visible?.target.id) setActiveSection(visible.target.id.replace("inspector-", ""));
      },
      { rootMargin: "-70px 0px -60% 0px", threshold: [0, 0.1, 0.5] },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [context.page.id]);

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", minHeight: 0 }}>
      <nav className="inspector-section-nav" aria-label="Разделы анализа страницы">
        {SECTIONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={activeSection === id ? "active" : ""}
            onClick={() => document.getElementById(`inspector-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            {label}
          </button>
        ))}
      </nav>

      <div style={{ display: "grid", gap: 16, padding: "10px 2px 30px" }}>
        <Section id="summary" title="Сводка и HTTP">
          <Card style={{ display: "grid", gap: 5 }}>
            <MetaText>HTTP: {context.page.status_code} → {context.page.final_status_code}</MetaText>
            <MetaText>Контекст просмотра: {context.page.persona?.label || "Гость"}</MetaText>
            <MetaText style={{ wordBreak: "break-word" }}>URL: {context.page.url}</MetaText>
            <MetaText>Title: {context.meta.title || "не задан"}</MetaText>
            <MetaText>Время ответа: {context.page.response_time_ms !== null ? `${context.page.response_time_ms} мс` : "—"}</MetaText>
            <details className="inspector-details">
              <summary>Что означают технические поля</summary>
              <MetaText opacity={0.7} style={{ marginTop: 7 }}>
                HTTP показывает ответ сервера. Title используется браузером и поисковыми системами. Время ответа измерено при сохранении страницы и может меняться между прогонами.
              </MetaText>
              <MetaText opacity={0.62} style={{ marginTop: 5 }}>
                ID прогона: {context.page.run_id} · ID сайта: {context.page.project_site_id} · ID контекста: {context.page.crawl_persona_id || "—"}
              </MetaText>
            </details>
          </Card>
          {context.page.redirect && (
            <Card variant="warning">
              <StatusText tone="warning">{context.page.redirect.explanation}</StatusText>
              <MetaText style={{ wordBreak: "break-word" }}>Куда: {context.page.redirect.target_url}</MetaText>
            </Card>
          )}
          {context.page.fetch_error_message && <StatusText tone="danger">{context.page.fetch_error_message}</StatusText>}
        </Section>

        <Section id="seo" title="SEO">
          <Card variant={context.seo.grade === "good" ? "hint" : "warning"} style={{ display: "grid", gap: 7 }}>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{context.seo.score}%</div>
            <MetaText>{context.seo.disclaimer}</MetaText>
            {context.seo.checklist.map((item) => (
              <div key={item.key} style={{ display: "grid", gap: 2, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 6 }}>
                <StatusText tone={item.status === "pass" ? "success" : item.status === "warning" ? "warning" : "danger"}>
                  {item.label} · {item.points}/{item.weight}
                </StatusText>
                <MetaText opacity={0.7}>{item.message}</MetaText>
              </div>
            ))}
          </Card>
        </Section>

        <Section id="links" title="Ссылки">
          <PageLinksInventory context={context} />
        </Section>

        <Section id="assets" title="Ассеты">
          <PageAssetsInventory context={context} />
        </Section>

        <Section id="tracking" title="Аналитика и scripts">
          <PageTrackingInventory context={context} />
        </Section>

        <Section id="consent" title="Cookies и consent">
          <Card variant="hint" style={{ display: "grid", gap: 5 }}>
            <div style={{ fontWeight: 700 }}>Cookies, найденные в коде</div>
            <MetaText>Имена: {context.tracking.cookies.names.join(", ") || "не обнаружены"}</MetaText>
            <MetaText opacity={0.68}>{context.tracking.cookies.explanation}</MetaText>
          </Card>
          <Card variant="warning" style={{ display: "grid", gap: 5 }}>
            <div style={{ fontWeight: 700 }}>Статический анализ не подтверждает запуск</div>
            <MetaText>CMP: {context.tracking.consent.frameworks.join(", ") || "не распознан"}</MetaText>
            <MetaText opacity={0.72}>{context.tracking.consent.explanation}</MetaText>
          </Card>
          <ConsentRuntimeAudit context={context} />
        </Section>

        <Section id="retries" title="Повторные проверки">
          {context.page.retry_attempts.length === 0 && <MetaText>Повторных проверок не было.</MetaText>}
          {context.page.retry_attempts.map((attempt) => (
            <Card key={attempt.id}>
              <StatusText tone={attempt.status === "SUCCEEDED" ? "success" : "danger"}>
                Попытка {attempt.attempt_no}: {attempt.status === "SUCCEEDED" ? "страница доступна" : "ошибка сохранилась"}
              </StatusText>
              <MetaText>{attempt.final_status_code ? `HTTP ${attempt.final_status_code}` : attempt.fetch_error_message || "Ответ не получен"}</MetaText>
            </Card>
          ))}
        </Section>
      </div>
    </div>
  );
}
