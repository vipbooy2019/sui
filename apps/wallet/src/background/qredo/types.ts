// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

export type QredoConnectRequestIdentity = {
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
} & QredoConnectRequestIdentity;

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
