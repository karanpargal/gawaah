import { addr, i32, key, u64 } from "@arkiv-network/sdk/attr"
import { and, eq, type Expression, gt, gte, lt, or } from "@arkiv-network/sdk/query"
import type { Hex } from "viem"
import { BLOCK_SECONDS, type PublicClient } from "./client"
import {
  APP,
  Attr,
  BURN_ADDRESS,
  type CategoryCode,
  clip,
  Kind,
  LIMITS,
  num,
  type PlatformCode,
  type Report,
  type StanceCode,
  type Takedown,
  type TakedownActionCode,
  type Witness,
} from "./schema"

const REPORT_FIELDS = {
  key: true,
  creator: true,
  owner: true,
  createdAt: true,
  expiresAt: true,
  creationFlags: true,
  attributes: true,
  payload: true,
} as const

const PAGE = 50

type Row = {
  key: Hex
  creator: Hex
  owner?: Hex
  createdAt: bigint
  expiresAt: bigint
  creationFlags?: { readonly: boolean; permissionlessExtension: boolean }
  attributes: Parameters<typeof num>[0]
  toJson(): unknown
}

function json(e: Row): Record<string, unknown> {
  try {
    const v = e.toJson()
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
  } catch {
    // A third party can write anything under our attribute names; never let one bad row break a feed.
    return {}
  }
}

export function toReport(e: Row): Report {
  const p = json(e)
  const media = e.attributes?.[Attr.media]
  return {
    key: e.key,
    creator: e.creator,
    owner: e.owner ?? e.creator,
    createdAtBlock: e.createdAt,
    expiresAtBlock: e.expiresAt,
    sealed:
      !!e.creationFlags?.readonly &&
      !!e.creationFlags.permissionlessExtension &&
      e.owner?.toLowerCase() === BURN_ADDRESS.toLowerCase(),
    state: num(e.attributes, Attr.state),
    district: num(e.attributes, Attr.district),
    category: num(e.attributes, Attr.category) as CategoryCode,
    occurredAt: num(e.attributes, Attr.occurredAt),
    media: media?.type === "key" ? (media.value as Hex) : null,
    title: clip(p.title, LIMITS.titleChars),
    body: clip(p.body, LIMITS.bodyChars),
  }
}

function toWitness(e: Row): Witness {
  return {
    key: e.key,
    creator: e.creator,
    createdAtBlock: e.createdAt,
    expiresAtBlock: e.expiresAt,
    report: e.attributes?.[Attr.report]?.value as Hex,
    stance: num(e.attributes, Attr.stance) as StanceCode,
    note: clip(json(e).note, LIMITS.noteChars),
  }
}

function toTakedown(e: Row): Takedown {
  return {
    key: e.key,
    creator: e.creator,
    createdAtBlock: e.createdAt,
    expiresAtBlock: e.expiresAt,
    report: e.attributes?.[Attr.report]?.value as Hex,
    platform: num(e.attributes, Attr.platform) as PlatformCode,
    action: num(e.attributes, Attr.action) as TakedownActionCode,
    takenDownAt: num(e.attributes, Attr.takenDownAt),
    note: clip(json(e).note, LIMITS.noteChars),
  }
}

const isReport = (r: Report) => r.title.length > 0 && Number.isFinite(r.occurredAt)

export type Page<T> = { items: T[]; next: (() => Promise<Page<T>>) | null }

export type FeedFilter = {
  /** Only reports claimed to have happened at or after this unix time. */
  since: number
  state?: number | undefined
  district?: number | undefined
  category?: CategoryCode | undefined
  /** Only reports created by these wallets — the "witnesses I trust" view. */
  creators?: Hex[] | undefined
}

/**
 * The main feed. Arkiv has no server-side ordering, so each page comes back in index order and
 * we sort by the claimed time on the client.
 */
export async function feed(pub: PublicClient, f: FeedFilter): Promise<Page<Report>> {
  const where: Expression[] = [
    eq(Attr.app, APP),
    eq(Attr.kind, Kind.Report),
    gte(Attr.occurredAt, u64(BigInt(Math.floor(f.since)))),
  ]
  if (f.state) where.push(eq(Attr.state, i32(f.state)))
  if (f.district) where.push(eq(Attr.district, i32(f.district)))
  if (f.category) where.push(eq(Attr.category, i32(f.category)))
  if (f.creators?.length) where.push(or(f.creators.map((c) => eq("$creator", addr(c)))))

  const first = await pub.select(REPORT_FIELDS).where(and(where)).limit(PAGE).fetch()
  return pageOf(first, (rows) =>
    rows.map(toReport).filter(isReport).sort((a, b) => b.occurredAt - a.occurredAt),
  )
}

/**
 * Reports that will disappear within `withinSeconds` unless someone vouches for them. `$expiresAt`
 * is maintained by the chain, so this list can't be gamed by the poster.
 */
export async function expiringSoon(
  pub: PublicClient,
  withinSeconds: number,
): Promise<Page<Report>> {
  const { currentBlock } = await pub.getBlockTiming()
  const horizon = currentBlock + BigInt(Math.ceil(withinSeconds / BLOCK_SECONDS))
  const first = await pub
    .select(REPORT_FIELDS)
    .where(
      and(
        eq(Attr.app, APP),
        eq(Attr.kind, Kind.Report),
        gt("$expiresAt", u64(currentBlock)),
        lt("$expiresAt", u64(horizon)),
      ),
    )
    .limit(PAGE)
    .fetch()
  return pageOf(first, (rows) =>
    rows
      .map(toReport)
      .filter(isReport)
      .sort((a, b) => Number(a.expiresAtBlock - b.expiresAtBlock)),
  )
}

export async function getReport(pub: PublicClient, reportKey: Hex): Promise<Report | null> {
  const res = await pub.select(REPORT_FIELDS).where(eq("$key", key(reportKey))).limit(1).fetch()
  const [row] = res.entities
  if (!row || row.attributes?.[Attr.kind]?.value !== Kind.Report) return null
  return toReport(row)
}

export type Evidence = { witnesses: Witness[]; takedowns: Takedown[] }

/** Everything that points at a report: confirmations, disputes and logged takedowns. */
export async function evidenceFor(pub: PublicClient, reportKey: Hex): Promise<Evidence> {
  const out: Evidence = { witnesses: [], takedowns: [] }
  const q = pub
    .select({ key: true, creator: true, createdAt: true, expiresAt: true, attributes: true, payload: true })
    .where(and(eq(Attr.app, APP), eq(Attr.report, key(reportKey))))
    .limit(200)
  for await (const row of q) {
    const kind = row.attributes?.[Attr.kind]?.value
    if (kind === Kind.Witness) out.witnesses.push(toWitness(row))
    else if (kind === Kind.Takedown) out.takedowns.push(toTakedown(row))
  }
  out.witnesses.sort((a, b) => Number(a.createdAtBlock - b.createdAtBlock))
  out.takedowns.sort((a, b) => b.takenDownAt - a.takenDownAt)
  return out
}

/** Recent takedowns across every report: the "what is being censored right now" board. */
export async function recentTakedowns(pub: PublicClient, since: number): Promise<Takedown[]> {
  const res = await pub
    .select({ key: true, creator: true, createdAt: true, expiresAt: true, attributes: true, payload: true })
    .where(
      and(
        eq(Attr.app, APP),
        eq(Attr.kind, Kind.Takedown),
        gte(Attr.takenDownAt, u64(BigInt(Math.floor(since)))),
      ),
    )
    .limit(200)
    .fetch()
  return res.entities.map(toTakedown).sort((a, b) => b.takenDownAt - a.takenDownAt)
}

/** The photo bytes are only fetched when a report is opened; feeds never select payloads of media. */
export async function mediaBytes(pub: PublicClient, mediaKey: Hex): Promise<Uint8Array | null> {
  const res = await pub
    .select({ payload: true, contentType: true, attributes: true })
    .where(eq("$key", key(mediaKey)))
    .limit(1)
    .fetch()
  const [row] = res.entities
  if (!row || row.contentType !== "image/jpeg") return null
  if (row.attributes?.[Attr.kind]?.value !== Kind.Media) return null
  return row.payload
}

type QueryPage<R> = {
  entities: readonly R[]
  hasNextPage(): boolean
  next(): Promise<QueryPage<R>>
}

function pageOf<R, T>(page: QueryPage<R>, map: (rows: readonly R[]) => T[]): Page<T> {
  return {
    items: map(page.entities),
    next: page.hasNextPage() ? async () => pageOf(await page.next(), map) : null,
  }
}
