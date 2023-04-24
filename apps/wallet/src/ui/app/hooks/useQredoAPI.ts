// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';

import { useBackgroundClient } from './useBackgroundClient';
import { useQredoInfo } from './useQredoInfo';
import { QredoAPI } from '_src/shared/qredo-api';

const API_INSTANCES: Record<string, QredoAPI> = {};

export function useQredoAPI(qredoID?: string) {
    const backgroundClient = useBackgroundClient();
    const { data, isLoading, error } = useQredoInfo(qredoID);
    const [api, setAPI] = useState(
        () => (qredoID && API_INSTANCES[qredoID]) || null
    );
    useEffect(() => {
        if (data?.qredoInfo?.apiUrl && data?.qredoInfo?.authToken && qredoID) {
            const instance = API_INSTANCES[qredoID];
            // if apiUrl changes that will mean the qredo ID will change
            // so no need to check this cases
            if (instance && instance.authToken !== data.qredoInfo.authToken) {
                instance.authToken = data.qredoInfo.authToken;
            } else if (!instance) {
                API_INSTANCES[qredoID] = new QredoAPI(
                    qredoID,
                    data.qredoInfo.apiUrl,
                    {
                        backgroundClient,
                        authToken: data.qredoInfo.authToken,
                    }
                );
            }
        }
        setAPI((qredoID && API_INSTANCES[qredoID]) || null);
    }, [
        backgroundClient,
        data?.qredoInfo?.apiUrl,
        data?.qredoInfo?.authToken,
        qredoID,
    ]);
    return [api, isLoading, error] as const;
}
