export type HttpStatusVisualMeta = {
  code: number | null;
  toneLabel: string;
  hint: string;
  color: string;
  chipBg: string;
  rowBg?: string;
};

export function parseHttpStatus(rawStatus: string | number | null | undefined): number | null {
  const code = Number(rawStatus);
  if (!Number.isFinite(code)) return null;
  const normalized = Math.trunc(code);
  if (normalized < 100 || normalized > 999) return null;
  return normalized;
}

export function getHttpStatusVisualMeta(rawStatus: string | number | null | undefined): HttpStatusVisualMeta {
  const code = parseHttpStatus(rawStatus);
  if (code == null) {
    return {
      code: null,
      toneLabel: "неизвестно",
      hint: "Код не распознан",
      color: "rgba(226,232,248,0.86)",
      chipBg: "rgba(226,232,248,0.10)",
    };
  }
  if (code >= 200 && code < 300) {
    return {
      code,
      toneLabel: "норма",
      hint: "Успешный ответ",
      color: "rgba(168,232,187,0.92)",
      chipBg: "rgba(94,189,122,0.14)",
    };
  }
  if (code >= 300 && code < 400) {
    return {
      code,
      toneLabel: "редирект",
      hint: "Допустимо, но стоит контролировать объем",
      color: "rgba(167,210,255,0.92)",
      chipBg: "rgba(105,164,236,0.16)",
    };
  }
  if (code >= 400 && code < 500) {
    return {
      code,
      toneLabel: "клиентская ошибка",
      hint: "Ненормально, требует проверки",
      color: "rgba(255,199,142,0.96)",
      chipBg: "rgba(206,143,73,0.18)",
      rowBg: "rgba(206,143,73,0.07)",
    };
  }
  return {
    code,
    toneLabel: "серверная ошибка",
    hint: "Критично, нужна реакция",
    color: "rgba(255,160,160,0.96)",
    chipBg: "rgba(203,84,84,0.20)",
    rowBg: "rgba(203,84,84,0.08)",
  };
}

export function extractHttpStatusFromLabels(labels: string): number | null {
  const match = /(?:^|,\s*)status=(\d{3})(?:,|$)/.exec(labels);
  if (!match?.[1]) return null;
  return parseHttpStatus(match[1]);
}
