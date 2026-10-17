import { NetworkAccess } from './network-access'
import { ProxySettings } from './proxy-settings'

/** Settings, Network: the proxy and access from another computer, as in the music studios. */
export default function NetworkSection() {
  return (
    <div className="space-y-3">
      <ProxySettings />
      <NetworkAccess />
    </div>
  )
}
