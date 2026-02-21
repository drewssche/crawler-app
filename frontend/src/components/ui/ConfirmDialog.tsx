import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Button from "./Button";

type Props = {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "Подтвердить",
  cancelText = "Отмена",
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
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

  const content = (
    <>
      <div
        onClick={onCancel}
        style={{
          position: "fixed",
          inset: 0,
          background: visible ? "rgba(0,0,0,0.38)" : "rgba(0,0,0,0)",
          transition: "background 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
          zIndex: 40,
        }}
      />
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "grid",
          placeItems: "center",
          padding: 16,
          zIndex: 41,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: "min(560px, 96vw)",
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "#1f2024",
            boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
            padding: 18,
            display: "grid",
            gap: 10,
            pointerEvents: "auto",
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0) scale(1)" : "translateY(10px) scale(0.98)",
            transition: "opacity 220ms ease, transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 28 }}>{title}</div>
          {description && <div style={{ opacity: 0.88, fontSize: 14 }}>{description}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <Button variant="ghost" onClick={onCancel} disabled={loading}>
              {cancelText}
            </Button>
            <Button variant="primary" onClick={onConfirm} disabled={loading}>
              {loading ? "Выполнение..." : confirmText}
            </Button>
          </div>
        </div>
      </div>
    </>
  );

  if (typeof document === "undefined") return content;
  return createPortal(content, document.body);
}
