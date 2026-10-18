import { useEffect, useState } from "react"
import type { Hex } from "viem"
import { publicClient } from "./arkiv/client"
import { type ChainClock, ClockContext } from "./lib/clock"
import { About } from "./ui/About"
import { Censored } from "./ui/Censored"
import { Feed } from "./ui/Feed"
import { NewReport } from "./ui/NewReport"
import { ReportPage } from "./ui/ReportPage"
import { Vanishing } from "./ui/Vanishing"

const pub = publicClient()

type Route =
  | { name: "feed" }
  | { name: "vanishing" }
  | { name: "censored" }
  | { name: "new" }
  | { name: "about"; section?: string }
  | { name: "report"; key: Hex }

function parse(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/"
  const m = path.match(/^\/r\/(0x[0-9a-fA-F]{64})$/)
  if (m) return { name: "report", key: m[1] as Hex }
  if (path === "/vanishing") return { name: "vanishing" }
  if (path === "/censored") return { name: "censored" }
  if (path === "/new") return { name: "new" }
  const about = path.match(/^\/about(?:\/(\w+))?$/)
  if (about) return about[1] ? { name: "about", section: about[1] } : { name: "about" }
  return { name: "feed" }
}

function useRoute() {
  const [route, setRoute] = useState(() => parse(location.hash))
  useEffect(() => {
    const on = () => {
      setRoute(parse(location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  return route
}

function useChainClock() {
  const [clock, setClock] = useState<ChainClock | null>(null)
  useEffect(() => {
    const sync = () =>
      pub
        .getBlockTiming()
        .then((t) => setClock({ block: t.currentBlock, time: t.currentBlockTime }))
        .catch(() => {})
    void sync()
    const id = setInterval(sync, 60_000)
    return () => clearInterval(id)
  }, [])
  return clock
}

const TODAY = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

const NAV = [
  { href: "#/", label: "Front page", match: "feed" },
  { href: "#/vanishing", label: "About to vanish", match: "vanishing" },
  { href: "#/censored", label: "Taken down", match: "censored" },
  { href: "#/about", label: "How it works", match: "about" },
] as const

export function App() {
  const route = useRoute()
  const clock = useChainClock()

  return (
    <ClockContext.Provider value={clock}>
      {route.name === "feed" ? (
        <header className="mast">
          <div className="wrap">
            <div className="mast-strip">
              <span>{TODAY}</span>
              <span className={`chain${clock ? " on" : ""}`}>
                <i />
                {clock ? `Live on Arkiv · block ${clock.block}` : "Connecting to Arkiv…"}
              </span>
            </div>
            <a className="nameplate" href="#/">
              Gawaah <span lang="hi">गवाह</span>
            </a>
            <p className="mast-tag">Protest reports from India that no one can quietly delete</p>
          </div>
        </header>
      ) : null}
      <nav className={`sections${route.name === "feed" ? "" : " compact"}`} aria-label="Sections">
        <div className="wrap sections-in">
          {route.name !== "feed" && (
            <a className="brand" href="#/" aria-label="Gawaah, front page">
              <Logo />
              <b>Gawaah</b>
            </a>
          )}
          <div className="nav">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} aria-current={route.name === n.match ? "page" : undefined}>
                {n.label}
              </a>
            ))}
          </div>
          <a className="btn primary sm" href="#/new" aria-current={route.name === "new" ? "page" : undefined}>
            Post a report
          </a>
        </div>
      </nav>
      <main className="wrap">
        {route.name === "feed" && <Feed />}
        {route.name === "vanishing" && <Vanishing />}
        {route.name === "censored" && <Censored />}
        {route.name === "new" && <NewReport />}
        {route.name === "about" && <About section={route.section} />}
        {route.name === "report" && <ReportPage key={route.key} reportKey={route.key} />}
      </main>
      <footer className="foot-note">
        <div className="wrap foot-in">
          <span>
            Built on Arkiv, the Web3 database · MIT ·{" "}
            <a href="https://github.com/karanpargal/gawaah" target="_blank" rel="noreferrer">
              source
            </a>
          </span>
          <span className={`chain${clock ? " on" : ""}`} title="Latest block this page has seen">
            <i />
            {clock ? `Tiramisu testnet · #${clock.block}` : "Connecting to Tiramisu…"}
          </span>
        </div>
      </footer>
    </ClockContext.Provider>
  )
}

/** Same mark as the favicon: a "G" drawn as an open seal. */
function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--red)" />
      <path d="M16 7a9 9 0 1 0 9 9h-9" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  )
}
