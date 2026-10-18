import type { Counts } from "../arkiv/read"
import type { Report } from "../arkiv/schema"
import { byline, CategoryTag, Place, SealTag, storyText } from "./common"
import { Support } from "./Story"

const day = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
const time = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })

/** One report in a headline list: when, what and where, who it's from, and how it's holding up. */
export function ReportCard({ r, counts }: { r: Report; counts?: Counts | undefined }) {
  return (
    <a className="row" href={`#/r/${r.key}`}>
      <div className="row-when">
        {day(r.occurredAt)}
        <span>{time(r.occurredAt)}</span>
      </div>
      <div>
        <div className="row-meta">
          <CategoryTag code={r.category} />
          <Place r={r} />
          {r.media && <span className="badge">Photo</span>}
          {!r.sealed && <SealTag sealed={false} />}
        </div>
        <h3 className="row-title">{r.title}</h3>
        {r.body && <p className="row-excerpt">{storyText(r.body)}</p>}
        <p className="row-by">{byline(r)}</p>
      </div>
      <div className="row-side">
        <Support r={r} counts={counts} />
      </div>
    </a>
  )
}
