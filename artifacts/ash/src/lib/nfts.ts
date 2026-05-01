import { apiUrl } from "./api-base";

export type NftStandard = "erc721" | "erc1155";

export interface NftItem {
  contractAddress: `0x${string}`;
  tokenId: string;
  type: NftStandard;
  // For ERC-721 always "1". For ERC-1155 the wallet's owned amount of this
  // edition. Stored as a decimal string so we can parse to bigint without
  // losing precision on ginormous balances.
  balance: string;
  name: string | null;
  collectionName: string | null;
  imageUrl: string | null;
}

export interface WalletNftScan {
  nfts: NftItem[];
  /**
   * `true` when the backend explicitly reported a missing indexer API key
   * (currently only on Monad mainnet without BLOCKVISION_API_KEY). Mirrors
   * the wallet-tokens scan contract so the UI can surface the same nudge.
   */
  missingKey?: boolean;
}

/**
 * Fetches the connected wallet's ERC-721 + ERC-1155 NFTs through the
 * api-server proxy. Always returns a normalized shape — never throws.
 */
export async function fetchWalletNfts(
  chainId: number,
  address: string,
): Promise<WalletNftScan> {
  try {
    const res = await fetch(
      apiUrl(`/api/explorer/nfts?chainId=${chainId}&address=${address}`),
      { credentials: "include" },
    );
    if (!res.ok) return { nfts: [] };
    const data = (await res.json()) as {
      nfts?: Array<{
        contractAddress?: string;
        tokenId?: string;
        type?: string;
        balance?: string;
        name?: string | null;
        collectionName?: string | null;
        imageUrl?: string | null;
      }>;
      source?: string;
      code?: string;
    };
    if (data?.code === "MISSING_BLOCKVISION_API_KEY") {
      return { nfts: [], missingKey: true };
    }
    const list = Array.isArray(data?.nfts) ? data.nfts : [];
    const nfts: NftItem[] = [];
    for (const it of list) {
      const addr =
        typeof it?.contractAddress === "string"
          ? it.contractAddress.toLowerCase()
          : "";
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) continue;
      const tokenId =
        typeof it?.tokenId === "string" && /^[0-9]+$/.test(it.tokenId)
          ? it.tokenId
          : null;
      if (!tokenId) continue;
      const type =
        it?.type === "erc721" || it?.type === "erc1155" ? it.type : null;
      if (!type) continue;
      // ERC-721 implicitly has balance 1; for ERC-1155 we keep whatever
      // the indexer told us. Bad payloads are passed through as "" so the
      // burn loop can reject them explicitly rather than silently sending
      // a synthetic amount of 1.
      const balance =
        typeof it?.balance === "string" && /^[0-9]+$/.test(it.balance)
          ? it.balance
          : type === "erc721"
          ? "1"
          : "";
      nfts.push({
        contractAddress: addr as `0x${string}`,
        tokenId,
        type,
        balance,
        name: typeof it?.name === "string" ? it.name : null,
        collectionName:
          typeof it?.collectionName === "string" ? it.collectionName : null,
        imageUrl: typeof it?.imageUrl === "string" ? it.imageUrl : null,
      });
    }
    return { nfts };
  } catch {
    return { nfts: [] };
  }
}

// Stable composite key for a single NFT (a contract address alone is not
// unique — one collection has many token ids).
export function nftKey(nft: Pick<NftItem, "contractAddress" | "tokenId">) {
  return `${nft.contractAddress.toLowerCase()}:${nft.tokenId}`;
}

// Human-readable label for an NFT used in burn dialogs and progress steps.
export function nftLabel(nft: NftItem): string {
  const collection = nft.collectionName || nft.name || "NFT";
  return `${collection} #${nft.tokenId}`;
}

// Minimal ABIs for the burn calls. Both standards expose
// safeTransferFrom; the ERC-1155 one carries the amount + opaque data.
export const ERC721_BURN_ABI = [
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const ERC1155_BURN_ABI = [
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "id", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
] as const;
