import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './lib/api';
import './index.css';
import { parseSearch, stringifySearch } from './lib/search-params';
import { routeTree } from './routeTree.gen';

const router = createRouter({ routeTree, parseSearch, stringifySearch });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// A request the API has refused on purpose, such as a limit that was hit,
// is not retried: asking again only spends more of the limit, and the person
// should see the message instead. Only a failed connection or a server fault
// gets a second try.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
