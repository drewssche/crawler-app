import { markEventRead, type EventItem } from "../api/events";
import { resolveEventDestination } from "./eventRouting";

export async function runEventPrimaryAction(params: {
  item: EventItem;
  navigate: (to: string) => void;
  onLocalRead?: (eventId: number) => void;
}) {
  const { item, navigate, onLocalRead } = params;
  if (!item.is_read) {
    try {
      await markEventRead(item.id, true);
      onLocalRead?.(item.id);
    } catch {
      // no-op: navigation should still happen
    }
  }
  navigate(resolveEventDestination(item));
}
