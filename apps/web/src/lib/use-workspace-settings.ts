import { useQuery } from '@tanstack/react-query';
import { getWorkspaceSettings } from './api';

// The numbers on the settings screen change slowly, so this only asks again
// when the screen is opened, not on a timer the way the queue does.
export function useWorkspaceSettings() {
  return useQuery({ queryKey: ['workspace', 'settings'], queryFn: getWorkspaceSettings });
}
