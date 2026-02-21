import { useEffect, useRef, type CSSProperties } from "react";
import Button from "./Button";

type ActionMenuItem = {
  key: string;
  label: string;
  onClick: () => void;
};

export default function ActionMenuPopover({
  open,
  top,
  right = 0,
  items,
  onClose,
  buttonStyle,
}: {
  open: boolean;
  top: number;
  right?: number;
  items: ActionMenuItem[];
  onClose: () => void;
  buttonStyle: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top,
        right,
        zIndex: 30,
        minWidth: 210,
        border: "1px solid #3333",
        borderRadius: 10,
        background: "#171717",
        padding: 6,
        display: "grid",
        gap: 4,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <Button
          key={item.key}
          onClick={() => {
            item.onClick();
            onClose();
          }}
          variant="ghost"
          size="sm"
          style={{ ...buttonStyle, width: "100%", textAlign: "left", justifyContent: "flex-start" }}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}
