import { useCallback, useEffect, useState } from "react"
import type { Hex } from "viem"
import { publicClient } from "../arkiv/client"
import { type Counts, evidenceCounts, expiringSoon } from "../arkiv/read"
import type { Report } from "../arkiv/schema"
import { vouch } from "../arkiv/write"
import { ensureGas, signer } from "../lib/identity"
import { useLive } from "../lib/live"
import { Empty, errorText, Problem, Skeletons } from "./common"
import { ReportCard } from "./ReportCard"

const pub = publicClient()
const HORIZON = 48 * 3600

export function Vanishing() {
  const [items, setItems] = useState<Report[] | null>(null)
  const [counts, setCounts] = useState<Map<string, Counts>>(new Map())
  const [busy, setBusy] = useState<Hex | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const page = await expiringSoon(pub, HORIZON)
    setItems(page.items)
    setCounts(await evidenceCounts(pub, page.items.map((r) => r.key)))
  }, [])

  useEffect(() => {
    load().catch((e) => setError(errorText(e)))
  }, [load])

  useLive({
    onExtended: (key) => {
      if (items?.some((r) => r.key.toLowerCase() === key.toLowerCase())) void load()
    },
  })

  async function keep(r: Report) {
    setBusy(r.key)
    setError(null)
    try {
      const wallet = signer()
      await ensureGas(wallet.account.address)
      await vouch(pub, wallet, r.key, { type: "keepAlive" })
      await load()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <header className="page-head">
        <h1>About to vanish</h1>
        <p>
          Reports that expire within 48 hours unless someone keeps them alive. Keeping one alive adds 3
          days. It doesn't mean you agree with it, only that it should stay readable. The list is a range
          query on <code>$expiresAt</code>, which only the chain sets, so posters can't game it.
        </p>
      </header>
      {error && <Problem error={error} />}
      {items === null ? (
        error ? null : <Skeletons n={2} />
      ) : items.length === 0 ? (
        <Empty title="Nothing is about to expire">Everything posted is being kept alive.</Empty>
      ) : (
        <div style={{ borderTop: "1px solid var(--line)" }}>
          {items.map((r) => (
            <div key={r.key} className="row-wrap">
              <ReportCard r={r} counts={counts.get(r.key.toLowerCase())} />
              <button className="btn" disabled={busy !== null} onClick={() => keep(r)}>
                {busy === r.key ? "Extending…" : "↻ Keep alive"}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
