import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { correctField, getDocument } from './api';

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
