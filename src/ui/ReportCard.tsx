import type { Counts } from "../arkiv/read"
import type { Report } from "../arkiv/schema"
import { CategoryTag, isDemo, LifeBar, Place, SealTag } from "./common"

const day = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
const time = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })

/** One report in a list: when, what and where, then how much support it has and how long it has left. */
export function ReportCard({ r, counts }: { r: Report; counts?: Counts | undefined }) {
  return (
    <a className="row" href={`#/r/${r.key}`}>
      <div className="row-when">
        {day(r.occurredAt)}
        <span>{time(r.occurredAt)}</span>
      </div>
      <div>
        <h3 className="row-title">{r.title}</h3>
        <div className="row-meta">
          <CategoryTag code={r.category} />
          <Place r={r} />
          {r.sources.length > 0 && <span className="badge">Sourced</span>}
          {r.media && <span className="badge">Photo</span>}
          {isDemo(r) && <span className="badge">Demo data</span>}
          {!r.sealed && <SealTag sealed={false} />}
        </div>
        {r.body && <p className="row-excerpt">{r.body}</p>}
      </div>
      <div className="row-side">
        <div className="tally" aria-label="Confirmed, disputed, taken down">
          {counts ? (
            <>
              <span className={counts.confirm ? "c" : "zero"} title="Confirmed">
                ✓{counts.confirm}
              </span>
              <span className={counts.dispute ? "d" : "zero"} title="Disputed">
                ✕{counts.dispute}
              </span>
              <span className={counts.takedown ? "t" : "zero"} title="Takedowns logged">
                ⊘{counts.takedown}
              </span>
            </>
          ) : (
            <span>…</span>
          )}
        </div>
        <LifeBar expiresAt={r.expiresAtBlock} />
      </div>
    </a>
  )
}
