import { createContext, useContext } from "react"
import { BLOCK_SECONDS } from "../arkiv/client"

/**
 * Arkiv expiry is counted in blocks. To show "vanishes in 3 days" we anchor one block to its
 * wall-clock time and extrapolate at the nominal block time.
 */
export type ChainClock = { block: bigint; time: number }

export const ClockContext = createContext<ChainClock | null>(null)
export const useClock = () => useContext(ClockContext)

export function blockToTime(clock: ChainClock, block: bigint): number {
  return clock.time + Number(block - clock.block) * BLOCK_SECONDS
}

export function secondsLeft(clock: ChainClock, expiresAt: bigint): number {
  const elapsed = Date.now() / 1000 - clock.time
  return Number(expiresAt - clock.block) * BLOCK_SECONDS - elapsed
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "now"
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${Math.max(1, m)}m`
}

export function formatAgo(unix: number): string {
  const s = Date.now() / 1000 - unix
  if (s < 0) return `in ${formatDuration(-s)}`
  if (s < 60) return "just now"
  return `${formatDuration(s)} ago`
}

export function formatWhen(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}
