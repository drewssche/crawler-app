import HintCard from "./HintCard";
import HintTable from "./HintTable";
import StructureStatusIcon from "./StructureStatusIcon";

export default function StructureLegendHint() {
  const columns = [
    { key: "icon", label: "Иконка", align: "center" as const },
    { key: "meaning", label: "Значение", align: "left" as const },
  ];
  const rows = [
    { id: "added", cells: { icon: <StructureStatusIcon status="added" />, meaning: "Новая страница" } },
    { id: "changed", cells: { icon: <StructureStatusIcon status="changed" />, meaning: "Изменения в странице" } },
    { id: "deleted", cells: { icon: <StructureStatusIcon status="deleted" />, meaning: "Страница удалена" } },
    { id: "error", cells: { icon: <StructureStatusIcon status="error" />, meaning: "Ошибка ответа/доступа" } },
  ];

  return (
    <HintCard
      title="Легенда структуры"
      subtitle="Показываем только значимые статусы; элементы без изменений идут без иконки."
      style={{ padding: 10 }}
    >
      <HintTable columns={columns} rows={rows} fontSize={12} cellPadding="6px 4px" />
    </HintCard>
  );
}
