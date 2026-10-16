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
import { Addr, CategoryTag, EntityLink, errorText, LifeBar, Place, SealTag, TxLink, useTrustVersion } from "./common"

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

  if (report === undefined) return <p className="status">Loading from Arkiv…</p>
  if (report === null)
    return (
      <div className="empty">
        This report doesn't exist or has expired. Nobody kept it alive.
        <div className="spacer" />
        <a href="#/">Back to reports</a>
      </div>
    )

  const confirms = evidence?.witnesses.filter((w) => w.stance === Stance.Confirm) ?? []
  const disputes = evidence?.witnesses.filter((w) => w.stance === Stance.Dispute) ?? []
  const distinct = (xs: { creator: Hex }[]) => new Set(xs.map((x) => x.creator.toLowerCase())).size
  const trustedConfirms = confirms.filter((w) => isTrusted(trustList, w.creator)).length
  const postedAt = clock ? blockToTime(clock, report.createdAtBlock) : null
  const claimsFuture = postedAt !== null && report.occurredAt - postedAt > 600

  return (
    <article>
      <p>
        <a href="#/" className="linkish">
          ← All reports
        </a>
      </p>
      <div className="card" style={{ cursor: "default" }}>
        <div className="meta">
          <CategoryTag code={report.category} />
          <Place r={report} />
          <SealTag sealed={report.sealed} />
        </div>
        <h1>{report.title}</h1>
        <div className="meta">
          <span>Happened {formatWhen(report.occurredAt)} (as claimed)</span>
          {postedAt && <span>· Written to Arkiv {formatWhen(postedAt)}</span>}
          {claimsFuture && <span className="tag warn">Claimed time is after it was posted</span>}
        </div>
        {photo && (
          <div className="photo">
            <img src={photo} alt="Photo attached to the report, with metadata removed" />
          </div>
        )}
        {report.body && <p className="body">{report.body}</p>}
        <div className="foot">
          <div className="tally">
            <span className="c">✓ {distinct(confirms)} confirmed</span>
            {trustedConfirms > 0 && <span className="c">({trustedConfirms} you trust)</span>}
            <span className="d">✕ {distinct(disputes)} disputed</span>
            <span className="t">⊘ {evidence?.takedowns.length ?? 0} takedowns</span>
          </div>
          <LifeBar expiresAt={report.expiresAtBlock} />
        </div>
      </div>

      <div className="panel">
        <h3>Were you there? Seen it taken down?</h3>
        <p className="status" style={{ marginTop: 0 }}>
          Every action below is signed by a brand-new wallet and extends this report by 3 days.
          Disputes extend it too: contested evidence should stay visible, not quietly expire.
        </p>
        <div className="actions">
          <button className="btn ok" disabled={!!busy} onClick={() => act("confirm", { type: "witness", stance: Stance.Confirm })}>
            {busy === "confirm" ? "Confirming…" : "✓ I saw this"}
          </button>
          <button className="btn warn" disabled={!!busy} onClick={() => act("dispute", { type: "witness", stance: Stance.Dispute })}>
            {busy === "dispute" ? "Recording…" : "✕ This is wrong"}
          </button>
          <button className="btn" disabled={!!busy} onClick={() => setTakedownOpen((v) => !v)}>
            ⊘ It was taken down
          </button>
          <button className="btn" disabled={!!busy} onClick={() => act("keep", { type: "keepAlive" })}>
            {busy === "keep" ? "Extending…" : "Keep alive"}
          </button>
        </div>
        {takedownOpen && <TakedownForm busy={!!busy} onSubmit={(v) => act("takedown", v)} />}
        {status && <p className="status">{status}</p>}
        {lastTx && (
          <p className="status">
            Transaction <TxLink hash={lastTx} />
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      {evidence && (evidence.witnesses.length > 0 || evidence.takedowns.length > 0) && (
        <div className="panel">
          <h3>Evidence</h3>
          <ul className="evidence">
            {evidence.takedowns.map((t) => (
              <li key={t.key}>
                <span className="tag seal">⊘</span>
                <div>
                  <b>{TakedownAction[t.action] ?? "Taken down"}</b> on {Platform[t.platform] ?? "a platform"},{" "}
                  {formatWhen(t.takenDownAt)}
                  {t.note && <div className="status">{t.note}</div>}
                  <div className="status">
                    logged by <Addr address={t.creator} />
                  </div>
                </div>
              </li>
            ))}
            {evidence.witnesses.map((w) => (
              <li key={w.key}>
                <span className={`tag ${w.stance === Stance.Confirm ? "ok" : "warn"}`}>
                  {w.stance === Stance.Confirm ? "✓" : "✕"}
                </span>
                <div style={{ flex: 1 }}>
                  {w.stance === Stance.Confirm ? "Confirmed" : "Disputed"} by <Addr address={w.creator} />
                  {isTrusted(trustList, w.creator) && <span className="tag ok"> trusted</span>}
                  {w.note && <div className="status">{w.note}</div>}
                </div>
                <button className="linkish" onClick={() => toggleTrust(w.creator)}>
                  {isTrusted(trustList, w.creator) ? "Untrust" : "Trust"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="panel">
        <h3>Check this yourself</h3>
        <dl className="kv">
          <dt>Entity</dt>
          <dd>
            <EntityLink entityKey={report.key} />
          </dd>
          <dt>Written by</dt>
          <dd>
            <Addr address={report.creator} />{" "}
            <button className="linkish" onClick={() => toggleTrust(report.creator)}>
              {isTrusted(trustList, report.creator) ? "Untrust this witness" : "Trust this witness"}
            </button>
          </dd>
          <dt>Owner</dt>
          <dd>
            <Addr address={report.owner} /> {report.sealed && "(burn address: no one can delete it)"}
          </dd>
          {report.media && (
            <>
              <dt>Photo</dt>
              <dd>
                <EntityLink entityKey={report.media} />
              </dd>
            </>
          )}
          <dt>Expires at</dt>
          <dd>
            block {report.expiresAtBlock.toString()}
            {clock && ` · in ~${formatDuration(blockToTime(clock, report.expiresAtBlock) - Date.now() / 1000)}`}
          </dd>
        </dl>
        <p className="status">
          Read it straight from the chain, without this website — see <a href="#/about">How it works</a>.
        </p>
      </div>
    </article>
  )
}

function TakedownForm({ busy, onSubmit }: { busy: boolean; onSubmit: (v: Vouch) => void }) {
  const [platform, setPlatform] = useState<PlatformCode>(1)
  const [action, setAction] = useState<TakedownActionCode>(1)
  const [when, setWhen] = useState(() => toLocalInput(Date.now()))
  const [note, setNote] = useState("")
  return (
    <form
      className="form"
      style={{ marginTop: 14 }}
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
      <div className="row">
        <div className="field">
          <label htmlFor="td-platform">Where</label>
          <select id="td-platform" value={platform} onChange={(e) => setPlatform(Number(e.target.value) as PlatformCode)}>
            {Object.entries(Platform).map(([c, l]) => (
              <option key={c} value={c}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="td-action">What happened</label>
          <select id="td-action" value={action} onChange={(e) => setAction(Number(e.target.value) as TakedownActionCode)}>
            {Object.entries(TakedownAction).map(([c, l]) => (
              <option key={c} value={c}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="td-when">When</label>
        <input id="td-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="td-note">Note (optional)</label>
        <input id="td-note" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. notice cited Section 69A" />
        <small>Don't paste links or usernames — they identify people.</small>
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
