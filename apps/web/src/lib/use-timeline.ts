import { useQuery } from '@tanstack/react-query';
import { getDocumentTimeline } from './api';

export function useDocumentTimeline(id: string) {
  return useQuery({
    queryKey: ['documents', id, 'timeline'],
    queryFn: () => getDocumentTimeline(id),
  });
}
