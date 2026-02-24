import type { ReactNode } from "react";

type Column = {
  key: string;
  label: ReactNode;
  align?: "left" | "center" | "right";
  width?: string;
};

type Row = {
  id: string;
  cells: Record<string, ReactNode>;
};

type Props = {
  columns: Column[];
  rows: Row[];
  fontSize?: number;
  cellPadding?: string;
};

function alignToText(align?: "left" | "center" | "right"): "left" | "center" | "right" {
  return align || "left";
}

export default function HintTable({ columns, rows, fontSize = 12, cellPadding = "6px 4px" }: Props) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize }}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                style={{
                  textAlign: alignToText(column.align),
                  padding: cellPadding,
                  borderBottom: "1px solid #3333",
                  width: column.width,
                }}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td
                  key={`${row.id}:${column.key}`}
                  style={{
                    textAlign: alignToText(column.align),
                    padding: cellPadding,
                    borderBottom: "1px solid #3333",
                    opacity: 0.9,
                  }}
                >
                  {row.cells[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

