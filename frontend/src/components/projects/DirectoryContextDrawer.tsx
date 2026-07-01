import Button from "../ui/Button";
import Card from "../ui/Card";
import DrawerBody from "../ui/DrawerBody";
import SectionHeaderRow from "../ui/SectionHeaderRow";
import SlidePanel from "../ui/SlidePanel";
import { MetaText, StatusText } from "../ui/StatusText";
import type { ProjectStructureDirectoryContext } from "../ui/ProjectStructureTree";

function directoryState(context: ProjectStructureDirectoryContext): {
  label: string;
  tone: "success" | "warning" | "muted";
} {
  if (context.errorPages > 0) return { label: `${context.errorPages} с ошибками`, tone: "warning" };
  if (context.changedPages > 0) return { label: `${context.changedPages} изменено`, tone: "warning" };
  if (context.totalPages > 0) return { label: "В порядке", tone: "success" };
  return { label: "Пусто", tone: "muted" };
}

export default function DirectoryContextDrawer({
  context,
  onClose,
}: {
  context: ProjectStructureDirectoryContext | null;
  onClose: () => void;
}) {
  return (
    <SlidePanel open={Boolean(context)} width="min(560px, 94vw)" onClose={onClose}>
      <div style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <SectionHeaderRow
          title={
            <div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Контекст раздела</div>
              <MetaText opacity={0.68} style={{ wordBreak: "break-word" }}>{context?.url || ""}</MetaText>
            </div>
          }
          actions={<Button variant="ghost" size="sm" onClick={onClose}>Закрыть</Button>}
        />
      </div>

      <DrawerBody>
        {context && (
          <>
            <Card
              variant={context.errorPages > 0 ? "warning" : "hint"}
              style={{ display: "grid", gap: 10 }}
            >
              <SectionHeaderRow
                title={<div style={{ fontWeight: 700 }}>Состояние раздела</div>}
                actions={<StatusText tone={directoryState(context).tone}>{directoryState(context).label}</StatusText>}
              />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                {[
                  { label: "Страницы", value: context.totalPages },
                  { label: "Разделы", value: context.directSections },
                  { label: "На уровне", value: context.directPages },
                ].map((item) => (
                  <Card key={item.label} style={{ padding: 9, background: "rgba(255,255,255,0.025)" }}>
                    <MetaText opacity={0.68}>{item.label}</MetaText>
                    <div style={{ fontSize: 22, fontWeight: 800 }}>{item.value}</div>
                  </Card>
                ))}
              </div>
              <MetaText opacity={0.72}>Изменённых или новых страниц внутри: {context.changedPages}</MetaText>
            </Card>

            <Card style={{ display: "grid", gap: 7 }}>
              <div style={{ fontWeight: 700 }}>Действия</div>
              <div>
                <Button
                  variant="accent"
                  size="sm"
                  onClick={() => window.open(context.url, "_blank", "noopener,noreferrer")}
                >
                  Открыть раздел на сайте
                </Button>
              </div>
            </Card>
          </>
        )}
      </DrawerBody>
    </SlidePanel>
  );
}
