import { useEffect, useState } from "react"
import type { Hex } from "viem"
import { EXPLORER } from "../arkiv/client"
import { Category, type CategoryCode, Lifetime, type Report } from "../arkiv/schema"
import { formatDuration, secondsLeft, useClock } from "../lib/clock"
import { districtName, stateName } from "../lib/regions"

export const short = (h: string, n = 4) => `${h.slice(0, 2 + n)}…${h.slice(-n)}`

export function Addr({ address, label }: { address: Hex; label?: string | undefined }) {
  return (
    <a className="mono" href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">
      {label ?? short(address)}
    </a>
  )
}

export function EntityLink({ entityKey }: { entityKey: Hex }) {
  return (
    <a className="mono" href={`${EXPLORER}/entity/${entityKey}`} target="_blank" rel="noreferrer">
      {short(entityKey, 6)}
    </a>
  )
}

export function TxLink({ hash }: { hash: Hex }) {
  return (
    <a className="mono" href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">
      {short(hash, 6)}
    </a>
  )
}

export function CategoryTag({ code }: { code: CategoryCode }) {
  return <span className="tag">{Category[code] ?? "Unknown"}</span>
}

export function Place({ r }: { r: Pick<Report, "state" | "district"> }) {
  return (
    <span>
      {districtName(r.district)}, {stateName(r.state)}
    </span>
  )
}

export function SealTag({ sealed }: { sealed: boolean }) {
  return sealed ? (
    <span className="tag seal" title="Readonly, owned by the burn address, extendable by anyone">
      ● Sealed
    </span>
  ) : (
    <span className="tag warn" title="Not created through Gawaah's sealed path — its owner could delete it">
      Unsealed
    </span>
  )
}

/** Remaining life as a bar against the 90-day cap, re-rendered every 30 seconds. */
export function LifeBar({ expiresAt }: { expiresAt: bigint }) {
  const clock = useClock()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])
  if (!clock) return null
  const left = secondsLeft(clock, expiresAt)
  const pct = Math.max(2, Math.min(100, (left / Lifetime.max) * 100))
  const level = left < 24 * 3600 ? "low" : left < 3 * 24 * 3600 ? "mid" : ""
  return (
    <div className={`life ${level}`}>
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <small>{left > 0 ? `Vanishes in ${formatDuration(left)}` : "Expired"}</small>
    </div>
  )
}

export function useTrustVersion() {
  const [v, setV] = useState(0)
  useEffect(() => {
    const on = () => setV((n) => n + 1)
    window.addEventListener("gawaah:trust", on)
    return () => window.removeEventListener("gawaah:trust", on)
  }, [])
  return v
}

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // viem errors are multi-paragraph; the first line is the useful part.
  return msg.split("\n")[0]!.slice(0, 300)
}
