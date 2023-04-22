// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

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
