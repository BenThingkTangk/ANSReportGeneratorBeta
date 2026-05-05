import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

/**
 * NervousSystemBody — interactive 3D human silhouette with the
 * central + peripheral nervous system rendered as glowing tubes.
 *
 * Electrical "spark" markers travel along each pathway. Parts of
 * the system that are out of balance light brighter (red/magenta
 * for sympathetic excess, cyan for parasympathetic dominance).
 *
 * Drag to rotate, pinch/scroll to zoom.
 */

type Props = {
  sympathetic: number;        // 0..100
  parasympathetic: number;    // 0..100
  wellnessScore?: number;     // 0..100
  /** Indications mapped to body regions (heart, gut, head, lungs) — optional */
  hotspots?: { region: BodyRegion; intensity: number /* 0..1 */ }[];
};

type BodyRegion = "head" | "heart" | "lungs" | "gut" | "spine" | "armsL" | "armsR" | "legsL" | "legsR";

/* ---------- helpers ---------- */
const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

/* ---------- humanoid silhouette ---------- */
function BodyShell() {
  // Rough humanoid built from primitives. Keeps it lightweight and readable.
  // All meshes are translucent, used as a visual envelope.
  const mat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#82c9ff"),
        transparent: true,
        opacity: 0.06,
        roughness: 0.4,
        transmission: 0.85,
        thickness: 0.4,
        ior: 1.2,
        clearcoat: 0.4,
        clearcoatRoughness: 0.4,
      }),
    [],
  );
  const wire = useMemo(
    () => new THREE.LineBasicMaterial({ color: 0x55d8ff, transparent: true, opacity: 0.18 }),
    [],
  );
  return (
    <group>
      {/* Head */}
      <mesh position={[0, 3.05, 0]} material={mat}>
        <sphereGeometry args={[0.55, 32, 32]} />
      </mesh>
      <lineSegments position={[0, 3.05, 0]}>
        <edgesGeometry args={[new THREE.SphereGeometry(0.55, 16, 12)]} />
        <primitive object={wire} attach="material" />
      </lineSegments>

      {/* Neck */}
      <mesh position={[0, 2.45, 0]} material={mat}>
        <cylinderGeometry args={[0.18, 0.22, 0.45, 16]} />
      </mesh>

      {/* Torso */}
      <mesh position={[0, 1.4, 0]} material={mat}>
        <capsuleGeometry args={[0.78, 1.4, 8, 16]} />
      </mesh>
      <lineSegments position={[0, 1.4, 0]}>
        <edgesGeometry args={[new THREE.CapsuleGeometry(0.78, 1.4, 4, 12)]} />
        <primitive object={wire} attach="material" />
      </lineSegments>

      {/* Pelvis */}
      <mesh position={[0, 0.25, 0]} material={mat}>
        <capsuleGeometry args={[0.7, 0.55, 6, 12]} />
      </mesh>

      {/* Arms */}
      {[
        { x: -0.95, rot: 0.18 },
        { x: 0.95, rot: -0.18 },
      ].map((a, i) => (
        <group key={i} position={[a.x, 1.85, 0]} rotation={[0, 0, a.rot]}>
          <mesh material={mat} position={[0, -0.7, 0]}>
            <capsuleGeometry args={[0.16, 1.3, 6, 12]} />
          </mesh>
          <mesh material={mat} position={[0, -1.95, 0]}>
            <capsuleGeometry args={[0.13, 1.15, 6, 12]} />
          </mesh>
          <mesh material={mat} position={[0, -2.6, 0]}>
            <sphereGeometry args={[0.16, 12, 12]} />
          </mesh>
        </group>
      ))}

      {/* Legs */}
      {[
        { x: -0.32 },
        { x: 0.32 },
      ].map((l, i) => (
        <group key={i} position={[l.x, -0.15, 0]}>
          <mesh material={mat} position={[0, -0.85, 0]}>
            <capsuleGeometry args={[0.22, 1.5, 6, 12]} />
          </mesh>
          <mesh material={mat} position={[0, -2.25, 0]}>
            <capsuleGeometry args={[0.18, 1.3, 6, 12]} />
          </mesh>
          <mesh material={mat} position={[0, -3.05, 0.12]}>
            <boxGeometry args={[0.28, 0.16, 0.5]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ---------- nerve path ---------- */
type Pathway = {
  id: string;
  curve: THREE.CatmullRomCurve3;
  baseColor: THREE.Color;
  branch: "sympathetic" | "parasympathetic" | "central" | "peripheral";
  region: BodyRegion;
  width: number;
};

function buildPathways(): Pathway[] {
  const cyan = new THREE.Color("#3dd9ff");
  const magenta = new THREE.Color("#ff4ed1");
  const violet = new THREE.Color("#9a7dff");
  const amber = new THREE.Color("#ffaf52");

  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // Brain → spine → cauda equina (CNS spine cord)
  const spine = new THREE.CatmullRomCurve3([
    v(0, 3.1, 0.05),
    v(0, 2.8, 0.08),
    v(0, 2.4, 0.06),
    v(0, 1.9, 0.02),
    v(0, 1.3, -0.04),
    v(0, 0.6, -0.05),
    v(0, 0.0, -0.02),
  ]);

  // Vagus nerve — descending parasympathetic, neck → heart → lungs → gut
  const vagusL = new THREE.CatmullRomCurve3([
    v(-0.18, 2.8, 0.18),
    v(-0.22, 2.45, 0.22),
    v(-0.28, 2.05, 0.28),
    v(-0.22, 1.7, 0.32), // heart
    v(-0.12, 1.35, 0.34), // lungs
    v(-0.06, 1.0, 0.32),
    v(-0.02, 0.55, 0.28), // gut
  ]);
  const vagusR = new THREE.CatmullRomCurve3([
    v(0.18, 2.8, 0.18),
    v(0.22, 2.45, 0.22),
    v(0.28, 2.05, 0.28),
    v(0.22, 1.7, 0.32),
    v(0.12, 1.35, 0.34),
    v(0.06, 1.0, 0.32),
    v(0.02, 0.55, 0.28),
  ]);

  // Sympathetic chain ganglia — paravertebral, magenta
  const sympL = new THREE.CatmullRomCurve3([
    v(-0.18, 2.4, -0.12),
    v(-0.22, 2.0, -0.14),
    v(-0.24, 1.55, -0.16),
    v(-0.22, 1.1, -0.18),
    v(-0.18, 0.6, -0.18),
    v(-0.14, 0.1, -0.16),
    v(-0.1, -0.35, -0.12),
  ]);
  const sympR = new THREE.CatmullRomCurve3([
    v(0.18, 2.4, -0.12),
    v(0.22, 2.0, -0.14),
    v(0.24, 1.55, -0.16),
    v(0.22, 1.1, -0.18),
    v(0.18, 0.6, -0.18),
    v(0.14, 0.1, -0.16),
    v(0.1, -0.35, -0.12),
  ]);

  // Brachial plexus → arm L
  const armL = new THREE.CatmullRomCurve3([
    v(-0.25, 2.35, 0),
    v(-0.55, 2.15, -0.05),
    v(-0.9, 1.7, -0.08),
    v(-1.05, 1.05, -0.04),
    v(-1.12, 0.4, 0),
    v(-1.18, -0.25, 0),
  ]);
  // Brachial plexus → arm R
  const armR = new THREE.CatmullRomCurve3([
    v(0.25, 2.35, 0),
    v(0.55, 2.15, -0.05),
    v(0.9, 1.7, -0.08),
    v(1.05, 1.05, -0.04),
    v(1.12, 0.4, 0),
    v(1.18, -0.25, 0),
  ]);

  // Lumbar/sacral plexus → leg L
  const legL = new THREE.CatmullRomCurve3([
    v(-0.1, 0.1, -0.04),
    v(-0.25, -0.3, -0.03),
    v(-0.32, -0.95, -0.02),
    v(-0.34, -1.7, 0),
    v(-0.34, -2.4, 0.02),
    v(-0.32, -3.0, 0.06),
  ]);
  const legR = new THREE.CatmullRomCurve3([
    v(0.1, 0.1, -0.04),
    v(0.25, -0.3, -0.03),
    v(0.32, -0.95, -0.02),
    v(0.34, -1.7, 0),
    v(0.34, -2.4, 0.02),
    v(0.32, -3.0, 0.06),
  ]);

  // Cranial branches (face/skull)
  const cranialL = new THREE.CatmullRomCurve3([
    v(0, 3.1, 0.05),
    v(-0.2, 3.2, 0.25),
    v(-0.4, 3.0, 0.35),
    v(-0.45, 2.75, 0.4),
  ]);
  const cranialR = new THREE.CatmullRomCurve3([
    v(0, 3.1, 0.05),
    v(0.2, 3.2, 0.25),
    v(0.4, 3.0, 0.35),
    v(0.45, 2.75, 0.4),
  ]);

  return [
    { id: "spine",     curve: spine,    baseColor: violet,  branch: "central",         region: "spine", width: 0.045 },
    { id: "vagusL",    curve: vagusL,   baseColor: cyan,    branch: "parasympathetic", region: "heart", width: 0.028 },
    { id: "vagusR",    curve: vagusR,   baseColor: cyan,    branch: "parasympathetic", region: "lungs", width: 0.028 },
    { id: "sympL",     curve: sympL,    baseColor: magenta, branch: "sympathetic",     region: "spine", width: 0.024 },
    { id: "sympR",     curve: sympR,    baseColor: magenta, branch: "sympathetic",     region: "spine", width: 0.024 },
    { id: "armL",      curve: armL,     baseColor: amber,   branch: "peripheral",      region: "armsL", width: 0.022 },
    { id: "armR",      curve: armR,     baseColor: amber,   branch: "peripheral",      region: "armsR", width: 0.022 },
    { id: "legL",      curve: legL,     baseColor: amber,   branch: "peripheral",      region: "legsL", width: 0.024 },
    { id: "legR",      curve: legR,     baseColor: amber,   branch: "peripheral",      region: "legsR", width: 0.024 },
    { id: "cranialL",  curve: cranialL, baseColor: cyan,    branch: "parasympathetic", region: "head",  width: 0.018 },
    { id: "cranialR",  curve: cranialR, baseColor: cyan,    branch: "parasympathetic", region: "head",  width: 0.018 },
  ];
}

/* ---------- nerve tube + spark ---------- */
function NervePath({
  path,
  intensity,
  speed,
  hovered,
  onHover,
}: {
  path: Pathway;
  intensity: number; // 0..1
  speed: number;
  hovered: boolean;
  onHover: (id: string | null) => void;
}) {
  const sparkRef = useRef<THREE.Mesh>(null!);
  const tRef = useRef(Math.random()); // each spark starts at random t

  useFrame((_, dt) => {
    tRef.current = (tRef.current + dt * speed) % 1;
    if (sparkRef.current) {
      const p = path.curve.getPoint(tRef.current);
      sparkRef.current.position.copy(p);
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.006 + tRef.current * 6);
      const s = 0.06 + 0.05 * pulse * (0.5 + intensity);
      sparkRef.current.scale.setScalar(s);
    }
  });

  const tubeGeom = useMemo(
    () => new THREE.TubeGeometry(path.curve, 96, path.width * (hovered ? 1.6 : 1), 10, false),
    [path, hovered],
  );

  const tubeMat = useMemo(() => {
    const c = path.baseColor.clone();
    return new THREE.MeshBasicMaterial({
      color: c,
      transparent: true,
      opacity: 0.35 + intensity * 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, [path, intensity]);

  const haloMat = useMemo(() => {
    const c = path.baseColor.clone();
    return new THREE.MeshBasicMaterial({
      color: c,
      transparent: true,
      opacity: 0.08 + intensity * 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, [path, intensity]);

  const haloGeom = useMemo(
    () => new THREE.TubeGeometry(path.curve, 64, path.width * 3.2, 8, false),
    [path],
  );

  return (
    <group
      onPointerOver={(e) => { e.stopPropagation(); onHover(path.id); }}
      onPointerOut={(e) => { e.stopPropagation(); onHover(null); }}
    >
      <mesh geometry={haloGeom} material={haloMat} />
      <mesh geometry={tubeGeom} material={tubeMat} />
      {/* travelling spark */}
      <mesh ref={sparkRef}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial
          color={path.baseColor}
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/* ---------- highlight bloom blob at body region ---------- */
function RegionGlow({ pos, color, intensity }: { pos: [number, number, number]; color: string; intensity: number }) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((_, dt) => {
    const t = performance.now() * 0.002;
    const s = 0.7 + Math.sin(t * 1.6) * 0.1;
    if (ref.current) ref.current.scale.setScalar(s * (0.6 + intensity * 0.8));
  });
  return (
    <mesh ref={ref} position={pos}>
      <sphereGeometry args={[0.5, 24, 24]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.18 * intensity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

/* ---------- gentle auto-rotation while idle ---------- */
function Group3D({
  intensities,
  onHover,
  hovered,
  hotspots,
}: {
  intensities: Record<string, number>;
  onHover: (id: string | null) => void;
  hovered: string | null;
  hotspots: NonNullable<Props["hotspots"]>;
}) {
  const grp = useRef<THREE.Group>(null!);
  const [autoRot, setAutoRot] = useState(true);

  useFrame((_, dt) => {
    if (autoRot && grp.current) grp.current.rotation.y += dt * 0.18;
  });

  const paths = useMemo(buildPathways, []);

  return (
    <group
      ref={grp}
      onPointerDown={() => setAutoRot(false)}
    >
      <BodyShell />
      {paths.map((p) => {
        const inten = intensities[p.id] ?? 0.4;
        const speed = 0.18 + inten * 0.6;
        return (
          <NervePath
            key={p.id}
            path={p}
            intensity={inten}
            speed={speed}
            hovered={hovered === p.id}
            onHover={onHover}
          />
        );
      })}
      {hotspots.map((h, i) => (
        <RegionGlow
          key={i}
          pos={REGION_POS[h.region]}
          color={REGION_COLOR[h.region]}
          intensity={h.intensity}
        />
      ))}
    </group>
  );
}

const REGION_POS: Record<BodyRegion, [number, number, number]> = {
  head:  [0, 3.05, 0],
  heart: [-0.18, 1.7, 0.22],
  lungs: [0.18, 1.5, 0.2],
  gut:   [0, 0.6, 0.15],
  spine: [0, 1.4, -0.05],
  armsL: [-1.0, 1.0, 0],
  armsR: [1.0, 1.0, 0],
  legsL: [-0.32, -1.6, 0],
  legsR: [0.32, -1.6, 0],
};
const REGION_COLOR: Record<BodyRegion, string> = {
  head:  "#3dd9ff",
  heart: "#ff4ed1",
  lungs: "#3dd9ff",
  gut:   "#7afcc6",
  spine: "#9a7dff",
  armsL: "#ffaf52",
  armsR: "#ffaf52",
  legsL: "#ffaf52",
  legsR: "#ffaf52",
};

/* ---------- main component ---------- */
export function NervousSystemBody({ sympathetic, parasympathetic, wellnessScore = 76, hotspots }: Props) {
  const total = sympathetic + parasympathetic || 1;
  const sym = sympathetic / total;     // 0..1
  const para = parasympathetic / total; // 0..1
  const balance = clamp(1 - Math.abs(sym - para) * 2);

  // Per-pathway intensity derived from balance
  const intensities = useMemo<Record<string, number>>(() => ({
    spine:    0.55 + balance * 0.35,
    vagusL:   0.35 + para * 0.65,
    vagusR:   0.35 + para * 0.65,
    sympL:    0.25 + sym * 0.7,
    sympR:    0.25 + sym * 0.7,
    armL:     0.35 + sym * 0.4,
    armR:     0.35 + sym * 0.4,
    legL:     0.35 + sym * 0.4,
    legR:     0.35 + sym * 0.4,
    cranialL: 0.45 + para * 0.5,
    cranialR: 0.45 + para * 0.5,
  }), [sym, para, balance]);

  const computedHotspots = useMemo<NonNullable<Props["hotspots"]>>(() => {
    if (hotspots && hotspots.length) return hotspots;
    // Default: heart/lungs glow with vagus, gut with parasympathetic, spine always
    const arr: NonNullable<Props["hotspots"]> = [
      { region: "heart", intensity: clamp(para * 1.2) },
      { region: "lungs", intensity: clamp(para * 1.0) },
      { region: "gut",   intensity: clamp(para * 0.8) },
      { region: "head",  intensity: clamp(0.4 + balance * 0.5) },
      { region: "spine", intensity: clamp(sym * 1.1) },
    ];
    return arr;
  }, [para, sym, balance, hotspots]);

  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="relative w-full" style={{ aspectRatio: "1 / 1.15", maxWidth: 460, margin: "0 auto" }}>
      <Canvas
        camera={{ position: [0, 0.6, 6.5], fov: 38 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ background: "transparent" }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[3, 5, 4]} intensity={0.6} color={"#9bd9ff"} />
        <directionalLight position={[-3, -2, -3]} intensity={0.35} color={"#ff8be0"} />
        <Suspense fallback={null}>
          <Group3D
            intensities={intensities}
            onHover={setHovered}
            hovered={hovered}
            hotspots={computedHotspots}
          />
        </Suspense>
        <OrbitControls
          enablePan={false}
          enableZoom
          minDistance={4.5}
          maxDistance={9}
          minPolarAngle={Math.PI * 0.18}
          maxPolarAngle={Math.PI * 0.82}
          rotateSpeed={0.85}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>

      {/* Score overlay (top-left) */}
      <div className="pointer-events-none absolute top-3 left-3 select-none">
        <div className="text-[10px] uppercase tracking-[0.2em] text-cyan/80">Live</div>
        <div className="ps-text-mono text-[28px] font-bold leading-none" style={{ textShadow: "0 0 18px hsl(185 95% 60% / 0.6)" }}>
          {Math.round(wellnessScore)}
        </div>
        <div className="text-[10px] text-white/60">ANS Score</div>
      </div>

      {/* Legend (bottom) */}
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-4 text-[10px] uppercase tracking-[0.15em]">
        <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full" style={{ background: "#3dd9ff", boxShadow: "0 0 8px #3dd9ff" }} /> Vagus</span>
        <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full" style={{ background: "#ff4ed1", boxShadow: "0 0 8px #ff4ed1" }} /> Sympathetic</span>
        <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full" style={{ background: "#9a7dff", boxShadow: "0 0 8px #9a7dff" }} /> Spine</span>
      </div>

      {/* Hover tooltip */}
      {hovered && (
        <div className="pointer-events-none absolute top-3 right-3 px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider" style={{ background: "hsl(220 30% 6% / 0.85)", border: "1px solid hsl(185 95% 60% / 0.4)", color: "hsl(185 95% 75%)" }}>
          {LABELS[hovered] ?? hovered}
        </div>
      )}

      {/* Hint */}
      <div className="pointer-events-none absolute bottom-9 right-3 text-[9px] uppercase tracking-[0.18em] text-white/40">
        Drag to rotate · Scroll to zoom
      </div>
    </div>
  );
}

const LABELS: Record<string, string> = {
  spine: "Spinal Cord (CNS)",
  vagusL: "Vagus Nerve · Left",
  vagusR: "Vagus Nerve · Right",
  sympL: "Sympathetic Chain · L",
  sympR: "Sympathetic Chain · R",
  armL: "Brachial Plexus · L",
  armR: "Brachial Plexus · R",
  legL: "Sacral Plexus · L",
  legR: "Sacral Plexus · R",
  cranialL: "Cranial Nerves · L",
  cranialR: "Cranial Nerves · R",
};
