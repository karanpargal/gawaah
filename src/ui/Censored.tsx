import { useEffect, useMemo, useState } from "react"
import type { Hex } from "viem"
import { publicClient } from "../arkiv/client"
import { getReport, recentTakedowns } from "../arkiv/read"
import { Platform, type PlatformCode, type Report, type Takedown, TakedownAction } from "../arkiv/schema"
import { formatWhen } from "../lib/clock"
import { Addr, CategoryTag, Empty, EntityLink, errorText, Place, Problem, Skeletons, visible } from "./common"

const pub = publicClient()
const WINDOW = 30 * 24 * 3600

export function Censored() {
  const [items, setItems] = useState<Takedown[] | null>(null)
  const [reports, setReports] = useState<Map<string, Report | null>>(new Map())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    recentTakedowns(pub, Math.floor(Date.now() / 1000) - WINDOW)
      .then(async (ts) => {
        // One lookup per distinct report, so each row can say what was taken down. Takedowns of
        // expired or synthetic reports are left out.
        const keys = [...new Set(ts.map((t) => t.report.toLowerCase()))] as Hex[]
        const found = await Promise.all(keys.map((k) => getReport(pub, k).catch(() => null)))
        const byKey = new Map<string, Report | null>(keys.map((k, i) => [k, found[i] ?? null]))
        setReports(byKey)
        setItems(
          ts.filter((t) => {
            const r = byKey.get(t.report.toLowerCase())
            return !!r && visible(r)
          }),
        )
      })
      .catch((e) => setError(errorText(e)))
  }, [])

  const byPlatform = useMemo(() => {
    const m = new Map<PlatformCode, number>()
    for (const t of items ?? []) m.set(t.platform, (m.get(t.platform) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [items])
  const max = byPlatform[0]?.[1] ?? 1

  return (
    <>
      <header className="page-head">
        <h1>What's being taken down</h1>
        <p>
          Reports whose posts were removed, withheld in India, or had accounts suspended elsewhere, in
          the last 30 days. Each takedown is its own Arkiv entity, so this list can be queried with the
          documented schema without going through this site.
        </p>
      </header>
      {error && <Problem error={error} />}
      {items === null ? (
        error ? null : <Skeletons n={3} />
      ) : items.length === 0 ? (
        <Empty title="No takedowns logged">Nothing has been reported as removed in the last 30 days.</Empty>
      ) : (
        <>
          <div className="results" style={{ marginTop: 0 }}>
            <span className="label">
              {items.length} {items.length === 1 ? "takedown" : "takedowns"} by platform
            </span>
          </div>
          <div className="platforms" style={{ marginTop: 12 }}>
            {byPlatform.map(([p, n]) => (
              <div key={p}>
                <span>{Platform[p] ?? "Other"}</span>
                <span className="bar" aria-hidden="true">
                  <i style={{ width: `${(n / max) * 100}%` }} />
                </span>
                <span className="n">{n}</span>
              </div>
            ))}
          </div>

          <div className="results">
            <span className="label">Most recent first</span>
          </div>
          <ul className="ledger" style={{ borderTop: 0, marginTop: 0 }}>
            {items.map((t) => {
              const r = reports.get(t.report.toLowerCase())
              return (
                <li key={t.key}>
                  <span className="mark t">⊘</span>
                  <div>
                    <div>
                      <b>{TakedownAction[t.action] ?? "Taken down"}</b> on {Platform[t.platform] ?? "a platform"}
                    </div>
                    <div className="note">
                      <a href={`#/r/${t.report}`}>{r?.title}</a>
                    </div>
                    <div className="sub">
                      {r && <CategoryTag code={r.category} />}
                      {r && <Place r={r} />}
                      <span>
                        logged by <Addr address={t.creator} />
                      </span>
                      <EntityLink entityKey={t.key} label="entity" />
                    </div>
                    {t.note && <div className="note">“{t.note}”</div>}
                  </div>
                  <span className="when">{formatWhen(t.takenDownAt)}</span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </>
  )
}
