import { useCallback, useEffect, useMemo, useState } from "react"
import type { Hex } from "viem"
import { publicClient } from "../arkiv/client"
import { type Counts, evidenceCounts, feed, getReport, type Page } from "../arkiv/read"
import { Category, type CategoryCode, type Report } from "../arkiv/schema"
import { trusted } from "../lib/identity"
import { useLive } from "../lib/live"
import { districtsOf, STATES } from "../lib/regions"
import { errorText, useTrustVersion } from "./common"
import { ReportCard } from "./ReportCard"

const WINDOWS = [
  { label: "24 hours", seconds: 24 * 3600 },
  { label: "7 days", seconds: 7 * 24 * 3600 },
  { label: "30 days", seconds: 30 * 24 * 3600 },
  { label: "90 days", seconds: 90 * 24 * 3600 },
]

const pub = publicClient()

export function Feed() {
  const [windowS, setWindowS] = useState(WINDOWS[1]!.seconds)
  const [state, setState] = useState(0)
  const [district, setDistrict] = useState(0)
  const [category, setCategory] = useState<CategoryCode | 0>(0)
  const [trustedOnly, setTrustedOnly] = useState(false)
  const trustV = useTrustVersion()

  const [items, setItems] = useState<Report[]>([])
  const [next, setNext] = useState<Page<Report>["next"]>(null)
  const [counts, setCounts] = useState<Map<string, Counts>>(new Map())
  const [incoming, setIncoming] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const trustList = useMemo(() => trusted(), [trustV])
  const filter = useMemo(
    () => ({
      since: Math.floor(Date.now() / 1000) - windowS,
      state: state || undefined,
      district: district || undefined,
      category: category || undefined,
      creators: trustedOnly ? trustList.map((t) => t.address) : undefined,
    }),
    [windowS, state, district, category, trustedOnly, trustList],
  )

  const loadCounts = useCallback(async (reports: Report[]) => {
    if (!reports.length) return
    const c = await evidenceCounts(pub, reports.map((r) => r.key))
    setCounts((prev) => new Map([...prev, ...c]))
  }, [])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    setIncoming([])
    if (trustedOnly && trustList.length === 0) {
      setItems([])
      setNext(null)
      setLoading(false)
      return
    }
    feed(pub, filter)
      .then((page) => {
        if (!live) return
        setItems(page.items)
        setNext(() => page.next)
        void loadCounts(page.items)
      })
      .catch((e) => live && setError(errorText(e)))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [filter, loadCounts, trustedOnly, trustList.length])

  const matches = useCallback(
    (r: Report) =>
      r.occurredAt >= filter.since &&
      (!filter.state || r.state === filter.state) &&
      (!filter.district || r.district === filter.district) &&
      (!filter.category || r.category === filter.category) &&
      (!filter.creators || filter.creators.some((c) => c.toLowerCase() === r.creator.toLowerCase())),
    [filter],
  )

  useLive({
    onSealed: async (key: Hex) => {
      const r = await getReport(pub, key).catch(() => null)
      if (!r || !matches(r)) return
      setIncoming((prev) => (prev.some((p) => p.key === r.key) ? prev : [r, ...prev]))
    },
    onExtended: (key, expiresAt) => {
      setItems((prev) =>
        prev.map((r) => (r.key.toLowerCase() === key.toLowerCase() ? { ...r, expiresAtBlock: expiresAt } : r)),
      )
    },
  })

  const showIncoming = () => {
    setItems((prev) => {
      const seen = new Set(prev.map((r) => r.key))
      return [...incoming.filter((r) => !seen.has(r.key)), ...prev]
    })
    void loadCounts(incoming)
    setIncoming([])
  }

  const loadMore = async () => {
    if (!next) return
    const page = await next()
    setItems((prev) => [...prev, ...page.items].sort((a, b) => b.occurredAt - a.occurredAt))
    setNext(() => page.next)
    void loadCounts(page.items)
  }

  return (
    <>
      <p className="lede">
        Reports from protests across India, held on Arkiv. No one — not a platform, not us — can
        edit or delete them.
      </p>
      <p className="sub">
        Each one lives for a week and stays up for as long as people keep confirming it.
      </p>

      <div className="filters">
        <div className="chipset" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button
              key={w.seconds}
              className="chip"
              aria-pressed={windowS === w.seconds}
              onClick={() => setWindowS(w.seconds)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <div className="filters">
        <select
          aria-label="State"
          value={state}
          onChange={(e) => {
            setState(Number(e.target.value))
            setDistrict(0)
          }}
        >
          <option value={0}>All states</option>
          {STATES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          aria-label="District"
          value={district}
          disabled={!state}
          onChange={(e) => setDistrict(Number(e.target.value))}
        >
          <option value={0}>All districts</option>
          {districtsOf(state).map((d) => (
            <option key={d.code} value={d.code}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Category"
          value={category}
          onChange={(e) => setCategory(Number(e.target.value) as CategoryCode | 0)}
        >
          <option value={0}>Everything</option>
          {Object.entries(Category).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <button className="chip" aria-pressed={trustedOnly} onClick={() => setTrustedOnly((v) => !v)}>
          Only witnesses I trust
        </button>
      </div>

      {incoming.length > 0 && (
        <div className="banner">
          <button className="btn primary" onClick={showIncoming}>
            {incoming.length} new {incoming.length === 1 ? "report" : "reports"} · show
          </button>
        </div>
      )}

      {error && <p className="error">Couldn't reach Arkiv: {error}</p>}
      {loading ? (
        <p className="status">Querying Arkiv…</p>
      ) : items.length === 0 ? (
        <div className="empty">
          {trustedOnly && trustList.length === 0
            ? "You don't trust any witnesses yet. Open a report and tap “Trust this witness”."
            : "Nothing reported here in this window."}
        </div>
      ) : (
        <div className="list">
          {items.map((r) => (
            <ReportCard key={r.key} r={r} counts={counts.get(r.key.toLowerCase())} />
          ))}
        </div>
      )}
      {next && (
        <p>
          <button className="btn" onClick={loadMore}>
            Load more
          </button>
        </p>
      )}
    </>
  )
}
