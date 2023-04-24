// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query';

import { useBackgroundClient } from '../../hooks/useBackgroundClient';
import { useQredoAPI } from '../../hooks/useQredoAPI';
import { makeQredoPendingRequestQueryKey } from './utils';
import { type GetWalletsParams } from '_src/shared/qredo-api';

export function useQredoUIPendingRequest(requestID?: string) {
    const backgroundClient = useBackgroundClient();
    return useQuery({
        queryKey: makeQredoPendingRequestQueryKey(requestID!),
        queryFn: async () =>
            await backgroundClient.fetchPendingQredoConnectRequest(requestID!),
        // events from background service will update this key (when qredo pending requests change)
        staleTime: Infinity,
        enabled: !!requestID,
    });
}

export function useFetchQredoAccounts(
    qredoID?: string,
    enabled?: boolean,
    params?: GetWalletsParams
) {
    const [api, isAPILoading, apiInitError] = useQredoAPI(qredoID);
    console.log('useFetchQredoAccounts api', api, isAPILoading, apiInitError);
    return useQuery(
        ['qredo', 'fetch', 'accounts', qredoID],
        async () => {
            if (api) {
                return (await api.getWallets(params)).wallets;
            }
            throw apiInitError
                ? apiInitError
                : new Error('Qredo API initialization failed');
        },
        {
            enabled:
                !!qredoID &&
                (enabled ?? true) &&
                !isAPILoading &&
                !!(api || apiInitError),
        }
    );
}
