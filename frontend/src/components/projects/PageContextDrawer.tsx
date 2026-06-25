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
  onClose,
}: {
  open: boolean;
  loading: boolean;
  error: string;
  context: PageContext | null;
  onClose: () => void;
}) {
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
          actions={<Button variant="ghost" size="sm" onClick={onClose}>Закрыть</Button>}
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
              <MetaText>Run #{context.page.run_id} · site #{context.page.project_site_id}</MetaText>
              <MetaText>Title: {context.meta.title || "не задан"}</MetaText>
              <MetaText>Description: {context.meta.description || "не задан"}</MetaText>
              <MetaText>Canonical: {context.meta.canonical || "не задан"}</MetaText>
              <MetaText>Robots: {context.meta.robots || "явные директивы отсутствуют"}</MetaText>
            </Card>

            <Card
              variant={context.seo.grade === "good" ? "hint" : context.seo.grade === "poor" ? "danger" : "warning"}
              style={{ display: "grid", gap: 9 }}
            >
              <SectionHeaderRow
                title={<div style={{ fontWeight: 700 }}>SEO checklist</div>}
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
          </>
        )}
      </DrawerBody>
    </SlidePanel>
  );
}
