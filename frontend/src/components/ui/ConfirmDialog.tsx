import Button from "./Button";
import ModalActionRow from "./ModalActionRow";
import ModalShell from "./ModalShell";

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
  return (
    <ModalShell
      open={open}
      onClose={onCancel}
      contentStyle={{ padding: 18, display: "grid", gap: 10 }}
    >
      <div style={{ fontWeight: 800, fontSize: 28 }}>{title}</div>
      {description && <div style={{ opacity: 0.88, fontSize: 14 }}>{description}</div>}
      <ModalActionRow>
        <Button variant="ghost" onClick={onCancel} disabled={loading}>
          {cancelText}
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={loading}>
          {loading ? "Выполнение..." : confirmText}
        </Button>
      </ModalActionRow>
    </ModalShell>
  );
}
