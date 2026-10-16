import type { Counts } from "../arkiv/read"
import type { Report } from "../arkiv/schema"
import { formatAgo } from "../lib/clock"
import { CategoryTag, LifeBar, Place, SealTag } from "./common"

export function ReportCard({ r, counts }: { r: Report; counts?: Counts | undefined }) {
  return (
    <a className="card" href={`#/r/${r.key}`}>
      <div className="meta">
        <CategoryTag code={r.category} />
        <Place r={r} />
        <span>· {formatAgo(r.occurredAt)}</span>
        {r.media && <span>· 📷</span>}
        {!r.sealed && <SealTag sealed={false} />}
      </div>
      <h3>{r.title}</h3>
      {r.body && <p>{r.body}</p>}
      <div className="foot">
        <div className="tally">
          {counts ? (
            <>
              <span className="c">✓ {counts.confirm} confirmed</span>
              {counts.dispute > 0 && <span className="d">✕ {counts.dispute} disputed</span>}
              {counts.takedown > 0 && <span className="t">⊘ {counts.takedown} takedowns</span>}
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
