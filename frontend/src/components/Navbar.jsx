import React, { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { useWeb3 } from '../context/Web3Context'

export default function Navbar() {
  const { address, connectWallet, disconnectWallet, networkOk, switchNetwork } = useWeb3()
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()
  const page = location.pathname.substring(1) || 'dashboard'

  const links = [
    { key: 'dashboard', label: 'mission_control' },
    { key: 'tasks', label: 'operations_queue' },
    { key: 'agents', label: 'neural_directory' },
    { key: 'post', label: 'deploy_task' },
    { key: 'docs', label: 'protocol_docs' },
    { key: 'disputes', label: 'disputes' },
  ]

  const truncateAddress = (addr) => {
    return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : ''
  }

  // Close menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
    }
  }

  const go = (path) => navigate({ to: `/${path}` })

  return (
    <nav className="navbar">
      <div className="nav-brand">
        <span className="brand-text">AIWORK_</span>
        <span style={{fontSize: '0.65rem', color: 'var(--text-ghost)', fontFamily: 'var(--font-mono)', marginLeft: '4px', fontWeight: '500'}}>v2.0</span>
      </div>
      <div className="nav-links">
        {links.map(({ key, label }) => (
          <button
            key={key}
            className={`nav-link ${page === key ? 'active' : ''}`}
            onClick={() => go(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="nav-actions">
        <div 
          className="chain-badge" 
          style={{ 
            color: networkOk ? 'inherit' : 'var(--accent-error)', 
            borderColor: networkOk ? 'var(--border-dim)' : 'var(--accent-error)',
            cursor: networkOk ? 'default' : 'pointer'
          }}
          onClick={networkOk ? undefined : switchNetwork}
        >
          <span className="chain-dot" style={{ background: networkOk ? 'var(--accent-success)' : 'var(--accent-error)' }}></span>
          {networkOk ? 'BASE_L2' : 'WRONG_NET (CLICK)'}
        </div>

        {/* Wallet button + dropdown */}
        <div className="wallet-menu" ref={menuRef} style={{ position: 'relative' }}>
          <button 
            className={`btn ${address ? 'btn-secondary' : 'btn-primary'} btn-sm`} 
            onClick={address ? () => setMenuOpen(prev => !prev) : connectWallet}
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {address ? `[ ${truncateAddress(address)} ]` : '[ CONNECT NODE ]'}
            {address && <span style={{ marginLeft: '6px', fontSize: '0.6rem' }}>{menuOpen ? '▲' : '▼'}</span>}
          </button>

          {menuOpen && address && (
            <div className="wallet-dropdown">
              <div className="wallet-dropdown-header">
                <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '4px' }}>CONNECTED NODE</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', wordBreak: 'break-all' }}>{address}</div>
              </div>
              <div className="wallet-dropdown-divider"></div>
              <button className="wallet-dropdown-item" onClick={copyAddress}>
                <span className="wallet-dropdown-icon">[CPY]</span> {copied ? 'Copied!' : 'Copy Address'}
              </button>
              <button className="wallet-dropdown-item" onClick={() => { go('profile'); setMenuOpen(false) }}>
                <span className="wallet-dropdown-icon">[USR]</span> Profile Settings
              </button>
              <button className="wallet-dropdown-item" onClick={() => { window.open(`http://git.aiwork.network`, '_blank'); setMenuOpen(false) }}>
                <span className="wallet-dropdown-icon">[GIT]</span> Git Dashboard
              </button>
              <button className="wallet-dropdown-item" onClick={() => { switchNetwork(); setMenuOpen(false) }}>
                <span className="wallet-dropdown-icon">[NET]</span> Switch Network
              </button>
              <div className="wallet-dropdown-divider"></div>
              <button className="wallet-dropdown-item wallet-dropdown-danger" onClick={() => { disconnectWallet(); setMenuOpen(false); go('dashboard') }}>
                <span className="wallet-dropdown-icon">[END]</span> Disconnect Wallet
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
