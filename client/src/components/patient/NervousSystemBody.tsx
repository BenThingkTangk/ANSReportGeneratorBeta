import { useRef, useState, useMemo, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

/**
 * NeuralOrb — a calm, cinematic visualization of the autonomic nervous system.
 *
 * Two intertwined helical strands of nerve nodes orbit a central core:
 *   - Sympathetic strand   → warm amber  (fight / flight)
 *   - Parasympathetic strand → cool teal (rest / digest)
 *
 * The relative density / brightness of each strand reflects the patient's
 * sympathetic vs parasympathetic balance. Soft signal pulses travel along
 * each strand. Drag to rotate. Click a strand to see what it does.
 *
 * Component name preserved for backwards compatibility with imports.
 */

interface Props {
  sympathetic: number;        // 0..100 (decorative animation input)
  parasympathetic: number;    // 0..100 (decorative animation input)
  /**
   * When false, the spectral sympathetic/parasympathetic split is NOT assessed
   * for this recording. The 3D helix still animates (neutral), but the legend
   * must show "Not assessed" instead of fabricated numeric percentages.
   */
  available?: boolean;
  hotspots?: string[];        // ignored — kept for API compatibility
}

type BranchKey = "sympathetic" | "parasympathetic" | "core";

interface BranchInfo {
  title: string;
  ans: string;
  role: string;
  bullets: string[];
  accent: string;
}

const BRANCH_INFO: Record<BranchKey, BranchInfo> = {
  sympathetic: {
    title: "Sympathetic Branch",
    ans: "Fight or flight",
    role: "Mobilizes energy. Raises heart rate, dilates pupils, redirects blood to muscles, sharpens focus, suppresses digestion.",
    bullets: [
      "Activated by stress, exercise, novelty",
      "Norepinephrine is the primary messenger",
      "Excess over time → tension, poor sleep, anxiety",
    ],
    accent: "#ff6b35",
  },
  parasympathetic: {
    title: "Parasympathetic Branch",
    ans: "Rest, digest, heal",
    role: "Restores the body. Slows heart rate, deepens breathing, drives digestion and tissue repair, calms the mind.",
    bullets: [
      "Vagus nerve carries most of its signal",
      "Acetylcholine is the primary messenger",
      "Healthy tone → fast recovery, calm baseline",
    ],
    accent: "#00e5ff",
  },
  core: {
    title: "Autonomic Core",
    ans: "Brainstem control center",
    role: "The medulla and hypothalamus continuously balance both branches in response to your environment, posture, breath, and emotion.",
    bullets: [
      "Balance = adaptability, not stillness",
      "HRV reflects how nimbly the core switches branches",
      "Trainable through breath, movement, and recovery",
    ],
    accent: "#a78bfa",
  },
};

// ---- Helix strand --------------------------------------------------------

function helixPoints(
  count: number,
  radius: number,
  height: number,
  turns: number,
  phase: number
): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const angle = t * Math.PI * 2 * turns + phase;
    const y = (t - 0.5) * height;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    pts.push(new THREE.Vector3(x, y, z));
  }
  return pts;
}

interface StrandProps {
  branch: "sympathetic" | "parasympathetic";
  intensity: number; // 0..1
  phase: number;
  color: THREE.Color;
  onClick: () => void;
  onHoverChange: (hovered: boolean) => void;
}

function HelixStrand({
  branch,
  intensity,
  phase,
  color,
  onClick,
  onHoverChange,
}: StrandProps) {
  const NODES = 56;
  const RADIUS = 1.55;
  const HEIGHT = 4.6;
  const TURNS = 2.2;

  const points = useMemo(
    () => helixPoints(NODES, RADIUS, HEIGHT, TURNS, phase),
    [phase]
  );

  // Smooth tube backbone
  const tubeGeom = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.3);
    return new THREE.TubeGeometry(curve, 240, 0.018, 8, false);
  }, [points]);

  const tubeGlowGeom = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.3);
    return new THREE.TubeGeometry(curve, 240, 0.05, 8, false);
  }, [points]);

  const groupRef = useRef<THREE.Group>(null!);
  const pulseRefs = useRef<THREE.Mesh[]>([]);
  const nodeRefs = useRef<THREE.Mesh[]>([]);

  // 3 pulses per strand, evenly spaced, scaled in brightness by intensity
  const pulseCount = 3;
  const speed = 0.06 + intensity * 0.05; // sympathetic faster when dominant

  useFrame((state) => {
    const elapsed = state.clock.getElapsedTime();
    const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.3);

    // Move pulses along the curve
    for (let i = 0; i < pulseCount; i++) {
      const mesh = pulseRefs.current[i];
      if (!mesh) continue;
      const t = ((elapsed * speed + i / pulseCount) % 1);
      const p = curve.getPoint(t);
      mesh.position.copy(p);
      // Subtle scale breathing
      const breath = 0.85 + Math.sin(elapsed * 2 + i) * 0.15;
      const s = (0.07 + intensity * 0.04) * breath;
      mesh.scale.set(s, s, s);
    }

    // Soft node breathing
    for (let i = 0; i < nodeRefs.current.length; i++) {
      const m = nodeRefs.current[i];
      if (!m) continue;
      const phaseOff = i * 0.2;
      const breath = 0.7 + Math.sin(elapsed * 1.1 + phaseOff) * 0.3;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = (0.4 + intensity * 0.5) * breath;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Outer glow tube */}
      <mesh geometry={tubeGlowGeom}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.10 + intensity * 0.18}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Inner solid tube — clickable */}
      <mesh
        geometry={tubeGeom}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHoverChange(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHoverChange(false);
          document.body.style.cursor = "default";
        }}
      >
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.55 + intensity * 0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Nerve nodes along the strand */}
      {points
        .filter((_, i) => i % 3 === 0)
        .map((p, i) => (
          <mesh
            key={`node-${branch}-${i}`}
            ref={(m) => {
              if (m) nodeRefs.current[i] = m;
            }}
            position={p}
          >
            <sphereGeometry args={[0.04, 12, 12]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.6}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        ))}

      {/* Travelling signal pulses */}
      {Array.from({ length: pulseCount }).map((_, i) => (
        <mesh
          key={`pulse-${branch}-${i}`}
          ref={(m) => {
            if (m) pulseRefs.current[i] = m;
          }}
        >
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.55 + intensity * 0.4}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// ---- Central core --------------------------------------------------------

function Core({
  intensity,
  onClick,
  onHoverChange,
}: {
  intensity: number;
  onClick: () => void;
  onHoverChange: (hovered: boolean) => void;
}) {
  const ringRef = useRef<THREE.Mesh>(null!);
  const innerRef = useRef<THREE.Mesh>(null!);
  const haloRef = useRef<THREE.Mesh>(null!);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.18;
      ringRef.current.rotation.x = Math.sin(t * 0.3) * 0.4;
    }
    if (innerRef.current) {
      const breath = 0.92 + Math.sin(t * 1.4) * 0.08;
      innerRef.current.scale.set(breath, breath, breath);
    }
    if (haloRef.current) {
      const mat = haloRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.18 + Math.sin(t * 1.4) * 0.06 + intensity * 0.05;
    }
  });

  const coreColor = new THREE.Color("#a78bfa");

  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHoverChange(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        onHoverChange(false);
        document.body.style.cursor = "default";
      }}
    >
      {/* Halo */}
      <mesh ref={haloRef}>
        <sphereGeometry args={[0.55, 32, 32]} />
        <meshBasicMaterial
          color={coreColor}
          transparent
          opacity={0.22}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Inner sphere */}
      <mesh ref={innerRef}>
        <sphereGeometry args={[0.32, 32, 32]} />
        <meshBasicMaterial
          color={coreColor}
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Slowly tilting torus ring */}
      <mesh ref={ringRef}>
        <torusGeometry args={[0.62, 0.012, 12, 80]} />
        <meshBasicMaterial
          color={coreColor}
          transparent
          opacity={0.7}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// ---- Star particles for atmosphere --------------------------------------

function StarField() {
  const ref = useRef<THREE.Points>(null!);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const N = 240;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 4 + Math.random() * 4;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.getElapsedTime() * 0.02;
    }
  });

  return (
    <points ref={ref} geometry={geom}>
      <pointsMaterial
        size={0.02}
        color={new THREE.Color("#6eeeff")}
        transparent
        opacity={0.45}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

// ---- Auto rotate ---------------------------------------------------------

function AutoRotate({ enabled }: { enabled: boolean }) {
  const ref = useRef<THREE.Group>(null!);
  useFrame((_, delta) => {
    if (enabled && ref.current) {
      ref.current.rotation.y += delta * 0.16;
    }
  });
  return <group ref={ref} />;
}

// ---- Scene wrapper -------------------------------------------------------

function Scene({
  symp,
  para,
  rotate,
  setSelected,
  setHovered,
}: {
  symp: number;
  para: number;
  rotate: boolean;
  setSelected: (b: BranchKey) => void;
  setHovered: (b: BranchKey | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null!);

  useFrame((_, delta) => {
    if (rotate && groupRef.current) {
      groupRef.current.rotation.y += delta * 0.15;
    }
  });

  const sympColor = new THREE.Color("#ff6b35");
  const paraColor = new THREE.Color("#00e5ff");

  return (
    <group ref={groupRef}>
      <StarField />
      <Core
        intensity={(symp + para) / 200}
        onClick={() => setSelected("core")}
        onHoverChange={(h) => setHovered(h ? "core" : null)}
      />
      <HelixStrand
        branch="sympathetic"
        intensity={symp / 100}
        phase={0}
        color={sympColor}
        onClick={() => setSelected("sympathetic")}
        onHoverChange={(h) => setHovered(h ? "sympathetic" : null)}
      />
      <HelixStrand
        branch="parasympathetic"
        intensity={para / 100}
        phase={Math.PI}
        color={paraColor}
        onClick={() => setSelected("parasympathetic")}
        onHoverChange={(h) => setHovered(h ? "parasympathetic" : null)}
      />
    </group>
  );
}

// ---- Public component ----------------------------------------------------

export function NervousSystemBody({ sympathetic, parasympathetic, available = true }: Props) {
  const [selected, setSelected] = useState<BranchKey | null>(null);
  const [hovered, setHovered] = useState<BranchKey | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);

  const symp = Math.max(0, Math.min(100, sympathetic));
  const para = Math.max(0, Math.min(100, parasympathetic));

  return (
    <div
      className="relative w-full"
      style={{ height: 380 }}
      onPointerDown={() => setAutoRotate(false)}
    >
      <Canvas
        camera={{ position: [0, 0, 6.2], fov: 38 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.6} />
          <Scene
            symp={symp}
            para={para}
            rotate={autoRotate}
            setSelected={(b) => setSelected(b)}
            setHovered={setHovered}
          />
          <OrbitControls
            enablePan={false}
            enableZoom={false}
            minDistance={5.5}
            maxDistance={7}
            minPolarAngle={Math.PI * 0.25}
            maxPolarAngle={Math.PI * 0.75}
          />
        </Suspense>
      </Canvas>

      {/* Hover label */}
      {hovered && !selected && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide pointer-events-none"
          style={{
            background: "hsl(220 30% 6% / 0.7)",
            border: `1px solid ${BRANCH_INFO[hovered].accent}`,
            color: BRANCH_INFO[hovered].accent,
            backdropFilter: "blur(8px)",
          }}
        >
          {BRANCH_INFO[hovered].title} · click for details
        </div>
      )}

      {/* Legend */}
      {available ? (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-3 text-[10px] font-medium pointer-events-none">
          <div className="flex items-center gap-1.5" style={{ color: "#ff8c5e" }}>
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#ff6b35", boxShadow: "0 0 8px #ff6b35" }} />
            Sympathetic {Math.round(symp)}
          </div>
          <span className="text-white/30">·</span>
          <div className="flex items-center gap-1.5" style={{ color: "#5ef0ff" }}>
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#00e5ff", boxShadow: "0 0 8px #00e5ff" }} />
            Parasympathetic {Math.round(para)}
          </div>
        </div>
      ) : (
        <div
          className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2 text-[10px] font-medium text-white/60 pointer-events-none"
          data-testid="nsb-not-assessed"
        >
          <span>Sympathetic / parasympathetic balance:</span>
          <span className="text-white/80">Not assessed</span>
        </div>
      )}

      {/* Hint */}
      <div className="absolute top-2 right-3 text-[10px] text-white/40 pointer-events-none">
        drag to rotate · click strands
      </div>

      {/* Detail popup */}
      {selected && (
        <div
          className="absolute inset-x-3 bottom-3 rounded-2xl p-4 z-10"
          style={{
            background: "hsl(220 30% 6% / 0.92)",
            border: `1px solid ${BRANCH_INFO[selected].accent}55`,
            boxShadow: `0 12px 40px hsl(220 30% 2% / 0.6), 0 0 22px ${BRANCH_INFO[selected].accent}22`,
            backdropFilter: "blur(14px)",
            animation: "ans-pop-in 220ms cubic-bezier(.2,.9,.3,1.1) both",
          }}
        >
          <style>{`
            @keyframes ans-pop-in {
              from { opacity: 0; transform: translateY(12px) scale(.97); }
              to   { opacity: 1; transform: translateY(0) scale(1); }
            }
          `}</style>
          <div className="flex items-start justify-between mb-2">
            <div>
              <div
                className="text-[10px] uppercase tracking-widest font-bold mb-0.5"
                style={{ color: BRANCH_INFO[selected].accent }}
              >
                {BRANCH_INFO[selected].ans}
              </div>
              <div className="text-base font-semibold text-white">
                {BRANCH_INFO[selected].title}
              </div>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="w-7 h-7 rounded-full flex items-center justify-center text-white/70 hover:text-white"
              style={{ background: "hsl(220 30% 12%)" }}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <p className="text-xs text-white/80 leading-relaxed mb-2">
            {BRANCH_INFO[selected].role}
          </p>
          <ul className="space-y-1">
            {BRANCH_INFO[selected].bullets.map((b, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-[11px] text-white/75 leading-snug"
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                  style={{ background: BRANCH_INFO[selected].accent }}
                />
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
