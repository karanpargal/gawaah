import type { Hex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { publicClient, walletClient } from "../arkiv/client"

/**
 * Who signs. By default every action gets a brand-new wallet that exists only in memory and is
 * dropped as soon as the transaction lands, so two reports from the same phone can't be linked
 * on-chain. A persistent ID is opt-in, for people who *want* to build a reputation — journalists,
 * legal observers — so others can choose to trust them by `$creator`.
 */
const PERSISTENT_KEY = "gawaah.witness-key"
const TRUSTED = "gawaah.trusted"

function read(name: string): string | null {
  try {
    return localStorage.getItem(name)
  } catch {
    return null
  }
}

function write(name: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(name)
    else localStorage.setItem(name, value)
  } catch {
    // Private mode or blocked storage: the app still works, it just won't remember.
  }
}

export function persistentAddress(): Hex | null {
  const k = read(PERSISTENT_KEY)
  return k ? privateKeyToAccount(k as Hex).address : null
}

export function createPersistentId(): Hex {
  const k = generatePrivateKey()
  write(PERSISTENT_KEY, k)
  return privateKeyToAccount(k).address
}

export function forgetPersistentId() {
  write(PERSISTENT_KEY, null)
}

export function signer() {
  const k = (read(PERSISTENT_KEY) as Hex | null) ?? generatePrivateKey()
  return walletClient(k)
}

// --- trust ----------------------------------------------------------------

export type Trusted = { address: Hex; label: string }

export function trusted(): Trusted[] {
  try {
    const v = JSON.parse(read(TRUSTED) ?? "[]")
    return Array.isArray(v) ? v.filter((t) => /^0x[0-9a-fA-F]{40}$/.test(t?.address)) : []
  } catch {
    return []
  }
}

export function setTrusted(list: Trusted[]) {
  write(TRUSTED, JSON.stringify(list))
  window.dispatchEvent(new Event("gawaah:trust"))
}

export const isTrusted = (list: Trusted[], a: Hex) =>
  list.some((t) => t.address.toLowerCase() === a.toLowerCase())

// --- gas ------------------------------------------------------------------

/**
 * A fresh wallet has no GLM to pay for its transaction. The drip is a tiny endpoint that sends
 * just enough gas to an empty address. It never sees the content and can't change or remove
 * anything — the worst it can do is refuse gas, and then anyone can fund the address themselves.
 */
export const DRIP_URL: string | undefined =
  import.meta.env.VITE_DRIP_URL || (import.meta.env.DEV ? "/api/drip" : undefined)

export async function ensureGas(address: Hex, onStatus?: (s: string) => void): Promise<void> {
  const pub = publicClient()
  if ((await pub.getBalance({ address })) > 0n) return
  if (!DRIP_URL) {
    throw new Error(
      `No gas source configured. Fund ${address} from https://hub.arkiv.network/faucet and retry.`,
    )
  }
  onStatus?.("Getting a little gas for your one-time wallet…")
  const res = await fetch(DRIP_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => "")
    throw new Error(`The gas drip refused (${res.status}). ${msg}`.trim())
  }
  for (let i = 0; i < 30; i++) {
    if ((await pub.getBalance({ address })) > 0n) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error("Gas didn't arrive within 30 seconds. Try again.")
}
