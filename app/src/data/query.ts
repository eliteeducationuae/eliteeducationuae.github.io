import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { flagViewError, handleViewRejections, isViewEndedError, useViewNotice } from './view-as';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
  // While an admin is viewing as someone else, a refused change or an ended view raises a calm notice.
  mutationCache: new MutationCache({
    onError(err) {
      flagViewError(err);
    },
  }),
  queryCache: new QueryCache({
    onError(err) {
      if (isViewEndedError(err)) useViewNotice.getState().flag('ended');
    },
  }),
});

// A refused change that a screen does not catch is still an expected, already-explained refusal while viewing.
handleViewRejections();
