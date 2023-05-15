// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query';

import { makeQredoConnectionInfoQueryKey } from '../pages/qredo-connect/utils';
import { useBackgroundClient } from './useBackgroundClient';

export function useQredoInfo(qredoID?: string) {
    const backgroundClient = useBackgroundClient();
    return useQuery(
        makeQredoConnectionInfoQueryKey(qredoID || ''),
        async () => backgroundClient.getQredoConnectionInfo(qredoID!),
        {
            enabled: !!qredoID,
            // events from background service will invalidate this key (when qredo info changes)
            staleTime: Infinity,
            meta: { skipPersistedCache: true },
        }
    );
}
