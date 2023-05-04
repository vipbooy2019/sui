// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { type Wallet } from '_src/shared/qredo-api';

export type QredoConnectIdentity = {
    service: string;
    apiUrl: string;
    origin: string;
};

export type QredoConnectPendingRequest = {
    id: string;
    originFavIcon?: string;
    token: string;
    windowID: number | null;
    messageIDs: string[];
} & QredoConnectIdentity;

export type UIQredoPendingRequest = Pick<
    QredoConnectPendingRequest,
    'id' | 'service' | 'apiUrl' | 'origin' | 'originFavIcon'
> & { partialToken: `…${string}` };

export type UIQredoInfo = {
    id: string;
    authToken: string;
    apiUrl: string;
    service: string;
};

export type QredoConnection = Omit<
    QredoConnectPendingRequest,
    'token' | 'windowID' | 'messageIDs'
> & {
    accounts: Wallet[];
};
