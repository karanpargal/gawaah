import { useCallback, useEffect, useMemo, useState } from "react"
import type { Hex } from "viem"
import { publicClient } from "../arkiv/client"
import { type Counts, evidenceCounts, feed, getReport, type Page } from "../arkiv/read"
import { Category, type CategoryCode, type Report } from "../arkiv/schema"
import { trusted } from "../lib/identity"
import { useLive } from "../lib/live"
import { districtsOf, STATES } from "../lib/regions"
import { Empty, errorText, newestFirst, Problem, Skeletons, useTrustVersion, visible } from "./common"
import { ReportCard } from "./ReportCard"
import { Lead, TopStory } from "./Story"
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
        const shown = page.items.filter(visible).sort(newestFirst)
        setItems(shown)
        setNext(() => page.next)
        void loadCounts(shown)
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
      if (!r || !visible(r) || !matches(r)) return
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
      return [...incoming.filter((r) => !seen.has(r.key)), ...prev].sort(newestFirst)
    })
    void loadCounts(incoming)
    setIncoming([])
  }

  const loadMore = async () => {
    if (!next) return
    const page = await next()
    const shown = page.items.filter(visible)
    setItems((prev) => [...prev, ...shown].sort(newestFirst))
    setNext(() => page.next)
    void loadCounts(shown)
  }

  const districtOptions = useMemo<Option<number>[]>(
    () => [{ value: 0, label: "All districts" }, ...districtsOf(state).map((d) => ({ value: d.code, label: d.name }))],
    [state],
  )
  // Front-page layout: the newest report with a photo leads, the next three are top stories, the
  // rest run as a headline list.
  const lead = items.find((r) => r.media) ?? items[0]
  const others = items.filter((r) => r !== lead)
  const top = others.slice(0, 3)
  const rest = others.slice(3)
  const countsOf = (r: Report) => counts.get(r.key.toLowerCase())

  return (
    <>
      <div className="filterline" role="group" aria-label="Filter reports">
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
      {loading ? (
        <Skeletons />
      ) : !lead ? (
        error ? null : trustedOnly && trustList.length === 0 ? (
          <Empty title="You don't trust any witnesses yet">
            Open a report and choose “Trust this witness” to follow people you know.
          </Empty>
        ) : (
          <Empty title="Nothing reported here yet">Try a longer period or a wider area.</Empty>
        )
      ) : (
        <>
          <Lead r={lead} counts={countsOf(lead)} />
          {top.length > 0 && (
            <section className="top-grid" aria-label="Top stories">
              {top.map((r) => (
                <TopStory key={r.key} r={r} counts={countsOf(r)} />
              ))}
            </section>
          )}
          {rest.length > 0 && (
            <section className="river" aria-label="More reports">
              <h2 className="section-h">More reports</h2>
              {rest.map((r) => (
                <ReportCard key={r.key} r={r} counts={countsOf(r)} />
              ))}
            </section>
          )}
        </>
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
