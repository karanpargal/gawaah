# Gawaah · गवाह

**A witness log for protests that no platform can take down.** Built on [Arkiv](https://arkiv.network),
the Web3 database, for the Arkiv Global Tour Stop hackathon. Tracks: **Best Indian Use Case** and
**Censorship Resistance**.

**Live app: <https://gawaah.vercel.app>** (Tiramisu testnet; posting works out of the box via the gas drip).

When people in India post about a protest, the posts get removed, withheld in India, or the
accounts get suspended, and the record of what happened goes with them. Gawaah keeps that record
somewhere nobody can quietly delete it, and also records **the takedown itself** as evidence.

- **Post** a report: state, district, category, time, what you saw, and an optional photo.
  Metadata is stripped and faces can be pixelated on your device first.
- **Confirm**, **dispute**, or **log a takedown**. Each adds three days to the report's life.
- **Keep alive** reports that are about to vanish.
- **Trust** specific witnesses, matched by `$creator`, to filter out sockpuppets.

## How Arkiv makes it work

| Property | Arkiv feature |
|---|---|
| Nobody can edit a report, including its author | `readonly` creation flag |
| Nobody can delete it, including a coerced author | Ownership transferred to `0x…dEaD` in the same atomic batch as the create |
| Anyone can keep it alive | `permissionlessExtension` creation flag + `extendEntity` |
| Spam fades without a moderator | Entity Expiration: 7 days, +3 per vouch, 90-day cap |
| Report, photo and evidence live and die together | Predicted keys + `executeBatch` |
| "About to vanish" can't be gamed | Range query on `$expiresAt`, which only the chain sets |
| Trust can't be forged | Filters on `$creator`, never on a writable field |
| New reports appear live | `watchEntityEvents` over WebSocket |
| Readable without this site | Plain `arkiv_query` JSON-RPC. See [`arkiv/schema.md`](arkiv/schema.md) |

Full data contract: **[`arkiv/schema.md`](arkiv/schema.md)**. Building notes:
**[`arkiv/friction.md`](arkiv/friction.md)**. Wallets and entities on Tiramisu:
**[`arkiv/evidence.md`](arkiv/evidence.md)**.

## Run it locally

Requires Node ≥ 22 and pnpm.

```sh
git clone https://github.com/karanpargal/gawaah && cd gawaah
pnpm install
pnpm dev                 # http://localhost:5173, reads live data from Tiramisu
```

Reading needs nothing else. To **write** from the browser, each one-time wallet needs gas. Either:

- run with a drip: deploy `api/drip.ts` (see below) and set `VITE_DRIP_URL`, or
- fund the address the app shows from <https://hub.arkiv.network/faucet>.

### End-to-end check against the chain

```sh
pnpm wallet:new          # writes a fresh key to .env and prints the address (never the key)
# fund that address from https://hub.arkiv.network/faucet
pnpm smoke               # publishes a synthetic report, then confirms, logs a takedown, keeps it alive
pnpm seed:news --dry-run # checks the news-sourced reports and photos without writing anything
```

`pnpm smoke` checks every assumption: the report is sealed, the author can't delete it, a
stranger can extend it, the photo and witnesses are extended along with it, and all queries
return it.

## Deploy

The app is a static build (`pnpm build` → `dist/`) with relative paths and hash routing, so it runs
from any static host, an IPFS gateway, or straight off disk.

The optional gas drip is a single Vercel Function in `api/drip.ts`. Env: `DRIP_PRIVATE_KEY` (a
funded Tiramisu key) and optional `DRIP_AMOUNT_GLM`. Set `VITE_DRIP_URL=/api/drip` at build time.

## Project layout

```
src/arkiv/      data contract, writes (publish, vouch) and queries. No UI code
src/lib/        identity and gas, photo sanitising, live updates, chain clock
src/ui/         React views
src/data/       frozen state and district code table
api/drip.ts     gas drip
scripts/        wallet generation, on-chain smoke test, demo seeding
arkiv/          schema.md and friction.md (hackathon deliverables)
```

## Data and safety

Reports posted through the app store no names, handles, phone numbers or URLs, and no location
finer than a district. The demo data is of two kinds, and each report says which it is:

- **Synthetic** (`pnpm seed`, `pnpm smoke`): invented events, marked *Synthetic demo report* or
  `[SMOKE TEST]`, used to exercise every write path. They stay on-chain until they expire (nobody
  can delete a sealed report), but the app filters them out of every view.
- **Compiled from news** (`pnpm seed:news`): summaries of published coverage of the October 2026
  Delhi protests. Each links its sources, says it is not a first-hand account, names no
  individuals, and has no confirmations or takedowns attached, since those are testimony. Photos
  are freely licensed pictures of the locations, captioned as not being of the event, with no
  identifiable faces ([credits](scripts/news-photos/CREDITS.md)). Limitations are listed honestly on the app's *How it works*
page: the RPC node can see IP addresses, and confirmation counts can be inflated with many
wallets, which is what trusted witnesses are for.

District names are from
[sab99r/Indian-States-And-Districts](https://github.com/sab99r/Indian-States-And-Districts),
updated for Ladakh (2019) and the DNH & DD merger (2020).

## License

MIT
