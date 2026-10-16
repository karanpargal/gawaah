import { useEffect, useMemo, useState } from "react"
import { publicClient } from "../arkiv/client"
import { recentTakedowns } from "../arkiv/read"
import { Platform, type PlatformCode, type Takedown, TakedownAction } from "../arkiv/schema"
import { formatWhen } from "../lib/clock"
import { errorText, short } from "./common"

const pub = publicClient()
const WINDOW = 30 * 24 * 3600

export function Censored() {
  const [items, setItems] = useState<Takedown[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    recentTakedowns(pub, Math.floor(Date.now() / 1000) - WINDOW)
      .then(setItems)
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
      <h1>What's being taken down</h1>
      <p className="lede">
        Every report logged as removed, withheld in India, or suspended on another platform in the
        last 30 days.
      </p>
      <p className="sub">
        The takedown itself becomes evidence: anyone can query this list with the documented
        schema, without going through this site.
      </p>
      {error && <p className="error">{error}</p>}
      {items === null ? (
        <p className="status">Querying Arkiv…</p>
      ) : items.length === 0 ? (
        <div className="empty">No takedowns logged in the last 30 days.</div>
      ) : (
        <>
          <div className="panel">
            <h3>Takedowns by platform</h3>
            <div style={{ display: "grid", gap: 8 }} role="list">
              {byPlatform.map(([p, n]) => (
                <div
                  key={p}
                  role="listitem"
                  title={`${Platform[p] ?? "Other"}: ${n} takedown${n === 1 ? "" : "s"}`}
                  style={{ display: "grid", gridTemplateColumns: "110px 1fr 32px", gap: 10, alignItems: "center", fontSize: 14 }}
                >
                  <span>{Platform[p] ?? "Other"}</span>
                  <span style={{ background: "var(--sunk)", borderRadius: 4, height: 14 }}>
                    <span
                      style={{
                        display: "block",
                        height: "100%",
                        width: `${(n / max) * 100}%`,
                        minWidth: 4,
                        background: "var(--accent)",
                        borderRadius: "0 4px 4px 0",
                      }}
                    />
                  </span>
                  <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{n}</span>
                </div>
              ))}
            </div>
          </div>
          <ul className="evidence panel">
            {items.map((t) => (
              <li key={t.key}>
                <span className="tag seal">⊘</span>
                <div>
                  <b>{TakedownAction[t.action] ?? "Taken down"}</b> on {Platform[t.platform] ?? "a platform"} ·{" "}
                  {formatWhen(t.takenDownAt)}
                  {t.note && <div className="status">{t.note}</div>}
                  <div className="status">
                    <a href={`#/r/${t.report}`}>Open the report ({short(t.report, 6)})</a>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
