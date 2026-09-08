import { createRootRoute, Outlet } from '@tanstack/react-router';
import { AccessGate } from '../components/AccessGate';

export const Route = createRootRoute({
  component: () => (
    <AccessGate>
      <Outlet />
    </AccessGate>
  ),
});
