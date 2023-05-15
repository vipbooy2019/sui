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

export type AccessTokenParams = {
    refreshToken: string;
    grantType?: string;
};

export type AccessTokenResponse = {
    access_token: string;
    expires_in: number;
    token_type: string;
};

export type Wallet = {
    walletID: string;
    address: string;
    network: string;
    labels: {
        key: string;
        name: string;
        value: string;
    }[];
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
    #accessToken: string | null;
    #backgroundClient: BackgroundClient | null;
    #accessTokenRenewInProgress: Promise<{
        qredoInfo: UIQredoInfo | null;
    }> | null = null;

    constructor(
        qredoID: string,
        baseURL: string,
        options: {
            accessToken?: string;
            backgroundClient?: BackgroundClient;
        } = {}
    ) {
        this.qredoID = qredoID;
        this.baseURL = baseURL + (baseURL.endsWith('/') ? '' : '/');
        this.#accessToken = options.accessToken || null;
        this.#backgroundClient = options.backgroundClient || null;
    }

    public set accessToken(accessToken: string) {
        this.#accessToken = accessToken;
    }

    public get accessToken() {
        return this.#accessToken || '';
    }

    public createAccessToken({
        refreshToken,
        grantType = 'refresh_token',
    }: AccessTokenParams): Promise<AccessTokenResponse> {
        const params = new FormData();
        params.append('refresh_token', refreshToken);
        if (grantType) {
            params.append('grant_type', grantType);
        }
        return this.#request(`${this.baseURL}connect/sui/token`, {
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
            `${this.baseURL}connect/sui/wallets${
                searchQuery ? `?${searchQuery}` : ''
            }`
        );
    }

    #request = async (...params: Parameters<typeof fetch>) => {
        let tries = 0;
        while (tries++ <= 1) {
            // TODO: add monitoring?
            const response = await fetch(params[0], {
                ...params[1],
                headers: {
                    ...params[1]?.headers,
                    Authorization: `Bearer ${this.#accessToken}`,
                },
            });
            const dataJson = await response.json();
            if (response.ok) {
                return dataJson;
            }
            if (response.status === 401) {
                if (this.#backgroundClient && tries === 1) {
                    if (this.#accessTokenRenewInProgress) {
                        await this.#accessTokenRenewInProgress;
                    } else {
                        this.#accessTokenRenewInProgress =
                            this.#backgroundClient
                                .getQredoConnectionInfo(this.qredoID, true)
                                .finally(
                                    () =>
                                        (this.#accessTokenRenewInProgress =
                                            null)
                                );
                        const { qredoInfo } = await this
                            .#accessTokenRenewInProgress;
                        this.#accessToken = qredoInfo?.accessToken || null;
                    }
                    if (this.#accessToken) {
                        continue;
                    }
                }
                throw new QredoAPIUnauthorizedError(response.status, dataJson);
            }
            throw new QredoAPIError(response.status, dataJson);
        }
    };
}
