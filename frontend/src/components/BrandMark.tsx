export default function BrandMark({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return (
    <span className={`brand-mark ${compact ? 'brand-mark-compact' : ''} ${className}`.trim()}>
      <svg className="brand-symbol" viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="collagent-arc" x1="10" y1="9" x2="49" y2="56" gradientUnits="userSpaceOnUse">
            <stop stopColor="#b9ff66" />
            <stop offset="0.55" stopColor="#62e5ff" />
            <stop offset="1" stopColor="#9c8cff" />
          </linearGradient>
          <linearGradient id="collagent-path" x1="27" y1="32" x2="53" y2="32" gradientUnits="userSpaceOnUse">
            <stop stopColor="#edf6f0" />
            <stop offset="1" stopColor="#b9ff66" />
          </linearGradient>
        </defs>
        <path d="M46 13.5A23 23 0 1 0 46 50.5" fill="none" stroke="url(#collagent-arc)" strokeWidth="6" strokeLinecap="round" />
        <path d="M27 32H52" fill="none" stroke="url(#collagent-path)" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="52" cy="32" r="5" fill="#b9ff66" />
      </svg>
      <span className="brand-wordmark" aria-label="Collagent">
        <span>coll</span><span className="brand-wordmark-accent">agent</span>
      </span>
      {!compact && <span className="brand-descriptor">problem protocol</span>}
    </span>
  )
}
