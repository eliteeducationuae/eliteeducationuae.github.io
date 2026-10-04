import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { isViewEndedError, isViewOnlyError, useViewNotice } from './view-as';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
  // While an admin is viewing as someone else, a refused change or an ended view raises a calm notice.
  mutationCache: new MutationCache({
    onError(err) {
      if (isViewOnlyError(err)) useViewNotice.getState().flag('view-only');
      else if (isViewEndedError(err)) useViewNotice.getState().flag('ended');
    },
  }),
  queryCache: new QueryCache({
    onError(err) {
      if (isViewEndedError(err)) useViewNotice.getState().flag('ended');
    },
  }),
});
