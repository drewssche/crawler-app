import { useEffect, useState, type ReactNode } from "react";

export default function SlidePanel({
  open,
  width = "min(520px, 92vw)",
  onClose,
  children,
}: {
  open: boolean;
  width?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const t = window.setTimeout(() => setVisible(true), 10);
      return () => window.clearTimeout(t);
    }
    setVisible(false);
    const t = window.setTimeout(() => setMounted(false), 220);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!mounted) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: visible ? "rgba(0, 0, 0, 0.38)" : "rgba(0, 0, 0, 0)",
          transition: "background 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
          zIndex: 30,
        }}
      />
      <aside
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width,
          height: "100vh",
          background: "#1f2024",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "-16px 0 40px rgba(0,0,0,0.45)",
          transform: visible ? "translateX(0)" : "translateX(100%)",
          transition: "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
          zIndex: 31,
          display: "grid",
          gridTemplateRows: "auto 1fr",
        }}
      >
        {children}
      </aside>
    </>
  );
}
