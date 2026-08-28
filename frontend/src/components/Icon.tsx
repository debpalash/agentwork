import type { ReactNode } from 'react'

export type IconName =
  | 'activity' | 'agents' | 'award' | 'check' | 'code' | 'copy' | 'credit'
  | 'dashboard' | 'disconnect' | 'disputes' | 'docs' | 'evidence' | 'funding'
  | 'network' | 'post' | 'problems' | 'profile' | 'repository' | 'review'
  | 'tasks' | 'warning' | 'wallet' | 'workstream'

const paths: Record<IconName, ReactNode> = {
  problems: <><circle cx="7" cy="7" r="2" /><circle cx="17" cy="6" r="2" /><circle cx="12" cy="17" r="2" /><path d="m8.7 8.1 2.2 6.8m4.3-7.2-2.1 7.4M9 7h6" /></>,
  dashboard: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
  tasks: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="m4 6 .8.8L6.5 5M4 12l.8.8L6.5 11M4 18l.8.8 1.7-1.8" /></>,
  agents: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3.5 20c.4-4 2.2-6 5.5-6s5.1 2 5.5 6M14 15c3.8-.5 6 1.2 6.5 5" /></>,
  post: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 8v8M8 12h8" /></>,
  docs: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></>,
  disputes: <><path d="M12 3 5 6v5c0 4.6 2.7 8 7 10 4.3-2 7-5.4 7-10V6z" /><path d="M12 8v5M12 17h.01" /></>,
  activity: <><path d="M4 12h4l2-6 4 12 2-6h4" /></>,
  award: <><circle cx="12" cy="9" r="5" /><path d="m9 14-1 7 4-2 4 2-1-7" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  code: <><path d="m9 6-6 6 6 6M15 6l6 6-6 6" /><path d="m14 4-4 16" /></>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="1" /><path d="M16 8V5H5v11h3" /></>,
  credit: <><circle cx="12" cy="12" r="8" /><path d="M8 12h8M12 8v8" /></>,
  disconnect: <><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" /></>,
  evidence: <><path d="M5 4h10l4 4v12H5z" /><path d="M15 4v5h4M8 13l2 2 5-5" /></>,
  funding: <><circle cx="12" cy="12" r="8" /><path d="M15 8.5c-.7-.7-1.7-1-3-1-1.7 0-3 .8-3 2s1 1.8 3 2 3 1 3 2.2-1.3 2.3-3 2.3c-1.3 0-2.5-.4-3.3-1.2M12 5v14" /></>,
  network: <><circle cx="6" cy="12" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="m8 11 8-4M8 13l8 4" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M5 21c.5-5 2.8-7 7-7s6.5 2 7 7" /></>,
  repository: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M8 4v16M11 8h5" /></>,
  review: <><path d="M4 5h16v12H9l-5 4z" /><path d="m8 11 2 2 5-5" /></>,
  warning: <><path d="M12 3 2.8 20h18.4z" /><path d="M12 9v5M12 17h.01" /></>,
  wallet: <><path d="M4 6h14a2 2 0 0 1 2 2v10H4z" /><path d="M4 6V4h12v2M15 11h5v4h-5a2 2 0 0 1 0-4z" /></>,
  workstream: <><path d="M4 6h6v5H4zM14 13h6v5h-6z" /><path d="M10 8.5h4a3 3 0 0 1 3 3V13" /></>,
}

interface IconProps {
  name: IconName
  className?: string
  size?: number
  label?: string
}

export default function Icon({ name, className = 'ui-icon', size = 20, label }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {paths[name]}
    </svg>
  )
}
