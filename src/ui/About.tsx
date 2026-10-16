import { useState } from "react"
import { BURN_ADDRESS } from "../arkiv/schema"
import {
  createPersistentId,
  DRIP_URL,
  forgetPersistentId,
  persistentAddress,
  setTrusted,
  trusted,
} from "../lib/identity"
import { Addr, useTrustVersion } from "./common"

const RPC = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
const CURL = `curl -s ${RPC} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query",
       "params":["app = str('"'"'gawaah'"'"') AND kind = str('"'"'report'"'"')",
                 {"select":{"key":true,"creator":true,"expiresAt":true,
                            "attributes":true,"payload":true},
                  "limit":"0x32"}]}'`

export function About() {
  const [persistent, setPersistent] = useState(persistentAddress())
  useTrustVersion()
  const list = trusted()

  return (
    <>
      <h1>How Gawaah works</h1>
      <p className="lede">
        When a post about a protest gets taken down, the people who were there lose the record. Gawaah
        keeps that record somewhere no one can quietly delete it.
      </p>

      <h2>What stops a takedown</h2>
      <ul>
        <li>
          <b>No server holds the reports.</b> They're Arkiv entities on a public chain. This page is
          static files that read and write the chain directly from your browser.
        </li>
        <li>
          <b>Nobody can edit a report</b>, not even its author. It's created with Arkiv's{" "}
          <code>readonly</code> flag.
        </li>
        <li>
          <b>Nobody can delete a report</b>, not even its author. In the same transaction that
          creates it, ownership passes to the burn address (<Addr address={BURN_ADDRESS} />), a
          key nobody holds.
        </li>
        <li>
          <b>Anyone can keep a report alive.</b> It's created with <code>permissionlessExtension</code>,
          so a witness, a journalist or a stranger can push its expiry out. Each confirmation adds 3
          days, up to 90.
        </li>
      </ul>

      <h2>Why reports expire at all</h2>
      <p>
        Every Arkiv entity expires, and here that's useful. Spam and unconfirmed claims fade on their
        own after a week, without a moderator. Whatever people keep vouching for survives. Nobody has
        to decide what's true; the people who were there do, by keeping it alive.
      </p>

      <h2>Read it without this website</h2>
      <p>
        If this site is blocked, the data isn't. Ask any Arkiv node yourself:
      </p>
      <pre>{CURL}</pre>
      <p className="status">
        The full data contract, with every entity type, attribute and query, is in{" "}
        <a href="https://github.com/karanpargal/gawaah/blob/main/arkiv/schema.md" target="_blank" rel="noreferrer">
          arkiv/schema.md
        </a>
        . The app is MIT-licensed. Fork it, mirror it, or host it on any static server or IPFS.
      </p>

      <h2>Your identity</h2>
      <div className="panel">
        {persistent ? (
          <>
            <p style={{ marginTop: 0 }}>
              You're using a <b>persistent witness ID</b>: <Addr address={persistent} />. Everything
              you post is linked to it, so people who trust you can find your reports.
            </p>
            <button
              className="btn"
              onClick={() => {
                forgetPersistentId()
                setPersistent(null)
              }}
            >
              Forget it and go back to one-time wallets
            </button>
          </>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>
              You're using <b>one-time wallets</b> (the safest default). Every action gets a new
              wallet that only ever exists in this tab's memory.
            </p>
            <p className="status">
              Journalists and legal observers may want a persistent ID instead, so others can choose
              to trust them. It's stored only on this device.
            </p>
            <button className="btn" onClick={() => setPersistent(createPersistentId())}>
              Create a persistent witness ID
            </button>
          </>
        )}
      </div>

      <h3>Witnesses you trust</h3>
      {list.length === 0 ? (
        <p className="status">None yet. Use “Trust” on a report or confirmation.</p>
      ) : (
        <ul className="evidence panel">
          {list.map((t) => (
            <li key={t.address}>
              <Addr address={t.address} />
              <span style={{ flex: 1 }} />
              <button className="linkish" onClick={() => setTrusted(list.filter((x) => x.address !== t.address))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="status">
        Trust is matched on <code>$creator</code>, which the chain sets and nobody can change, never on
        anything a poster writes.
      </p>

      <h2>What we can't protect you from</h2>
      <ul>
        <li>
          The Arkiv RPC node can see your IP address when you post. Use Tor or a VPN if that's a risk
          for you.
        </li>
        <li>
          A one-time wallet needs a tiny amount of gas.{" "}
          {DRIP_URL
            ? "This site's gas drip pays it. The drip sees only a fresh address, never your report, and can't change or remove anything. The worst it can do is refuse."
            : "This deployment has no gas drip configured, so fund the address from the Arkiv faucet."}
        </li>
        <li>Confirmation counts can be inflated by one person using many wallets. Trusted witnesses are the answer to that.</li>
        <li>This runs on Arkiv's Tiramisu testnet for the hackathon. Demo data is synthetic.</li>
      </ul>
    </>
  )
}
