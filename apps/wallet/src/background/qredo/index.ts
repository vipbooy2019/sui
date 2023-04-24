// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import Tabs from '../Tabs';
import { Window } from '../Window';
import { type Connections } from '../connections';
import { type ContentScriptConnection } from '../connections/ContentScriptConnection';
import {
    createPendingRequest,
    getAllPendingRequests,
    getPendingRequest,
    storePendingRequests,
    updatePendingRequest,
} from './storage';
import { type UIQredoInfo, type QredoConnectPendingRequest } from './types';
import {
    qredoConnectPageUrl,
    toUIQredoPendingRequest,
    validateInputOrThrow,
} from './utils';
import { type QredoConnectInput } from '_src/dapp-interface/WalletStandardInterface';
import { type Message } from '_src/shared/messaging/messages';
import { type AuthTokenResponse, QredoAPI } from '_src/shared/qredo-api';

export async function requestUserApproval(
    input: QredoConnectInput,
    connection: ContentScriptConnection,
    message: Message
) {
    const origin = connection.origin;
    const { service, apiUrl, token } = validateInputOrThrow(input);
    const existingPendingRequest = await getPendingRequest({
        service,
        apiUrl,
        origin,
    });
    if (existingPendingRequest) {
        const qredoConnectUrl = qredoConnectPageUrl(existingPendingRequest.id);
        const changes: Parameters<typeof updatePendingRequest>['1'] = {
            messageID: message.id,
            append: true,
            token: token,
        };
        if (
            !(await Tabs.highlight({
                url: qredoConnectUrl,
                windowID: existingPendingRequest.windowID || undefined,
                match: ({ url, inAppRedirectUrl }) => {
                    const urlMatch = `/dapp/qredo-connect/${existingPendingRequest.id}`;
                    return (
                        url.includes(urlMatch) ||
                        (!!inAppRedirectUrl &&
                            inAppRedirectUrl.includes(urlMatch))
                    );
                },
            }))
        ) {
            const approvalWindow = new Window(qredoConnectUrl);
            await approvalWindow.show();
            if (approvalWindow.id) {
                changes.windowID = approvalWindow.id;
            }
        }
        await updatePendingRequest(existingPendingRequest.id, changes);
        return;
    }
    const request = await createPendingRequest(
        {
            service,
            apiUrl,
            token,
            origin,
            originFavIcon: connection.originFavIcon,
        },
        message.id
    );
    const approvalWindow = new Window(qredoConnectPageUrl(request.id));
    await approvalWindow.show();
    if (approvalWindow.id) {
        await updatePendingRequest(request.id, { windowID: approvalWindow.id });
    }
}

export async function handleOnWindowClosed(
    windowID: number,
    connections: Connections
) {
    const allRequests = await getAllPendingRequests();
    const remainingRequests: QredoConnectPendingRequest[] = [];
    allRequests.forEach((aRequest) => {
        if (aRequest.windowID === windowID) {
            aRequest.messageIDs.forEach((aMessageID) => {
                connections.notifyContentScript(
                    {
                        event: 'qredoConnectResult',
                        origin: aRequest.origin,
                        allowed: false,
                    },
                    aMessageID
                );
            });
        } else {
            remainingRequests.push(aRequest);
        }
    });
    await storePendingRequests(remainingRequests);
}

export async function getUIQredoPendingRequest(requestID: string) {
    const pendingRequest = await getPendingRequest(requestID);
    if (pendingRequest) {
        return toUIQredoPendingRequest(pendingRequest);
    }
    return null;
}

export { registerForPendingRequestsChanges } from './storage';

const IN_PROGRESS_ACCESS_TOKENS_RENEWALS: Record<
    string,
    Promise<AuthTokenResponse> | null
> = {};

export async function getUIQredoInfo(
    requestID: string,
    renewAccessToken: boolean
): Promise<UIQredoInfo | null> {
    const pendingRequest = await getPendingRequest(requestID);
    console.log('getUIQredoInfo', {
        requestID,
        renewAccessToken,
        pendingRequest,
    });
    if (!pendingRequest) {
        // TODO: check if is an accepted connection
        return null;
    }
    // TODO implement the case we have a stored connection with existing accessToken (don't forget renewAccessToken)
    const refreshToken = pendingRequest.token;
    let accessToken: string;
    if (!IN_PROGRESS_ACCESS_TOKENS_RENEWALS[requestID]) {
        IN_PROGRESS_ACCESS_TOKENS_RENEWALS[requestID] = new QredoAPI(
            requestID,
            pendingRequest.apiUrl
        )
            .createAuthToken({ refreshToken })
            .finally(
                () => (IN_PROGRESS_ACCESS_TOKENS_RENEWALS[requestID] = null)
            );
        accessToken = (await IN_PROGRESS_ACCESS_TOKENS_RENEWALS[requestID])!
            .access_token;
        // TODO: store new access token if qredo is connected
        IN_PROGRESS_ACCESS_TOKENS_RENEWALS[requestID] = null;
    } else {
        accessToken = (await IN_PROGRESS_ACCESS_TOKENS_RENEWALS[requestID])!
            .access_token;
    }
    return {
        id: pendingRequest.id,
        service: pendingRequest.service,
        apiUrl: pendingRequest.apiUrl,
        authToken: accessToken,
    };
}
