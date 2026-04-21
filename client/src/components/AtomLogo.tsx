interface AtomLogoProps {
  size?: number;
  color?: string;
}

export function AtomLogo({ size = 24, color = "currentColor" }: AtomLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-label="Atom logo"
    >
      {/* Nucleus */}
      <circle cx="16" cy="16" r="3.5" fill={color} />
      {/* Orbital 1 */}
      <ellipse
        cx="16" cy="16"
        rx="13" ry="5.5"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        opacity="0.85"
      />
      {/* Orbital 2 — rotated 60° */}
      <ellipse
        cx="16" cy="16"
        rx="13" ry="5.5"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        opacity="0.85"
        transform="rotate(60 16 16)"
      />
      {/* Orbital 3 — rotated 120° */}
      <ellipse
        cx="16" cy="16"
        rx="13" ry="5.5"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        opacity="0.85"
        transform="rotate(120 16 16)"
      />
    </svg>
  );
}
