type Props = {
  label: string;
  total?: number | null;
  fallback?: string;
};

export default function ListTotalMeta({ label, total, fallback = "—" }: Props) {
  return (
    <div style={{ fontSize: 12, opacity: 0.74 }}>
      {label}: {total ?? fallback}
    </div>
  );
}

