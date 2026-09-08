import { useQuery } from '@tanstack/react-query';
import { listTableDocuments } from './api';

const STILL_WORKING = new Set(['queued', 'processing']);

// The table's own rows, one query per search word so the API can do the
// searching in Postgres. Polls only while something in the current search is
// still being read, the same as the queue.
export function useTableDocuments(q: string) {
  return useQuery({
    queryKey: ['documents', 'table', q],
    queryFn: () => listTableDocuments(q),
    refetchInterval: (query) =>
      query.state.data?.some((doc) => STILL_WORKING.has(doc.status)) ? 2000 : false,
  });
}
