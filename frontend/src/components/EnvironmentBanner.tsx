import { useWeb3 } from '../context/Web3Context'

export function environmentDetails(chainId?: number) {
  const configuredLabel = import.meta.env.VITE_ENVIRONMENT_LABEL
  const configuredMode = import.meta.env.VITE_DATA_MODE
  if (Number(chainId) === 31337) {
    return {
      label: configuredLabel || 'Local demo',
      mode: configuredMode || 'seeded-demo',
      message: 'Seeded records and test-wallet activity are not production adoption metrics.',
    }
  }
  if (Number(chainId) === 84532) {
    return {
      label: configuredLabel || 'Base Sepolia testnet',
      mode: configuredMode || 'testnet',
      message: 'Testnet transactions and balances have no production value.',
    }
  }
  return {
    label: configuredLabel || 'Base mainnet',
    mode: configuredMode || 'live',
    message: configuredMode === 'seeded-demo' ? 'This environment includes visibly labelled demonstration records.' : '',
  }
}

export default function EnvironmentBanner() {
  const { targetChain } = useWeb3()
  const environment = environmentDetails(targetChain?.id)
  if (environment.mode === 'live' && !environment.message) return null
  return (
    <div className={`environment-banner environment-${environment.mode}`} role="status">
      <strong>{environment.label}</strong>
      <span>{environment.message}</span>
    </div>
  )
}
