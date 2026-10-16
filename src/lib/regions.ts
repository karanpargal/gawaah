import data from "../data/regions.json"

export type District = { code: number; name: string }
export type State = { code: number; name: string; districts: District[] }

export const STATES: State[] = data
const STATE_BY_CODE = new Map(STATES.map((s) => [s.code, s]))
const DISTRICT_BY_CODE = new Map(STATES.flatMap((s) => s.districts.map((d) => [d.code, d] as const)))

export const stateName = (code: number) => STATE_BY_CODE.get(code)?.name ?? `State ${code}`
export const districtName = (code: number) => DISTRICT_BY_CODE.get(code)?.name ?? `District ${code}`
export const districtsOf = (state: number) => STATE_BY_CODE.get(state)?.districts ?? []
