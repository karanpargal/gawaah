# Friction report

Building Gawaah on Arkiv, 16–18 Oct 2026. Each entry is something we actually hit or tested,
with the exact versions involved.

**Environment:** `@arkiv-network/sdk` 0.8.1, `viem` 2.57.7, Node 26.3.1, macOS 26 (Darwin 25.6),
Tiramisu testnet (chain ID 7738577).

---

## 1. Hackathon guide says to range-filter on `$createdAt`, but the SDK refuses it

**Surface:** query builder, `gte("$createdAt", …)`; hackathon `AGENTS.md`.

**Expected:** The hackathon's `AGENTS.md` says: "There is no server-side ordering, so sort on the
client or range-filter on `$createdAt`." So we expected
`select().where(gte("$createdAt", u64(block)))` to return recently created entities.

**Actual:** The SDK throws before sending anything:

```
InvalidPredicateError: "$createdAt" is returned in query results but carries no index,
so it cannot be filtered on. Select it and filter the results in JavaScript instead.
```

In `src/query/expression.ts` the only filterable system attributes are `$key`, `$owner`,
`$creator` and `$expiresAt`. `$createdAt`, `$updatedAt`, `$creationFlags`, `$contentType` and
`$payload` are result-only.

**Reproduce:**

```ts
import { createPublicClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { gte } from "@arkiv-network/sdk/query"
import { u64 } from "@arkiv-network/sdk/attr"
import { http } from "viem"

const c = createPublicClient({ chain: tiramisu, transport: http() })
const { currentBlock } = await c.getBlockTiming()
await c.select({ key: true }).where(gte("$createdAt", u64(currentBlock - 3000n))).fetch()
```

**Impact on us:** "Posted in the last 24 hours" can't use the chain's own creation block, which
is the one timestamp a poster can't fake. We store a client-set `occurredAt` (u64 seconds) for
range queries instead, select `$createdAt` alongside it, and flag reports whose claimed time is
far from the block they landed in.

**Suggested fix:** Either change the `AGENTS.md` line to "range-filter on a numeric timestamp
attribute you set yourself, or on `$expiresAt`", or index `$createdAt` in the engine. An index is
the better fix: it's the only creation time a reader can trust.

---

## 2. The SDK README's install snippet shows an old version

**Surface:** `README.md` shipped in the `@arkiv-network/sdk@0.8.1` npm tarball.

**Expected:** The install section matches the version you just installed.

**Actual:** After `npm install @arkiv-network/sdk viem`, the README says `package.json` will
contain `"@arkiv-network/sdk": "^0.6.0"`. Installing gives `0.8.1`. Since 0.8 changed the query
API (`select().where().fetch()`), someone pinning to what the README shows lands on an
incompatible API.

**Reproduce:** `npm pack @arkiv-network/sdk@0.8.1 && tar xzf *.tgz && grep -n '"\^0' package/README.md`
gives line 88.

**Suggested fix:** Generate that snippet from `package.json` at publish time, or drop the version
from it.

---

## 3. The SDK accepts camelCase attribute names; the engine reverts on them

**Surface:** `createEntity` / `executeBatch` attributes; `src/attr/names.ts`; revert decoding in
`src/utils/revert.ts`.

**Expected:** The SDK validates attribute names before sending. `names.ts` documents the grammar
as "a leading letter, then letters, digits, `.`, `-` or `_`" (regex `^[A-Za-z][A-Za-z0-9._-]*$`)
and says "Names are **case-sensitive** — `Level` and `level` are two different attributes." So
`occurredAt` should be valid.

**Actual:** Client-side validation passes, then the transaction reverts during gas estimation:

```
EntityMutationError: Transaction failed: an attribute name holds "A" (0x41) at byte 8,
which is outside the name charset ("A"-"Z", "a"-"z", "0"-"9", ".", "-" and "_", with a letter first)
  Error: Ident32InvalidByte(uint256 position, bytes1 value)
```

Byte 8 of `occurredAt` is the capital `A`. The decoded message is self-contradictory: it lists
`"A"-"Z"` as allowed while rejecting `"A"`. The doc comment in `revert.ts` uses
`Ident32InvalidByte` with `(5, 0x41)`, which is also an uppercase `A`, as its example, so this seems
to be a known engine rule the client-side grammar doesn't reflect.

**Reproduce:** any create with a camelCase attribute name on Tiramisu, e.g.

```ts
await wallet.createEntity({
  payload: new Uint8Array(), contentType: "application/octet-stream",
  attributes: { occurredAt: u64(1n) },
  expires: ExpirationTime.fromHours(1),
})
```

**Impact on us:** Our first real write failed. We switched every attribute to snake_case
(`occurred_at`, `taken_down_at`). No gas was spent, since it failed at estimation.

**Suggested fix:** Make `NAME_RE` in `names.ts` match what the engine enforces, so the error is
thrown client-side with the offending name. Then fix the `CHARSET` text in `revert.ts`, and drop the
"case-sensitive" example from the docs if uppercase can't be stored at all.

---

## 4. No published gas figures, so we sized gas funding by trial

**Surface:** docs and faucet; `createEntity` with a large payload.

**What happened:** We fund one-time wallets with just enough GLM for a single write. We guessed
0.002 GLM. A report with a 40 KB photo actually costs 0.0017 GLM, but the node rejected the
transaction ("total cost … exceeds the balance"), because the upfront check uses gas limit ×
`maxFeePerGas`, not what is actually spent. That's normal EVM behaviour, not an Arkiv bug. But
without published numbers per byte of payload, we had to measure. What we measured on Tiramisu,
16–17 Oct 2026, at about 1.2 gwei:

| Operation | Gas used | GLM |
|---|---|---|
| Batch: 40 KB `image/jpeg` create + small JSON create + 2 ownership transfers | 1,714,110 | 0.00171 |
| Batch: witness create + 2 `extendEntity` + 1 ownership transfer | 145,784 | 0.00015 |
| Batch: takedown create + 3 `extendEntity` + 1 ownership transfer | 165,288 | 0.00017 |
| Batch: 4 × `extendEntity` | 40,000 | 0.00004 |

**Suggested fix:** A short table like this in the docs (base cost, cost per payload KB, per
attribute, per extension) would let builders who sponsor gas size their drips without trial and
error.

---

## 5. Hitting the anonymous query budget makes SDK queries hang for ~40 minutes with no error

**Surface:** public Tiramisu RPC (`arkiv_query`) + SDK 0.8.1 on viem 2.57.7's `http()` transport.

**Expected:** When the free query budget runs out, a query fails quickly with an error that says
so, ideally one the SDK names (like it does for engine reverts), so the app can tell the user.

**Actual:** After our seed script (about 80 writes, each doing 2–3 reads), every query from our IP
hung. No error, no log, nothing for 60+ seconds, on every query shape. Raw `curl` showed why:

```
HTTP/2 429
ratelimit: limit=10000, remaining=0, reset=2410
retry-after: 2410
{"error":"ANON_COST_LIMITED","message":"unauthenticated query budget exhausted; get an API key at https://hub.arkiv.network for a monthly quota"}
```

viem's `buildRequest` honours `Retry-After` on retry (`utils/buildRequest.ts`, "If we find a
Retry-After header, let's retry after the given time"). With `retry-after: 2410`, every
`select().fetch()` sleeps about 40 minutes before its first retry. `eth_blockNumber` and
`arkiv_getBlockTiming` kept answering instantly, so the node looked healthy and only queries hung.

**Reproduce:** exhaust the anonymous budget (we did it with `pnpm seed`), then:

```sh
curl -s -D - https://rpc.tiramisu.db-chain.testnet.arkiv.network -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["kind = str('"'"'report'"'"')",{"select":{"key":true},"limit":"0x1"}]}'
```

and run any SDK query with the default `http()` transport. It doesn't resolve within a minute.

**Impact on us:** This would have hit users. Many people behind one IP (a campus, a protest
site's Wi-Fi, a carrier NAT) share one anonymous budget, and the app would just freeze. We now
create every transport with `http(url, { retryCount: 0, timeout: 20_000 })`, map 429 /
`ANON_COST_LIMITED` to a plain explanation, and let users set their own RPC URL and API key
(`X-Api-Key`, which the RPC allows over CORS). That last part also strengthens the
censorship-resistance story: the public node is one chokepoint, and the data isn't tied to it.

**Suggested fix:**
1. In the SDK, detect 429 + `ANON_COST_LIMITED` and throw a typed `RateLimitedError` with the
   reset time, rather than letting viem's Retry-After sleep run.
2. Document the anonymous budget (10,000 cost units per window, about an hour judging by
   `reset`), the `Arkiv-Cost` and `Arkiv-Quota-Used-Percent` response headers, and what a
   typical query costs.
3. Mention it in the hackathon guide: seed scripts are an easy way to hit it on day one.

---

## Paths we tested that worked

All on SDK 0.8.1 against Tiramisu, run via `pnpm smoke` (see `scripts/smoke.ts`).

- **Predicted keys in an atomic batch.** `predictEntityKeys({ owner, count: 2 })` → two creates
  that reference each other's keys as `key` attributes, plus two `ownershipChanges` targeting
  those keys, all in one `executeBatch`. The created keys matched the predicted ones exactly.
- **Burning ownership.** Transferring to `0x…dEaD` worked inside the same batch as the create.
  A later `deleteEntity` from the original author failed with a clearly decoded message:
  `entity 0xc85d…a089 is owned by 0x…dEaD, not 0xc230…`. Good error decoding.
- **`permissionlessExtension`.** A wallet unrelated to the entity extended it.
  `ExpirationTime.atBlock(target)` moved expiry exactly 129,600 blocks (72 h), as computed.
- **128 KB payload class.** A 40,960-byte `image/jpeg` payload round-tripped byte-for-byte.
- **Compound queries.** `and(eq, eq, gte(u64))`, `or` over up to 50 `eq(report, key(…))`
  clauses, and `or` over `$creator` addresses all returned the right rows.
- **Read-only queries over HTTP** with no API key: `getBlockTiming()`, `getEntityCount()`, and a
  range query on `$expiresAt` (`lt` + `gt` on `u64`). `hasNextPage()` was correct.
- **`$expiresAt` is filterable** with ordered operators. We use it for the "About to vanish" view.
- **API keys lift the query budget.** Adding `X-Api-Key` (via `http(url, { fetchOptions: { headers } })`)
  got queries through immediately while our IP was still on 429.
- **Posting from a real browser.** An automated Chrome run posted a report with a 320 KB phone
  photo carrying a planted EXIF block with a fake GPS marker. The app re-encoded it to an 80 KB
  JPEG, a one-time wallet got gas from the drip, and the sealed batch landed in 15 s. Reading the
  `media` entity back showed a bare JFIF with no `Exif` segment and no trace of the marker.
- **Plain JSON-RPC.** `arkiv_query` works from `curl` with no SDK, and the RPC answers CORS
  preflights with `access-control-allow-origin: *`, so the browser app needs no proxy.
