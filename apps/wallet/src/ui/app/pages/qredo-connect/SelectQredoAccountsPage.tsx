// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useParams, useLocation } from 'react-router-dom';

import { useQredoUIPendingRequest, useFetchQredoAccounts } from './hooks';
import { SummaryCard } from '_components/SummaryCard';
import Loading from '_components/loading';
import Overlay from '_components/overlay';

export function SelectQredoAccountsPage() {
    const { id } = useParams();
    const { state } = useLocation();
    const qredoRequestReviewd = !!state?.reviewed;
    const { data: qredoRequest, isLoading: isQredoRequestLoading } =
        useQredoUIPendingRequest(id);
    const fetchAccountsEnabled =
        !isQredoRequestLoading && (!qredoRequest || qredoRequestReviewd);
    const { data, isLoading } = useFetchQredoAccounts(id, fetchAccountsEnabled);
    return (
        <Overlay showModal title="Import Accounts">
            <Loading loading={isQredoRequestLoading}>
                <SummaryCard
                    header="Select accounts"
                    body={
                        <Loading loading={isLoading}>
                            {JSON.stringify(data)}
                        </Loading>
                    }
                />
            </Loading>
        </Overlay>
    );
}
