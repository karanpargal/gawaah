import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk"
import { type AttributeInputs, i32, key, u64 } from "@arkiv-network/sdk/attr"
import { and, eq } from "@arkiv-network/sdk/query"
import type { Hash, Hex } from "viem"
import { BLOCK_SECONDS, type PublicClient, type WalletClient } from "./client"
import {
  APP,
  Attr,
  BURN_ADDRESS,
  type CategoryCode,
  clip,
  Kind,
  LIMITS,
  Lifetime,
  type PlatformCode,
  type ReportPayload,
  type SourceLink,
  SCHEMA_VERSION,
  type StanceCode,
  type TakedownActionCode,
} from "./schema"

/**
 * Every Gawaah entity is created `readonly` (nobody can rewrite what a witness said) and with
 * `permissionlessExtension` (anyone can keep it alive, not just the author).
 */
const FLAGS = { readonly: true, permissionlessExtension: true } as const

/** The cap on how many linked entities one vouch extends, to keep the batch bounded. */
const MAX_FAMILY_EXTENSIONS = 60

const blocks = (seconds: number) => BigInt(Math.ceil(seconds / BLOCK_SECONDS))

function base(kind: (typeof Kind)[keyof typeof Kind]): AttributeInputs {
  return { [Attr.app]: APP, [Attr.version]: i32(SCHEMA_VERSION), [Attr.kind]: kind }
}

export type NewReport = {
  state: number
  district: number
  category: CategoryCode
  /** Unix seconds, as claimed by the witness. */
  occurredAt: number
  title: string
  body: string
  /** An already stripped and compressed JPEG. */
  media?: Uint8Array | undefined
  /** Seeding only: published coverage a news-compiled report cites. The app's form never sets it. */
  sources?: SourceLink[] | undefined
  /** Seeding only: attribution for a photo the reporter didn't take. */
  photoCredit?: SourceLink | undefined
  /**
   * Seeding only: a shorter first lifetime so the "About to vanish" view has something in it
   * during a demo. The app always uses `Lifetime.initial`.
   */
  lifetimeSeconds?: number | undefined
}

export type PublishResult = { txHash: Hash; reportKey: Hex; mediaKey: Hex | null }

/**
 * Publishes a report, and its photo if there is one, in one atomic batch:
 *
 * 1. create the media entity (raw JPEG bytes, pointing at the report's predicted key)
 * 2. create the report entity (pointing at the media's predicted key)
 * 3. hand both to the burn address, so nobody can delete them before they expire
 *
 * The keys are predicted before sending, which is what lets the two entities reference each
 * other and the ownership transfer target them inside the same transaction.
 */
export async function publishReport(
  pub: PublicClient,
  wallet: WalletClient,
  input: NewReport,
): Promise<PublishResult> {
  const owner = wallet.account.address
  const hasMedia = !!input.media && input.media.length > 0
  if (hasMedia && input.media!.length > LIMITS.mediaBytes) {
    throw new Error(`Photo is ${input.media!.length} bytes; the limit is ${LIMITS.mediaBytes}.`)
  }

  const count: number = hasMedia ? 2 : 1
  const predicted = await pub.predictEntityKeys({ owner, count })
  const reportSlot = predicted[hasMedia ? 1 : 0]!
  const mediaSlot = hasMedia ? predicted[0]! : null

  const payload: ReportPayload = {
    title: clip(input.title.trim(), LIMITS.titleChars),
    body: clip(input.body.trim(), LIMITS.bodyChars),
    ...(input.sources?.length && { sources: input.sources.slice(0, LIMITS.sources) }),
    ...(input.photoCredit && { photoCredit: input.photoCredit }),
  }
  const expires = ExpirationTime.fromSeconds(input.lifetimeSeconds ?? Lifetime.initial)

  const creates = []
  const keys: Hex[] = []
  if (mediaSlot) {
    keys.push(mediaSlot.key)
    creates.push({
      payload: input.media!,
      contentType: "image/jpeg",
      attributes: { ...base(Kind.Media), [Attr.report]: key(reportSlot.key) },
      expires,
      flags: FLAGS,
      salt: mediaSlot.salt,
    })
  }
  keys.push(reportSlot.key)
  creates.push({
    payload: jsonToPayload(payload),
    contentType: "application/json",
    attributes: {
      ...base(Kind.Report),
      [Attr.state]: i32(input.state),
      [Attr.district]: i32(input.district),
      [Attr.category]: i32(input.category),
      [Attr.occurredAt]: u64(BigInt(Math.floor(input.occurredAt))),
      ...(mediaSlot ? { [Attr.media]: key(mediaSlot.key) } : {}),
    },
    expires,
    flags: FLAGS,
    salt: reportSlot.salt,
  })

  const result = await wallet.executeBatch({
    creates,
    ownershipChanges: keys.map((entityKey) => ({ entityKey, newOwner: BURN_ADDRESS })),
  })

  const created = result.createdEntities.map((k) => k.toLowerCase())
  if (keys.some((k) => !created.includes(k.toLowerCase()))) {
    throw new Error(`Created keys ${created.join(", ")} did not match predicted ${keys.join(", ")}`)
  }
  return { txHash: result.txHash, reportKey: reportSlot.key, mediaKey: mediaSlot?.key ?? null }
}

export type Vouch =
  | { type: "witness"; stance: StanceCode; note?: string }
  | {
      type: "takedown"
      platform: PlatformCode
      action: TakedownActionCode
      takenDownAt: number
      note?: string
    }
  | { type: "keepAlive" }

export type VouchResult = {
  txHash: Hash
  entityKey: Hex | null
  /** The block the report now expires at, or null if it was already at the 90-day cap. */
  extendedTo: bigint | null
}

/**
 * Records a confirmation, a dispute, a takedown, or a bare "keep alive" — and in the same batch
 * pushes the report's expiry out by `Lifetime.perVouch`, dragging its photo and every linked
 * entity along so a report never outlives its own evidence.
 *
 * A dispute still extends the report: deleting contested evidence by letting it lapse is exactly
 * what we don't want. The dispute is recorded next to it instead.
 */
export async function vouch(
  pub: PublicClient,
  wallet: WalletClient,
  reportKey: Hex,
  v: Vouch,
): Promise<VouchResult> {
  const [{ currentBlock }, report, family] = await Promise.all([
    pub.getBlockTiming(),
    pub.getEntity(reportKey),
    pub
      .select({ key: true, expiresAt: true })
      .where(and(eq(Attr.app, APP), eq(Attr.report, key(reportKey))))
      .limit(200)
      .fetch(),
  ])

  if (report.expiresAt <= currentBlock) throw new Error("This report has already expired.")

  const from = report.expiresAt > currentBlock ? report.expiresAt : currentBlock
  const cap = currentBlock + blocks(Lifetime.max)
  let target = from + blocks(Lifetime.perVouch)
  if (target > cap) target = cap
  const extending = target > report.expiresAt

  const extensions = extending
    ? [
        { entityKey: reportKey, expires: ExpirationTime.atBlock(target) },
        ...family.entities
          .filter((e) => e.expiresAt < target)
          .slice(0, MAX_FAMILY_EXTENSIONS)
          .map((e) => ({ entityKey: e.key, expires: ExpirationTime.atBlock(target) })),
      ]
    : []

  if (v.type === "keepAlive") {
    if (!extending) return { txHash: "0x" as Hash, entityKey: null, extendedTo: null }
    const { txHash } = await wallet.executeBatch({ extensions })
    return { txHash, entityKey: null, extendedTo: target }
  }

  const note = clip(v.note?.trim(), LIMITS.noteChars)
  const attributes: AttributeInputs =
    v.type === "witness"
      ? { ...base(Kind.Witness), [Attr.report]: key(reportKey), [Attr.stance]: i32(v.stance) }
      : {
          ...base(Kind.Takedown),
          [Attr.report]: key(reportKey),
          [Attr.platform]: i32(v.platform),
          [Attr.action]: i32(v.action),
          [Attr.takenDownAt]: u64(BigInt(Math.floor(v.takenDownAt))),
        }

  const [slot] = await pub.predictEntityKeys({ owner: wallet.account.address, count: 1 })
  const { txHash, createdEntities } = await wallet.executeBatch({
    creates: [
      {
        payload: jsonToPayload(note ? { note } : {}),
        contentType: "application/json",
        attributes,
        // Lives exactly as long as the report it vouches for.
        expires: ExpirationTime.atBlock(extending ? target : report.expiresAt),
        flags: FLAGS,
        salt: slot.salt,
      },
    ],
    extensions,
    ownershipChanges: [{ entityKey: slot.key, newOwner: BURN_ADDRESS }],
  })

  return { txHash, entityKey: createdEntities[0] ?? slot.key, extendedTo: extending ? target : null }
}
