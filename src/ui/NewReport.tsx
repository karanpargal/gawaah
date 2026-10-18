import { useEffect, useRef, useState } from "react"
import { publicClient } from "../arkiv/client"
import { Category, type CategoryCode, LIMITS } from "../arkiv/schema"
import { publishReport } from "../arkiv/write"
import { ensureGas, persistentAddress, signer } from "../lib/identity"
import { type PreparedPhoto, preparePhoto, type Redaction } from "../lib/photo"
import { districtsOf, STATES } from "../lib/regions"
import { errorText, Problem } from "./common"
import { type Option, Select } from "./Select"
import { toLocalInput } from "./ReportPage"

const pub = publicClient()
const STATE_OPTIONS: Option<number>[] = STATES.map((s) => ({ value: s.code, label: s.name }))
const CATEGORY_OPTIONS: Option<CategoryCode>[] = Object.entries(Category).map(([c, l]) => ({
  value: Number(c) as CategoryCode,
  label: l,
}))

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
    <div className="narrow">
      <header className="page-head">
        <h1>Report what you saw</h1>
        <p>
          Once posted, a report is sealed: <b>nobody can edit or delete it, including you</b>. It stays
          up for a week, longer if people confirm it.
        </p>
      </header>
      <div className="callout warn">
        <b>Stay safe.</b> Don't name people or include phone numbers or handles. Keep faces out of
        photos, or pixelate them below. Location is recorded to the district, never finer.
      </div>
      <form className="form" onSubmit={submit} style={{ marginTop: 28 }}>
        <div className="section">
          <span className="label">Where and when</span>
          <div className="two">
            <div className="field">
              <span className="flabel" id="state-l">State</span>
              <Select
                id="state"
                labelledBy="state-l"
                value={state}
                options={STATE_OPTIONS}
                onChange={(v) => {
                  setState(v)
                  setDistrict(0)
                }}
                placeholder="Choose a state"
              />
            </div>
            <div className="field">
              <span className="flabel" id="district-l">District</span>
              <Select
                id="district"
                labelledBy="district-l"
                value={district}
                options={districtsOf(state).map((d) => ({ value: d.code, label: d.name }))}
                onChange={setDistrict}
                disabled={!state}
                placeholder={state ? "Choose a district" : "Choose a state first"}
              />
            </div>
          </div>
          <div className="two">
            <div className="field">
              <span className="flabel" id="category-l">What happened</span>
              <Select id="category" labelledBy="category-l" value={category} options={CATEGORY_OPTIONS} onChange={setCategory} />
            </div>
            <div className="field">
              <label htmlFor="when">When</label>
              <input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
            </div>
          </div>
        </div>

        <div className="section">
          <span className="label">What you saw</span>
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" value={title} maxLength={LIMITS.titleChars} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Students' march stopped at the university gate" required />
          </div>
          <div className="field">
            <label htmlFor="body">Details</label>
            <textarea id="body" value={body} maxLength={LIMITS.bodyChars} onChange={(e) => setBody(e.target.value)} placeholder="Facts first: what, roughly how many, what the police did, what time it ended." />
            <small className="mono">
              {body.length} / {LIMITS.bodyChars}
            </small>
          </div>
        </div>

        <div className="section">
          <span className="label">Photo (optional)</span>
          {!prepared ? (
            <label className="drop">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null)
                  setBoxes([])
                }}
              />
              <b>Choose a photo</b>
              <span>Location, camera and time data are stripped on your device before anything is sent.</span>
            </label>
          ) : (
            <div className="field">
              <span className="flabel">Drag over faces to pixelate them</span>
              <Redactor src={prepared.url} boxes={boxes} onChange={setBoxes} />
              <small>
                <span className="mono">
                  {prepared.width}×{prepared.height} · {Math.round(prepared.bytes.length / 1024)} KB
                </span>{" "}
                · this preview is exactly what will be posted ·{" "}
                {boxes.length > 0 && (
                  <>
                    <button type="button" className="linkish" onClick={() => setBoxes([])}>
                      clear {boxes.length} {boxes.length === 1 ? "box" : "boxes"}
                    </button>{" "}
                    ·{" "}
                  </>
                )}
                <button
                  type="button"
                  className="linkish"
                  onClick={() => {
                    setFile(null)
                    setBoxes([])
                  }}
                >
                  remove photo
                </button>
              </small>
            </div>
          )}
        </div>

        <div className="section">
          <p className="status" style={{ margin: 0 }}>
            {persistent ? (
              <>
                Signed with your <b>persistent witness ID</b> <span className="mono">{persistent.slice(0, 10)}…</span>.
                People who trust you will see it. Change this in <a href="#/about">How it works</a>.
              </>
            ) : (
              <>
                Signed with a <b>one-time wallet</b> created now and forgotten right after. Nothing links
                this report to you or to anything else you post.
              </>
            )}
          </p>
          <div className="form-actions">
            <button className="btn primary" disabled={busy}>
              {busy ? "Posting…" : "Seal and post"}
            </button>
            {status && <span className="status">{status}</span>}
          </div>
          {error && <Problem error={error} />}
        </div>
      </form>
    </div>
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
