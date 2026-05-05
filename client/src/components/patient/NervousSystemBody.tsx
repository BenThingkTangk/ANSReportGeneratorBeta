import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

/**
 * NervousSystemBody — sleek wireframe exoskeleton with dense nerve mesh.
 *
 * - No flashing/lightning/travelling sparks.
 * - Affected regions glow softly in & out (breathing).
 * - Click a region (head, heart, lungs, gut, spine, arms, legs) → ANS info popup.
 * - Drag to rotate, scroll/pinch to zoom.
 */

type Props = {
  sympathetic: number;
  parasympathetic: number;
  /** Optional region intensities 0..1; auto-derived from sym/para if omitted. */
  hotspots?: { region: BodyRegion; intensity: number }[];
};

type BodyRegion =
  | "head" | "heart" | "lungs" | "gut" | "spine"
  | "armsL" | "armsR" | "legsL" | "legsR";

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

/* ---------- exoskeleton (thin wireframe) ---------- */
function ExoSkeleton() {
  const lineMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0x88e6ff,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );
  const dimMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0x4ab8d9,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  const buildLine = (pts: THREE.Vector3[]) =>
    new THREE.BufferGeometry().setFromPoints(pts);

  const lines = useMemo(() => {
    const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

    const headFront = (segs = 36) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const t = (i / segs) * Math.PI * 2;
        pts.push(v(Math.cos(t) * 0.32, 3.05 + Math.sin(t) * 0.42, 0));
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

    // Jaw hint
    const jaw = [v(-0.18, 2.75, 0.1), v(-0.1, 2.65, 0.18), v(0.1, 2.65, 0.18), v(0.18, 2.75, 0.1)];

    // Neck contours
    const neckL = [v(-0.1, 2.7), v(-0.13, 2.5), v(-0.17, 2.35)];
    const neckR = [v(0.1, 2.7), v(0.13, 2.5), v(0.17, 2.35)];

    // Torso silhouette
    const torsoL = [
      v(-0.55, 2.32), v(-0.65, 2.15), v(-0.7, 1.85),
      v(-0.6, 1.45), v(-0.5, 1.05), v(-0.45, 0.6),
      v(-0.42, 0.2),
    ];
    const torsoR = torsoL.map((p) => v(-p.x, p.y, p.z));
    // Back contour (offset slightly z-)
    const torsoLBack = torsoL.map((p) => v(p.x * 0.9, p.y, p.z - 0.18));
    const torsoRBack = torsoR.map((p) => v(p.x * 0.9, p.y, p.z - 0.18));

    // Shoulders, hipline
    const shoulders = [v(-0.55, 2.32), v(0.55, 2.32)];
    const hipLine = [v(-0.42, 0.2), v(0.42, 0.2)];
    // Sternum
    const sternum = [v(0, 2.3), v(0, 2.0), v(0, 1.6), v(0, 1.2)];

    // Ribcage arcs
    const rib = (y: number, r: number, segs = 24) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const t = -Math.PI * 0.18 + (i / segs) * Math.PI * 1.36;
        pts.push(v(Math.cos(t) * r, y, Math.sin(t) * r * 0.55));
      }
      return pts;
    };
    const ribs = [
      rib(2.05, 0.62), rib(1.85, 0.66), rib(1.65, 0.66),
      rib(1.45, 0.6), rib(1.25, 0.55),
    ];
    // Back ribs (mirrored on -z)
    const ribBack = (y: number, r: number, segs = 24) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const t = Math.PI - Math.PI * 0.18 + (i / segs) * Math.PI * 1.36;
        pts.push(v(Math.cos(t) * r, y, Math.sin(t) * r * 0.55));
      }
      return pts;
    };
    const ribsBack = [ribBack(2.05, 0.62), ribBack(1.85, 0.66), ribBack(1.65, 0.66), ribBack(1.45, 0.6), ribBack(1.25, 0.55)];

    // Pelvis
    const pelvis = (() => {
      const pts: THREE.Vector3[] = [];
      const segs = 22;
      for (let i = 0; i <= segs; i++) {
        const t = Math.PI + (i / segs) * Math.PI;
        pts.push(v(Math.cos(t) * 0.42, 0.05 + Math.sin(t) * 0.18, 0));
      }
      return pts;
    })();

    // Arms — front + back contour for skeletal feel
    const armL = [
      v(-0.55, 2.3), v(-0.85, 2.05), v(-1.05, 1.55),
      v(-1.15, 1.05), v(-1.2, 0.55), v(-1.22, 0.05),
    ];
    const armR = armL.map((p) => v(-p.x, p.y, p.z));
    const armLBack = armL.map((p) => v(p.x - 0.05, p.y, p.z - 0.06));
    const armRBack = armR.map((p) => v(p.x + 0.05, p.y, p.z - 0.06));
    // Hand
    const handL = [v(-1.22, 0.05), v(-1.28, -0.18), v(-1.3, -0.32)];
    const handR = handL.map((p) => v(-p.x, p.y, p.z));

    // Legs
    const legL = [
      v(-0.22, 0.15), v(-0.28, -0.4), v(-0.32, -1.05),
      v(-0.34, -1.7), v(-0.34, -2.4), v(-0.32, -3.05),
    ];
    const legR = legL.map((p) => v(-p.x, p.y, p.z));
    const legLOuter = legL.map((p) => v(p.x - 0.13, p.y, p.z));
    const legROuter = legR.map((p) => v(p.x + 0.13, p.y, p.z));
    // Feet
    const footL = [v(-0.32, -3.05), v(-0.45, -3.1, 0.2), v(-0.18, -3.12, 0.3)];
    const footR = footL.map((p) => v(-p.x, p.y, p.z));

    return {
      bright: [
        headFront(), headSide(), headTop(), jaw,
        neckL, neckR,
        torsoL, torsoR,
        shoulders, hipLine, sternum,
        ...ribs, pelvis,
        armL, armR, handL, handR,
        legL, legR, footL, footR,
      ],
      dim: [
        torsoLBack, torsoRBack,
        ...ribsBack,
        armLBack, armRBack,
        legLOuter, legROuter,
      ],
    };
  }, []);

  const brightLines = useMemo(
    () => lines.bright.map((pts) => new THREE.Line(buildLine(pts), lineMat)),
    [lines, lineMat],
  );
  const dimLines = useMemo(
    () => lines.dim.map((pts) => new THREE.Line(buildLine(pts), dimMat)),
    [lines, dimMat],
  );

  return (
    <group>
      {brightLines.map((l, i) => (<primitive key={`b${i}`} object={l} />))}
      {dimLines.map((l, i) => (<primitive key={`d${i}`} object={l} />))}
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

  const spine = new THREE.CatmullRomCurve3([
    v(0, 3.1, 0.05), v(0, 2.8, 0.06), v(0, 2.4, 0.04),
    v(0, 1.9, 0.0), v(0, 1.3, -0.04), v(0, 0.6, -0.05),
    v(0, 0.0, -0.02),
  ]);
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
  const armL = new THREE.CatmullRomCurve3([
    v(-0.18, 2.32, 0), v(-0.5, 2.15, -0.04), v(-0.9, 1.6, -0.06),
    v(-1.05, 1.05, -0.04), v(-1.13, 0.5, 0), v(-1.18, -0.05, 0),
  ]);
  const armR = new THREE.CatmullRomCurve3([
    v(0.18, 2.32, 0), v(0.5, 2.15, -0.04), v(0.9, 1.6, -0.06),
    v(1.05, 1.05, -0.04), v(1.13, 0.5, 0), v(1.18, -0.05, 0),
  ]);
  const legL = new THREE.CatmullRomCurve3([
    v(-0.06, 0.1, -0.02), v(-0.2, -0.25, -0.02), v(-0.28, -0.9, 0),
    v(-0.3, -1.6, 0.02), v(-0.3, -2.3, 0.04), v(-0.3, -2.95, 0.08),
  ]);
  const legR = new THREE.CatmullRomCurve3([
    v(0.06, 0.1, -0.02), v(0.2, -0.25, -0.02), v(0.28, -0.9, 0),
    v(0.3, -1.6, 0.02), v(0.3, -2.3, 0.04), v(0.3, -2.95, 0.08),
  ]);
  const cranialL = new THREE.CatmullRomCurve3([
    v(0, 3.1, 0.05), v(-0.15, 3.2, 0.2), v(-0.28, 3.0, 0.3), v(-0.32, 2.75, 0.32),
  ]);
  const cranialR = new THREE.CatmullRomCurve3([
    v(0, 3.1, 0.05), v(0.15, 3.2, 0.2), v(0.28, 3.0, 0.3), v(0.32, 2.75, 0.32),
  ]);
  const radialL = new THREE.CatmullRomCurve3([
    v(-0.5, 2.0, 0.04), v(-0.7, 1.6, 0.06), v(-0.95, 1.1, 0.04), v(-1.05, 0.7, 0.02),
  ]);
  const radialR = new THREE.CatmullRomCurve3(
    radialL.points.map((p) => new THREE.Vector3(-p.x, p.y, p.z)),
  );
  const ulnarL = new THREE.CatmullRomCurve3([
    v(-0.55, 2.2, 0.02), v(-0.85, 1.7, 0.04), v(-1.0, 1.1, 0.02), v(-1.1, 0.55, 0),
  ]);
  const ulnarR = new THREE.CatmullRomCurve3(
    ulnarL.points.map((p) => new THREE.Vector3(-p.x, p.y, p.z)),
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
    v(0, 1.0, -0.02), v(-0.05, 0.7, 0.08), v(-0.02, 0.45, 0.18), v(0.04, 0.25, 0.22),
  ]);
  const sciaticL = new THREE.CatmullRomCurve3([
    v(-0.2, -0.25, -0.06), v(-0.34, -0.85, -0.04),
    v(-0.36, -1.55, 0), v(-0.34, -2.3, 0.04),
  ]);
  const sciaticR = new THREE.CatmullRomCurve3([
    v(0.2, -0.25, -0.06), v(0.34, -0.85, -0.04),
    v(0.36, -1.55, 0), v(0.34, -2.3, 0.04),
  ]);

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
    { id: "radialL",       curve: radialL,       baseColor: amber, branch: "peripheral",      region: "armsL", width: 0.012 },
    { id: "radialR",       curve: radialR,       baseColor: amber, branch: "peripheral",      region: "armsR", width: 0.012 },
    { id: "ulnarL",        curve: ulnarL,        baseColor: amber, branch: "peripheral",      region: "armsL", width: 0.011 },
    { id: "ulnarR",        curve: ulnarR,        baseColor: amber, branch: "peripheral",      region: "armsR", width: 0.011 },
    { id: "intercostalL",  curve: intercostalL,  baseColor: cyan,  branch: "parasympathetic", region: "lungs", width: 0.01 },
    { id: "intercostalR",  curve: intercostalR,  baseColor: cyan,  branch: "parasympathetic", region: "lungs", width: 0.01 },
    { id: "intercostalL2", curve: intercostalL2, baseColor: cyan,  branch: "parasympathetic", region: "lungs", width: 0.01 },
    { id: "intercostalR2", curve: intercostalR2, baseColor: cyan,  branch: "parasympathetic", region: "lungs", width: 0.01 },
    { id: "phrenicL",      curve: phrenicL,      baseColor: cyan,  branch: "parasympathetic", region: "lungs", width: 0.011 },
    { id: "phrenicR",      curve: phrenicR,      baseColor: cyan,  branch: "parasympathetic", region: "lungs", width: 0.011 },
    { id: "splanchnic",    curve: splanchnic,    baseColor: green, branch: "parasympathetic", region: "gut",   width: 0.014 },
    { id: "sciaticL",      curve: sciaticL,      baseColor: amber, branch: "peripheral",      region: "legsL", width: 0.014 },
    { id: "sciaticR",      curve: sciaticR,      baseColor: amber, branch: "peripheral",      region: "legsR", width: 0.014 },
  ];
}

/* ---------- nerve tube — static glow, no spark, gentle breathing pulse ---------- */
function NervePath({ path, intensity }: { path: Pathway; intensity: number }) {
  const haloRef = useRef<THREE.Mesh>(null!);
  useFrame(() => {
    const t = performance.now() * 0.0014;
    const pulse = 0.85 + Math.sin(t + path.curve.points[0].y * 1.7) * 0.15;
    if (haloRef.current) {
      const m = haloRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = (0.06 + intensity * 0.16) * pulse;
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
      opacity: 0.42 + intensity * 0.45,
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
      <mesh geometry={haloGeom} material={haloMat} ref={haloRef} />
      <mesh geometry={tubeGeom} material={tubeMat} />
    </group>
  );
}

/* ---------- region bloom (breathing in/out) + click target ---------- */
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
const REGION_RADIUS: Record<BodyRegion, number> = {
  head: 0.5, heart: 0.42, lungs: 0.42, gut: 0.5, spine: 0.32,
  armsL: 0.5, armsR: 0.5, legsL: 0.55, legsR: 0.55,
};

function RegionGlow({
  region,
  intensity,
  onClick,
  onHover,
}: {
  region: BodyRegion;
  intensity: number;
  onClick: (r: BodyRegion) => void;
  onHover: (r: BodyRegion | null) => void;
}) {
  const ref = useRef<THREE.Mesh>(null!);
  const haloRef = useRef<THREE.Mesh>(null!);

  useFrame(() => {
    const t = performance.now() * 0.0018;
    // unique phase per region
    const phase = (region.charCodeAt(0) + region.length) * 0.4;
    const k = 0.55 + Math.sin(t + phase) * 0.45; // 0.1 .. 1.0
    if (ref.current) {
      const m = ref.current.material as THREE.MeshBasicMaterial;
      m.opacity = (0.08 + intensity * 0.22) * k;
      ref.current.scale.setScalar(0.85 + k * 0.25);
    }
    if (haloRef.current) {
      const m = haloRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = (0.04 + intensity * 0.12) * k;
      haloRef.current.scale.setScalar(1.4 + k * 0.4);
    }
  });

  const r = REGION_RADIUS[region];
  const color = REGION_COLOR[region];

  return (
    <group
      position={REGION_POS[region]}
      onClick={(e) => { e.stopPropagation(); onClick(region); }}
      onPointerOver={(e) => { e.stopPropagation(); onHover(region); document.body.style.cursor = "pointer"; }}
      onPointerOut={(e) => { e.stopPropagation(); onHover(null); document.body.style.cursor = "default"; }}
    >
      {/* outer halo */}
      <mesh ref={haloRef}>
        <sphereGeometry args={[r * 1.6, 24, 24]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.06}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* inner glow */}
      <mesh ref={ref}>
        <sphereGeometry args={[r, 24, 24]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.18}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* invisible click target */}
      <mesh visible={false}>
        <sphereGeometry args={[r * 1.4, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

/* ---------- scene with auto-rotate until interaction ---------- */
function Group3D({
  intensities,
  paths,
  hotspots,
  onRegionClick,
  onRegionHover,
}: {
  intensities: Record<string, number>;
  paths: Pathway[];
  hotspots: { region: BodyRegion; intensity: number }[];
  onRegionClick: (r: BodyRegion) => void;
  onRegionHover: (r: BodyRegion | null) => void;
}) {
  const grp = useRef<THREE.Group>(null!);
  const [autoRot, setAutoRot] = useState(true);

  useFrame((_, dt) => {
    if (autoRot && grp.current) grp.current.rotation.y += dt * 0.18;
  });

  return (
    <group ref={grp} onPointerDown={() => setAutoRot(false)}>
      <ExoSkeleton />
      {paths.map((p) => (
        <NervePath key={p.id} path={p} intensity={intensities[p.id] ?? 0.4} />
      ))}
      {hotspots.map((h) => (
        <RegionGlow
          key={h.region}
          region={h.region}
          intensity={h.intensity}
          onClick={onRegionClick}
          onHover={onRegionHover}
        />
      ))}
    </group>
  );
}

/* ---------- region info content ---------- */
const REGION_INFO: Record<BodyRegion, { title: string; ans: string; symptoms: string[]; care: string[] }> = {
  head: {
    title: "Head & Brain",
    ans: "Cranial nerves and the brainstem regulate the autonomic baseline. Vagal output, baroreceptor reflexes and sympathetic outflow all originate here.",
    symptoms: ["Brain fog", "Headaches", "Light sensitivity", "Sleep disturbance"],
    care: ["Daily HRV-paced breathing", "Reduce screen time before bed", "Hydration & electrolytes"],
  },
  heart: {
    title: "Heart",
    ans: "Vagal innervation slows the heart; sympathetic input speeds it up. HRV reflects how dynamically these systems adapt.",
    symptoms: ["Palpitations", "Resting tachycardia", "Low HRV", "Lightheadedness on standing"],
    care: ["Zone 2 cardio 3×/week", "Cold face dunk for vagal tone", "Avoid stimulants late in day"],
  },
  lungs: {
    title: "Lungs & Diaphragm",
    ans: "Phrenic & vagal branches modulate breathing rhythm. Slow diaphragmatic breathing strengthens parasympathetic tone.",
    symptoms: ["Shallow breathing", "Air hunger", "Reduced exercise tolerance"],
    care: ["4-7-8 breathing 2×/day", "Diaphragm activation drills", "Aerobic base building"],
  },
  gut: {
    title: "Gut & Visceral System",
    ans: "Splanchnic and vagal nerves drive 'rest & digest'. Imbalance shows up as motility, reflux and bloating issues.",
    symptoms: ["Bloating", "Reflux", "Slow motility", "Food sensitivity"],
    care: ["Eat without screens", "Walk 10 min after meals", "Bitters & fiber"],
  },
  spine: {
    title: "Spinal Cord (CNS)",
    ans: "Sympathetic chain runs alongside the vertebrae. Fight-or-flight outflow is dispatched from thoracic and lumbar segments.",
    symptoms: ["Chronic muscle tension", "Posture-related fatigue", "Stress hyperreactivity"],
    care: ["Mobility / yoga 3×/week", "Box breathing under load", "Sleep position audit"],
  },
  armsL: {
    title: "Left Arm Plexus",
    ans: "Brachial, radial and ulnar pathways carry both motor and autonomic vasomotor signals to the upper limb.",
    symptoms: ["Cold hands", "Tingling", "Slow nail-bed refill"],
    care: ["Contrast showers", "Grip / loaded carries", "Improve thoracic outlet posture"],
  },
  armsR: {
    title: "Right Arm Plexus",
    ans: "Brachial, radial and ulnar pathways carry both motor and autonomic vasomotor signals to the upper limb.",
    symptoms: ["Cold hands", "Tingling", "Slow nail-bed refill"],
    care: ["Contrast showers", "Grip / loaded carries", "Improve thoracic outlet posture"],
  },
  legsL: {
    title: "Left Leg / Sciatic",
    ans: "Sacral plexus and sympathetic lumbar outflow regulate lower-body vascular tone, sweat and pelvic function.",
    symptoms: ["Cold feet", "Heaviness", "Orthostatic pooling"],
    care: ["Calf raises 3×/day", "Compression socks if symptomatic", "Squat-pattern strength"],
  },
  legsR: {
    title: "Right Leg / Sciatic",
    ans: "Sacral plexus and sympathetic lumbar outflow regulate lower-body vascular tone, sweat and pelvic function.",
    symptoms: ["Cold feet", "Heaviness", "Orthostatic pooling"],
    care: ["Calf raises 3×/day", "Compression socks if symptomatic", "Squat-pattern strength"],
  },
};

/* ---------- main component ---------- */
export function NervousSystemBody({ sympathetic, parasympathetic, hotspots }: Props) {
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

  const computedHotspots = useMemo<{ region: BodyRegion; intensity: number }[]>(() => {
    if (hotspots && hotspots.length) return hotspots;
    return [
      { region: "heart", intensity: clamp(para * 1.2) },
      { region: "lungs", intensity: clamp(para * 1.0) },
      { region: "gut",   intensity: clamp(para * 0.8) },
      { region: "head",  intensity: clamp(0.4 + balance * 0.4) },
      { region: "spine", intensity: clamp(sym * 1.1) },
      { region: "armsL", intensity: clamp(0.3 + sym * 0.4) },
      { region: "armsR", intensity: clamp(0.3 + sym * 0.4) },
      { region: "legsL", intensity: clamp(0.3 + sym * 0.4) },
      { region: "legsR", intensity: clamp(0.3 + sym * 0.4) },
    ];
  }, [para, sym, balance, hotspots]);

  const [hovered, setHovered] = useState<BodyRegion | null>(null);
  const [selected, setSelected] = useState<BodyRegion | null>(null);

  const info = selected ? REGION_INFO[selected] : null;

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
            paths={paths}
            hotspots={computedHotspots}
            onRegionClick={setSelected}
            onRegionHover={setHovered}
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

      {/* Hover label */}
      {hovered && !selected && (
        <div
          className="pointer-events-none absolute top-3 right-3 px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: "hsl(220 30% 6% / 0.85)", border: "1px solid hsl(185 95% 60% / 0.4)", color: "hsl(185 95% 75%)" }}
        >
          {REGION_INFO[hovered].title} — click for info
        </div>
      )}

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[9px] uppercase tracking-[0.15em]">
        <span className="flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full" style={{ background: "#3dd9ff", boxShadow: "0 0 6px #3dd9ff" }} /> Vagus</span>
        <span className="flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full" style={{ background: "#ff4ed1", boxShadow: "0 0 6px #ff4ed1" }} /> Sympathetic</span>
        <span className="flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full" style={{ background: "#9a7dff", boxShadow: "0 0 6px #9a7dff" }} /> CNS</span>
        <span className="flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full" style={{ background: "#ffaf52", boxShadow: "0 0 6px #ffaf52" }} /> Peripheral</span>
      </div>
      <div className="pointer-events-none absolute bottom-9 right-3 text-[9px] uppercase tracking-[0.18em] text-white/40">
        Drag · Scroll · Tap a glow
      </div>

      {/* Click info popup */}
      {info && (
        <div
          className="absolute inset-0 flex items-end justify-center p-3 pointer-events-none"
          style={{ background: "linear-gradient(to top, hsl(220 30% 5% / 0.7), transparent 60%)" }}
        >
          <div
            className="pointer-events-auto w-full max-w-[420px] rounded-2xl p-4 text-left animate-[slidein_220ms_ease-out]"
            style={{
              background: "hsl(220 30% 6% / 0.92)",
              border: "1px solid hsl(185 95% 60% / 0.35)",
              boxShadow: "0 10px 40px hsl(185 95% 30% / 0.25), inset 0 0 30px hsl(220 30% 4% / 0.6)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
            }}
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="ps-overline" style={{ color: REGION_COLOR[selected!] }}>{selected}</div>
                <div className="ps-text-display text-base font-semibold">{info.title}</div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-white/70 hover:text-white"
                style={{ background: "hsl(220 25% 12%)", border: "1px solid hsl(195 40% 30% / 0.3)" }}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="text-xs text-white/80 leading-relaxed mb-3">{info.ans}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="ps-overline mb-1.5">Common Symptoms</div>
                <ul className="space-y-1">
                  {info.symptoms.map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px] text-white/85">
                      <span className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: REGION_COLOR[selected!] }} />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="ps-overline mb-1.5">Care</div>
                <ul className="space-y-1">
                  {info.care.map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px] text-white/85">
                      <span className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: "hsl(140 60% 60%)" }} />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes slidein { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
    </div>
  );
}
