// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { type UIQredoInfo } from '_src/background/qredo/types';
import { type BackgroundClient } from '_src/ui/app/background-client';

export type QredoAPIErrorResponse = {
    code: string;
    msg: string;
    detail: {
        reason: string;
    };
};

export class QredoAPIError extends Error {
    status: number;
    apiData: QredoAPIErrorResponse;

    constructor(status: number, apiData: QredoAPIErrorResponse) {
        super(`Qredo API Error (status: ${status}). ${apiData.msg}`);
        this.status = status;
        this.apiData = apiData;
    }
}

export class QredoAPIUnauthorizedError extends QredoAPIError {}

export type AuthTokenParams = {
    refreshToken: string;
    grantType?: string;
};

export type AuthTokenResponse = {
    access_token: string;
    expires_in: number;
    token_type: string;
};

export type Wallet = {
    walletID: string;
    address: string;
    network: string;
    labels: [
        {
            key: string;
            name: string;
            value: string;
        }
    ];
};

export type GetWalletsResponse = {
    wallets: Wallet[];
};

export type GetWalletsParams = {
    filters?: { address?: string };
};

export class QredoAPI {
    readonly baseURL: string;
    readonly qredoID: string;
    #authToken: string | null;
    #backgroundClient: BackgroundClient | null;
    #authTokenRenewInProgress: Promise<{
        qredoInfo: UIQredoInfo | null;
    }> | null = null;

    constructor(
        qredoID: string,
        baseURL: string,
        options: {
            authToken?: string;
            backgroundClient?: BackgroundClient;
        } = {}
    ) {
        this.qredoID = qredoID;
        this.baseURL = baseURL + (baseURL.endsWith('/') ? '' : '/');
        this.#authToken = options.authToken || null;
        this.#backgroundClient = options.backgroundClient || null;
    }

    public set authToken(authToken: string) {
        this.#authToken = authToken;
    }

    public get authToken() {
        return this.#authToken || '';
    }

    public createAuthToken({
        refreshToken,
        grantType,
    }: AuthTokenParams): Promise<AuthTokenResponse> {
        const params = new FormData();
        params.append('refresh_token', refreshToken);
        if (grantType) {
            params.append('grant_type', grantType);
        }
        return this.#request(`${this.baseURL}sui/token`, {
            method: 'post',
            body: params,
        });
    }

    public getWallets({
        filters,
    }: GetWalletsParams = {}): Promise<GetWalletsResponse> {
        const searchParams = new URLSearchParams();
        if (filters?.address) {
            searchParams.append('address', filters.address);
        }
        const searchQuery = searchParams.toString();
        return this.#request(
            `${this.baseURL}sui/wallets${searchQuery ? `?${searchQuery}` : ''}`
        );
    }

    #request = async (...params: Parameters<typeof fetch>) => {
        console.log('qredo api request', ...params);
        // TODO: append authToken to request?
        let tries = 0;
        while (tries++ <= 1) {
            // TODO: add monitoring?
            const response = await fetch(...params);
            const dataJson = await response.json();
            if (response.ok) {
                return dataJson;
            }
            if (response.status === 401) {
                if (this.#backgroundClient && tries === 1) {
                    if (this.#authTokenRenewInProgress) {
                        await this.#authTokenRenewInProgress;
                    } else {
                        this.#authTokenRenewInProgress = this.#backgroundClient
                            .getQredoApiInfo(this.qredoID, true)
                            .finally(
                                () => (this.#authTokenRenewInProgress = null)
                            );
                        const { qredoInfo } = await this
                            .#authTokenRenewInProgress;
                        this.#authToken = qredoInfo?.authToken || null;
                    }
                    if (this.#authToken) {
                        continue;
                    }
                }
                throw new QredoAPIUnauthorizedError(response.status, dataJson);
            }
            throw new QredoAPIError(response.status, dataJson);
        }
    };
}
