// Generates a fresh Tiramisu wallet into .env and prints only its address.
// The private key never leaves the file, so it never ends up in a terminal log.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"

const ENV = ".env"
const existing = existsSync(ENV) ? readFileSync(ENV, "utf8") : ""
const match = existing.match(/^ARKIV_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m)

if (match?.[1]) {
  console.log("Wallet already in .env:", privateKeyToAccount(match[1] as `0x${string}`).address)
} else {
  const key = generatePrivateKey()
  const rest = existing.replace(/^ARKIV_PRIVATE_KEY=.*$/m, "").trim()
  writeFileSync(ENV, `${rest ? `${rest}\n` : ""}ARKIV_PRIVATE_KEY=${key}\n`, { mode: 0o600 })
  console.log("New wallet written to .env:", privateKeyToAccount(key).address)
}
console.log("Fund it at https://hub.arkiv.network/faucet")
