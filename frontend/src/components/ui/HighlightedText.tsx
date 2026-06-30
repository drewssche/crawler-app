import { Fragment } from "react";

function splitMatches(value: string, query: string): Array<{ text: string; hit: boolean }> {
  const source = value || "";
  const needle = (query || "").trim();
  if (!needle) return [{ text: source, hit: false }];

  const lowerSource = source.toLocaleLowerCase("ru").replace(/ё/g, "е");
  const lowerNeedle = needle.toLocaleLowerCase("ru").replace(/ё/g, "е");
  const chunks: Array<{ text: string; hit: boolean }> = [];

  let cursor = 0;
  while (cursor < source.length) {
    const index = lowerSource.indexOf(lowerNeedle, cursor);
    if (index < 0) {
      chunks.push({ text: source.slice(cursor), hit: false });
      break;
    }
    if (index > cursor) {
      chunks.push({ text: source.slice(cursor, index), hit: false });
    }
    chunks.push({ text: source.slice(index, index + needle.length), hit: true });
    cursor = index + needle.length;
  }

  return chunks.length > 0 ? chunks : [{ text: source, hit: false }];
}

export default function HighlightedText({
  value,
  query,
}: {
  value: string;
  query?: string;
}) {
  const chunks = splitMatches(value, query || "");
  return (
    <>
      {chunks.map((chunk, idx) => (
        <Fragment key={`${chunk.text}:${idx}`}>
          {chunk.hit ? (
            <mark
              style={{
                background: "rgba(255, 214, 102, 0.34)",
                color: "#fff3bf",
                border: "1px solid rgba(255, 214, 102, 0.42)",
                borderRadius: 4,
                padding: "0 2px",
              }}
            >
              {chunk.text}
            </mark>
          ) : (
            chunk.text
          )}
        </Fragment>
      ))}
    </>
  );
}
