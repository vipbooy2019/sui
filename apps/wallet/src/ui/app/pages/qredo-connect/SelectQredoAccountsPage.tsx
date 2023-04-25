// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { ArrowRight16 } from '@mysten/icons';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
    useParams,
    useLocation,
    Navigate,
    useNavigate,
} from 'react-router-dom';

import { forcePersistQueryClientSave } from '../../helpers/queryClient';
import { Button } from '../../shared/ButtonUI';
import { SelectQredoAccountsSummaryCard } from './components/SelectQredoAccountsSummaryCard';
import { useQredoUIPendingRequest } from './hooks';
import { PasswordInputDialog } from '_components/menu/content/PasswordInputDialog';
import Overlay from '_components/overlay';
import { type Wallet } from '_src/shared/qredo-api';

export function SelectQredoAccountsPage() {
    const { id } = useParams();
    const { state } = useLocation();
    const navigate = useNavigate();
    const qredoRequestReviewed = !!state?.reviewed;
    const { data: qredoRequest, isLoading: isQredoRequestLoading } =
        useQredoUIPendingRequest(id);
    // do not call the api if user has not clicked continue in Qredo Connect Info page
    const fetchAccountsEnabled =
        !isQredoRequestLoading && (!qredoRequest || qredoRequestReviewed);

    const [selectedAccounts, setSelectedAccounts] = useState<Wallet[]>([]);
    const [showPassword, setShowPassword] = useState(false);
    const shouldCloseWindow = (!isQredoRequestLoading && !qredoRequest) || !id;
    useEffect(() => {
        if (shouldCloseWindow) {
            // wait for cache to be updated and then close the window
            // to avoid keeping in cache any deleted pending qredo request
            forcePersistQueryClientSave().finally(() => window.close());
        }
    }, [shouldCloseWindow]);
    if (qredoRequest && !qredoRequestReviewed) {
        return <Navigate to="../" replace relative="path" />;
    }
    if (shouldCloseWindow) {
        return null;
    }
    return (
        <>
            {showPassword ? (
                <div className="flex flex-1 pb-4">
                    <PasswordInputDialog
                        title="Import Accounts"
                        continueLabel="Import"
                        onBackClicked={() => setShowPassword(false)}
                        onPasswordVerified={(password) => {
                            // TODO: accept/store qredo connection
                            toast.success(
                                `Qredo account${
                                    selectedAccounts.length > 1 ? 's' : ''
                                } added`
                            );
                            navigate('/tokens?menu=/accounts');
                        }}
                    />
                </div>
            ) : (
                <Overlay
                    showModal
                    title="Import Accounts"
                    closeOverlay={() => {
                        navigate(-1);
                    }}
                >
                    <div className="flex flex-col flex-1 flex-nowrap align-top overflow-x-hidden overflow-y-auto gap-3">
                        <div className="flex flex-1 overflow-hidden">
                            <SelectQredoAccountsSummaryCard
                                fetchAccountsEnabled={fetchAccountsEnabled}
                                qredoID={id}
                                selectedAccounts={selectedAccounts}
                                onChange={setSelectedAccounts}
                            />
                        </div>
                        <div>
                            <Button
                                size="tall"
                                variant="primary"
                                text="Continue"
                                after={<ArrowRight16 />}
                                disabled={!selectedAccounts?.length}
                                onClick={() => {
                                    setShowPassword(true);
                                }}
                            />
                        </div>
                    </div>
                </Overlay>
            )}
        </>
    );
}
