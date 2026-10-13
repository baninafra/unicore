export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 38 38" aria-hidden="true">
      <path d="M19 3l14 8v16l-14 8-14-8V11z" fill="none" stroke="var(--primary)" strokeWidth="2.8" strokeLinejoin="round" />
      <circle cx="19" cy="19" r="5.5" fill="var(--primary-soft)" />
    </svg>
  );
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-1.5">
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-[-0.02em]">UniCore</span>
    </div>
  );
}
