import type { PageContext } from "../../api/pageContext";
import Button from "../ui/Button";
import Card from "../ui/Card";
import DrawerBody from "../ui/DrawerBody";
import SectionHeaderRow from "../ui/SectionHeaderRow";
import SlidePanel from "../ui/SlidePanel";
import { MetaText, StatusText } from "../ui/StatusText";

function seoTone(status: "pass" | "warning" | "fail"): "success" | "warning" | "danger" {
  if (status === "pass") return "success";
  if (status === "warning") return "warning";
  return "danger";
}

export default function PageContextDrawer({
  open,
  loading,
  error,
  context,
  canRetry,
  retryPending,
  retryMessage,
  retrySucceeded,
  onRetry,
  onOpenFullAnalysis,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  error: string;
  context: PageContext | null;
  canRetry: boolean;
  retryPending: boolean;
  retryMessage: string;
  retrySucceeded: boolean | null;
  onRetry: () => void;
  onOpenFullAnalysis: () => void;
  onClose: () => void;
}) {
  const recognizedScripts = context?.tracking.scripts.items.filter((script) => script.provider !== "Не определён") || [];
  const unknownScripts = context?.tracking.scripts.items.filter((script) => script.provider === "Не определён") || [];
  const personaLabel = context?.page.persona?.label || "Гость";

  return (
    <SlidePanel open={open} width="min(620px, 94vw)" onClose={onClose}>
      <div style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <SectionHeaderRow
          title={
            <div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Контекст страницы</div>
              <MetaText opacity={0.68} style={{ wordBreak: "break-word" }}>{context?.page.url || ""}</MetaText>
            </div>
          }
          actions={
            <div style={{ display: "flex", gap: 8 }}>
              {context && (
                <Button variant="accent" size="sm" onClick={onOpenFullAnalysis}>
                  Открыть полный анализ
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onClose}>Закрыть</Button>
            </div>
          }
        />
      </div>

      <DrawerBody>
        {loading && <MetaText>Анализ страницы...</MetaText>}
        {error && <StatusText tone="danger">{error}</StatusText>}

        {context && (
          <>
            <Card style={{ display: "grid", gap: 8 }}>
              <SectionHeaderRow
                title={<div style={{ fontWeight: 700 }}>Технический контекст</div>}
                actions={
                  <Button
                    variant="accent"
                    size="sm"
                    onClick={() => window.open(context.page.url, "_blank", "noopener,noreferrer")}
                  >
                    Открыть на сайте
                  </Button>
                }
              />
              <MetaText>HTTP: {context.page.status_code} · {context.page.content_type || "тип неизвестен"}</MetaText>
              <MetaText>Контекст просмотра: {context.page.persona?.label || "Гость"}</MetaText>
              <MetaText>Title: {context.meta.title || "не задан"}</MetaText>
              <MetaText>Description: {context.meta.description || "не задан"}</MetaText>
              <MetaText>Canonical: {context.meta.canonical || "не задан"}</MetaText>
              <MetaText>Robots: {context.meta.robots || "явные директивы отсутствуют"}</MetaText>
              <details>
                <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.78 }}>Технические детали</summary>
                <MetaText style={{ marginTop: 6 }}>
                  ID прогона: {context.page.run_id} · ID сайта: {context.page.project_site_id} · ID контекста: {context.page.crawl_persona_id || "—"}
                </MetaText>
              </details>
            </Card>

            {context.page.redirect && (
              <Card variant="warning" style={{ display: "grid", gap: 7 }}>
                <div style={{ fontWeight: 700 }}>
                  {context.page.redirect.status_code} · Перенаправление
                </div>
                <MetaText>{context.page.redirect.explanation}</MetaText>
                <MetaText style={{ wordBreak: "break-word" }}>
                  Куда: {context.page.redirect.target_url}
                </MetaText>
                <MetaText>Переходов: {context.page.redirect.hops}</MetaText>
                {context.page.redirect.chain.map((hop, index) => (
                  <MetaText key={`${hop.url}-${index}`} opacity={0.68} style={{ wordBreak: "break-word" }}>
                    {index + 1}. {hop.status_code} · {hop.url}
                  </MetaText>
                ))}
              </Card>
            )}

            {context.page.fetch_error_code && (
              <Card variant="danger" style={{ display: "grid", gap: 6 }}>
                <SectionHeaderRow
                  title={<div style={{ fontWeight: 700 }}>Не удалось получить страницу</div>}
                  actions={canRetry && context.page.can_retry ? (
                    <Button variant="accent" size="sm" disabled={retryPending} onClick={onRetry}>
                      {retryPending ? "Проверяем..." : `Повторить как ${personaLabel}`}
                    </Button>
                  ) : undefined}
                />
                <StatusText tone="danger">
                  {context.page.fetch_error_message || context.page.fetch_error_code}
                </StatusText>
                <MetaText opacity={0.68}>Ошибка относится только к этой странице.</MetaText>
              </Card>
            )}

            {!context.page.fetch_error_code && context.page.final_status_code >= 400 && (
              <Card variant="danger" style={{ display: "grid", gap: 6 }}>
                <SectionHeaderRow
                  title={<div style={{ fontWeight: 700 }}>HTTP {context.page.final_status_code}</div>}
                  actions={canRetry && context.page.can_retry ? (
                    <Button variant="accent" size="sm" disabled={retryPending} onClick={onRetry}>
                      {retryPending ? "Проверяем..." : `Повторить как ${personaLabel}`}
                    </Button>
                  ) : undefined}
                />
                <MetaText>Сайт вернул ошибку только для этой страницы. Исходный результат сохранён.</MetaText>
              </Card>
            )}

            {retryMessage && (
              <StatusText tone={retrySucceeded ? "success" : "warning"}>{retryMessage}</StatusText>
            )}

            {context.page.retry_attempts.length > 0 && (
              <Card style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 700 }}>Повторные проверки</div>
                <MetaText opacity={0.68}>Исходный результат страницы не изменяется.</MetaText>
                {context.page.retry_attempts.map((attempt) => (
                  <Card key={attempt.id} style={{ padding: 9, display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <StatusText tone={attempt.status === "SUCCEEDED" ? "success" : "danger"}>
                        Попытка {attempt.attempt_no}: {attempt.status === "SUCCEEDED" ? "страница доступна" : "ошибка сохранилась"}
                      </StatusText>
                      <MetaText>{attempt.response_time_ms !== null ? `${attempt.response_time_ms} мс` : "—"}</MetaText>
                    </div>
                    <MetaText>
                      {attempt.final_status_code ? `HTTP ${attempt.final_status_code}` : attempt.fetch_error_message || "Ответ не получен"}
                    </MetaText>
                    {attempt.final_url && attempt.final_url !== context.page.url && (
                      <MetaText opacity={0.68} style={{ wordBreak: "break-word" }}>Итоговый адрес: {attempt.final_url}</MetaText>
                    )}
                  </Card>
                ))}
              </Card>
            )}

            {!context.page.fetch_error_code && context.page.final_status_code < 400 && (
              <Card
                variant={context.seo.grade === "good" ? "hint" : context.seo.grade === "poor" ? "danger" : "warning"}
                style={{ display: "grid", gap: 9 }}
              >
                <SectionHeaderRow
                  title={
                    <div style={{ fontWeight: 700 }}>
                      {context.page.redirect ? "SEO конечной страницы" : "SEO checklist"}
                    </div>
                  }
                  actions={<div style={{ fontSize: 28, fontWeight: 800 }}>{context.seo.score}%</div>}
                />
                <MetaText opacity={0.7}>{context.seo.disclaimer}</MetaText>
                {context.seo.checklist.map((item) => (
                  <Card key={item.key} style={{ padding: 9, display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <StatusText tone={seoTone(item.status)}>{item.label}</StatusText>
                      <MetaText>{item.points}/{item.weight}</MetaText>
                    </div>
                    <MetaText opacity={0.75}>{item.message}</MetaText>
                  </Card>
                ))}
              </Card>
            )}

            <Card style={{ display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 700 }}>Ссылки</div>
              <MetaText>
                Всего: {context.links.total} · внутренних: {context.links.internal} · внешних: {context.links.external} · известных битых: {context.links.known_broken}
              </MetaText>
              {context.links.items.filter((item) => item.broken).map((item) => (
                <StatusText key={item.url} tone="danger" style={{ fontSize: 12, wordBreak: "break-word" }}>
                  {item.known_status} · {item.url}
                </StatusText>
              ))}
              {context.links.known_broken === 0 && <MetaText opacity={0.68}>Известных битых целей в текущем run не найдено.</MetaText>}
            </Card>

            <Card style={{ display: "grid", gap: 7 }}>
              <div style={{ fontWeight: 700 }}>Ассеты</div>
              <MetaText>
                Изображения: {context.assets.images.total} · без alt: {context.assets.images.missing_alt}
              </MetaText>
              <MetaText>Scripts: {context.assets.scripts.total} · Styles: {context.assets.styles.total}</MetaText>
              {context.assets.images.items.filter((item) => item.missing_alt).slice(0, 10).map((item) => (
                <StatusText key={item.url} tone="warning" style={{ fontSize: 12, wordBreak: "break-word" }}>
                  Нет alt: {item.url}
                </StatusText>
              ))}
            </Card>

            <Card style={{ display: "grid", gap: 9 }}>
              <SectionHeaderRow
                title={
                  <div>
                    <div style={{ fontWeight: 700 }}>Аналитика, scripts и cookies</div>
                    <MetaText opacity={0.68}>Без значений cookies, токенов и других секретов</MetaText>
                  </div>
                }
                actions={
                  <MetaText>
                    Распознано: {context.tracking.scripts.recognized}/{context.tracking.scripts.total}
                  </MetaText>
                }
              />

              {context.tracking.identifiers.length > 0 ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <MetaText opacity={0.72}>Найденные идентификаторы</MetaText>
                  {context.tracking.identifiers.map((item) => (
                    <Card key={`${item.provider_key}-${item.id}`} style={{ padding: 9, display: "grid", gap: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <StatusText tone="success">{item.provider}</StatusText>
                        <code style={{ fontSize: 12 }}>{item.id}</code>
                      </div>
                      <MetaText opacity={0.7}>
                        Тип: {item.type} · источников: {item.sources.length}
                      </MetaText>
                    </Card>
                  ))}
                </div>
              ) : (
                <MetaText opacity={0.68}>GTM/Analytics/Ads identifiers в сохранённом HTML не обнаружены.</MetaText>
              )}

              {context.tracking.scripts.items.length > 0 && (
                <div style={{ display: "grid", gap: 6 }}>
                  <MetaText opacity={0.72}>Распознанные scripts</MetaText>
                  {recognizedScripts.length === 0 && (
                    <MetaText opacity={0.68}>Распознанных аналитических или рекламных scripts нет.</MetaText>
                  )}
                  {recognizedScripts.slice(0, 10).map((script, index) => (
                    <Card key={`${script.source || "inline"}-${index}`} style={{ padding: 9, display: "grid", gap: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 650 }}>{script.provider}</div>
                        <StatusText tone={script.consent_state === "blocked_until_consent" ? "success" : "warning"}>
                          {script.consent_state === "blocked_until_consent"
                            ? "Ожидает согласия"
                            : "Момент запуска не проверен"}
                        </StatusText>
                      </div>
                      <MetaText>{script.purpose}</MetaText>
                      <MetaText opacity={0.68} style={{ wordBreak: "break-word" }}>
                        {script.source || `Inline script #${index + 1}`}
                      </MetaText>
                      <MetaText opacity={0.68}>{script.consent_explanation}</MetaText>
                    </Card>
                  ))}
                  {unknownScripts.length > 0 && (
                    <details className="inspector-details">
                      <summary>Прочие scripts · {unknownScripts.length}</summary>
                      <MetaText opacity={0.68} style={{ marginTop: 7 }}>
                        Они найдены в HTML, но их назначение нельзя надёжно определить без дополнительного анализа.
                      </MetaText>
                    </details>
                  )}
                  <MetaText opacity={0.65}>
                    Полный список scripts, ссылок и ассетов доступен в полном анализе страницы.
                  </MetaText>
                </div>
              )}

              <Card variant="hint" style={{ padding: 9, display: "grid", gap: 5 }}>
                <div style={{ fontWeight: 650 }}>Cookies</div>
                <MetaText>
                  Явно записываемых имён: {context.tracking.cookies.total}
                  {context.tracking.cookies.names.length > 0
                    ? ` · ${context.tracking.cookies.names.join(", ")}`
                    : ""}
                </MetaText>
                <MetaText opacity={0.68}>{context.tracking.cookies.explanation}</MetaText>
              </Card>

              <Card variant="warning" style={{ padding: 9, display: "grid", gap: 5 }}>
                <div style={{ fontWeight: 650 }}>Поведение согласия не проверено</div>
                <MetaText>
                  CMP: {context.tracking.consent.frameworks.length > 0
                    ? context.tracking.consent.frameworks.join(", ")
                    : "не распознан"}
                </MetaText>
                <MetaText opacity={0.72}>{context.tracking.consent.explanation}</MetaText>
              </Card>
            </Card>
          </>
        )}
      </DrawerBody>
    </SlidePanel>
  );
}
