// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { formatDate } from '@mysten/core';
import { type ReactNode } from 'react';

import { Heading } from '~/ui/Heading';
import {
    AddressLink,
    CheckpointSequenceLink,
    EpochLink,
} from '~/ui/InternalLink';
import { Text } from '~/ui/Text';
import {
    TransactionBlockCard,
    TransactionBlockCardSection,
} from '~/ui/TransactionBlockCard';

export function TransactionDetail({
    label,
    value,
}: {
    label: string;
    value: ReactNode | string;
}) {
    return (
        <div className="flex flex-col items-start gap-2 px-5 first:px-0">
            <Heading variant="heading4/semibold" color="steel-darker">
                {label}
            </Heading>
            <Text variant="pBody/normal" color="steel-dark">
                {value}
            </Text>
        </div>
    );
}

interface TransactionDetailsProps {
    sender?: string;
    checkpoint?: string;
    executedEpoch?: string;
    timestamp?: string;
}

export function TransactionDetailCard({
    sender,
    checkpoint,
    executedEpoch,
    timestamp,
}: TransactionDetailsProps) {
    return (
        <TransactionBlockCard>
            <TransactionBlockCardSection>
                <div className="flex flex-col flex-wrap gap-6">
                    {timestamp && (
                        <Text variant="pBody/medium" color="steel-dark">
                            {formatDate(Number(timestamp))}
                        </Text>
                    )}
                    <div className="divide grid grid-cols-3 gap-5 divide-x divide-gray-45 md:justify-between md:divide-x-0 xl:divide-x">
                        {sender && (
                            <TransactionDetail
                                label="Sender"
                                value={<AddressLink address={sender} />}
                            />
                        )}
                        {checkpoint && (
                            <TransactionDetail
                                label="Checkpoint"
                                value={
                                    <CheckpointSequenceLink
                                        sequence={checkpoint}
                                        label={Number(
                                            checkpoint
                                        ).toLocaleString()}
                                    />
                                }
                            />
                        )}
                        {executedEpoch && (
                            <TransactionDetail
                                label="Epoch"
                                value={<EpochLink epoch={executedEpoch} />}
                            />
                        )}
                    </div>
                </div>
            </TransactionBlockCardSection>
        </TransactionBlockCard>
    );
}
