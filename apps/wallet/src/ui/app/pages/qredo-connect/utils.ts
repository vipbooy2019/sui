// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { type UIQredoPendingRequest } from '_src/background/qredo/types';

export const QREDO_PENDING_REQUEST_KEY_COMMON = [
    'qredo-connect',
    'pending-request',
] as const;

export function makeQredoPendingRequestQueryKey(requestID: string) {
    return [...QREDO_PENDING_REQUEST_KEY_COMMON, requestID];
}

export function getQredoPendingRequestFromQueryKey(queryKey: string[]) {
    return queryKey[2];
}

export function isUntrustedQredoConnect({
    apiUrl,
    origin,
}: UIQredoPendingRequest) {
    try {
        return (
            new URL(origin).protocol !== 'https:' ||
            new URL(apiUrl).protocol !== 'https:'
        );
    } catch (e) {
        return false;
    }
}
