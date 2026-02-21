export type RelevanceKind = "self" | "selected" | "none";

function normalize(email: string | null | undefined): string {
  return (email || "").trim().toLowerCase();
}

function containsEmail(text: string | null | undefined, email: string): boolean {
  const content = (text || "").toLowerCase();
  return !!email && content.includes(email);
}

export function getAuditRelevance(params: {
  actorEmail?: string | null;
  targetEmail?: string | null;
  body?: string | null;
  currentUserEmail?: string | null;
  selectedUserEmail?: string | null;
}): RelevanceKind {
  const actor = normalize(params.actorEmail);
  const target = normalize(params.targetEmail);
  const current = normalize(params.currentUserEmail);
  const selected = normalize(params.selectedUserEmail);

  if (
    current &&
    (actor === current || target === current || containsEmail(params.body, current))
  ) {
    return "self";
  }
  if (
    selected &&
    (actor === selected || target === selected || containsEmail(params.body, selected))
  ) {
    return "selected";
  }
  return "none";
}

export function getEventRelevance(params: {
  body?: string | null;
  targetEmail?: string | null;
  currentUserEmail?: string | null;
  selectedUserEmail?: string | null;
}): RelevanceKind {
  return getAuditRelevance({
    actorEmail: null,
    targetEmail: params.targetEmail,
    body: params.body,
    currentUserEmail: params.currentUserEmail,
    selectedUserEmail: params.selectedUserEmail,
  });
}
