// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    SuiAddress,
    SuiObjectDataFilter,
    SuiObjectResponse,
    getObjectDisplay,
} from '@mysten/sui.js';
import { useRpcClient } from '../api/RpcClientContext';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

// OriginByte contract address for mainnet (we only support mainnet)
const ORIGINBYTE_OWNER_TOKEN_ADDRESS =
    '0x95a441d389b07437d00dd07e0b6f05f513d7659b13fd7c5d3923c7d9d847199b';
const ORIGINBYTE_KIOSK_OWNER_TOKEN = `${ORIGINBYTE_OWNER_TOKEN_ADDRESS}::ob_kiosk::OwnerToken`;

const MAX_OBJECTS_PER_REQ = 6;
const hasDisplayData = (obj: SuiObjectResponse) => !!getObjectDisplay(obj).data;

interface UseGetOriginByteKioskContentsParams {
    address: SuiAddress | null;
    maxObjectRequests?: number;
    filter?: SuiObjectDataFilter;
    enabled?: boolean;
    includeKioskContents?: boolean;
}

export function useGetOriginByteKioskContents({
    address,
    enabled = true,
}: {
    address: SuiAddress | null;
    enabled: boolean;
}) {
    const rpc = useRpcClient();
    return useQuery(
        ['get-originbyte-kiosk-contents', address],
        async () => {
            // find an owner token
            const ownerToken = await rpc.getOwnedObjects({
                owner: address!,
                filter: {
                    MatchAny: [{ StructType: ORIGINBYTE_KIOSK_OWNER_TOKEN }],
                },
                options: {
                    showContent: true,
                },
            });

            if (!ownerToken) return [];

            // find list of kiosk IDs owned by address
            const obKioskIds = ownerToken.data.map(
                (obj) =>
                    obj.data?.content &&
                    'fields' in obj.data.content &&
                    obj.data.content.fields.kiosk
            );

            if (!obKioskIds.length) return [];

            // fetch the user's kiosks
            const ownedKiosks = await rpc.multiGetObjects({
                ids: obKioskIds,
                options: {
                    showContent: true,
                },
            });

            // find object IDs within a kiosk
            const kioskObjectIds = await Promise.all(
                ownedKiosks.map(async (kiosk) => {
                    if (!kiosk.data?.objectId) return [];
                    const objects = await rpc.getDynamicFields({
                        parentId: kiosk.data.objectId,
                    });
                    return objects.data.map((obj) => obj.objectId);
                })
            );

            // fetch the contents of the objects within a kiosk
            const kioskContent = await rpc.multiGetObjects({
                ids: kioskObjectIds.flat(),
                options: {
                    showType: true,
                    showContent: true,
                    showDisplay: true,
                },
            });

            return kioskContent.filter(hasDisplayData);
        },
        { enabled }
    );
}

// todo: this is a hack to get kiosk contents to display in Explorer
// with our current strategy for pagination. we should remove this when we have proper
// APIs for kiosks
export function useGetOwnedObjectsWithKiosks({
    address,
    maxObjectRequests = MAX_OBJECTS_PER_REQ,
    filter,
    includeKioskContents = true,
}: UseGetOriginByteKioskContentsParams) {
    const rpc = useRpcClient();
    const { data: kioskContents, isFetched } = useGetOriginByteKioskContents({
        address: address!,
        enabled: includeKioskContents,
    });
    const [initial] = useState(true);

    return useInfiniteQuery(
        [
            'get-owned-objects-with-kiosks',
            address,
            filter,
            maxObjectRequests,
            initial, // todo: why
        ],
        async ({ pageParam }) => {
            const ownedObjects = await rpc.getOwnedObjects({
                owner: address!,
                filter: { MatchNone: [{ StructType: '0x2::coin::Coin' }] },
                options: {
                    showType: true,
                    showContent: true,
                    showDisplay: true,
                },
                limit: maxObjectRequests,
                cursor: kioskContents?.length ? undefined : pageParam,
            });

            // if there are no kiosk contents just return normally
            if (!kioskContents?.length) return ownedObjects;

            // set data to the kiosk contents and mutate the array
            const data: SuiObjectResponse[] & Partial<{ obKiosk: boolean }>[] =
                kioskContents?.splice(0, maxObjectRequests) ?? [];

            // if we're out of kiosk items to display, return owned objects
            if (data.length < maxObjectRequests) {
                const diff = maxObjectRequests - data.length;
                data.push(...ownedObjects.data.splice(0, diff));
            }

            return {
                ...ownedObjects,
                data,
            };
        },
        {
            getNextPageParam: (lastPage) =>
                lastPage.hasNextPage ? lastPage.nextCursor : undefined,
            enabled: isFetched,
        }
    );
}
