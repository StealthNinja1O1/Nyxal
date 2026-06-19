import { http } from "./client";
import type { LorebookEntryWire, NewEntry, Book } from "./lorebook-types";

export const lorebookApi = {
  list: (botId: string, book: Book) =>
    http.get<LorebookEntryWire[]>(`/bots/${botId}/lorebook/${book}`),
  create: (botId: string, book: Book, entry: NewEntry) =>
    http.post<LorebookEntryWire>(`/bots/${botId}/lorebook/${book}`, entry),
  update: (botId: string, book: Book, entryId: string, patch: Partial<LorebookEntryWire>) =>
    http.patch<LorebookEntryWire>(`/bots/${botId}/lorebook/${book}/${entryId}`, patch),
  remove: (botId: string, book: Book, entryId: string) =>
    http.del<{ ok: true }>(`/bots/${botId}/lorebook/${book}/${entryId}`),
  import: (botId: string, book: Book, entries: NewEntry[], mode: "merge" | "replace") =>
    http.post<{ ok: true; imported: number }>(
      `/bots/${botId}/lorebook/${book}/import`,
      { mode, entries },
    ),
};
