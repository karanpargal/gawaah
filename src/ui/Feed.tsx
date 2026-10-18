import { useCallback, useEffect, useMemo, useState } from "react"
import type { Hex } from "viem"
import { publicClient } from "../arkiv/client"
import { type Counts, evidenceCounts, feed, getReport, type Page } from "../arkiv/read"
import { Category, type CategoryCode, type Report } from "../arkiv/schema"
import { useClock } from "../lib/clock"
import { trusted } from "../lib/identity"
import { useLive } from "../lib/live"
import { districtsOf, STATES } from "../lib/regions"
import { Empty, errorText, feedOrder, Problem, Skeletons, useTrustVersion } from "./common"
import { ReportCard } from "./ReportCard"
import { type Option, Select } from "./Select"

const WINDOWS: Option<number>[] = [
  { label: "Last 24 hours", value: 24 * 3600 },
  { label: "Last 7 days", value: 7 * 24 * 3600 },
  { label: "Last 30 days", value: 30 * 24 * 3600 },
  { label: "Last 90 days", value: 90 * 24 * 3600 },
]
const STATE_OPTIONS: Option<number>[] = [{ value: 0, label: "All states" }, ...STATES.map((s) => ({ value: s.code, label: s.name }))]
const CATEGORY_OPTIONS: Option<number>[] = [
  { value: 0, label: "All categories" },
  ...Object.entries(Category).map(([code, label]) => ({ value: Number(code), label })),
]

const pub = publicClient()

export function Feed() {
  const [windowS, setWindowS] = useState(WINDOWS[2]!.value)
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
        setItems([...page.items].sort(feedOrder))
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
      return [...incoming.filter((r) => !seen.has(r.key)), ...prev].sort(feedOrder)
    })
    void loadCounts(incoming)
    setIncoming([])
  }

  const loadMore = async () => {
    if (!next) return
    const page = await next()
    setItems((prev) => [...prev, ...page.items].sort(feedOrder))
    setNext(() => page.next)
    void loadCounts(page.items)
  }

  const clock = useClock()
  const districtOptions = useMemo<Option<number>[]>(
    () => [{ value: 0, label: "All districts" }, ...districtsOf(state).map((d) => ({ value: d.code, label: d.name }))],
    [state],
  )
  const totals = useMemo(() => {
    let confirm = 0
    let takedown = 0
    for (const r of items) {
      const c = counts.get(r.key.toLowerCase())
      confirm += c?.confirm ?? 0
      takedown += c?.takedown ?? 0
    }
    return { confirm, takedown }
  }, [items, counts])

  return (
    <>
      <section className="intro">
        <h1>Protest reports from India that no one can quietly delete.</h1>
        <p>
          Each report is written to Arkiv sealed and handed to a burn address in the same transaction,
          so no platform, government, or Gawaah itself can edit or remove it. Reports fade after a week
          unless witnesses keep them alive. <a href="#/about">How it works</a>
        </p>
        <dl className="stats">
          <div>
            <dt>Reports</dt>
            <dd>{loading ? "–" : items.length + (next ? "+" : "")}</dd>
          </div>
          <div>
            <dt>Confirmations</dt>
            <dd>{loading ? "–" : totals.confirm}</dd>
          </div>
          <div>
            <dt>Takedowns logged</dt>
            <dd>{loading ? "–" : totals.takedown}</dd>
          </div>
          <div>
            <dt>Tiramisu</dt>
            <dd className="live">
              {clock ? (
                <>
                  <i /> #{clock.block.toString()}
                </>
              ) : (
                "–"
              )}
            </dd>
          </div>
        </dl>
      </section>

      <div className="filterbar" role="group" aria-label="Filter reports">
        <Select label="Period" value={windowS} options={WINDOWS} onChange={setWindowS} />
        <Select
          label="State"
          value={state}
          options={STATE_OPTIONS}
          onChange={(v) => {
            setState(v)
            setDistrict(0)
          }}
        />
        <Select label="District" value={district} options={districtOptions} onChange={setDistrict} disabled={!state} />
        <Select
          label="Category"
          value={category}
          options={CATEGORY_OPTIONS}
          onChange={(v) => setCategory(v as CategoryCode | 0)}
        />
        <button className="toggle" aria-pressed={trustedOnly} onClick={() => setTrustedOnly((v) => !v)}>
          <span className="sw" />
          Witnesses I trust
        </button>
      </div>

      {incoming.length > 0 && (
        <div className="banner">
          <button className="btn primary" onClick={showIncoming}>
            ↑ {incoming.length} new {incoming.length === 1 ? "report" : "reports"}
          </button>
        </div>
      )}

      {error && (
        <div className="feed-error">
          <Problem error={error} prefix="Couldn't reach Arkiv." />
        </div>
      )}
      {!error && (
        <div className="results">
          <span className="label">{WINDOWS.find((w) => w.value === windowS)?.label}</span>
          <span className="label">Newest first · demo data last · live</span>
        </div>
      )}
      {loading ? (
        <Skeletons />
      ) : items.length === 0 ? (
        error ? null : trustedOnly && trustList.length === 0 ? (
          <Empty title="You don't trust any witnesses yet">
            Open a report and choose “Trust this witness” to follow people you know.
          </Empty>
        ) : (
          <Empty title="Nothing reported here yet">Try a longer period or a wider area.</Empty>
        )
      ) : (
        <div>
          {items.map((r) => (
            <ReportCard key={r.key} r={r} counts={counts.get(r.key.toLowerCase())} />
          ))}
        </div>
      )}
      {next && (
        <p style={{ textAlign: "center", marginTop: 24 }}>
          <button className="btn" onClick={loadMore}>
            Load more
          </button>
        </p>
      )}
    </>
  )
}
