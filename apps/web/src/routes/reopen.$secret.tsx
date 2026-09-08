import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { messageOf, reopenWorkspace } from '../lib/api';

export const Route = createFileRoute('/reopen/$secret')({
  component: ReopenRoute,
});

// Landed on from a settings reopen link. Swaps this browser's workspace
// cookie for the one the link points at, then goes to the queue. The door
// still has to be passed first, since this route sits under the same root
// as every other screen.
function ReopenRoute() {
  const { secret } = Route.useParams();
  const queryClient = useQueryClient();

  const reopen = useQuery({
    queryKey: ['reopen', secret],
    queryFn: async () => {
      const workspace = await reopenWorkspace(secret);
      queryClient.setQueryData(['workspace'], workspace);
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
      return workspace;
    },
    staleTime: Infinity,
    retry: false,
  });

  if (reopen.isSuccess) {
    return <Navigate to="/queue" />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-5 text-center text-sm text-ink-soft">
      {reopen.isError
        ? messageOf(reopen.error, 'This reopen link did not work.')
        : 'Opening your workspace…'}
    </div>
  );
}
