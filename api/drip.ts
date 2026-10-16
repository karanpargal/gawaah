// Gas drip: sends a fresh, empty wallet just enough GLM for one Gawaah write.
//
// This is the only server-side piece, and it is deliberately powerless. It never sees a report,
// can't sign anything on a user's behalf, and can't change or remove data. If it goes down or
// refuses, users can still fund their wallet from the faucet and post exactly as before.
//
// Deployed as a Vercel Function. Env: DRIP_PRIVATE_KEY (required), DRIP_AMOUNT_GLM (optional).
import { createPublicClient, createWalletClient, type Hex, http, isAddress, parseEther } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { tiramisu } from "@arkiv-network/sdk/chains"

const AMOUNT = parseEther(process.env.DRIP_AMOUNT_GLM ?? "0.0002")
const PER_IP_PER_HOUR = 20

// Per-instance memory. It resets on cold starts, which is fine: this is a testnet speed bump,
// not a security boundary.
const hits = new Map<string, number[]>()

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
}

const reply = (status: number, body: string) =>
  new Response(body, { status, headers: { ...CORS, "content-type": "text/plain" } })

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function POST(request: Request) {
  const key = process.env.DRIP_PRIVATE_KEY as Hex | undefined
  if (!key) return reply(503, "Drip not configured.")

  let address: unknown
  try {
    address = ((await request.json()) as { address?: unknown }).address
  } catch {
    return reply(400, "Send JSON: {\"address\": \"0x…\"}")
  }
  if (typeof address !== "string" || !isAddress(address)) return reply(400, "Invalid address.")

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000)
  if (recent.length >= PER_IP_PER_HOUR) return reply(429, "Too many requests. Try again later.")

  const pub = createPublicClient({ chain: tiramisu, transport: http() })
  if ((await pub.getBalance({ address })) > 0n) return reply(409, "Address already has gas.")

  recent.push(now)
  hits.set(ip, recent)

  const wallet = createWalletClient({ chain: tiramisu, transport: http(), account: privateKeyToAccount(key) })
  const hash = await wallet.sendTransaction({ to: address, value: AMOUNT })
  return new Response(JSON.stringify({ hash }), {
    status: 200,
    headers: { ...CORS, "content-type": "application/json" },
  })
}
