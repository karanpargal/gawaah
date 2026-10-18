import type { Counts } from "../arkiv/read"
import type { Report } from "../arkiv/schema"
import { formatDuration, formatWhen, secondsLeft, useClock } from "../lib/clock"
import { districtName } from "../lib/regions"
import { byline, CategoryTag, storyText, usePhoto } from "./common"

/** Support and remaining life in one quiet line: what a reader needs to judge a report at a glance. */
export function Support({ r, counts }: { r: Report; counts?: Counts | undefined }) {
  const clock = useClock()
  const left = clock ? secondsLeft(clock, r.expiresAtBlock) : null
  return (
    <p className="support">
      {counts ? (
        <>
          <span className={counts.confirm ? "c" : undefined}>✓ {counts.confirm} confirmed</span>
          {counts.dispute > 0 && <span className="d">✕ {counts.dispute} disputed</span>}
          {counts.takedown > 0 && <span className="t">⊘ {counts.takedown} taken down</span>}
        </>
      ) : (
        <span>…</span>
      )}
      {left !== null && <span className={left < 24 * 3600 ? "t" : undefined}>{left > 0 ? `fades in ${formatDuration(left)}` : "expired"}</span>}
    </p>
  )
}

function Dateline({ r }: { r: Report }) {
  return (
    <p className="byline">
      <b>{byline(r)}</b>
      <span>
        {districtName(r.district)} · {formatWhen(r.occurredAt)}
      </span>
    </p>
  )
}

function Photo({ r, className }: { r: Report; className: string }) {
  const url = usePhoto(r.media)
  if (!r.media) return null
  return <div className={className}>{url ? <img src={url} alt={r.photoCredit?.label ?? ""} /> : <span className="img-wait" />}</div>
}

/** The front page's top story: the newest report with a photo. */
export function Lead({ r, counts }: { r: Report; counts?: Counts | undefined }) {
  return (
    <a className={`lead${r.media ? "" : " no-img"}`} href={`#/r/${r.key}`}>
      <Photo r={r} className="lead-img" />
      <div className="lead-text">
        <CategoryTag code={r.category} />
        <h2 className="lead-h">{r.title}</h2>
        <p className="dek">{storyText(r.body)}</p>
        <Dateline r={r} />
        <Support r={r} counts={counts} />
      </div>
    </a>
  )
}

export function TopStory({ r, counts }: { r: Report; counts?: Counts | undefined }) {
  return (
    <a className="top-story" href={`#/r/${r.key}`}>
      <Photo r={r} className="top-img" />
      <CategoryTag code={r.category} />
      <h3 className="top-h">{r.title}</h3>
      <p className="dek">{storyText(r.body)}</p>
      <Dateline r={r} />
      <Support r={r} counts={counts} />
    </a>
  )
}
