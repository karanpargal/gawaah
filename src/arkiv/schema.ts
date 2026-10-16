// The Gawaah data contract. Everything another client needs to read or write
// compatible entities lives here and in /arkiv/schema.md — keep the two in sync.
import type { Attributes } from "@arkiv-network/sdk"
import type { Hex } from "viem"

export const APP = "gawaah"
export const SCHEMA_VERSION = 1

/**
 * Every Gawaah entity is handed to this address in the same batch that creates
 * it. Nobody holds its key, so nobody — not even a coerced author — can delete
 * an entity before it expires. Combined with the `readonly` creation flag, the
 * content can't be changed either.
 */
export const BURN_ADDRESS: Hex = "0x000000000000000000000000000000000000dEaD"

export const Kind = {
  Report: "report",
  Media: "media",
  Witness: "witness",
  Takedown: "takedown",
} as const
export type Kind = (typeof Kind)[keyof typeof Kind]

/** Attribute names. Payloads are not queryable, so anything we filter on lives here. */
export const Attr = {
  app: "app",
  version: "v",
  kind: "kind",
  state: "state",
  district: "district",
  category: "category",
  occurredAt: "occurredAt",
  media: "media",
  report: "report",
  stance: "stance",
  platform: "platform",
  action: "action",
  takenDownAt: "takenDownAt",
} as const

export const Category = {
  1: "Gathering or march",
  2: "Police action",
  3: "Detention",
  4: "Internet shutdown",
  5: "Violence or injury",
  6: "Other",
} as const satisfies Record<number, string>
export type CategoryCode = keyof typeof Category

export const Stance = { Confirm: 1, Dispute: 2 } as const
export type StanceCode = (typeof Stance)[keyof typeof Stance]

export const Platform = {
  1: "X / Twitter",
  2: "Instagram",
  3: "Facebook",
  4: "YouTube",
  5: "WhatsApp",
  6: "Telegram",
  7: "News site",
  8: "Other",
} as const satisfies Record<number, string>
export type PlatformCode = keyof typeof Platform

export const TakedownAction = {
  1: "Post removed",
  2: "Withheld in India",
  3: "Account suspended",
  4: "Reach limited",
} as const satisfies Record<number, string>
export type TakedownActionCode = keyof typeof TakedownAction

/**
 * Entity Expiration policy, in seconds. A report starts with a week of life.
 * Each confirmation, takedown log or "keep alive" pushes it out by three more
 * days, capped at 90 days from now — so what the community keeps vouching for
 * survives, and spam quietly ages out without anyone having to moderate it.
 */
export const Lifetime = {
  initial: 7 * 24 * 3600,
  perVouch: 3 * 24 * 3600,
  max: 90 * 24 * 3600,
} as const

export const LIMITS = {
  titleChars: 120,
  bodyChars: 2000,
  noteChars: 280,
  /** Leaves headroom under the SDK's 128 KiB MAX_PAYLOAD_BYTES. */
  mediaBytes: 120 * 1024,
} as const

export type ReportPayload = { title: string; body: string }
export type WitnessPayload = { note?: string }
export type TakedownPayload = { note?: string }

export type Report = {
  key: Hex
  creator: Hex
  owner: Hex
  createdAtBlock: bigint
  expiresAtBlock: bigint
  /**
   * Readonly, extendable by anyone, and owned by the burn address — i.e. created through Gawaah's
   * own publish path. Anyone can write `app = "gawaah"`, so this is checked, never assumed.
   */
  sealed: boolean
  state: number
  district: number
  category: CategoryCode
  occurredAt: number
  media: Hex | null
  title: string
  body: string
}

export type Witness = {
  key: Hex
  creator: Hex
  createdAtBlock: bigint
  expiresAtBlock: bigint
  report: Hex
  stance: StanceCode
  note: string
}

export type Takedown = {
  key: Hex
  creator: Hex
  createdAtBlock: bigint
  expiresAtBlock: bigint
  report: Hex
  platform: PlatformCode
  action: TakedownActionCode
  takenDownAt: number
  note: string
}

// --- decoding -------------------------------------------------------------

function raw(attrs: Attributes | undefined, name: string): unknown {
  return attrs?.[name]?.value
}

export function num(attrs: Attributes | undefined, name: string): number {
  const v = raw(attrs, name)
  return typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number.NaN
}

export function text(attrs: Attributes | undefined, name: string): string | undefined {
  const v = raw(attrs, name)
  return typeof v === "string" ? v : undefined
}

export function clip(s: unknown, max: number): string {
  return typeof s === "string" ? s.slice(0, max) : ""
}
