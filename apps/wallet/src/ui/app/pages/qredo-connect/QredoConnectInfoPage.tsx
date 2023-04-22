// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { useBackgroundClient } from '../../hooks/useBackgroundClient';
import { Button } from '../../shared/ButtonUI';
import { PageMainLayoutTitle } from '../../shared/page-main-layout/PageMainLayoutTitle';
import { Text } from '../../shared/text';
import { makeQredoPendingRequestQueryKey } from './utils';

export function QredoConnectInfoPage() {
    const { requestID } = useParams();
    const backgroundClient = useBackgroundClient();
    const { data, isLoading } = useQuery({
        queryKey: makeQredoPendingRequestQueryKey(requestID!),
        queryFn: async () =>
            (await backgroundClient.fetchPendingQredoConnectRequests()).find(
                ({ id }) => id === requestID
            ) || null,
        // events from background service will update this key (when qredo pending requests change)
        staleTime: Infinity,
        enabled: !!requestID,
    });
    if (isLoading) {
        return null;
    }
    return (
        <>
            <PageMainLayoutTitle title="Qredo Accounts Setup" />
            <div className="flex flex-col flex-nowrap gap-10 justify-center flex-1 p-6 items-center">
                <Text>Qredo connect is under construction.</Text>
                <Button
                    variant="secondary"
                    text="Close"
                    onClick={() => window.close()}
                />
                <p>{JSON.stringify(data, null, 2)}</p>
            </div>
        </>
    );
}
