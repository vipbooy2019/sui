// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { debounce } from 'throttle-debounce';
import { v4 as uuid } from 'uuid';

import { type Connections } from '../connections';
import {
    setToSessionStorage,
    getFromSessionStorage,
    isSessionStorageSupported,
    addSessionStorageEventListener,
} from '../storage-utils';
import { toUIQredoPendingRequest } from './utils';

import type {
    QredoConnectPendingRequest,
    QredoConnectRequestIdentity,
} from './types';

const SESSION_STORAGE_KEY = 'qredo-connect-requests';

export async function getAllPendingRequests() {
    return (
        (await getFromSessionStorage<QredoConnectPendingRequest[]>(
            SESSION_STORAGE_KEY,
            []
        )) || []
    );
}

export async function getPendingRequest(
    requestIdentity: QredoConnectRequestIdentity | string
) {
    if (!isSessionStorageSupported()) {
        throw new Error(
            'Session storage is required. Please update your browser'
        );
    }
    const allPendingRequests = await getAllPendingRequests();
    return (
        allPendingRequests.find(
            (aRequest) =>
                (typeof requestIdentity === 'string' &&
                    aRequest.id === requestIdentity) ||
                (typeof requestIdentity === 'object' &&
                    requestIdentity.apiUrl === aRequest.apiUrl &&
                    requestIdentity.origin === aRequest.origin &&
                    requestIdentity.service === aRequest.service) ||
                false
        ) || null
    );
}

export function storePendingRequests(requests: QredoConnectPendingRequest[]) {
    return setToSessionStorage(SESSION_STORAGE_KEY, requests);
}

export async function storePendingRequest(request: QredoConnectPendingRequest) {
    if (!isSessionStorageSupported()) {
        throw new Error(
            'Session storage is required. Please update your browser'
        );
    }
    const allPendingRequests = await getAllPendingRequests();
    const existingIndex = allPendingRequests.findIndex(
        (aRequest) => aRequest.id === request.id
    );
    if (existingIndex >= 0) {
        allPendingRequests.splice(existingIndex, 1, request);
    } else {
        allPendingRequests.push(request);
    }
    await storePendingRequests(allPendingRequests);
}

export async function createPendingRequest(
    options: Omit<QredoConnectPendingRequest, 'id' | 'messageIDs' | 'windowID'>,
    messageID: string
) {
    const newRequest: QredoConnectPendingRequest = {
        id: uuid(),
        ...options,
        windowID: null,
        messageIDs: [messageID],
    };
    await storePendingRequest(newRequest);
    return newRequest;
}

export async function updatePendingRequest(
    id: string,
    change: {
        windowID?: number;
        messageID?: string;
        append?: boolean;
        token?: string;
    }
) {
    const request = await getPendingRequest(id);
    if (!request) {
        return;
    }
    if (typeof change.windowID === 'number') {
        request.windowID = change.windowID;
    }
    if (change.messageID) {
        if (change.append) {
            request.messageIDs.push(change.messageID);
        } else {
            request.messageIDs = [change.messageID];
        }
    }
    if (change.token) {
        request.token = change.token;
    }
    await storePendingRequest(request);
}

const debouncedUIPendingQredoUpdate = debounce(
    100,
    (connections: Connections, newValue: QredoConnectPendingRequest[]) => {
        connections.notifyUI({
            event: 'pendingQredoConnectUpdate',
            pendingRequests: newValue.map(toUIQredoPendingRequest),
        });
    }
);

export function registerForPendingRequestsChanges(connections: Connections) {
    addSessionStorageEventListener((changes) => {
        if (SESSION_STORAGE_KEY in changes) {
            debouncedUIPendingQredoUpdate(
                connections,
                changes[SESSION_STORAGE_KEY].newValue
            );
        }
    });
}
