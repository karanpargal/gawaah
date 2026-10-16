import { useEffect, useRef, useState } from "react"
import { publicClient } from "../arkiv/client"
import { Category, type CategoryCode, LIMITS } from "../arkiv/schema"
import { publishReport } from "../arkiv/write"
import { ensureGas, persistentAddress, signer } from "../lib/identity"
import { type PreparedPhoto, preparePhoto, type Redaction } from "../lib/photo"
import { districtsOf, STATES } from "../lib/regions"
import { errorText } from "./common"
import { toLocalInput } from "./ReportPage"

const pub = publicClient()

export function NewReport() {
  const [state, setState] = useState(0)
  const [district, setDistrict] = useState(0)
  const [category, setCategory] = useState<CategoryCode>(1)
  const [when, setWhen] = useState(() => toLocalInput(Date.now()))
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [boxes, setBoxes] = useState<Redaction[]>([])
  const [prepared, setPrepared] = useState<PreparedPhoto | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const persistent = persistentAddress()

  // Re-encode whenever the photo or redactions change, so the preview is exactly what gets posted.
  useEffect(() => {
    if (!file) {
      setPrepared(null)
      return
    }
    let live = true
    let url: string | null = null
    preparePhoto(file, boxes)
      .then((p) => {
        url = p.url
        if (live) setPrepared(p)
      })
      .catch((e) => live && setError(errorText(e)))
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [file, boxes])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!state || !district) return setError("Pick a state and district.")
    if (!title.trim()) return setError("Add a short title.")
    setBusy(true)
    try {
      const wallet = signer()
      await ensureGas(wallet.account.address, setStatus)
      setStatus("Sealing your report on Arkiv…")
      const res = await publishReport(pub, wallet, {
        state,
        district,
        category,
        occurredAt: Math.floor(new Date(when).getTime() / 1000),
        title,
        body,
        media: prepared?.bytes,
      })
      location.hash = `#/r/${res.reportKey}`
    } catch (e) {
      setError(errorText(e))
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Report what you saw</h1>
      <div className="callout">
        <b>Stay safe.</b> Don't name people, don't include phone numbers or handles, and keep faces
        out of photos or pixelate them below. Once posted, <b>nobody can delete this, including
        you</b>.
      </div>
      <div className="spacer" />
      <form className="form" onSubmit={submit}>
        <div className="row">
          <div className="field">
            <label htmlFor="state">State</label>
            <select
              id="state"
              value={state}
              onChange={(e) => {
                setState(Number(e.target.value))
                setDistrict(0)
              }}
              required
            >
              <option value={0}>Choose…</option>
              {STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="district">District</label>
            <select id="district" value={district} disabled={!state} onChange={(e) => setDistrict(Number(e.target.value))} required>
              <option value={0}>Choose…</option>
              {districtsOf(state).map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </select>
            <small>District only — never a street or exact location.</small>
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="category">What happened</label>
            <select id="category" value={category} onChange={(e) => setCategory(Number(e.target.value) as CategoryCode)}>
              {Object.entries(Category).map(([c, l]) => (
                <option key={c} value={c}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="when">When</label>
            <input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
          </div>
        </div>
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" value={title} maxLength={LIMITS.titleChars} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Students' march stopped at the university gate" required />
        </div>
        <div className="field">
          <label htmlFor="body">What you saw</label>
          <textarea id="body" value={body} maxLength={LIMITS.bodyChars} onChange={(e) => setBody(e.target.value)} placeholder="Facts first: what, roughly how many, what the police did, what time it ended." />
          <small>
            {body.length}/{LIMITS.bodyChars}
          </small>
        </div>
        <div className="field">
          <span className="label">Photo (optional)</span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setBoxes([])
            }}
          />
          <small>
            Location, camera and time data are stripped on your device before anything is sent. The
            photo is shrunk to fit on Arkiv (≤ {Math.round(LIMITS.mediaBytes / 1024)} KB).
          </small>
        </div>
        {prepared && (
          <div className="field">
            <span className="label">Drag over faces to pixelate them</span>
            <Redactor src={prepared.url} boxes={boxes} onChange={setBoxes} />
            <small>
              This preview is exactly what will be posted · {prepared.width}×{prepared.height} ·{" "}
              {Math.round(prepared.bytes.length / 1024)} KB
              {boxes.length > 0 && (
                <>
                  {" · "}
                  <button type="button" className="linkish" onClick={() => setBoxes([])}>
                    clear {boxes.length} {boxes.length === 1 ? "box" : "boxes"}
                  </button>
                </>
              )}
            </small>
          </div>
        )}
        <div className="callout ok">
          {persistent ? (
            <>
              Signed with your <b>persistent witness ID</b> ({persistent.slice(0, 8)}…). People who
              trust you will see it. Change this on <a href="#/about">How it works</a>.
            </>
          ) : (
            <>
              Signed with a <b>one-time wallet</b> created just now and forgotten right after. Nothing
              links this report to you or to anything else you post.
            </>
          )}
        </div>
        <div>
          <button className="btn primary" disabled={busy}>
            {busy ? "Posting…" : "Post report"}
          </button>
        </div>
        {status && <p className="status">{status}</p>}
        {error && <p className="error">{error}</p>}
      </form>
    </>
  )
}

function Redactor({
  src,
  boxes,
  onChange,
}: {
  src: string
  boxes: Redaction[]
  onChange: (b: Redaction[]) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Redaction | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)

  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    }
  }

  return (
    <div
      ref={ref}
      className="redactor"
      onPointerDown={(e) => {
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        start.current = at(e)
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        const p = at(e)
        const s = start.current
        setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) })
      }}
      onPointerUp={() => {
        if (draft && draft.w > 0.02 && draft.h > 0.02) onChange([...boxes, draft])
        start.current = null
        setDraft(null)
      }}
    >
      <img src={src} alt="Preview of the photo to be posted" draggable={false} />
      {draft && (
        <div
          className="box"
          style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }}
        />
      )}
    </div>
  )
}
