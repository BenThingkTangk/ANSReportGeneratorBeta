import * as React from 'react';

type PhysioPSPulseNodeLogoProps = React.SVGProps<SVGSVGElement> & {
  title?: string;
  variant?: 'primary' | 'markOnly' | 'monochrome';
};

export function PhysioPSPulseNodeLogo({
  title = 'PhysioPS Pulse Node',
  variant = 'primary',
  ...props
}: PhysioPSPulseNodeLogoProps) {
  const titleId = React.useId();
  const uid = React.useId().replace(/:/g, '');
  const bgId = `${uid}-physiops-bg`;
  const nodeId = `${uid}-physiops-node`;
  const traceId = `${uid}-physiops-trace`;
  const isMono = variant === 'monochrome';
  const showContainer = variant !== 'markOnly';

  return (
    <svg
      viewBox="0 0 512 512"
      role="img"
      aria-labelledby={titleId}
      className="physiops-pulse-node"
      {...props}
    >
      <title id={titleId}>{title}</title>
      <defs>
        <radialGradient id={bgId} cx="48%" cy="48%" r="64%">
          <stop offset="0%" stopColor="#0D1B2A" />
          <stop offset="62%" stopColor="#030B14" />
          <stop offset="100%" stopColor="#020812" />
        </radialGradient>
        <radialGradient id={nodeId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F0F4F8" />
          <stop offset="24%" stopColor="#7CFFD8" />
          <stop offset="62%" stopColor="#00E5A0" />
          <stop offset="100%" stopColor="#4A9EFF" />
        </radialGradient>
        <linearGradient id={traceId} x1="172" y1="256" x2="426" y2="256" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00E5A0" />
          <stop offset="55%" stopColor="#A855F7" />
          <stop offset="100%" stopColor="#4A9EFF" />
        </linearGradient>
      </defs>
      {showContainer && <rect width="512" height="512" rx="112" fill={isMono ? '#030B14' : `url(#${bgId})`} />}
      <circle data-ring cx="180" cy="256" r="106" fill="none" stroke={isMono ? 'currentColor' : '#4A9EFF'} strokeOpacity=".22" strokeWidth="3" strokeDasharray="10 18" />
      <circle cx="180" cy="256" r="72" fill="none" stroke={isMono ? 'currentColor' : '#00E5A0'} strokeOpacity=".55" strokeWidth="4" />
      <circle data-node-core cx="180" cy="256" r="39" fill={isMono ? 'currentColor' : `url(#${nodeId})`} />
      <path data-ecg d="M180 256 H232 L246 224 L268 304 L292 194 L318 256 H426" fill="none" stroke={isMono ? 'currentColor' : `url(#${traceId})`} strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
      {!isMono && <path d="M180 256 H232 L246 224 L268 304 L292 194 L318 256 H426" fill="none" stroke="#F0F4F8" strokeOpacity=".35" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}
