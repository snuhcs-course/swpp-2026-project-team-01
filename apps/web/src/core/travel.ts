import type { Place, Role } from "./types"
import type { TravelAnchor } from "./calendar"

export const OFFLINE_TRAVEL_MIN = 60

export function isOffline(event: TravelAnchor): boolean {
  return event.kind !== "online"
}

function sameLocation(event: TravelAnchor, place: Place): boolean {
  if (event.kind !== "place" || !event.placeRef) return false
  return event.placeRef === place.id || event.placeRef === place.name
}

/**
 * Minutes needed between an offline event and a meeting at `place` (same value before and after).
 * Online meetings need no travel. Online *events* never reach this function: they are not an
 * origin or destination, so callers skip them when looking for the neighbouring event.
 */
export function travelMinutes(event: TravelAnchor, place: Place, role: Role): number {
  if (place.kind === "online") return 0
  if (sameLocation(event, place)) return 0
  if (role === "client") return OFFLINE_TRAVEL_MIN
  const atOffice = event.kind === "office"
  if (place.kind === "office_near") return atOffice ? 30 : 60
  return atOffice ? 60 : 30
}
