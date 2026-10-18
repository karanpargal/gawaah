import { useCallback, useEffect, useState } from "react"
import type { Hex } from "viem"
import { publicClient } from "../arkiv/client"
import { type Evidence, evidenceFor, getReport, mediaBytes } from "../arkiv/read"
import {
  Platform,
  type PlatformCode,
  type Report,
  Stance,
  TakedownAction,
  type TakedownActionCode,
} from "../arkiv/schema"
import { type Vouch, vouch } from "../arkiv/write"
import { blockToTime, formatDuration, formatWhen, useClock } from "../lib/clock"
import { ensureGas, isTrusted, setTrusted, signer, trusted } from "../lib/identity"
import { useLive } from "../lib/live"
import { bytesToUrl } from "../lib/photo"
import {
  Addr,
  CategoryTag,
  EntityLink,
  Empty,
  errorText,
  hostOf,
  isDemo,
  LifeBar,
  Place,
  Problem,
  SealTag,
  Skeletons,
  short,
  TxLink,
  useTrustVersion,
} from "./common"
import { type Option, Select } from "./Select"

const pub = publicClient()

export function ReportPage({ reportKey }: { reportKey: Hex }) {
  const clock = useClock()
  const [report, setReport] = useState<Report | null | undefined>(undefined)
  const [evidence, setEvidence] = useState<Evidence | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastTx, setLastTx] = useState<Hex | null>(null)
  const [takedownOpen, setTakedownOpen] = useState(false)
  const trustV = useTrustVersion()
  const trustList = trusted()
  void trustV

  const refresh = useCallback(async () => {
    const [r, ev] = await Promise.all([getReport(pub, reportKey), evidenceFor(pub, reportKey)])
    setReport(r)
    setEvidence(ev)
    return r
  }, [reportKey])

  useEffect(() => {
    let url: string | null = null
    refresh()
      .then(async (r) => {
        if (!r?.media) return
        const bytes = await mediaBytes(pub, r.media)
        if (bytes) setPhoto((url = bytesToUrl(bytes)))
      })
      .catch((e) => setError(errorText(e)))
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [refresh])

  useLive({
    onExtended: (key, expiresAt) => {
      if (key.toLowerCase() === reportKey.toLowerCase()) {
        setReport((r) => (r ? { ...r, expiresAtBlock: expiresAt } : r))
      }
    },
    onSealed: () => void evidenceFor(pub, reportKey).then(setEvidence).catch(() => {}),
  })

  async function act(label: string, v: Vouch) {
    setBusy(label)
    setError(null)
    setLastTx(null)
    try {
      const wallet = signer()
      await ensureGas(wallet.account.address, setStatus)
      setStatus("Writing to Arkiv…")
      const res = await vouch(pub, wallet, reportKey, v)
      if (res.txHash !== "0x") setLastTx(res.txHash)
      setStatus(
        res.extendedTo
          ? "Done. You extended this report's life by 3 days."
          : "Done. This report is already at its 90-day maximum.",
      )
      setTakedownOpen(false)
      await refresh()
    } catch (e) {
      setError(errorText(e))
      setStatus(null)
    } finally {
      setBusy(null)
    }
  }

  function toggleTrust(address: Hex) {
    const list = trusted()
    if (isTrusted(list, address)) {
      setTrusted(list.filter((t) => t.address.toLowerCase() !== address.toLowerCase()))
    } else {
      setTrusted([...list, { address, label: "" }])
    }
  }

  const crumbs = (
    <nav className="crumbs" aria-label="Breadcrumb">
      <a href="#/">← Reports</a>
      <span>/</span>
      <span>{short(reportKey, 6)}</span>
    </nav>
  )

  if (report === undefined)
    return (
      <>
        {crumbs}
        <div style={{ marginTop: 20 }}>
          {error ? <Problem error={error} prefix="Couldn't load this report." /> : <Skeletons n={1} />}
        </div>
      </>
    )
  if (report === null)
    return (
      <>
        {crumbs}
        <Empty title="This report has vanished">
          It doesn't exist, or it expired because nobody kept it alive.
        </Empty>
      </>
    )

  const confirms = evidence?.witnesses.filter((w) => w.stance === Stance.Confirm) ?? []
  const disputes = evidence?.witnesses.filter((w) => w.stance === Stance.Dispute) ?? []
  const distinct = (xs: { creator: Hex }[]) => new Set(xs.map((x) => x.creator.toLowerCase())).size
  const trustedConfirms = confirms.filter((w) => isTrusted(trustList, w.creator)).length
  const postedAt = clock ? blockToTime(clock, report.createdAtBlock) : null
  const claimsFuture = postedAt !== null && report.occurredAt - postedAt > 600
  const takedowns = evidence?.takedowns ?? []
  const witnesses = evidence?.witnesses ?? []

  return (
    <article>
      {crumbs}
      <div className="rp">
        <div className="rp-main">
          <div className="rp-meta">
            <CategoryTag code={report.category} />
            <Place r={report} />
            <SealTag sealed={report.sealed} />
            {report.sources.length > 0 && <span className="badge">Sourced</span>}
            {isDemo(report) && <span className="badge">Demo data</span>}
          </div>
          <h1>{report.title}</h1>
          <p className="rp-when">
            Happened {formatWhen(report.occurredAt)} (as claimed)
            {postedAt && <> · written to Arkiv {formatWhen(postedAt)}</>}
            {claimsFuture && <span className="warn"> · claimed time is after it was posted</span>}
          </p>

          {photo && (
            <figure>
              <img src={photo} alt={report.photoCredit ? report.photoCredit.label : "Photo attached to the report, metadata removed"} />
              <figcaption>
                {report.photoCredit ? (
                  <a href={report.photoCredit.url} target="_blank" rel="noreferrer" className="ext">
                    {report.photoCredit.label}
                  </a>
                ) : (
                  "Attached by the reporter. Location, camera and time metadata were removed before upload."
                )}
              </figcaption>
            </figure>
          )}

          {report.body && <p className="rp-body">{report.body}</p>}

          {report.sources.length > 0 && (
            <section className="sources">
              <h3 className="label">Sources</h3>
              <ol>
                {report.sources.map((src) => (
                  <li key={src.url}>
                    <a href={src.url} target="_blank" rel="noreferrer" className="ext">
                      {src.label}
                    </a>
                    <span className="host">{hostOf(src.url)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <dl className="facts">
            <div className="c">
              <dt className="label">Confirmed</dt>
              <dd>
                {distinct(confirms)}
                {trustedConfirms > 0 && <span className="faint"> ({trustedConfirms} trusted)</span>}
              </dd>
            </div>
            <div className="d">
              <dt className="label">Disputed</dt>
              <dd>{distinct(disputes)}</dd>
            </div>
            <div className="t">
              <dt className="label">Takedowns</dt>
              <dd>{takedowns.length}</dd>
            </div>
            <div>
              <dt className="label">Life left</dt>
              <dd>{clock ? formatDuration(blockToTime(clock, report.expiresAtBlock) - Date.now() / 1000) : "–"}</dd>
              <LifeBar expiresAt={report.expiresAtBlock} />
            </div>
          </dl>
        </div>

        <aside className="rp-side">
          <div className="side-block">
            <h3>Add to the record</h3>
            <p>
              Signed by a brand-new wallet. Each adds 3 days to this report's life; disputes too, so
              contested evidence stays visible.
            </p>
            <div className="acts">
              <button className="act c" disabled={!!busy} onClick={() => act("confirm", { type: "witness", stance: Stance.Confirm })}>
                <span className="ico">✓</span>
                {busy === "confirm" ? "Confirming…" : "I saw this"}
                <small>+3d</small>
              </button>
              <button className="act d" disabled={!!busy} onClick={() => act("dispute", { type: "witness", stance: Stance.Dispute })}>
                <span className="ico">✕</span>
                {busy === "dispute" ? "Recording…" : "This is wrong"}
                <small>+3d</small>
              </button>
              <button className="act t" disabled={!!busy} onClick={() => setTakedownOpen((v) => !v)} aria-expanded={takedownOpen}>
                <span className="ico">⊘</span>
                It was taken down
                <small>+3d</small>
              </button>
              <button className="act" disabled={!!busy} onClick={() => act("keep", { type: "keepAlive" })}>
                <span className="ico">↻</span>
                {busy === "keep" ? "Extending…" : "Keep it alive"}
                <small>+3d</small>
              </button>
            </div>
            {takedownOpen && <TakedownForm busy={!!busy} onSubmit={(v) => act("takedown", v)} />}
            {status && <p className="status">{status}</p>}
            {lastTx && (
              <p className="status">
                Transaction <TxLink hash={lastTx} />
              </p>
            )}
            {error && <Problem error={error} />}
          </div>

          <div className="side-block">
            <h3>Verify on-chain</h3>
            <p>Everything here can be checked on the Tiramisu explorer, without this website.</p>
            <dl className="kv">
              <div>
                <dt className="label">Report entity</dt>
                <dd>
                  <EntityLink entityKey={report.key} />
                </dd>
              </div>
              <div>
                <dt className="label">Written by</dt>
                <dd>
                  <Addr address={report.creator} />{" "}
                  <button className="linkish" onClick={() => toggleTrust(report.creator)}>
                    {isTrusted(trustList, report.creator) ? "Untrust" : "Trust this witness"}
                  </button>
                </dd>
              </div>
              <div>
                <dt className="label">Owner</dt>
                <dd>
                  <Addr address={report.owner} /> {report.sealed && "burn address, so no one can delete it"}
                </dd>
              </div>
              {report.media && (
                <div>
                  <dt className="label">Photo entity</dt>
                  <dd>
                    <EntityLink entityKey={report.media} />
                  </dd>
                </div>
              )}
              <div>
                <dt className="label">Expires at block</dt>
                <dd>
                  <span className="mono">{report.expiresAtBlock.toString()}</span>
                </dd>
              </div>
            </dl>
          </div>
        </aside>

        <section className="rp-ev">
          <h3>Evidence log</h3>
          <p className="status" style={{ margin: 0 }}>
            Every confirmation, dispute and takedown is its own Arkiv entity, linked to this report.
          </p>
          {evidence === null ? (
            <div className="ev-empty">Loading evidence…</div>
          ) : takedowns.length + witnesses.length === 0 ? (
            <div className="ev-empty">
              Nothing logged yet. If you were there, or saw a post about this removed, add it above.
            </div>
          ) : (
            <ul className="ledger">
              {takedowns.map((t) => (
                <li key={t.key}>
                  <span className="mark t">⊘</span>
                  <div>
                    <span className="grow-title">
                      <b>{TakedownAction[t.action] ?? "Taken down"}</b> on {Platform[t.platform] ?? "a platform"}
                    </span>
                    {t.note && <div className="note">{t.note}</div>}
                    <div className="sub">
                      <span>
                        logged by <Addr address={t.creator} />
                      </span>
                      <EntityLink entityKey={t.key} label="entity" />
                    </div>
                  </div>
                  <span className="when">{formatWhen(t.takenDownAt)}</span>
                </li>
              ))}
              {witnesses.map((w) => (
                <li key={w.key}>
                  <span className={`mark ${w.stance === Stance.Confirm ? "c" : "d"}`}>
                    {w.stance === Stance.Confirm ? "✓" : "✕"}
                  </span>
                  <div>
                    {w.stance === Stance.Confirm ? "Confirmed" : "Disputed"} by <Addr address={w.creator} />
                    {isTrusted(trustList, w.creator) && <span className="badge" style={{ marginLeft: 8 }}>Trusted</span>}
                    {w.note && <div className="note">{w.note}</div>}
                    <div className="sub">
                      <EntityLink entityKey={w.key} label="entity" />
                      <button className="linkish" onClick={() => toggleTrust(w.creator)}>
                        {isTrusted(trustList, w.creator) ? "Untrust" : "Trust this witness"}
                      </button>
                    </div>
                  </div>
                  <span className="when">{clock ? formatWhen(blockToTime(clock, w.createdAtBlock)) : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </article>
  )
}

const PLATFORM_OPTIONS: Option<PlatformCode>[] = Object.entries(Platform).map(([c, l]) => ({
  value: Number(c) as PlatformCode,
  label: l,
}))
const ACTION_OPTIONS: Option<TakedownActionCode>[] = Object.entries(TakedownAction).map(([c, l]) => ({
  value: Number(c) as TakedownActionCode,
  label: l,
}))

function TakedownForm({ busy, onSubmit }: { busy: boolean; onSubmit: (v: Vouch) => void }) {
  const [platform, setPlatform] = useState<PlatformCode>(1)
  const [action, setAction] = useState<TakedownActionCode>(1)
  const [when, setWhen] = useState(() => toLocalInput(Date.now()))
  const [note, setNote] = useState("")
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({
          type: "takedown",
          platform,
          action,
          takenDownAt: Math.floor(new Date(when).getTime() / 1000),
          note,
        })
      }}
    >
      <div className="field">
        <span className="flabel" id="td-platform-l">Where</span>
        <Select id="td-platform" labelledBy="td-platform-l" value={platform} options={PLATFORM_OPTIONS} onChange={setPlatform} />
      </div>
      <div className="field">
        <span className="flabel" id="td-action-l">What happened</span>
        <Select id="td-action" labelledBy="td-action-l" value={action} options={ACTION_OPTIONS} onChange={setAction} />
      </div>
      <div className="field">
        <label htmlFor="td-when">When</label>
        <input id="td-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="td-note">Note (optional)</label>
        <input id="td-note" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. notice cited Section 69A" />
        <small>No links or usernames: they identify people.</small>
      </div>
      <div>
        <button className="btn primary" disabled={busy}>
          {busy ? "Logging…" : "Log takedown"}
        </button>
      </div>
    </form>
  )
}

export function toLocalInput(ms: number) {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 16)
}
