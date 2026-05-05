import { Suspense, useMemo, useRef, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

/**
 * NervousSystemBody — sleek exoskeleton with dense nerve network and
 * white-electric flashes that crackle along pathways and dissipate.
 *
 * Drag to rotate, scroll/pinch to zoom.
 */

type Props = {
  sympathetic: number;
  parasympathetic: number;
  wellnessScore?: number;
  hotspots?: { region: BodyRegion; intensity: number }[];
};

type BodyRegion =
  | "head" | "heart" | "lungs" | "gut" | "spine"
  | "armsL" | "armsR" | "legsL" | "legsR";

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

/* ---------- Sleek wireframe exoskeleton ---------- */
function ExoSkeleton() {
  const lineMat = useMemo(
    () => new THREE.LineBasicMaterial({
      color: 0x88e6ff,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    []
  );
  const dimMat = useMemo(
    () => new THREE.LineBasicMaterial({
      color: 0x4ab8d9,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    []
  );

  // Helper: build a line geometry from points
  const buildLine = (pts: THREE.Vector3[]) => {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return g;
  };

  // Slim humanoid silhouette — drawn with thin contour lines, no chunky meshes
  const lines = useMemo(() => {
    const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

    // Head — narrow ellipse, 3 axes
    const head = (rx = 0.32, ry = 0.42, segs = 36) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const t = (i / segs) * Math.PI * 2;
        pts.push(v(Math.cos(t) * rx, 3.05 + Math.sin(t) * ry, 0));
      }
      return pts;
    };
    const headSide = (segs = 36) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const t = (i / segs) * Math.PI * 2;
        pts.push(v(0, 3.05 + Math.sin(t) * 0.42, Math.cos(t) * 0.34));
      }
      return pts;
    };
    const headTop = (segs = 36) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const t = (i / segs) * Math.PI * 2;
        pts.push(v(Math.cos(t) * 0.32, 3.4, Math.sin(t) * 0.34));
      }
      return pts;
    };

    // Neck
    const neckL = [v(-0.1, 2.7), v(-0.13, 2.5), v(-0.17, 2.35)];
    const neckR = [v(0.1, 2.7), v(0.13, 2.5), v(0.17, 2.35)];

    // Torso silhouette (front)
    const shoulderToHipL = [
      v(-0.55, 2.32), v(-0.65, 2.15), v(-0.7, 1.85),
      v(-0.6, 1.45), v(-0.5, 1.05), v(-0.45, 0.6),
      v(-0.42, 0.2),
    ];
    const shoulderToHipR = shoulderToHipL.map((p) => v(-p.x, p.y, p.z));
    // Shoulders across
    const shoulderLine = [v(-0.55, 2.32), v(0.55, 2.32)];
    // Hipline
    const hipLine = [v(-0.42, 0.2), v(0.42, 0.2)];
    // Sternum line
    const sternum = [v(0, 2.3), v(0, 2.0), v(0, 1.6), v(0, 1.2)];
    // Ribcage hint (3 horizontal arcs)
    const rib = (y: number, r: number, segs = 24) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const t = -Math.PI * 0.15 + (i / segs) * Math.PI * 1.3;
        pts.push(v(Math.cos(t) * r, y, Math.sin(t) * r * 0.55));
      }
      return pts;
    };
    const ribs = [
      rib(2.05, 0.62), rib(1.85, 0.66), rib(1.65, 0.66),
      rib(1.45, 0.6), rib(1.25, 0.55),
    ];
    // Pelvis arc
    const pelvis = (() => {
      const pts: THREE.Vector3[] = [];
      const segs = 22;
      for (let i = 0; i <= segs; i++) {
        const t = Math.PI + (i / segs) * Math.PI;
        pts.push(v(Math.cos(t) * 0.42, 0.05 + Math.sin(t) * 0.18, 0));
      }
      return pts;
    })();

    // Arms — single line per arm, both sides + back hint
    const armL = [
      v(-0.55, 2.3), v(-0.85, 2.05), v(-1.05, 1.55),
      v(-1.15, 1.05), v(-1.2, 0.55), v(-1.22, 0.05),
    ];
    const armR = armL.map((p) => v(-p.x, p.y, p.z));
    const armLBack = armL.map((p) => v(p.x - 0.04, p.y, p.z - 0.06));
    const armRBack = armR.map((p) => v(p.x + 0.04, p.y, p.z - 0.06));
    // Hand tips
    const handL = [v(-1.22, 0.05), v(-1.28, -0.18), v(-1.3, -0.32)];
    const handR = handL.map((p) => v(-p.x, p.y, p.z));

    // Legs
    const legL = [
      v(-0.22, 0.15), v(-0.28, -0.4), v(-0.32, -1.05),
      v(-0.34, -1.7), v(-0.34, -2.4), v(-0.32, -3.05),
    ];
    const legR = legL.map((p) => v(-p.x, p.y, p.z));
    const legLOuter = legL.map((p) => v(p.x - 0.12, p.y, p.z));
    const legROuter = legR.map((p) => v(p.x + 0.12, p.y, p.z));
    // Feet
    const footL = [v(-0.32, -3.05), v(-0.45, -3.1, 0.2), v(-0.18, -3.12, 0.3)];
    const footR = footL.map((p) => v(-p.x, p.y, p.z));

    return {
      bright: [
        head(),
        headSide(),
        headTop(),
        neckL,
        neckR,
        shoulderToHipL,
        shoulderToHipR,
        shoulderLine,
        hipLine,
        sternum,
        ...ribs,
        pelvis,
        armL,
        armR,
        handL,
        handR,
        legL,
        legR,
        footL,
        footR,
      ],
      dim: [armLBack, armRBack, legLOuter, legROuter],
    };
  }, []);

  return (
    <group>
      {lines.bright.map((pts, i) => (
        <line key={`b${i}`} geometry={buildLine(pts)} material={lineMat} />
      ))}
      {lines.dim.map((pts, i) => (
        <line key={`d${i}`} geometry={buildLine(pts)} material={dimMat} />
      ))}
    </group>
  );
}

/* ---------- nerve pathways ---------- */
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
  const green = new THREE.Color("#7afcc6");

  const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

  // Spine (CNS core)
  const spine = new THREE.CatmullRomCurve3([
    v(0, 3.1, 0.05), v(0, 2.8, 0.06), v(0, 2.4, 0.04),
    v(0, 1.9, 0.0), v(0, 1.3, -0.04), v(0, 0.6, -0.05),
    v(0, 0.0, -0.02),
  ]);

  // Vagus L/R — cyan parasympathetic
  const vagusL = new THREE.CatmullRomCurve3([
    v(-0.1, 2.85, 0.16), v(-0.18, 2.5, 0.2), v(-0.24, 2.05, 0.24),
    v(-0.22, 1.7, 0.26), v(-0.14, 1.35, 0.28), v(-0.08, 0.95, 0.26),
    v(-0.04, 0.55, 0.22),
  ]);
  const vagusR = new THREE.CatmullRomCurve3([
    v(0.1, 2.85, 0.16), v(0.18, 2.5, 0.2), v(0.24, 2.05, 0.24),
    v(0.22, 1.7, 0.26), v(0.14, 1.35, 0.28), v(0.08, 0.95, 0.26),
    v(0.04, 0.55, 0.22),
  ]);

  // Sympathetic chain L/R — magenta
  const sympL = new THREE.CatmullRomCurve3([
    v(-0.12, 2.4, -0.08), v(-0.16, 2.0, -0.1), v(-0.18, 1.55, -0.12),
    v(-0.18, 1.1, -0.14), v(-0.16, 0.6, -0.14), v(-0.12, 0.1, -0.12),
    v(-0.08, -0.3, -0.1),
  ]);
  const sympR = new THREE.CatmullRomCurve3([
    v(0.12, 2.4, -0.08), v(0.16, 2.0, -0.1), v(0.18, 1.55, -0.12),
    v(0.18, 1.1, -0.14), v(0.16, 0.6, -0.14), v(0.12, 0.1, -0.12),
    v(0.08, -0.3, -0.1),
  ]);

  // Brachial plexus → arms
  const armL = new THREE.CatmullRomCurve3([
    v(-0.18, 2.32, 0), v(-0.5, 2.15, -0.04), v(-0.9, 1.6, -0.06),
    v(-1.05, 1.05, -0.04), v(-1.13, 0.5, 0), v(-1.18, -0.05, 0),
  ]);
  const armR = new THREE.CatmullRomCurve3([
    v(0.18, 2.32, 0), v(0.5, 2.15, -0.04), v(0.9, 1.6, -0.06),
    v(1.05, 1.05, -0.04), v(1.13, 0.5, 0), v(1.18, -0.05, 0),
  ]);

  // Lumbar/sacral plexus → legs
  const legL = new THREE.CatmullRomCurve3([
    v(-0.06, 0.1, -0.02), v(-0.2, -0.25, -0.02), v(-0.28, -0.9, 0),
    v(-0.3, -1.6, 0.02), v(-0.3, -2.3, 0.04), v(-0.3, -2.95, 0.08),
  ]);
  const legR = new THREE.CatmullRomCurve3([
    v(0.06, 0.1, -0.02), v(0.2, -0.25, -0.02), v(0.28, -0.9, 0),
    v(0.3, -1.6, 0.02), v(0.3, -2.3, 0.04), v(0.3, -2.95, 0.08),
  ]);

  // Cranial branches
  const cranialL = new THREE.CatmullRomCurve3([
    v(0, 3.1, 0.05), v(-0.15, 3.2, 0.2), v(-0.28, 3.0, 0.3),
    v(-0.32, 2.75, 0.32),
  ]);
  const cranialR = new THREE.CatmullRomCurve3([
    v(0, 3.1, 0.05), v(0.15, 3.2, 0.2), v(0.28, 3.0, 0.3),
    v(0.32, 2.75, 0.32),
  ]);

  // Peripheral fine branches — secondary mesh of fibers
  const radialL = new THREE.CatmullRomCurve3([
    v(-0.5, 2.0, 0.04), v(-0.7, 1.6, 0.06), v(-0.95, 1.1, 0.04),
    v(-1.05, 0.7, 0.02),
  ]);
  const radialR = new THREE.CatmullRomCurve3(
    radialL.points.map((p) => new THREE.Vector3(-p.x, p.y, p.z)),
  );
  const intercostalL = new THREE.CatmullRomCurve3([
    v(-0.05, 1.85, -0.04), v(-0.3, 1.78, 0.1), v(-0.5, 1.7, 0.18),
  ]);
  const intercostalR = new THREE.CatmullRomCurve3([
    v(0.05, 1.85, -0.04), v(0.3, 1.78, 0.1), v(0.5, 1.7, 0.18),
  ]);
  const intercostalL2 = new THREE.CatmullRomCurve3([
    v(-0.05, 1.55, -0.04), v(-0.3, 1.5, 0.12), v(-0.55, 1.45, 0.18),
  ]);
  const intercostalR2 = new THREE.CatmullRomCurve3([
    v(0.05, 1.55, -0.04), v(0.3, 1.5, 0.12), v(0.55, 1.45, 0.18),
  ]);
  const phrenicL = new THREE.CatmullRomCurve3([
    v(-0.12, 2.45, 0), v(-0.2, 2.1, 0.1), v(-0.18, 1.7, 0.18),
  ]);
  const phrenicR = new THREE.CatmullRomCurve3([
    v(0.12, 2.45, 0), v(0.2, 2.1, 0.1), v(0.18, 1.7, 0.18),
  ]);
  const splanchnic = new THREE.CatmullRomCurve3([
    v(0, 1.0, -0.02), v(-0.05, 0.7, 0.08), v(-0.02, 0.45, 0.18),
    v(0.04, 0.25, 0.22),
  ]);
  const sciaticL = new THREE.CatmullRomCurve3([
    v(-0.2, -0.25, -0.06), v(-0.34, -0.85, -0.04),
    v(-0.36, -1.55, 0), v(-0.34, -2.3, 0.04),
  ]);
  const sciaticR = new THREE.CatmullRomCurve3([
    v(0.2, -0.25, -0.06), v(0.34, -0.85, -0.04),
    v(0.36, -1.55, 0), v(0.34, -2.3, 0.04),
  ]);
  const ulnarL = new THREE.CatmullRomCurve3([
    v(-0.55, 2.2, 0.02), v(-0.85, 1.7, 0.04),
    v(-1.0, 1.1, 0.02), v(-1.1, 0.55, 0),
  ]);
  const ulnarR = new THREE.CatmullRomCurve3(
    ulnarL.points.map((p) => new THREE.Vector3(-p.x, p.y, p.z)),
  );

  return [
    { id: "spine",    curve: spine,    baseColor: violet,  branch: "central",         region: "spine", width: 0.04 },
    { id: "vagusL",   curve: vagusL,   baseColor: cyan,    branch: "parasympathetic", region: "heart", width: 0.022 },
    { id: "vagusR",   curve: vagusR,   baseColor: cyan,    branch: "parasympathetic", region: "lungs", width: 0.022 },
    { id: "sympL",    curve: sympL,    baseColor: magenta, branch: "sympathetic",     region: "spine", width: 0.02 },
    { id: "sympR",    curve: sympR,    baseColor: magenta, branch: "sympathetic",     region: "spine", width: 0.02 },
    { id: "armL",     curve: armL,     baseColor: amber,   branch: "peripheral",      region: "armsL", width: 0.018 },
    { id: "armR",     curve: armR,     baseColor: amber,   branch: "peripheral",      region: "armsR", width: 0.018 },
    { id: "legL",     curve: legL,     baseColor: amber,   branch: "peripheral",      region: "legsL", width: 0.02 },
    { id: "legR",     curve: legR,     baseColor: amber,   branch: "peripheral",      region: "legsR", width: 0.02 },
    { id: "cranialL", curve: cranialL, baseColor: cyan,    branch: "parasympathetic", region: "head",  width: 0.014 },
    { id: "cranialR", curve: cranialR, baseColor: cyan,    branch: "parasympathetic", region: "head",  width: 0.014 },
    // Secondary peripheral fibers
    { id: "radialL",       curve: radialL,       baseColor: amber, branch: "peripheral", region: "armsL", width: 0.012 },
    { id: "radialR",       curve: radialR,       baseColor: amber, branch: "peripheral", region: "armsR", width: 0.012 },
    { id: "ulnarL",        curve: ulnarL,        baseColor: amber, branch: "peripheral", region: "armsL", width: 0.011 },
    { id: "ulnarR",        curve: ulnarR,        baseColor: amber, branch: "peripheral", region: "armsR", width: 0.011 },
    { id: "intercostalL",  curve: intercostalL,  baseColor: cyan,  branch: "parasympathetic", region: "lungs", width: 0.01 },
    { id: "intercostalR",  curve: intercostalR,  baseColor: cyan,  branch: "parasympathetic", region: "lungs", width: 0.01 },
    { id: "intercostalL2", curve: intercostalL2, baseColor: cyan,  branch: "parasympathetic", region: "lungs", width: 0.01 },
    { id: "intercostalR2", curve: intercostalR2, baseColor: cyan,  branch: "parasympathetic", region: "lungs", width: 0.01 },
    { id: "phrenicL",      curve: phrenicL,      baseColor: cyan,  branch: "parasympathetic", region: "lungs", width: 0.011 },
    { id: "phrenicR",      curve: phrenicR,      baseColor: cyan,  branch: "parasympathetic", region: "lungs", width: 0.011 },
    { id: "splanchnic",    curve: splanchnic,    baseColor: green, branch: "parasympathetic", region: "gut",   width: 0.014 },
    { id: "sciaticL",      curve: sciaticL,      baseColor: amber, branch: "peripheral", region: "legsL", width: 0.014 },
    { id: "sciaticR",      curve: sciaticR,      baseColor: amber, branch: "peripheral", region: "legsR", width: 0.014 },
  ];
}

/* ---------- nerve tube + travelling spark ---------- */
function NervePath({
  path,
  intensity,
  speed,
  flashAt,
}: {
  path: Pathway;
  intensity: number;
  speed: number;
  /** Triggers a white flash at performance.now() ms timestamp; 0 = none */
  flashAt: number;
}) {
  const sparkRef = useRef<THREE.Mesh>(null!);
  const flashRef = useRef<THREE.Mesh>(null!);
  const flashCoreRef = useRef<THREE.Mesh>(null!);
  const tRef = useRef(Math.random());
  const flashStartRef = useRef(0);
  const flashTRef = useRef(0);

  useEffect(() => {
    if (flashAt > 0) {
      flashStartRef.current = flashAt;
      flashTRef.current = Math.random();
    }
  }, [flashAt]);

  useFrame((_, dt) => {
    tRef.current = (tRef.current + dt * speed) % 1;
    if (sparkRef.current) {
      const p = path.curve.getPoint(tRef.current);
      sparkRef.current.position.copy(p);
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.006 + tRef.current * 6);
      const s = 0.05 + 0.04 * pulse * (0.5 + intensity);
      sparkRef.current.scale.setScalar(s);
    }
    // Flash dissipation
    const now = performance.now();
    const elapsed = now - flashStartRef.current;
    const FLASH_DUR = 520;
    if (flashStartRef.current && elapsed < FLASH_DUR && flashRef.current) {
      const k = elapsed / FLASH_DUR;
      const ease = 1 - Math.pow(k, 1.8);
      const wobble = 0.85 + Math.sin(now * 0.06) * 0.15;
      const p = path.curve.getPoint(flashTRef.current);
      flashRef.current.position.copy(p);
      flashRef.current.scale.setScalar((0.45 + ease * 0.95) * wobble);
      (flashRef.current.material as THREE.MeshBasicMaterial).opacity = ease * 0.95;
      if (flashCoreRef.current) {
        flashCoreRef.current.position.copy(p);
        flashCoreRef.current.scale.setScalar((0.18 + ease * 0.4) * wobble);
        (flashCoreRef.current.material as THREE.MeshBasicMaterial).opacity = Math.min(1, ease * 1.6);
      }
    } else if (flashRef.current) {
      (flashRef.current.material as THREE.MeshBasicMaterial).opacity = 0;
      if (flashCoreRef.current) (flashCoreRef.current.material as THREE.MeshBasicMaterial).opacity = 0;
    }
  });

  const tubeGeom = useMemo(
    () => new THREE.TubeGeometry(path.curve, 96, path.width, 8, false),
    [path],
  );
  const haloGeom = useMemo(
    () => new THREE.TubeGeometry(path.curve, 64, path.width * 3, 8, false),
    [path],
  );
  const tubeMat = useMemo(
    () => new THREE.MeshBasicMaterial({
      color: path.baseColor.clone(),
      transparent: true,
      opacity: 0.4 + intensity * 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    [path, intensity],
  );
  const haloMat = useMemo(
    () => new THREE.MeshBasicMaterial({
      color: path.baseColor.clone(),
      transparent: true,
      opacity: 0.06 + intensity * 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    [path, intensity],
  );

  return (
    <group>
      <mesh geometry={haloGeom} material={haloMat} />
      <mesh geometry={tubeGeom} material={tubeMat} />
      {/* travelling spark */}
      <mesh ref={sparkRef}>
        <sphereGeometry args={[1, 10, 10]} />
        <meshBasicMaterial
          color={path.baseColor}
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* white electric flash — outer halo */}
      <mesh ref={flashRef}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial
          color={"#ffffff"}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* white electric flash — bright core */}
      <mesh ref={flashCoreRef}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial
          color={"#ffffff"}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/* ---------- jagged lightning bolt — short-lived, white ---------- */
function LightningBolt({
  start,
  end,
  birth,
  life = 320,
}: {
  start: THREE.Vector3;
  end: THREE.Vector3;
  birth: number;
  life?: number;
}) {
  const ref = useRef<THREE.Line>(null!);
  const mat = useRef(
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  ).current;

  const geom = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const segs = 8 + Math.floor(Math.random() * 4);
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = new THREE.Vector3().lerpVectors(start, end, t);
      const j = (Math.random() - 0.5) * len * 0.18 * Math.sin(t * Math.PI);
      const k = (Math.random() - 0.5) * len * 0.18 * Math.sin(t * Math.PI);
      p.x += j;
      p.z += k;
      p.y += (Math.random() - 0.5) * len * 0.06 * Math.sin(t * Math.PI);
      pts.push(p);
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [start, end]);

  useFrame(() => {
    const elapsed = performance.now() - birth;
    if (elapsed > life) {
      mat.opacity = 0;
      return;
    }
    const k = elapsed / life;
    mat.opacity = (1 - Math.pow(k, 1.6)) * 0.9;
  });

  return <line ref={ref as any} geometry={geom} material={mat} />;
}

/* ---------- region bloom ---------- */
function RegionGlow({ pos, color, intensity }: { pos: [number, number, number]; color: string; intensity: number }) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(() => {
    const t = performance.now() * 0.002;
    const s = 0.75 + Math.sin(t * 1.6) * 0.1;
    if (ref.current) ref.current.scale.setScalar(s * (0.6 + intensity * 0.8));
  });
  return (
    <mesh ref={ref} position={pos}>
      <sphereGeometry args={[0.45, 24, 24]} />
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
  head: "#3dd9ff", heart: "#ff4ed1", lungs: "#3dd9ff",
  gut: "#7afcc6", spine: "#9a7dff",
  armsL: "#ffaf52", armsR: "#ffaf52",
  legsL: "#ffaf52", legsR: "#ffaf52",
};

/* ---------- scene group with rotation + flash scheduler ---------- */
type Bolt = { id: number; start: THREE.Vector3; end: THREE.Vector3; birth: number };

function Group3D({
  intensities,
  hotspots,
  paths,
  flashes,
  bolts,
}: {
  intensities: Record<string, number>;
  hotspots: NonNullable<Props["hotspots"]>;
  paths: Pathway[];
  flashes: Record<string, number>;
  bolts: Bolt[];
}) {
  const grp = useRef<THREE.Group>(null!);
  const [autoRot, setAutoRot] = useState(true);

  useFrame((_, dt) => {
    if (autoRot && grp.current) grp.current.rotation.y += dt * 0.18;
  });

  return (
    <group ref={grp} onPointerDown={() => setAutoRot(false)}>
      <ExoSkeleton />
      {paths.map((p) => {
        const inten = intensities[p.id] ?? 0.4;
        const speed = 0.2 + inten * 0.7;
        return (
          <NervePath
            key={p.id}
            path={p}
            intensity={inten}
            speed={speed}
            flashAt={flashes[p.id] ?? 0}
          />
        );
      })}
      {bolts.map((b) => (
        <LightningBolt key={b.id} start={b.start} end={b.end} birth={b.birth} />
      ))}
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

/* ---------- main component ---------- */
export function NervousSystemBody({
  sympathetic,
  parasympathetic,
  wellnessScore = 76,
  hotspots,
}: Props) {
  const total = sympathetic + parasympathetic || 1;
  const sym = sympathetic / total;
  const para = parasympathetic / total;
  const balance = clamp(1 - Math.abs(sym - para) * 2);

  const paths = useMemo(buildPathways, []);

  const intensities = useMemo<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const p of paths) {
      switch (p.branch) {
        case "central": m[p.id] = 0.55 + balance * 0.35; break;
        case "parasympathetic": m[p.id] = 0.32 + para * 0.65; break;
        case "sympathetic": m[p.id] = 0.25 + sym * 0.7; break;
        default: m[p.id] = 0.32 + sym * 0.45; break;
      }
    }
    return m;
  }, [paths, sym, para, balance]);

  const computedHotspots = useMemo<NonNullable<Props["hotspots"]>>(() => {
    if (hotspots && hotspots.length) return hotspots;
    return [
      { region: "heart", intensity: clamp(para * 1.2) },
      { region: "lungs", intensity: clamp(para * 1.0) },
      { region: "gut",   intensity: clamp(para * 0.8) },
      { region: "head",  intensity: clamp(0.4 + balance * 0.5) },
      { region: "spine", intensity: clamp(sym * 1.1) },
    ];
  }, [para, sym, balance, hotspots]);

  // Flash scheduler — randomly fires a white flash on a pathway every 700-1500ms.
  // Sometimes also spawns a jagged lightning bolt to a neighboring nerve.
  const [flashes, setFlashes] = useState<Record<string, number>>({});
  const [bolts, setBolts] = useState<Bolt[]>([]);

  useEffect(() => {
    let mounted = true;
    let nextId = 1;
    const tick = () => {
      if (!mounted) return;
      // Weight selection by intensity — busier nerves fire more often
      const weights = paths.map((p) => intensities[p.id] ?? 0.4);
      const totalW = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * totalW;
      let idx = 0;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) { idx = i; break; }
      }
      const p = paths[idx];
      setFlashes((prev) => ({ ...prev, [p.id]: performance.now() }));

      // 35% of flashes spawn a lightning bolt to an adjacent point
      if (Math.random() < 0.35) {
        const t1 = Math.random();
        const t2 = clamp(t1 + (Math.random() - 0.5) * 0.5, 0.05, 0.95);
        const start = p.curve.getPoint(t1);
        // Offset target — sometimes another nerve, sometimes nearby on same nerve
        let end: THREE.Vector3;
        if (Math.random() < 0.5) {
          // jump to nearest neighbour by approximate position
          const candidates = paths.filter((q) => q.id !== p.id);
          const target = candidates[Math.floor(Math.random() * candidates.length)];
          end = target.curve.getPoint(Math.random());
        } else {
          end = p.curve.getPoint(t2);
        }
        const id = nextId++;
        const birth = performance.now();
        setBolts((prev) => [...prev, { id, start, end, birth }]);
        // Auto-cleanup after life
        setTimeout(() => {
          if (!mounted) return;
          setBolts((prev) => prev.filter((b) => b.id !== id));
        }, 500);
      }

      const next = 600 + Math.random() * 900;
      setTimeout(tick, next);
    };
    const t = setTimeout(tick, 400);
    return () => { mounted = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full" style={{ aspectRatio: "1 / 1.15", maxWidth: 460, margin: "0 auto" }}>
      <Canvas
        camera={{ position: [0, 0.6, 6.5], fov: 38 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ background: "transparent" }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[3, 5, 4]} intensity={0.5} color={"#9bd9ff"} />
        <directionalLight position={[-3, -2, -3]} intensity={0.3} color={"#ff8be0"} />
        <Suspense fallback={null}>
          <Group3D
            intensities={intensities}
            hotspots={computedHotspots}
            paths={paths}
            flashes={flashes}
            bolts={bolts}
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

      {/* Score overlay */}
      <div className="pointer-events-none absolute top-3 left-3 select-none">
        <div className="text-[10px] uppercase tracking-[0.2em] text-cyan/80">Live</div>
        <div className="ps-text-mono text-[28px] font-bold leading-none" style={{ textShadow: "0 0 18px hsl(185 95% 60% / 0.6)" }}>
          {Math.round(wellnessScore)}
        </div>
        <div className="text-[10px] text-white/60">ANS Score</div>
      </div>

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-3 text-[9px] uppercase tracking-[0.15em]">
        <span className="flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full" style={{ background: "#3dd9ff", boxShadow: "0 0 6px #3dd9ff" }} /> Vagus</span>
        <span className="flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full" style={{ background: "#ff4ed1", boxShadow: "0 0 6px #ff4ed1" }} /> Sympathetic</span>
        <span className="flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full" style={{ background: "#9a7dff", boxShadow: "0 0 6px #9a7dff" }} /> CNS</span>
        <span className="flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full" style={{ background: "#ffaf52", boxShadow: "0 0 6px #ffaf52" }} /> Peripheral</span>
      </div>

      <div className="pointer-events-none absolute bottom-9 right-3 text-[9px] uppercase tracking-[0.18em] text-white/40">
        Drag · Scroll
      </div>
    </div>
  );
}
