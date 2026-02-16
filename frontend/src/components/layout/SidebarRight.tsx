export default function SidebarRight() {
  return (
    <aside style={{ border: "1px solid #3333", borderRadius: 12, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>События (демо)</h3>
      <div style={{ display: "grid", gap: 8, opacity: 0.8 }}>
        <div>Профиль создан</div>
        <div>Прогон #12 завершён</div>
        <div>Изменено страниц: 3</div>
      </div>
    </aside>
  );
}
