// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query';

import { useBackgroundClient } from './useBackgroundClient';

export function useQredoInfo(qredoID?: string) {
    const backgroundClient = useBackgroundClient();
    return useQuery(
        ['qredo', 'info', qredoID],
        async () => backgroundClient.getQredoApiInfo(qredoID!),
        // staleTime: Infinity because background service sends updates when qredo info changes
        // and background client updates the query data
        { enabled: !!qredoID, staleTime: Infinity }
    );
}
