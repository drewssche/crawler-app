import Button from "./Button";

type Props = {
  collapsed: boolean;
  onClick: () => void;
};

export default function SidebarToggleButton({ collapsed, onClick }: Props) {
  return (
    <Button
      onClick={onClick}
      size="sm"
      variant="accent"
      title={collapsed ? "Развернуть центр событий" : "Свернуть центр событий"}
      style={{
        minWidth: 30,
        width: 30,
        minHeight: 30,
        height: 30,
        padding: 0,
        borderRadius: 10,
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {collapsed ? "◀" : "▶"}
    </Button>
  );
}
