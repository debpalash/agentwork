import React, { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { useWeb3 } from '../context/Web3Context'
import BrandMark from './BrandMark'
import Icon, { type IconName } from './Icon'

type RouteKey = '' | 'problems' | 'dashboard' | 'tasks' | 'agents' | 'post' | 'docs' | 'disputes' | 'profile'

export default function Navbar() {
  const { address, connectWallet, disconnectWallet, networkOk, switchNetwork, targetChain, walletError, clearWalletError } = useWeb3()
  const [walletOpen, setWalletOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const walletRef = useRef<HTMLDivElement | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const page = location.pathname.substring(1) || 'home'
  const forgejoUrl = import.meta.env.VITE_FORGEJO_URL || (import.meta.env.DEV ? 'http://localhost:3000' : null)

  const links: Array<{ key: Exclude<RouteKey, '' | 'profile'>; label: string; icon: IconName }> = [
    { key: 'problems', label: 'Fund & Solve', icon: 'problems' },
    { key: 'dashboard', label: 'Overview', icon: 'dashboard' },
    { key: 'tasks', label: 'Find Tasks', icon: 'tasks' },
    { key: 'agents', label: 'Builders', icon: 'agents' },
    { key: 'post', label: 'Post a Task', icon: 'post' },
    { key: 'docs', label: 'Docs', icon: 'docs' },
    { key: 'disputes', label: 'Disputes', icon: 'disputes' },
  ]

  const truncateAddress = (addr: string | null) => {
    return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : ''
  }

  // Close the wallet menu on outside click.
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (walletRef.current && event.target instanceof Node && !walletRef.current.contains(event.target)) {
        setWalletOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  useEffect(() => setNavOpen(false), [location.pathname])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNavOpen(false)
        setWalletOpen(false)
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [])

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address).then(() => {
        setCopied(true)
        if (copyTimer.current) clearTimeout(copyTimer.current)
        copyTimer.current = setTimeout(() => setCopied(false), 1500)
      })
    }
  }

  const go = async (path: RouteKey) => {
    setNavOpen(false)
    await navigate({ to: `/${path}` })
    requestAnimationFrame(() => document.getElementById('main-content')?.focus())
  }

  return (
    <nav className="navbar">
      <button className="nav-brand nav-brand-button" onClick={() => go('')} aria-label="Collagent home">
        <BrandMark />
      </button>
      <div className={`nav-links ${navOpen ? 'open' : ''}`} id="primary-navigation">
        {links.map(({ key, label, icon }) => (
          <button
            key={key}
            className={`nav-link ${page === key ? 'active' : ''}`}
            onClick={() => go(key)}
            aria-label={label}
            aria-current={page === key ? 'page' : undefined}
            title={label}
          >
            <Icon name={icon} className="nav-icon" />
            <span className="nav-link-label">{label}</span>
          </button>
        ))}
      </div>
      <div className="nav-actions">
        <button
          className={`nav-menu-toggle ${navOpen ? 'active' : ''}`}
          type="button"
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
          aria-controls="primary-navigation"
          onClick={() => { setNavOpen(value => !value); setWalletOpen(false) }}
        >
          <span className="nav-menu-icon" aria-hidden="true"><i /><i /><i /></span>
          <span className="nav-menu-label">{navOpen ? 'Close' : 'Menu'}</span>
        </button>
        <button
          type="button"
          className="chain-badge" 
          style={{ 
            color: networkOk ? 'inherit' : 'var(--accent-error)', 
            borderColor: networkOk ? 'var(--border-dim)' : 'var(--accent-error)',
            cursor: networkOk ? 'default' : 'pointer'
          }}
          onClick={networkOk ? undefined : switchNetwork}
          disabled={networkOk}
          aria-label={networkOk ? `Connected to ${targetChain?.name}` : `Switch to ${targetChain?.name}`}
        >
          <span className="chain-dot" style={{ background: networkOk ? 'var(--accent-success)' : 'var(--accent-error)' }}></span>
          {networkOk ? targetChain?.name : `Switch to ${targetChain?.name}`}
        </button>

        {/* Wallet button + dropdown */}
        <div className="wallet-menu" ref={walletRef} style={{ position: 'relative' }}>
          <button 
            className={`btn ${address ? 'btn-secondary' : 'btn-primary'} btn-sm`} 
            onClick={address ? () => { setWalletOpen(prev => !prev); setNavOpen(false) } : connectWallet}
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            <Icon name="wallet" size={17} />
            {address ? truncateAddress(address) : 'Connect wallet'}
          </button>

          {walletOpen && address && (
            <div className="wallet-dropdown">
              <div className="wallet-dropdown-header">
                <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '4px' }}>Connected wallet</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', wordBreak: 'break-all' }}>{address}</div>
              </div>
              <div className="wallet-dropdown-divider"></div>
              <button className="wallet-dropdown-item" onClick={copyAddress}>
                <Icon name="copy" className="wallet-dropdown-icon" /> {copied ? 'Copied' : 'Copy address'}
              </button>
              <button className="wallet-dropdown-item" onClick={() => { void go('profile'); setWalletOpen(false) }}>
                <Icon name="profile" className="wallet-dropdown-icon" /> Profile settings
              </button>
              {forgejoUrl && <button className="wallet-dropdown-item" onClick={() => { window.open(forgejoUrl, '_blank', 'noopener,noreferrer'); setWalletOpen(false) }}>
                <Icon name="repository" className="wallet-dropdown-icon" /> Git workspace
              </button>}
              <button className="wallet-dropdown-item" onClick={() => { switchNetwork(); setWalletOpen(false) }}>
                <Icon name="network" className="wallet-dropdown-icon" /> Switch network
              </button>
              <div className="wallet-dropdown-divider"></div>
              <button className="wallet-dropdown-item wallet-dropdown-danger" onClick={() => { disconnectWallet(); setWalletOpen(false); void go('dashboard') }}>
                <Icon name="disconnect" className="wallet-dropdown-icon" /> Disconnect wallet
              </button>
            </div>
          )}
        </div>
        {walletError && (
          <div className="wallet-error" role="alert">
            <span>{walletError}</span>
            <button type="button" onClick={clearWalletError} aria-label="Dismiss wallet error">Close</button>
          </div>
        )}
      </div>
    </nav>
  )
}
