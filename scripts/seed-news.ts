// Publishes reports summarising PUBLISHED NEWS COVERAGE of the October 2026 protests in Delhi, so
// the feed shows what Gawaah is for. Every report links its sources, says it is not a first-hand
// account, and carries no personal names. Photos are freely licensed pictures of the locations
// (credited, and labelled as not being of the event), with no identifiable faces. No confirmations
// or takedowns are added: those are testimony, and only real witnesses should give them.
//
//   pnpm seed:news             publish
//   pnpm seed:news --dry-run   check regions, photos and sizes without writing anything
import { readFileSync } from "node:fs"
import { createWalletClient as createViemWallet, type Hex, http, parseEther } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { publicClient, tiramisu, walletClient } from "../src/arkiv/client"
import { type CategoryCode, LIMITS, type SourceLink } from "../src/arkiv/schema"
import { publishReport } from "../src/arkiv/write"
import { STATES } from "../src/lib/regions"

process.loadEnvFile?.(".env")

function where(state: string, district: string) {
  const s = STATES.find((x) => x.name === state)
  const d = s?.districts.find((x) => x.name === district)
  if (!s || !d) throw new Error(`Unknown region ${district}, ${state}`)
  return { state: s.code, district: d.code }
}

/** IST wall-clock time to unix seconds. Where coverage gives no time of day, we use noon. */
const ist = (iso: string) => Math.floor(new Date(`${iso}+05:30`).getTime() / 1000)

/**
 * Drops every APPn segment except APP0 (JFIF) — EXIF, XMP, ICC and maker notes — so nothing but
 * pixels reaches the chain, matching what the browser's canvas re-encode does for user photos.
 */
function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Not a JPEG")
  const out: number[] = [0xff, 0xd8]
  let i = 2
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error(`Bad JPEG marker at ${i}`)
    const marker = bytes[i + 1]!
    if (marker === 0xda) {
      // Start of scan: the rest is image data.
      out.push(...bytes.subarray(i))
      break
    }
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!
    const isApp = marker >= 0xe1 && marker <= 0xef
    if (!isApp && marker !== 0xfe) out.push(...bytes.subarray(i, i + 2 + len))
    i += 2 + len
  }
  return Uint8Array.from(out)
}

const photo = (name: string) => stripJpeg(readFileSync(new URL(`./news-photos/${name}.jpg`, import.meta.url)))

const credit = (label: string, url: string): SourceLink => ({
  label: `Location photo, not of this event: ${label}`,
  url,
})

const AJ_OCT16: SourceLink = {
  label: "Al Jazeera: Indian protest leaders detained ahead of flag march in New Delhi",
  url: "https://www.aljazeera.com/video/newsfeed/2026/10/16/indian-protest-leaders-detained-ahead-of-flag-march-in-new-delhi",
}
const AJ_OCT2: SourceLink = {
  label: "Al Jazeera: Indian authorities clamp down as 'cockroach' movement launches new protests",
  url: "https://www.aljazeera.com/news/2026/10/2/indian-authorities-clamp-down-as-cockroach-movement-launches-new-protests",
}
const HRW: SourceLink = {
  label: "Human Rights Watch: India, end crackdown on protesters, arbitrary detentions",
  url: "https://www.hrw.org/news/2026/10/13/india-end-crackdown-on-protesters-arbitrary-detentions",
}
const BT: SourceLink = {
  label: "Breakthrough News: How protesters marched on the garrisoned heart of India's capital",
  url: "https://breakthroughnews.org/2026/10/17/one-barricade-after-another-how-protesters-marched-on-the-garrisoned-heart-of-indias-capital/",
}
const MEDIANAMA: SourceLink = {
  label: "MediaNama: Internet shutdown ordered around New Delhi's Jantar Mantar",
  url: "https://www.medianama.com/2026/10/223-internet-shutdown-new-delhi-jantar-mantar/",
}
const CIVICUS: SourceLink = {
  label: "Civicus Monitor: Thousands detained in crackdown on mass protests",
  url: "https://monitor.civicus.org/explore/india-thousands-detained-in-crackdown-on-mass-protests-against-electoral-roll-manipulation-while-activists-and-journalists-are-criminalised/",
}

type NewsReport = {
  at: [string, string]
  category: CategoryCode
  occurredAt: number
  title: string
  body: string
  sources: SourceLink[]
  photo?: { file: string; credit: SourceLink }
}

const FOOTER = "Compiled from published news reporting, not a first-hand account."

export const NEWS: NewsReport[] = [
  {
    at: ["Delhi", "New Delhi"], category: 3, occurredAt: ist("2026-10-16T12:00:00"),
    title: "Protest leaders detained before flag march in New Delhi",
    body:
      "Hundreds gathered in New Delhi for a flag march demanding that the Chief Election Commissioner " +
      "resign over alleged fraud in the voter rolls. Leaders of the youth-led movement, including a " +
      "student leader, were detained before the march began. Protests continued in several other cities.",
    sources: [AJ_OCT16],
  },
  {
    at: ["Delhi", "New Delhi"], category: 5, occurredAt: ist("2026-10-11T12:30:00"),
    title: "Journalist beaten by police while filming a protester's detention",
    body:
      "A magazine journalist recording the detention of a protester was hit on the head, slapped and " +
      "struck with a rifle butt by police. The same day, the Supreme Court directed authorities to stop " +
      "detaining peaceful protesters and to restore internet services.",
    sources: [HRW],
  },
  {
    at: ["Delhi", "New Delhi"], category: 3, occurredAt: ist("2026-10-11T12:00:00"),
    title: "At least 30 journalists detained covering the protests",
    body:
      "Over 10 and 11 October, at least 30 journalists covering the protests were detained. Police " +
      "seized some of their phones and equipment.",
    sources: [HRW],
  },
  {
    at: ["Delhi", "New Delhi"], category: 2, occurredAt: ist("2026-10-10T10:30:00"),
    title: "Marchers push through barricades toward Jantar Mantar",
    body:
      "Around 300 to 350 protesters left a party office about 3 km away and marched toward Jantar " +
      "Mantar, which police had sealed. They pushed through several layers of barricades. Those who got " +
      "within about 400 m were held and put on buses. Dozens of metro stations were closed and trains " +
      "cancelled. One report puts detentions that day at over 7,000; figures vary between sources.",
    sources: [BT, HRW],
    photo: {
      file: "barricade",
      credit: credit(
        "a Delhi Police barricade on Parliament Street. Sidheeq, CC BY-SA 3.0, via Wikimedia Commons (resized)",
        "https://commons.wikimedia.org/wiki/File:Delhi_Police%27s_Barricade.jpeg",
      ),
    },
  },
  {
    at: ["Delhi", "North West  Delhi"], category: 3, occurredAt: ist("2026-10-10T12:30:00"),
    title: "Detainees taken to stadiums on the city's edge",
    body:
      "People detained around Jantar Mantar were driven to holding sites far from the protest, " +
      "including a stadium in Bawana about 50 km away. Eight stadiums and other public facilities were " +
      "reportedly used as detention centres. Detainees allege mistreatment in vans and buses.",
    sources: [BT],
  },
  {
    at: ["Delhi", "New Delhi"], category: 2, occurredAt: ist("2026-10-10T12:00:00"),
    title: "Police enter gurdwara to detain protesters sheltering inside",
    body:
      "Police entered a gurdwara near Connaught Place to detain protesters who had taken refuge there. " +
      "A civil society group has called for an independent inquiry.",
    sources: [HRW],
    photo: {
      file: "bangla-sahib",
      credit: credit(
        "Gurudwara Bangla Sahib, New Delhi. A.Savin, Free Art License, via Wikimedia Commons (cropped)",
        "https://commons.wikimedia.org/wiki/File:Gurudwara_Bangla_Sahib_in_New_Delhi_03-2016_img3.jpg",
      ),
    },
  },
  {
    at: ["Delhi", "New Delhi"], category: 4, occurredAt: ist("2026-10-09T22:00:00"),
    title: "Mobile internet cut within 4 km of Kartavya Path for 24 hours",
    body:
      "Mobile internet was suspended within a 4 km radius of the Janpath-Kartavya Path crossing from " +
      "10 pm on 9 October to 10 pm on 10 October. The Home Ministry's notice to telecom operators was " +
      "not published and gave no reason. It is the second shutdown here this month, after a 12-hour, " +
      "1.5 km one on 2 October.",
    sources: [MEDIANAMA],
    photo: {
      file: "kartavya-path",
      credit: credit(
        "Kartavya Path signboard, New Delhi. Pinakpani, CC BY-SA 4.0, via Wikimedia Commons (resized)",
        "https://commons.wikimedia.org/wiki/File:Kartavya_Path_in_the_evening_in_New_Delhi_08.jpg",
      ),
    },
  },
  {
    at: ["Delhi", "New Delhi"], category: 3, occurredAt: ist("2026-10-02T14:00:00"),
    title: "Hundreds arrested as protests against the election chief begin",
    body:
      "More than 500 people, including opposition party members and student groups, were arrested in " +
      "New Delhi by the afternoon as protests demanding the Chief Election Commissioner's resignation " +
      "began. Metro stations near the protest site were closed and mobile internet was cut for 12 hours.",
    sources: [AJ_OCT2, MEDIANAMA, CIVICUS],
    photo: {
      file: "jantar-mantar",
      credit: credit(
        "Jantar Mantar, New Delhi. Subeesh Balan, CC BY-SA 3.0, via Wikimedia Commons (resized)",
        "https://commons.wikimedia.org/wiki/File:Jantar_Mantar_New_Delhi.jpg",
      ),
    },
  },
]

if (process.argv.includes("--dry-run")) {
  for (const n of NEWS) {
    where(...n.at)
    const size = n.photo ? `${Math.round(photo(n.photo.file).length / 1024)} KB photo` : "no photo"
    console.log(`${new Date(n.occurredAt * 1000).toISOString().slice(0, 16)}  ${n.at[1]}  ${size}  ${n.title}`)
    if (n.photo && photo(n.photo.file).length > LIMITS.mediaBytes) throw new Error(`${n.photo.file} too large`)
  }
  process.exit(0)
}

const main = process.env.ARKIV_PRIVATE_KEY as Hex | undefined
if (!main) throw new Error("ARKIV_PRIVATE_KEY missing")
const pub = publicClient()
const funder = createViemWallet({ chain: tiramisu, transport: http(), account: privateKeyToAccount(main) })
// Measured: a 40 KB photo report used 0.0017 GLM, and the node's upfront check (gas limit × max fee)
// needs headroom on top. See arkiv/friction.md §4.
const GAS = parseEther("0.004")
const GAS_WITH_PHOTO = parseEther("0.012")

for (const n of NEWS) {
  const author = walletClient(generatePrivateKey())
  const hash = await funder.sendTransaction({ to: author.account.address, value: n.photo ? GAS_WITH_PHOTO : GAS })
  await pub.waitForTransactionReceipt({ hash })
  const r = await publishReport(pub, author, {
    ...where(...n.at),
    category: n.category,
    occurredAt: n.occurredAt,
    title: n.title,
    body: `${n.body}\n\n${FOOTER}`,
    sources: n.sources,
    media: n.photo ? photo(n.photo.file) : undefined,
    photoCredit: n.photo?.credit,
  })
  console.log(`report ${r.reportKey}  creator ${author.account.address}  ${n.title}`)
}
