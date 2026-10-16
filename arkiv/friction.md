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

## Paths we tested that worked

- **Read-only queries over HTTP from Node** with no API key: `getBlockTiming()`,
  `getEntityCount()`, and a range query on `$expiresAt` (`lt` + `gt` on `u64`). The range query
  returned typed attributes plus `creationFlags.raw`, and `hasNextPage()` was correct.
- **`$expiresAt` is filterable** with ordered operators. We use it for the "About to vanish" view.
