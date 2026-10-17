import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { type Hex, http, webSocket } from "viem"
import { privateKeyToAccount } from "viem/accounts"

export { tiramisu }

export const EXPLORER = "https://tiramisu.explorer.arkiv.network"
export const BLOCK_SECONDS = 2
export const DEFAULT_RPC = tiramisu.rpcUrls.default.http[0]

// --- endpoint -------------------------------------------------------------

/**
 * Which node to talk to. The public Tiramisu RPC gives each IP a free query budget and then
 * answers 429. People behind one shared IP (a campus, a protest site's Wi-Fi) can hit it together,
 * and any single endpoint can be blocked. So the node and an optional API key are settings: in the
 * browser they're stored per device, and in scripts they come from ARKIV_RPC_URL / ARKIV_API_KEY.
 */
const RPC_SETTING = "gawaah.rpc-url"
const KEY_SETTING = "gawaah.api-key"

function stored(name: string): string | null {
  try {
    return globalThis.localStorage?.getItem(name) ?? null
  } catch {
    return null
  }
}

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] || undefined : undefined
}

export type RpcConfig = { url: string; apiKey: string | null; custom: boolean }

export function rpcConfig(): RpcConfig {
  const url = stored(RPC_SETTING) || env("ARKIV_RPC_URL")
  const apiKey = stored(KEY_SETTING) || env("ARKIV_API_KEY") || null
  return { url: url || DEFAULT_RPC, apiKey, custom: !!url }
}

export function saveRpcConfig(url: string, apiKey: string) {
  try {
    if (url.trim() && url.trim() !== DEFAULT_RPC) localStorage.setItem(RPC_SETTING, url.trim())
    else localStorage.removeItem(RPC_SETTING)
    if (apiKey.trim()) localStorage.setItem(KEY_SETTING, apiKey.trim())
    else localStorage.removeItem(KEY_SETTING)
  } catch {
    // Storage blocked: settings can't persist, the defaults still work.
  }
}

function transport() {
  const { url, apiKey } = rpcConfig()
  return http(url, {
    // viem honours Retry-After on a 429, and the public node sends values like 2410 seconds,
    // so the default retry turns a rate limit into a silent 40-minute hang. Fail fast instead
    // and tell the person what happened.
    retryCount: 0,
    timeout: 20_000,
    ...(apiKey && { fetchOptions: { headers: { "X-Api-Key": apiKey } } }),
  })
}

// --- clients --------------------------------------------------------------

/** Queries go over HTTP: they are one-shot and HTTP is what every network lets through. */
export function publicClient() {
  return createPublicClient({ chain: tiramisu, transport: transport() })
}

/**
 * Live updates need a WebSocket transport. Over HTTP `watchEntityEvents` silently falls back to
 * polling `eth_getFilterChanges`, which works but lags and hammers the node.
 */
export function liveClient() {
  const { url, custom } = rpcConfig()
  const ws = custom ? url.replace(/^http/, "ws") : tiramisu.rpcUrls.default.webSocket[0]
  return createPublicClient({ chain: tiramisu, transport: webSocket(ws) })
}

export function walletClient(privateKey: Hex) {
  return createWalletClient({
    chain: tiramisu,
    transport: transport(),
    account: privateKeyToAccount(privateKey),
  })
}

export type PublicClient = ReturnType<typeof publicClient>
export type LiveClient = ReturnType<typeof liveClient>
export type WalletClient = ReturnType<typeof walletClient>

/** True when an error is the public node's per-IP query budget running out. */
export function isRateLimited(e: unknown): boolean {
  const s = e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? "")}` : String(e)
  return /\b429\b|ANON_COST_LIMITED|budget exhausted/i.test(s)
}
