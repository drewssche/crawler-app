import type { Ref } from "react";
import type { SiteScopeMode } from "../../api/projectSites";
import UiSelect from "../ui/UiSelect";
import { MetaText } from "../ui/StatusText";

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  padding: 10,
  borderRadius: 10,
};

type Props = {
  name: string;
  startUrl: string;
  scopeMode: SiteScopeMode;
  pathPrefix: string;
  disabled?: boolean;
  startUrlInputRef?: Ref<HTMLInputElement>;
  onNameChange: (value: string) => void;
  onStartUrlChange: (value: string) => void;
  onScopeModeChange: (value: SiteScopeMode) => void;
  onPathPrefixChange: (value: string) => void;
};

export default function SiteScopeFields({
  name,
  startUrl,
  scopeMode,
  pathPrefix,
  disabled = false,
  startUrlInputRef,
  onNameChange,
  onStartUrlChange,
  onScopeModeChange,
  onPathPrefixChange,
}: Props) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Название сайта</span>
          <input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Например: Основной сайт"
            disabled={disabled}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Стартовый адрес</span>
          <input
            ref={startUrlInputRef}
            value={startUrl}
            onChange={(event) => onStartUrlChange(event.target.value)}
            placeholder="https://example.com"
            inputMode="url"
            disabled={disabled}
            style={inputStyle}
          />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Область мониторинга</span>
          <UiSelect
            value={scopeMode}
            onChange={(event) => onScopeModeChange(event.target.value as SiteScopeMode)}
            disabled={disabled}
          >
            <option value="whole_site">Весь сайт</option>
            <option value="path_prefix">Только раздел</option>
          </UiSelect>
        </label>
        {scopeMode === "path_prefix" && (
          <label style={{ display: "grid", gap: 6 }}>
            <span>Путь раздела</span>
            <input
              value={pathPrefix}
              onChange={(event) => onPathPrefixChange(event.target.value)}
              placeholder="/docs"
              disabled={disabled}
              style={inputStyle}
            />
          </label>
        )}
      </div>

      <MetaText opacity={0.7}>
        {scopeMode === "whole_site"
          ? "Crawler будет проходить страницы этого сайта в пределах выбранного адреса."
          : "Crawler останется внутри указанного раздела. Соседние пути и другие домены не попадут в результат."}
      </MetaText>
    </div>
  );
}
