import type { AthleteFact, CreateAthleteFact, UpdateAthleteFact } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

import { api, QUERY_KEYS } from "@/lib/api";

import { useApiMutation } from "./useApiMutation";

/** Every fact on the athlete card, retired ones included, oldest first. */
export function useAthleteFacts({ enabled = true }: { readonly enabled?: boolean } = {}) {
  return useQuery<AthleteFact[]>({
    queryKey: QUERY_KEYS.athleteFacts,
    queryFn: () => api.athleteFacts.list(),
    enabled,
  });
}

/** Adds a fact; one the card already holds is confirmed instead. */
export function useAddAthleteFact() {
  return useApiMutation({
    mutationFn: (data: CreateAthleteFact) => api.athleteFacts.create(data),
    invalidateQueries: [QUERY_KEYS.athleteFacts],
    successToast: "Saved to your athlete card",
    errorToast: "Couldn't add that fact",
  });
}

function updatedFactTitle(changes: UpdateAthleteFact): string {
  if (changes.confirm) return "Kept on your athlete card";
  if (changes.active === false) return "Fact retired";
  if (changes.active === true) return "Fact restored";
  return "Fact updated";
}

/** Rewords, recategorises, retires, restores or confirms a fact. */
export function useUpdateAthleteFact() {
  return useApiMutation({
    mutationFn: ({ id, changes }: { readonly id: string; readonly changes: UpdateAthleteFact }) =>
      api.athleteFacts.update(id, changes),
    invalidateQueries: [QUERY_KEYS.athleteFacts],
    successToast: (_fact, { changes }) => ({ title: updatedFactTitle(changes) }),
    errorToast: "Couldn't update that fact",
  });
}

export function useDeleteAthleteFact() {
  return useApiMutation({
    mutationFn: (id: string) => api.athleteFacts.remove(id),
    invalidateQueries: [QUERY_KEYS.athleteFacts],
    successToast: "Fact deleted",
    errorToast: "Couldn't delete that fact",
  });
}

/**
 * Moves the older free-text injuries note onto the card, a fact per sentence.
 * The server drops the note only once all of it fits.
 */
export function useImportAthleteNote() {
  return useApiMutation({
    mutationFn: () => api.athleteFacts.importNote(),
    invalidateQueries: [QUERY_KEYS.athleteFacts, QUERY_KEYS.authUser],
    successToast: ({ added, skipped }) =>
      skipped > 0
        ? {
            title: "Your card is full",
            description: `Added ${added} of ${added + skipped}. Your note stays until you retire facts to make room for the rest.`,
          }
        : { title: "Note added to your athlete card" },
    errorToast: "Couldn't add your note to the card",
  });
}

/** Deletes the older note without adding it to the card. */
export function useDiscardAthleteNote() {
  return useApiMutation({
    mutationFn: () => api.preferences.update({ trainingConstraints: null }),
    invalidateQueries: [QUERY_KEYS.authUser],
    successToast: "Note removed",
    errorToast: "Couldn't remove the note",
  });
}
