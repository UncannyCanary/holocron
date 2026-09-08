import { useQuery } from '@tanstack/react-query';
import { listDocuments } from './api';

const STILL_WORKING = new Set(['queued', 'processing']);

// The queue and the first visit share one query, so an upload from either
// place shows up on both. It polls only while something is still being read,
// so an idle tab does not keep asking.
export function useDocuments() {
  return useQuery({
    queryKey: ['documents'],
    queryFn: listDocuments,
    refetchInterval: (query) =>
      query.state.data?.some((doc) => STILL_WORKING.has(doc.status)) ? 2000 : false,
  });
}
