import type { ReactNode } from "react";
import ModalActionRow from "./ModalActionRow";
import ModalShell from "./ModalShell";

type Props = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  width?: string;
  zIndex?: number;
};

export default function FormModal({
  open,
  onClose,
  title,
  children,
  actions,
  width = "min(420px, 92vw)",
  zIndex = 20,
}: Props) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      width={width}
      zIndex={zIndex}
      contentStyle={{ padding: 14, background: "#1a1a1a", display: "grid", gap: 10 }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 0 }}>{title}</h3>
      {children}
      {actions ? <ModalActionRow style={{ marginTop: 0 }}>{actions}</ModalActionRow> : null}
    </ModalShell>
  );
}
