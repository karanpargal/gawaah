import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { type Hex, http, webSocket } from "viem"
import { privateKeyToAccount } from "viem/accounts"

export { tiramisu }

export const EXPLORER = "https://tiramisu.explorer.arkiv.network"
export const BLOCK_SECONDS = 2

/** Queries go over HTTP: they are one-shot and HTTP is what every network lets through. */
export function publicClient() {
  return createPublicClient({ chain: tiramisu, transport: http() })
}

/**
 * Live updates need a WebSocket transport. Over HTTP `watchEntityEvents` silently falls back to
 * polling `eth_getFilterChanges`, which works but lags and hammers the node.
 */
export function liveClient() {
  return createPublicClient({ chain: tiramisu, transport: webSocket() })
}

export function walletClient(privateKey: Hex) {
  return createWalletClient({
    chain: tiramisu,
    transport: http(),
    account: privateKeyToAccount(privateKey),
  })
}

export type PublicClient = ReturnType<typeof publicClient>
export type LiveClient = ReturnType<typeof liveClient>
export type WalletClient = ReturnType<typeof walletClient>
