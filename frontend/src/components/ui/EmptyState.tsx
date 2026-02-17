type Props = {
  text: string;
};

export default function EmptyState({ text }: Props) {
  return <div style={{ opacity: 0.75, fontSize: 13 }}>{text}</div>;
}
