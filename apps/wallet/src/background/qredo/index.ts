// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import mitt from 'mitt';

import Tabs from '../Tabs';
import { Window } from '../Window';
import { type ContentScriptConnection } from '../connections/ContentScriptConnection';
import keyring from '../keyring';
import {
    createPendingRequest,
    deletePendingRequest,
    getAllPendingRequests,
    getPendingRequest,
    getQredoConnection,
    storeAllPendingRequests,
    storeQredoConnection,
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
import { type QredoConnectPayload } from '_src/shared/messaging/messages/payloads/QredoConnect';
import { type AuthTokenResponse, QredoAPI } from '_src/shared/qredo-api';

const qredoEvents = mitt<{
    onConnectionResponse: {
        allowed: boolean;
        request: QredoConnectPendingRequest;
    };
}>();

export const onQredoEvent = qredoEvents.on;
export const offQredoEvent = qredoEvents.off;

export async function requestUserApproval(
    input: QredoConnectInput,
    connection: ContentScriptConnection,
    message: Message
) {
    const origin = connection.origin;
    const { service, apiUrl, token } = validateInputOrThrow(input);
    const connectionIdentity = {
        service,
        apiUrl,
        origin,
    };
    const existingPendingRequest = await getPendingRequest(connectionIdentity);
    console.log({ existingPendingRequest });
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
    // make sure we reuse any existing connection id so we will override it in the end
    const existingConnection = await getQredoConnection(connectionIdentity);
    const request = await createPendingRequest(
        {
            service,
            apiUrl,
            token,
            origin,
            originFavIcon: connection.originFavIcon,
            id: existingConnection?.id || undefined,
        },
        message.id
    );
    const approvalWindow = new Window(qredoConnectPageUrl(request.id));
    await approvalWindow.show();
    if (approvalWindow.id) {
        await updatePendingRequest(request.id, { windowID: approvalWindow.id });
    }
}

export async function handleOnWindowClosed(windowID: number) {
    const allRequests = await getAllPendingRequests();
    const remainingRequests: QredoConnectPendingRequest[] = [];
    allRequests.forEach((aRequest) => {
        if (aRequest.windowID === windowID) {
            qredoEvents.emit('onConnectionResponse', {
                allowed: false,
                request: aRequest,
            });
        } else {
            remainingRequests.push(aRequest);
        }
    });
    if (allRequests.length !== remainingRequests.length) {
        await storeAllPendingRequests(remainingRequests);
    }
}

export async function getUIQredoPendingRequest(requestID: string) {
    const pendingRequest = await getPendingRequest(requestID);
    if (pendingRequest) {
        return toUIQredoPendingRequest(pendingRequest);
    }
    return null;
}

export { registerForQredoChanges } from './storage';

const IN_PROGRESS_ACCESS_TOKENS_RENEWALS: Record<
    string,
    Promise<AuthTokenResponse> | null
> = {};

export async function getUIQredoInfo(
    requestID: string,
    renewAccessToken: boolean
): Promise<UIQredoInfo | null> {
    const pendingRequest = await getPendingRequest(requestID);
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

export async function acceptQredoConnection({
    qredoID,
    password,
    accounts,
}: QredoConnectPayload<'acceptQredoConnection'>['args']) {
    const pendingRequest = await getPendingRequest(qredoID);
    if (!pendingRequest) {
        // TODO: handle case we update the existing connection
        throw new Error(
            `Accepting Qredo connection failed, pending request ${qredoID} not found`
        );
    }
    const { id, apiUrl, origin, originFavIcon, service } = pendingRequest;
    // when creating a request for a connection we use the same id if there is any stored connection with same qredo identity
    // so setting the token to a qredoID here should override the existing one
    await keyring.storeQredoConnection(
        qredoID,
        pendingRequest.token,
        password,
        accounts
    );
    await storeQredoConnection({
        id,
        apiUrl,
        origin,
        originFavIcon,
        service,
        accounts,
    });
    await deletePendingRequest(pendingRequest);
    qredoEvents.emit('onConnectionResponse', {
        allowed: true,
        request: pendingRequest,
    });
}
