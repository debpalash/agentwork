import React, { createContext, useContext, useState, useEffect } from 'react'
import { createWalletClient, createPublicClient, custom, http } from 'viem'
import { baseSepolia, hardhat } from 'viem/chains'

const Web3Context = createContext()

const localHardhat = {
  id: 7890,
  name: 'Local Hardhat',
  network: 'hardhat',
  nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
}

export function Web3Provider({ children }) {
  const [address, setAddress] = useState(null)
  const [walletClient, setWalletClient] = useState(null)
  const [publicClient, setPublicClient] = useState(null)
  const [networkOk, setNetworkOk] = useState(true)

  // Configure target networks
  const supportedChains = [baseSepolia, localHardhat]
  const targetChain = baseSepolia // Default to baseSepolia for public testing

  useEffect(() => {
    if (typeof window !== 'undefined' && window.ethereum) {
      // Re-hydrate session on reload
      window.ethereum.request({ method: 'eth_accounts' })
        .then(accounts => {
          if (accounts.length > 0) handleConnect(accounts[0])
        })
        .catch(console.error)

      // Listeners
      window.ethereum.on('accountsChanged', accounts => {
        if (accounts.length > 0) handleConnect(accounts[0])
        else handleDisconnect()
      })

      window.ethereum.on('chainChanged', (chainId) => {
        const id = parseInt(chainId, 16)
        setNetworkOk(supportedChains.some(c => c.id === id))
      })
    }
  }, [])

  const handleConnect = async (addr) => {
    setAddress(addr)
    const wClient = createWalletClient({
      chain: targetChain,
      transport: custom(window.ethereum)
    })
    const pClient = createPublicClient({
      chain: targetChain,
      transport: custom(window.ethereum)
    })
    
    setWalletClient(wClient)
    setPublicClient(pClient)

    const chainId = await pClient.getChainId()
    setNetworkOk(supportedChains.some(c => c.id === chainId))
  }

  const handleDisconnect = () => {
    setAddress(null)
    setWalletClient(null)
    setPublicClient(null)
  }

  const disconnectWallet = () => {
    handleDisconnect()
  }

  const connectWallet = async () => {
    if (!window.ethereum) {
      alert("No Ethereum wallet found. Please install MetaMask or Coinbase Wallet.")
      return
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      handleConnect(accounts[0])
    } catch (err) {
      console.error("Wallet connection failed:", err)
    }
  }

  const switchNetwork = async () => {
    if (!window.ethereum) return
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${targetChain.id.toString(16)}` }],
      })
    } catch (switchError) {
      // This error code indicates that the chain has not been added to MetaMask.
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: `0x${targetChain.id.toString(16)}`,
                chainName: targetChain.name,
                rpcUrls: targetChain.rpcUrls.default.http,
                nativeCurrency: targetChain.nativeCurrency,
              },
            ],
          })
        } catch (addError) {
          console.error("Failed to add network:", addError)
        }
      }
    }
  }

  return (
    <Web3Context.Provider value={{ address, walletClient, publicClient, connectWallet, disconnectWallet, switchNetwork, networkOk, targetChain }}>
      {children}
    </Web3Context.Provider>
  )
}

export const useWeb3 = () => useContext(Web3Context)
