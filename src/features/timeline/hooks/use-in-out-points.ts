import { useMarkersStore } from '../stores/markers-store'
import { setInPoint, setOutPoint } from '../stores/timeline-actions'

/**
 * Subscribes to the in/out render-range points and their setters.
 * Shared by the timeline header and ruler markers so the store
 * subscription shape stays identical everywhere.
 */
export function useInOutPoints() {
  const inPoint = useMarkersStore((s) => s.inPoint)
  const outPoint = useMarkersStore((s) => s.outPoint)
  return { inPoint, outPoint, setInPoint, setOutPoint }
}
