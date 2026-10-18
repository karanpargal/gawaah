# Gawaah data contract

Gawaah keeps everything as Arkiv entities on **Tiramisu** (chain ID `7738577`). Any client can
read and write compatible data using only this document. Source of truth in code:
[`src/arkiv/schema.ts`](../src/arkiv/schema.ts), [`write.ts`](../src/arkiv/write.ts),
[`read.ts`](../src/arkiv/read.ts).

SDK: `@arkiv-network/sdk` 0.8.1.

## Rules shared by every entity

| Property | Value | Why |
|---|---|---|
| `app` attribute | `str("gawaah")` | Namespaces our entities among everyone else's on Tiramisu |
| `v` attribute | `i32(1)` | Schema version |
| `kind` attribute | `str` — `report` · `media` · `witness` · `takedown` | Entity type |
| Creation flags | `readonly: true`, `permissionlessExtension: true` | Nobody can rewrite what was said. Anyone can keep it alive |
| `$owner` | `0x000000000000000000000000000000000000dEaD`, transferred in the **same batch** as the create | Nobody holds this key, so nobody can delete the entity before it expires — not even a coerced author |
| `$creator` | The wallet that signed (one-time by default) | Immutable, set by the chain. Trust and de-duplication use only this |

A Gawaah client treats an entity as **sealed** only if all three hold: `creationFlags.readonly`,
`creationFlags.permissionlessExtension`, and `$owner == 0x…dEaD`. Anyone can write
`app = "gawaah"`, so the attribute alone proves nothing. Unsealed entities are shown with a
warning.

## Entity types

### `report`

What a witness saw.

| Attribute | Type | Meaning |
|---|---|---|
| `state` | `i32` | Census 2011 / LGD state code, e.g. `27` = Maharashtra. Table: [`src/data/regions.json`](../src/data/regions.json) |
| `district` | `i32` | `state * 100 + n`, from the same table. **District is the finest location stored** |
| `category` | `i32` | 1 Gathering or march · 2 Police action · 3 Detention · 4 Internet shutdown · 5 Violence or injury · 6 Other |
| `occurred_at` | `u64` | Unix seconds when it happened, *as claimed by the witness* |
| `media` | `key` | *(optional)* Key of the `media` entity holding the photo |

**Payload:** `application/json`:

```ts
{
  title: string          // ≤120
  body: string           // ≤2000
  sources?: { label: string, url: string }[]   // ≤5. Published coverage a report is compiled from
  photoCredit?: { label: string, url: string } // attribution for a photo the reporter didn't take
}
```

`sources` and `photoCredit` are only written by `pnpm seed:news`; the app's own form never sets them,
so a witness can't attach links that identify people. Readers must drop any link that isn't a
well-formed `https://` URL (≤300 chars): the payload is writable by anyone.

The payload is not queryable, so nothing we filter on lives here.

### `media`

The photo, stored on Arkiv itself, not on IPFS or a CDN that could be pulled.

| Attribute | Type | Meaning |
|---|---|---|
| `report` | `key` | The report it belongs to |

**Payload:** raw JPEG bytes, `contentType: "image/jpeg"`, ≤120 KiB (the SDK cap is 128 KiB).
The image is re-encoded on the poster's device, so EXIF, GPS and camera data never leave the
phone, and regions the poster marks are pixelated before encoding.

`report` and `media` point at each other. Both keys are predicted with `predictEntityKeys`
before the transaction is sent, so both entities and both ownership transfers go in **one
atomic `executeBatch`**. A report never exists without its photo, and neither is ever deletable.

### `witness`

A confirmation or a dispute.

| Attribute | Type | Meaning |
|---|---|---|
| `report` | `key` | The report |
| `stance` | `i32` | `1` confirm · `2` dispute |

**Payload:** `application/json`, `{ "note"?: string ≤280 }`.

### `takedown`

A record that a post about this report was censored somewhere else.

| Attribute | Type | Meaning |
|---|---|---|
| `report` | `key` | The report |
| `platform` | `i32` | 1 X/Twitter · 2 Instagram · 3 Facebook · 4 YouTube · 5 WhatsApp · 6 Telegram · 7 News site · 8 Other |
| `action` | `i32` | 1 Post removed · 2 Withheld in India · 3 Account suspended · 4 Reach limited |
| `taken_down_at` | `u64` | Unix seconds |

**Payload:** `application/json`, `{ "note"?: string ≤280 }`. URLs and handles are deliberately not
stored, because they identify people.

## Entity Expiration per type

| Type | Initial lifetime | Extended by | Cap |
|---|---|---|---|
| `report` | 7 days | +3 days per witness, takedown or keep-alive, counted from its current expiry | 90 days from now |
| `media` | 7 days | Always extended to match its report | 90 days |
| `witness` | Created at its report's new expiry (`ExpirationTime.atBlock`) | Dragged along on later vouches | 90 days |
| `takedown` | Same as `witness` | Same | 90 days |

Every vouch is one atomic batch: create the `witness` or `takedown`, Lifetime Extension of the
report **and every linked entity expiring earlier**, then the ownership transfer to the burn
address. So evidence never outlives its report, and a report never loses its photo or its
confirmations.

**A dispute also extends the report.** Contested evidence should stay visible next to the
dispute, not be erased by letting it lapse.

**Why not `ExpirationTime.permanent()`?** Expiry does the moderation. Spam and unconfirmed claims
disappear after a week without anyone deciding what's true. What people keep vouching for stays.

## Queries the app runs

Arkiv has no server-side ordering. We sort pages on the client.

| Question | Query |
|---|---|
| **Feed:** what was reported recently, optionally by state, district or category? | `app = "gawaah" AND kind = "report" AND occurred_at >= u64(since) [AND state = i32(s)] [AND district = i32(d)] [AND category = i32(c)]`, 50 per page, cursor pagination |
| **Trusted witnesses only** | The feed query `AND ($creator = addr(a1) OR $creator = addr(a2) …)` |
| **About to vanish:** what will expire in the next 48 h? | `app = "gawaah" AND kind = "report" AND $expiresAt > u64(head) AND $expiresAt < u64(head + 86400 blocks)` |
| **Evidence for a report** | `app = "gawaah" AND report = key(K)`, walking every page |
| **Tallies for a whole feed page** (one query, not N) | `app = "gawaah" AND (kind = "witness" OR kind = "takedown") AND (report = key(K1) OR … OR report = key(K50))`. Confirmations are counted once per distinct `$creator` |
| **What's being censored** | `app = "gawaah" AND kind = "takedown" AND taken_down_at >= u64(since)` |
| **Open one report / photo** | `$key = key(K)`. The photo payload is fetched only when a report is opened |

### Live updates

`watchEntityEvents` over **WebSocket**. Most Tiramisu traffic belongs to other apps, so instead of
fetching every `EntityCreated` we listen for `OwnershipTransferred` to the burn address, which
only a sealed Gawaah write produces, and fetch only those keys. `ExpiryExtended` updates life bars
in place.

## Reading without Gawaah

```sh
curl -s https://rpc.tiramisu.db-chain.testnet.arkiv.network \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query",
       "params":["app = str('"'"'gawaah'"'"') AND kind = str('"'"'report'"'"')",
                 {"select":{"key":true,"creator":true,"owner":true,"expiresAt":true,
                            "creationFlags":true,"attributes":true,"payload":true},
                  "limit":"0x32"}]}'
```

Payloads come back hex-encoded. A report's payload is UTF-8 JSON, and a media payload is JPEG
bytes.

## What deliberately stays off Arkiv

| Data | Where it lives | Why |
|---|---|---|
| Names, phone numbers, handles, post URLs | Nowhere | Rules ban personal data, and storing it would endanger the people involved |
| Precise location | Nowhere, district only | Narrower than a district could identify someone's home |
| Original photo and its EXIF | Never leaves the device | Only the re-encoded, redacted JPEG is uploaded |
| Private keys | Tab memory (one-time) or `localStorage` (opt-in persistent ID) | Secrets never go on Arkiv |
| Trusted-witness list | `localStorage` | A personal choice, not public data |
| Gas funding | `/api/drip` | Powerless by design. It sees only a fresh address |
