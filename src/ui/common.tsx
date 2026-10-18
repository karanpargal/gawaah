import { type ReactNode, useEffect, useState } from "react"
import type { Hex } from "viem"
import { EXPLORER, isRateLimited, publicClient } from "../arkiv/client"
import { mediaBytes } from "../arkiv/read"
import { Category, type CategoryCode, Lifetime, type Report } from "../arkiv/schema"
import { formatDuration, secondsLeft, useClock } from "../lib/clock"
import { bytesToUrl } from "../lib/photo"
import { districtName, stateName } from "../lib/regions"

export const short = (h: string, n = 4) => `${h.slice(0, 2 + n)}…${h.slice(-n)}`

export function Addr({ address, label }: { address: Hex; label?: string | undefined }) {
  return (
    <a className="mono" href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer" title={address}>
      {label ?? short(address)}
    </a>
  )
}

export function EntityLink({ entityKey, label }: { entityKey: Hex; label?: string | undefined }) {
  return (
    <a className="mono ext" href={`${EXPLORER}/entity/${entityKey}`} target="_blank" rel="noreferrer" title={entityKey}>
      {label ?? short(entityKey, 6)}
    </a>
  )
}

export function TxLink({ hash }: { hash: Hex }) {
  return (
    <a className="mono ext" href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer" title={hash}>
      {short(hash, 6)}
    </a>
  )
}

export function CategoryTag({ code }: { code: CategoryCode }) {
  return (
    <span className="cat" data-cat={code}>
      {Category[code] ?? "Unknown"}
    </span>
  )
}

export function Place({ r }: { r: Pick<Report, "state" | "district"> }) {
  return (
    <span className="place">
      {districtName(r.district)}, {stateName(r.state)}
    </span>
  )
}

/**
 * Synthetic seed and test reports say so in their text (see scripts/seed.ts and scripts/smoke.ts).
 * They stay on-chain until they expire, since nobody can delete a sealed report, but the app never
 * shows them.
 */
const isSynthetic = (r: Pick<Report, "title" | "body">) =>
  /^\[(SMOKE|E2E) TEST\]/.test(r.title) || /(Synthetic demo report|Synthetic data for an automated test)/.test(r.body)

export const visible = (r: Pick<Report, "title" | "body">) => !isSynthetic(r)

export const newestFirst = (a: Report, b: Report) => b.occurredAt - a.occurredAt

/** "Al Jazeera" from "Al Jazeera: headline…", for bylines. */
const outlet = (label: string) => label.split(":")[0]!.trim()

/** Who a report is from: the outlets it was compiled from, or the witness wallet that wrote it. */
export function byline(r: Pick<Report, "sources" | "creator">): string {
  if (r.sources.length) return `Compiled from ${[...new Set(r.sources.map((s) => outlet(s.label)))].join(", ")}`
  return `Witness ${short(r.creator)}`
}

/** The text without the trailing provenance line, which the byline already says. */
export const storyText = (body: string) =>
  body.replace(/\n*Compiled from published news reporting, not a first-hand account\.\s*$/, "").trim()

const photoCache = new Map<string, Promise<string | null>>()

/** A report's photo as an object URL, fetched once per page load and shared between views. */
export function usePhoto(mediaKey: Hex | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!mediaKey) return
    let live = true
    let p = photoCache.get(mediaKey)
    if (!p) {
      p = mediaBytes(publicClient(), mediaKey)
        .then((b) => (b ? bytesToUrl(b) : null))
        .catch(() => null)
      photoCache.set(mediaKey, p)
    }
    void p.then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [mediaKey])
  return url
}

export function SealTag({ sealed }: { sealed: boolean }) {
  return sealed ? (
    <span className="badge" title="Readonly, owned by the burn address, extendable by anyone">
      Sealed
    </span>
  ) : (
    <span className="badge red" title="Not created through Gawaah's sealed path — its owner could delete it">
      Unsealed
    </span>
  )
}

/** Remaining life against the 90-day cap, re-rendered every 30 seconds. */
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
  return (
    <div className={`life${left < 24 * 3600 ? " low" : ""}`} title="Remaining life, out of the 90-day maximum">
      <small>{left > 0 ? `${formatDuration(left)} left` : "Expired"}</small>
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
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

const RATE_LIMITED =
  "The public Arkiv node has used up the free query budget for your network. It resets within " +
  "the hour. To keep going now, add a free API key or another node under How it works → Network."

export function errorText(e: unknown): string {
  if (isRateLimited(e)) return RATE_LIMITED
  const msg = e instanceof Error ? e.message : String(e)
  // viem errors are multi-paragraph; the first line is the useful part.
  return msg.split("\n")[0]!.slice(0, 300)
}

/** An error as a callout. A spent query budget gets a direct way out. */
export function Problem({ error, prefix }: { error: string; prefix?: string | undefined }) {
  if (error === RATE_LIMITED) {
    return (
      <div className="callout warn" role="alert">
        <b>Arkiv is rate-limiting this network.</b> The public node's free query budget resets within
        the hour. Add a free API key or another node to keep going now.
        <div>
          <a className="btn sm" href="#/about/network">
            Open network settings
          </a>
        </div>
      </div>
    )
  }
  return (
    <div className="callout red" role="alert">
      {prefix && <b>{prefix} </b>}
      {error}
    </div>
  )
}

/** Row-shaped placeholders while a query is in flight. */
export function Skeletons({ n = 4 }: { n?: number }) {
  return (
    <div aria-busy="true" aria-label="Querying Arkiv">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="row skel">
          <div>
            <i style={{ width: "70%" }} />
            <i style={{ width: "50%" }} />
          </div>
          <div>
            <i className="h" />
            <i style={{ width: "40%" }} />
            <i style={{ width: "90%" }} />
          </div>
          <div>
            <i />
          </div>
        </div>
      ))}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  )
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}
