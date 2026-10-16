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
  | { name: "about" }
  | { name: "report"; key: Hex }

function parse(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/"
  const m = path.match(/^\/r\/(0x[0-9a-fA-F]{64})$/)
  if (m) return { name: "report", key: m[1] as Hex }
  if (path === "/vanishing") return { name: "vanishing" }
  if (path === "/censored") return { name: "censored" }
  if (path === "/new") return { name: "new" }
  if (path === "/about") return { name: "about" }
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

const NAV = [
  { href: "#/", label: "Reports", match: "feed" },
  { href: "#/vanishing", label: "About to vanish", match: "vanishing" },
  { href: "#/censored", label: "Taken down", match: "censored" },
  { href: "#/about", label: "How it works", match: "about" },
] as const

export function App() {
  const route = useRoute()
  const clock = useChainClock()

  return (
    <ClockContext.Provider value={clock}>
      <div className="shell">
        <header className="top">
          <a className="brand" href="#/">
            <b>Gawaah</b>
            <span>गवाह · witness</span>
          </a>
          <nav className="nav">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} aria-current={route.name === n.match ? "page" : undefined}>
                {n.label}
              </a>
            ))}
            <a className="post" href="#/new">
              + Report
            </a>
          </nav>
        </header>
        <main>
          {route.name === "feed" && <Feed />}
          {route.name === "vanishing" && <Vanishing />}
          {route.name === "censored" && <Censored />}
          {route.name === "new" && <NewReport />}
          {route.name === "about" && <About />}
          {route.name === "report" && <ReportPage key={route.key} reportKey={route.key} />}
        </main>
        <footer className="foot-note">
          Built on Arkiv, the Web3 database (Tiramisu testnet) · MIT ·{" "}
          <a href="https://github.com/karanpargal/gawaah" target="_blank" rel="noreferrer">
            source
          </a>
        </footer>
      </div>
    </ClockContext.Provider>
  )
}
