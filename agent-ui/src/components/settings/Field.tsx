import type { ReactNode } from 'react'

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block space-y-1.5">
    <span className="text-xs uppercase text-text-tertiary">{label}</span>
    {children}
  </label>
)

export default Field
