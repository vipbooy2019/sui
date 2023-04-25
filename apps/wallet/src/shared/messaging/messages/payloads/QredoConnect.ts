// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { type BasePayload, isBasePayload } from './BasePayload';
import { type Payload } from './Payload';
import {
    type UIQredoInfo,
    type UIQredoPendingRequest,
} from '_src/background/qredo/types';
import { type QredoConnectInput } from '_src/dapp-interface/WalletStandardInterface';

type Methods = {
    connect: QredoConnectInput;
    connectResponse: { allowed: boolean };
    pendingRequestsUpdate: { requests: UIQredoPendingRequest[] };
    getPendingRequest: { requestID: string };
    getPendingRequestResponse: { request: UIQredoPendingRequest | null };
    getQredoInfo: { qredoID: string; refreshAccessToken: boolean };
    getQredoInfoResponse: { qredoInfo: UIQredoInfo | null };
};

export interface QredoConnectPayload<M extends keyof Methods>
    extends BasePayload {
    type: 'qredo-connect';
    method: M;
    args: Methods[M];
}

export function isQredoConnectPayload<M extends keyof Methods>(
    payload: Payload,
    method: M
): payload is QredoConnectPayload<M> {
    return (
        isBasePayload(payload) &&
        payload.type === 'qredo-connect' &&
        'method' in payload &&
        payload.method === method &&
        'args' in payload &&
        !!payload.args
    );
}
