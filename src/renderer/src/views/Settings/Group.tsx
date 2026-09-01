export function Group({
  label,
  first,
  children
}: {
  label: string
  first?: boolean
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section>
      {!first && <div className="my-[16px] h-px" style={{ background: 'var(--line)' }} />}

      <div className="section-label mb-[8px]">{label}</div>

      {children}
    </section>
  )
}
