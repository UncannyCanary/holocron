import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { correctField, deleteDocument, getDocument, retryDocument } from './api';

const STILL_WORKING = new Set(['queued', 'processing']);

// One document with its fields, checks, pages, and run. It polls while the
// document is still being read, so a page opened straight after an upload
// fills itself in.
export function useDocument(id: string) {
  return useQuery({
    queryKey: ['documents', id],
    queryFn: () => getDocument(id),
    refetchInterval: (query) =>
      query.state.data && STILL_WORKING.has(query.state.data.status) ? 2000 : false,
  });
}

// Saving a correction changes the document's fields and checks, and can
// change the trust badge the queue shows for it. Asking again for everything
// under "documents" covers both this document and the list.
export function useCorrectField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: { fieldId: string; value: string }) =>
      correctField(change.fieldId, change.value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

// Sends a failed document back to the queue so it does not stay failed
// forever. The queue and the document itself both start polling again once
// the query it invalidates comes back queued.
export function useRetryDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => retryDocument(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

// Removes a document. The list is asked for again so the queue and the
// table drop it at once.
export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}
