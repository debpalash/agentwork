import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { createWalletClient, createPublicClient, custom } from 'viem'
import type { Address, PublicClient, WalletClient } from 'viem'
import { base, baseSepolia, hardhat } from 'viem/chains'
import type { Web3ContextValue } from '../types'

const Web3Context = createContext<Web3ContextValue | undefined>(undefined)

const localHardhat = {
  ...hardhat,
  id: 31337,
  name: 'Local Hardhat',
  network: 'hardhat',
  nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
}

const configuredChainId = Number(import.meta.env.VITE_CHAIN_ID || 31337)
const configuredChain = ({ 31337: localHardhat, 84532: baseSepolia, 8453: base })[configuredChainId] || localHardhat

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function walletErrorCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? Number(error.code) : undefined
}

export function Web3Provider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null)
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null)
  const [publicClient, setPublicClient] = useState<PublicClient | null>(null)
  const [networkOk, setNetworkOk] = useState(true)
  const [walletError, setWalletError] = useState('')

  const handleDisconnect = useCallback(() => {
    setAddress(null)
    setWalletClient(null)
    setPublicClient(null)
    setWalletError('')
  }, [])

  const handleConnect = useCallback(async (addr: string) => {
    if (!window.ethereum) throw new Error('No Ethereum wallet was found')
    const wClient = createWalletClient({
      chain: configuredChain,
      transport: custom(window.ethereum)
    })
    const pClient = createPublicClient({
      chain: configuredChain,
      transport: custom(window.ethereum)
    })
    const chainId = await pClient.getChainId()
    setAddress(addr as Address)
    setWalletClient(wClient as WalletClient)
    setPublicClient(pClient as PublicClient)
    setNetworkOk(chainId === configuredChain.id)
    setWalletError('')
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.ethereum) {
      const provider = window.ethereum
      let active = true
      const accountsChanged = (...args: unknown[]) => {
        const accounts = Array.isArray(args[0]) ? args[0] as string[] : []
        if (!active) return
        if (accounts[0]) void handleConnect(accounts[0]).catch(error => setWalletError(messageFrom(error, 'Wallet connection failed')))
        else handleDisconnect()
      }
      const chainChanged = (...args: unknown[]) => {
        const chainId = String(args[0] || '')
        if (active) setNetworkOk(parseInt(chainId, 16) === configuredChain.id)
      }

      provider.request({ method: 'eth_accounts' })
        .then(result => {
          const accounts = Array.isArray(result) ? result as string[] : []
          if (active && accounts[0]) return handleConnect(accounts[0])
        })
        .catch(error => { if (active) setWalletError(messageFrom(error, 'Wallet session could not be restored')) })

      provider.on?.('accountsChanged', accountsChanged)
      provider.on?.('chainChanged', chainChanged)
      return () => {
        active = false
        provider.removeListener?.('accountsChanged', accountsChanged)
        provider.removeListener?.('chainChanged', chainChanged)
      }
    }
  }, [handleConnect, handleDisconnect])

  const disconnectWallet = handleDisconnect

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      setWalletError('No Ethereum wallet was found. Install MetaMask or Coinbase Wallet, then try again.')
      return
    }
    try {
      const result = await window.ethereum.request({ method: 'eth_requestAccounts' })
      const accounts = Array.isArray(result) ? result as string[] : []
      if (!accounts[0]) throw new Error('The wallet did not return an account')
      await handleConnect(accounts[0])
    } catch (err) {
      setWalletError(messageFrom(err, 'Wallet connection failed'))
    }
  }, [handleConnect])

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) return
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${configuredChain.id.toString(16)}` }],
      })
      setWalletError('')
    } catch (switchError) {
      if (walletErrorCode(switchError) === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: `0x${configuredChain.id.toString(16)}`,
                chainName: configuredChain.name,
                rpcUrls: configuredChain.rpcUrls.default.http,
                nativeCurrency: configuredChain.nativeCurrency,
              },
            ],
          })
        } catch (addError) {
          setWalletError(messageFrom(addError, 'The configured network could not be added'))
        }
      } else {
        setWalletError(messageFrom(switchError, 'The wallet could not switch networks'))
      }
    }
  }, [])

  const value = useMemo(() => ({
    address,
    walletClient,
    publicClient,
    connectWallet,
    disconnectWallet,
    switchNetwork,
    networkOk,
    targetChain: configuredChain,
    walletError,
    clearWalletError: () => setWalletError(''),
  }), [address, walletClient, publicClient, connectWallet, disconnectWallet, switchNetwork, networkOk, walletError])

  return (
    <Web3Context.Provider value={value}>
      {children}
    </Web3Context.Provider>
  )
}

export const useWeb3 = (): Web3ContextValue => {
  const context = useContext(Web3Context)
  if (!context) throw new Error('useWeb3 must be used inside Web3Provider')
  return context
}
