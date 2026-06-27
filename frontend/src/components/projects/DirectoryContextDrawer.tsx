import Button from "../ui/Button";
import Card from "../ui/Card";
import DrawerBody from "../ui/DrawerBody";
import SectionHeaderRow from "../ui/SectionHeaderRow";
import SlidePanel from "../ui/SlidePanel";
import { MetaText, StatusText } from "../ui/StatusText";
import type { ProjectStructureDirectoryContext } from "../ui/ProjectStructureTree";

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
            <Card style={{ display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 700 }}>Что находится в разделе</div>
              <MetaText>
                Страниц: {context.totalPages} · подразделов рядом: {context.directSections} · страниц на текущем уровне: {context.directPages}
              </MetaText>
              <MetaText opacity={0.7}>
                Это сводка по сохранённой структуре выбранного прогона. Сам раздел не имеет отдельного результата страницы.
              </MetaText>
            </Card>

            <Card
              variant={context.errorPages > 0 ? "warning" : "hint"}
              style={{ display: "grid", gap: 7 }}
            >
              <div style={{ fontWeight: 700 }}>Состояние вложенных страниц</div>
              <StatusText tone={context.errorPages > 0 ? "warning" : "success"}>
                {context.errorPages > 0
                  ? `Страниц с ошибками: ${context.errorPages}`
                  : "Ошибок во вложенных страницах не найдено"}
              </StatusText>
              <MetaText>Новых или изменённых результатов: {context.changedPages}</MetaText>
            </Card>

            <Card style={{ display: "grid", gap: 7 }}>
              <div style={{ fontWeight: 700 }}>Действия</div>
              <MetaText opacity={0.7}>
                Разверните раздел в дереве или используйте поиск Structure, чтобы открыть анализ конкретной страницы.
              </MetaText>
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
