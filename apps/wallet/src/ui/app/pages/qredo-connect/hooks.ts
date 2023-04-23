// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query';

import { useBackgroundClient } from '../../hooks/useBackgroundClient';
import { makeQredoPendingRequestQueryKey } from './utils';

export function useQredoUIPendingRequest(requestID?: string) {
    const backgroundClient = useBackgroundClient();
    return useQuery({
        queryKey: makeQredoPendingRequestQueryKey(requestID!),
        queryFn: async () =>
            (await backgroundClient.fetchPendingQredoConnectRequests()).find(
                ({ id }) => id === requestID
            ) || null,
        // events from background service will update this key (when qredo pending requests change)
        staleTime: Infinity,
        enabled: !!requestID,
    });
}
