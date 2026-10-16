// Seeds Tiramisu with SYNTHETIC demo reports so the feed, tallies and boards have something in
// them. Every report says it is synthetic. No real people, places finer than a district, or events.
//
//   pnpm seed
import { createWalletClient as createViemWallet, type Hex, http, parseEther } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { publicClient, tiramisu, walletClient } from "../src/arkiv/client"
import { type CategoryCode, type PlatformCode, Stance, type TakedownActionCode } from "../src/arkiv/schema"
import { publishReport, vouch } from "../src/arkiv/write"
import { STATES } from "../src/lib/regions"

process.loadEnvFile?.(".env")
const main = process.env.ARKIV_PRIVATE_KEY as Hex | undefined
if (!main) throw new Error("ARKIV_PRIVATE_KEY missing")

const pub = publicClient()
const funder = createViemWallet({ chain: tiramisu, transport: http(), account: privateKeyToAccount(main) })
const GAS = parseEther(process.env.SEED_GAS_GLM ?? "0.002")

function where(state: string, district: string) {
  const s = STATES.find((x) => x.name === state)
  const d = s?.districts.find((x) => x.name === district)
  if (!s || !d) throw new Error(`Unknown region ${district}, ${state}`)
  return { state: s.code, district: d.code }
}

type Seed = {
  at: [string, string]
  category: CategoryCode
  hoursAgo: number
  title: string
  body: string
  confirms: number
  disputes?: number
  takedowns?: [PlatformCode, TakedownActionCode, number][]
  /** 30h first life, to populate "About to vanish". Must get no vouches, which would extend it. */
  shortLife?: boolean
}

const FOOTER = "\n\n(Synthetic demo report for the Arkiv hackathon. No real event.)"

const SEEDS: Seed[] = [
  {
    at: ["Delhi", "New Delhi"], category: 1, hoursAgo: 3,
    title: "Silent march from the university to the city centre",
    body: "Around 2,000 students walked in silence with placards. Police lined the route but did not stop it. Dispersed peacefully by 6 pm.",
    confirms: 5, takedowns: [[1, 2, 2], [2, 1, 1]],
  },
  {
    at: ["Maharashtra", "Pune"], category: 2, hoursAgo: 6,
    title: "Police use batons to clear sit-in outside the collectorate",
    body: "Sit-in of roughly 150 people was cleared at around 4 pm. Several people were pushed to the ground. Two ambulances arrived.",
    confirms: 3, disputes: 1, takedowns: [[1, 1, 4], [4, 1, 3]],
  },
  {
    at: ["Manipur", "Imphal West"], category: 4, hoursAgo: 20,
    title: "Mobile data down across the district since this morning",
    body: "No 4G on any carrier since about 7 am. Broadband still working in some areas. No official order seen yet.",
    confirms: 6, takedowns: [[1, 2, 12]],
  },
  {
    at: ["Karnataka", "Bengaluru (Bangalore) Urban"], category: 3, hoursAgo: 9,
    title: "Around 30 detained at the park, taken away in buses",
    body: "Protesters gathered at the park at noon. Police said the gathering lacked permission. About 30 were detained and driven away in two buses.",
    confirms: 2, takedowns: [[2, 3, 5]],
  },
  {
    at: ["West Bengal", "Kolkata"], category: 1, hoursAgo: 30,
    title: "Candlelight vigil, several thousand attend",
    body: "Large peaceful vigil that went on into the night. No police action seen.",
    confirms: 4,
  },
  {
    at: ["Uttar Pradesh", "Lucknow"], category: 2, hoursAgo: 40,
    title: "Water cannon used on march near the assembly",
    body: "March of farmers' unions stopped by barricades. Water cannon used twice. The march turned back.",
    confirms: 1, disputes: 2, takedowns: [[3, 1, 30]],
  },
  {
    at: ["Tamil Nadu", "Chennai"], category: 6, hoursAgo: 52,
    title: "Shops shut in solidarity along the main market road",
    body: "Most shops kept shutters down until 2 pm. Traders' association called it voluntary.",
    confirms: 0, shortLife: true,
  },
  {
    at: ["Jammu and Kashmir", "Srinagar"], category: 4, hoursAgo: 70,
    title: "Broadband and mobile both cut, landlines working",
    body: "Complete internet outage reported from multiple neighbourhoods. Landlines are the only way to reach people.",
    confirms: 2, takedowns: [[1, 2, 60], [6, 4, 50]],
  },
  {
    at: ["Bihar", "Patna"], category: 1, hoursAgo: 60,
    title: "Students block the road outside the exam board office",
    body: "Road blocked for about two hours over the exam result. Traffic diverted. No arrests seen.",
    confirms: 0, shortLife: true,
  },
  {
    at: ["Assam", "Kamrup Metropolitan"], category: 5, hoursAgo: 14,
    title: "Clash near the bus stand, injuries reported",
    body: "A scuffle broke out between two groups. At least five people were taken to hospital. Situation calm by evening.",
    confirms: 1, disputes: 1,
  },
  {
    at: ["Gujarat", "Ahmedabad"], category: 1, hoursAgo: 4,
    title: "Women's collective holds rally at the riverfront",
    body: "Several hundred women marched with songs and banners. Ended with a public reading of demands.",
    confirms: 0,
  },
]

async function burner() {
  const w = walletClient(generatePrivateKey())
  const hash = await funder.sendTransaction({ to: w.account.address, value: GAS })
  await pub.waitForTransactionReceipt({ hash })
  return w
}

const creators: Hex[] = []
const now = Math.floor(Date.now() / 1000)

for (const s of SEEDS) {
  const author = await burner()
  const r = await publishReport(pub, author, {
    ...where(...s.at),
    category: s.category,
    occurredAt: now - s.hoursAgo * 3600,
    title: s.title,
    body: s.body + FOOTER,
    lifetimeSeconds: s.shortLife ? 30 * 3600 : undefined,
  })
  creators.push(author.account.address)
  console.log(`report ${r.reportKey}  ${s.at[1]}: ${s.title}`)

  for (let i = 0; i < s.confirms; i++) {
    await vouch(pub, await burner(), r.reportKey, { type: "witness", stance: Stance.Confirm })
  }
  for (let i = 0; i < (s.disputes ?? 0); i++) {
    await vouch(pub, await burner(), r.reportKey, {
      type: "witness",
      stance: Stance.Dispute,
      note: "The numbers here look exaggerated.",
    })
  }
  for (const [platform, action, hoursLater] of s.takedowns ?? []) {
    const takenDownAt = Math.min(now - 60, now - s.hoursAgo * 3600 + hoursLater * 3600)
    await vouch(pub, await burner(), r.reportKey, { type: "takedown", platform, action, takenDownAt })
  }
}

console.log("\nSeed author wallets (for the Devfolio evidence field):")
for (const c of creators) console.log(`  ${c}`)
