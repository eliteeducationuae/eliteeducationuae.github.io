import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { reportError } from '@/lib/error-reporting';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
  // Launch readiness: failed reads and writes are reported (scrubbed and rate limited) for System health.
  queryCache: new QueryCache({
    onError: (error, query) => reportError(error, { source: 'query', route: String(query.queryKey[0]) }),
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) =>
      reportError(error, { source: 'mutation', route: mutation.options.mutationKey ? String(mutation.options.mutationKey[0]) : undefined }),
  }),
});
