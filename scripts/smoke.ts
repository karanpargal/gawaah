// End-to-end check of every Arkiv behaviour Gawaah relies on, against Tiramisu.
// Uses throwaway wallets funded from ARKIV_PRIVATE_KEY, and only synthetic data.
//
//   pnpm smoke
import { createWalletClient as createViemWallet, formatEther, type Hex, http, parseEther } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { publicClient, tiramisu, walletClient } from "../src/arkiv/client"
import { evidenceFor, expiringSoon, feed, getReport, mediaBytes } from "../src/arkiv/read"
import { BURN_ADDRESS, Stance } from "../src/arkiv/schema"
import { publishReport, vouch } from "../src/arkiv/write"

process.loadEnvFile?.(".env")
const main = process.env.ARKIV_PRIVATE_KEY as Hex | undefined
if (!main) throw new Error("ARKIV_PRIVATE_KEY missing — run `pnpm wallet:new` and fund it")

const pub = publicClient()
const funder = createViemWallet({
  chain: tiramisu,
  transport: http(),
  account: privateKeyToAccount(main),
})

const step = (msg: string) => console.log(`\n▸ ${msg}`)
const ok = (msg: string) => console.log(`  ✓ ${msg}`)
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`✗ ${msg}`)
  ok(msg)
}

async function gasOf(txHash: Hex) {
  const r = await pub.getTransactionReceipt({ hash: txHash })
  return `${r.gasUsed} gas, ${formatEther(r.gasUsed * r.effectiveGasPrice)} GLM`
}

async function burner(amount = "0.002") {
  const key = generatePrivateKey()
  const w = walletClient(key)
  const hash = await funder.sendTransaction({ to: w.account.address, value: parseEther(amount) })
  await pub.waitForTransactionReceipt({ hash })
  return w
}

step(`funder ${funder.account.address}`)
const balance = await pub.getBalance({ address: funder.account.address })
console.log(`  balance ${formatEther(balance)} GLM`)
check(balance > parseEther("0.01"), "funder has gas")

step("publish a report with a photo (atomic: media + report + 2 ownership transfers)")
const author = await burner("0.05")
const photo = new Uint8Array(40 * 1024).map((_, i) => (i * 31) % 256)
const now = Math.floor(Date.now() / 1000)
const published = await publishReport(pub, author, {
  state: 27,
  district: 2721,
  category: 1,
  occurredAt: now - 600,
  title: "[SMOKE TEST] Synthetic gathering report",
  body: "Synthetic data for an automated test. No real event.",
  media: photo,
})
console.log(`  report ${published.reportKey}\n  media  ${published.mediaKey}`)
console.log(`  ${await gasOf(published.txHash)}`)

step("read it back")
const report = await getReport(pub, published.reportKey)
check(report, "report is queryable by $key")
check(report.sealed, "sealed: readonly + permissionlessExtension + owned by burn address")
check(report.owner.toLowerCase() === BURN_ADDRESS.toLowerCase(), "$owner is the burn address")
check(
  report.creator.toLowerCase() === author.account.address.toLowerCase(),
  "$creator is still the author",
)
check(report.media === published.mediaKey, "report points at its media by predicted key")
const bytes = await mediaBytes(pub, published.mediaKey!)
check(bytes?.length === photo.length, `photo round-trips (${bytes?.length} bytes)`)

step("the author cannot delete it any more")
try {
  await author.deleteEntity({ entityKey: published.reportKey })
  throw new Error("✗ delete succeeded — reports are NOT protected")
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.startsWith("✗")) throw e
  ok(`delete rejected: ${msg.split("\n")[0]?.slice(0, 140)}`)
}

step("a second wallet confirms it, extending the report and its photo")
const before = report.expiresAtBlock
const witness = await burner("0.01")
const confirmed = await vouch(pub, witness, published.reportKey, {
  type: "witness",
  stance: Stance.Confirm,
  note: "Synthetic confirmation",
})
console.log(`  ${await gasOf(confirmed.txHash)}`)
const afterConfirm = (await getReport(pub, published.reportKey))!
check(afterConfirm.expiresAtBlock > before, `expiry moved ${before} → ${afterConfirm.expiresAtBlock}`)
const media = await pub.getEntity(published.mediaKey!)
check(media.expiresAt === afterConfirm.expiresAtBlock, "photo was extended with it")

step("a third wallet logs a takedown")
const reporter = await burner("0.01")
const takedown = await vouch(pub, reporter, published.reportKey, {
  type: "takedown",
  platform: 1,
  action: 2,
  takenDownAt: now - 60,
})
console.log(`  ${await gasOf(takedown.txHash)}`)

step("a fourth wallet keeps it alive without saying anything")
const stranger = await burner("0.01")
const kept = await vouch(pub, stranger, published.reportKey, { type: "keepAlive" })
console.log(`  ${await gasOf(kept.txHash)}`)
const final = (await getReport(pub, published.reportKey))!
check(final.expiresAtBlock > afterConfirm.expiresAtBlock, "a stranger extended it (permissionless)")

step("queries")
const evidence = await evidenceFor(pub, published.reportKey)
check(evidence.witnesses.length === 1, "1 witness linked")
check(evidence.takedowns.length === 1, "1 takedown linked")
check(
  evidence.witnesses.every((w) => w.expiresAtBlock === final.expiresAtBlock),
  "witness was dragged along by the keep-alive",
)
const page = await feed(pub, { since: now - 3600, state: 27 })
check(page.items.some((r) => r.key === published.reportKey), "shows in the Maharashtra feed")
const trusted = await feed(pub, { since: now - 3600, creators: [author.account.address] })
check(trusted.items.length >= 1, "shows when filtering by trusted $creator")
const expiring = await expiringSoon(pub, 30 * 24 * 3600)
check(expiring.items.some((r) => r.key === published.reportKey), "shows in expiring-within-30d")

console.log("\nAll good.")
