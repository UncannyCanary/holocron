import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { ensureWorkspace, getDoorStatus, messageOf, unlockDoor } from '../lib/api';

// Sits above every route. Nothing past it renders until the door is passed
// and this browser has a workspace, so no screen has to check for either
// itself.
export function AccessGate({ children }: { children: ReactNode }) {
  const door = useQuery({ queryKey: ['door'], queryFn: getDoorStatus });
  const reopening = useLocation({ select: (location) => location.pathname }).startsWith('/reopen/');

  if (door.isPending) {
    return null;
  }
  if (door.isError) {
    return <FullScreenMessage text="Holocron could not be reached. Try reloading the page." />;
  }
  if (door.data.required && !door.data.unlocked) {
    return <DoorScreen />;
  }
  // A reopen link brings its own workspace. Making a new one first would
  // waste it, and spend one of the few new workspaces an address may open.
  if (reopening) {
    return <>{children}</>;
  }
  return <EnsureWorkspace>{children}</EnsureWorkspace>;
}

function DoorScreen() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const unlock = useMutation({
    mutationFn: unlockDoor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['door'] }),
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 p-5">
      <span className="font-serif text-[28px]">Holocron</span>
      <form
        className="flex w-[280px] flex-col gap-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          unlock.mutate(code);
        }}
      >
        <label htmlFor="access-code" className="text-note text-ink-soft">
          Enter the access code to continue.
        </label>
        <input
          id="access-code"
          type="password"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className="h-10 rounded-md border border-line-strong bg-card px-3 font-mono text-lede text-ink"
        />
        {unlock.isError && (
          <span role="alert" className="text-note text-needs-review">
            {messageOf(unlock.error, 'Something went wrong. Try again.')}
          </span>
        )}
        <button
          type="submit"
          className="btn btn-primary justify-center"
          disabled={unlock.isPending || code === ''}
        >
          {unlock.isPending ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}

function EnsureWorkspace({ children }: { children: ReactNode }) {
  const workspace = useQuery({
    queryKey: ['workspace'],
    queryFn: ensureWorkspace,
    staleTime: Infinity,
  });

  if (workspace.isPending) {
    return null;
  }
  if (workspace.isError) {
    return (
      <FullScreenMessage
        text={messageOf(workspace.error, 'Something went wrong. Try reloading the page.')}
      />
    );
  }
  return <>{children}</>;
}

function FullScreenMessage({ text }: { text: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-5 text-center text-sm text-ink-soft">
      {text}
    </div>
  );
}
