import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { reportError } from '@/lib/error-reporting';

import { flagViewError, handleViewRejections, isViewEndedError, useViewNotice } from './view-as';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
  // While an admin is viewing as someone else, a refused change or an ended view raises a calm notice.
  // Launch readiness: failed reads and writes are also reported (scrubbed and rate limited) for System health.
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (isViewEndedError(error)) useViewNotice.getState().flag('ended');
      reportError(error, { source: 'query', route: String(query.queryKey[0]) });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // An expected View as refusal is not an app error.
      if (flagViewError(error)) return;
      reportError(error, { source: 'mutation', route: mutation.options.mutationKey ? String(mutation.options.mutationKey[0]) : undefined });
    },
  }),
});

// A refused change that a screen does not catch is still an expected, already-explained refusal while viewing.
handleViewRejections();
