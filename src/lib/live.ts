import { useEffect, useRef } from "react"
import type { Hex } from "viem"
import { type LiveClient, liveClient } from "../arkiv/client"
import { BURN_ADDRESS } from "../arkiv/schema"

let shared: LiveClient | null = null
const client = () => (shared ??= liveClient())

export type LiveHandlers = {
  /** An entity was just handed to the burn address — the last step of every Gawaah write. */
  onSealed?: (entityKey: Hex) => void
  onExtended?: (entityKey: Hex, expiresAt: bigint) => void
}

/**
 * Follows the chain head over WebSocket. Most entities on Tiramisu belong to other apps, so rather
 * than fetching every new entity we listen for ownership moving to the burn address, which only
 * our sealed publish path does, and fetch just those.
 */
export function useLive(handlers: LiveHandlers) {
  const ref = useRef(handlers)
  ref.current = handlers
  useEffect(() => {
    const burn = BURN_ADDRESS.toLowerCase()
    return client().watchEntityEvents({
      onOwnershipTransferred: (e) => {
        if (e.newOwner.toLowerCase() === burn) ref.current.onSealed?.(e.entityKey)
      },
      onExpiryExtended: (e) => ref.current.onExtended?.(e.entityKey, e.expiresAt),
      onError: (err) => console.warn("[gawaah] live updates:", err.message),
    })
  }, [])
}
