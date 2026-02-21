import { memo, useState } from "react";
import type { EventItem } from "../../api/events";
import ActionMenuPopover from "./ActionMenuPopover";
import Button from "./Button";

type Props = {
  item: EventItem;
  compact?: boolean;
  onOpen: (item: EventItem) => void;
  onToggleRead?: (item: EventItem) => void;
  onToggleDismiss?: (item: EventItem) => void;
  onFilterSimilar?: (item: EventItem) => void;
  onOpenUser?: (item: EventItem) => void;
  showReadToggle?: boolean;
  showDismissToggle?: boolean;
  showMoreMenu?: boolean;
};

function EventCardActions({
  item,
  compact = false,
  onOpen,
  onToggleRead,
  onToggleDismiss,
  onFilterSimilar,
  onOpenUser,
  showReadToggle = true,
  showDismissToggle = true,
  showMoreMenu = true,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  const baseStyle = {
    fontSize: compact ? 11 : 12,
    padding: compact ? "0 6px" : "6px 10px",
    borderRadius: compact ? 8 : 10,
    minHeight: compact ? 24 : 30,
  } as const;

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", position: "relative" }}>
      <Button
        onClick={(e) => {
          e.stopPropagation();
          onOpen(item);
        }}
        variant="secondary"
        size="sm"
        style={baseStyle}
      >
        {"\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a"}
      </Button>
      {showReadToggle && onToggleRead && (
        <Button
          onClick={(e) => {
            e.stopPropagation();
            onToggleRead(item);
          }}
          variant="ghost"
          size="sm"
          style={baseStyle}
        >
          {item.is_read ? "\u041e\u0442\u043c\u0435\u0442\u0438\u0442\u044c \u043d\u0435\u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043d\u043d\u044b\u043c" : "\u041e\u0442\u043c\u0435\u0442\u0438\u0442\u044c \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043d\u043d\u044b\u043c"}
        </Button>
      )}
      {showDismissToggle && onToggleDismiss && (
        <Button
          onClick={(e) => {
            e.stopPropagation();
            onToggleDismiss(item);
          }}
          variant="ghost"
          size="sm"
          style={baseStyle}
        >
          {item.is_dismissed ? "\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c" : "\u0421\u043a\u0440\u044b\u0442\u044c"}
        </Button>
      )}

      {showMoreMenu && (onFilterSimilar || onOpenUser) && (
        <div style={{ position: "relative", display: "inline-flex" }}>
          <Button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            variant="secondary"
            size="sm"
            style={baseStyle}
            title={"\u0414\u0440\u0443\u0433\u0438\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f"}
          >
            {"\u0415\u0449\u0435"}
          </Button>
          <ActionMenuPopover
            open={menuOpen}
            top={compact ? 24 : 36}
            items={[
              ...(onFilterSimilar
                ? [
                    {
                      key: "filter-similar",
                      label: "\u0424\u0438\u043b\u044c\u0442\u0440\u043e\u0432\u0430\u0442\u044c \u043f\u043e\u0445\u043e\u0436\u0438\u0435",
                      onClick: () => onFilterSimilar(item),
                    },
                  ]
                : []),
              ...(onOpenUser
                ? [
                    {
                      key: "open-user",
                      label: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f",
                      onClick: () => onOpenUser(item),
                    },
                  ]
                : []),
            ]}
            onClose={() => setMenuOpen(false)}
            buttonStyle={{
              border: "1px solid #3333",
              background: "#1a1a1a",
              color: "inherit",
              cursor: "pointer",
              ...baseStyle,
            }}
          />
        </div>
      )}
    </div>
  );
}

export default memo(
  EventCardActions,
  (prev, next) =>
    prev.item === next.item &&
    prev.compact === next.compact &&
    prev.showReadToggle === next.showReadToggle &&
    prev.showDismissToggle === next.showDismissToggle &&
    prev.showMoreMenu === next.showMoreMenu &&
    Boolean(prev.onOpenUser) === Boolean(next.onOpenUser) &&
    Boolean(prev.onFilterSimilar) === Boolean(next.onFilterSimilar) &&
    Boolean(prev.onToggleRead) === Boolean(next.onToggleRead) &&
    Boolean(prev.onToggleDismiss) === Boolean(next.onToggleDismiss),
);
