import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  zIndex?: number;
  closeOnOverlay?: boolean;
  contentStyle?: CSSProperties;
};

export default function ModalShell({
  open,
  onClose,
  children,
  width = "min(560px, 96vw)",
  zIndex = 40,
  closeOnOverlay = true,
  contentStyle,
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
        onClick={() => {
          if (closeOnOverlay) onClose();
        }}
        style={{
          position: "fixed",
          inset: 0,
          background: visible ? "rgba(0,0,0,0.38)" : "rgba(0,0,0,0)",
          transition: "background 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
          zIndex,
        }}
      />
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "grid",
          placeItems: "center",
          padding: 16,
          zIndex: zIndex + 1,
          pointerEvents: "none",
        }}
      >
        <div
          role="dialog"
          aria-modal
          style={{
            width,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "#1f2024",
            boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
            pointerEvents: "auto",
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0) scale(1)" : "translateY(10px) scale(0.98)",
            transition: "opacity 220ms ease, transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
            ...contentStyle,
          }}
        >
          {children}
        </div>
      </div>
    </>
  );

  if (typeof document === "undefined") return content;
  return createPortal(content, document.body);
}

