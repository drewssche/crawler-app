import { Outlet } from "react-router-dom";
import SidebarLeft from "./SidebarLeft";
import SidebarRight from "./SidebarRight";

export default function AppLayout() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "260px minmax(0, 1fr) 280px",
        gap: 16,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <aside style={{ padding: 16, boxSizing: "border-box", minHeight: 0 }}>
        <SidebarLeft />
      </aside>
      <main style={{ padding: 16, boxSizing: "border-box", minWidth: 0, minHeight: 0 }}>
        <div
          style={{
            border: "1px solid #3333",
            borderRadius: 16,
            padding: 18,
            minHeight: "100%",
            overflow: "auto",
          }}
        >
          <Outlet />
        </div>
      </main>
      <aside style={{ padding: 16, boxSizing: "border-box", minHeight: 0 }}>
        <SidebarRight />
      </aside>
    </div>
  );
}
