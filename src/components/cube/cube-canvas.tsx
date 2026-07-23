'use client';

import { useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import * as THREE from 'three';

// ═══════════════════════════════════════════════════════
// WCA standard Rubik's cube sticker colors
// ═══════════════════════════════════════════════════════
const COLORS: Record<string, string> = {
  '+y': '#FFFFFF', // white (top)
  '-y': '#009B48', // green (bottom)
  '+z': '#B71234', // red (front)
  '-z': '#FF5900', // orange (back)
  '+x': '#0046B8', // blue (right)
  '-x': '#FFD500', // yellow (left)
};

const CUBIE_SIZE = 0.9;
const GAP = 0.1;
const STEP = CUBIE_SIZE + GAP;
const STICKER_INSET = 0.12; // how much smaller the sticker is than the face
const STICKER_DEPTH = 0.02; // how far above the body the sticker sits

function faceKey(dx: number, dy: number, dz: number) {
  if (dy === 1) return '+y';
  if (dy === -1) return '-y';
  if (dz === 1) return '+z';
  if (dz === -1) return '-z';
  if (dx === 1) return '+x';
  if (dx === -1) return '-x';
  return '';
}

interface StickerDef {
  offset: [number, number, number]; // position relative to cubie center
  rotation: [number, number, number]; // rotation to face outward
  color: string;
}

function Cubie({ cx, cy, cz }: { cx: number; cy: number; cz: number }) {
  const stickers = useMemo(() => {
    const result: StickerDef[] = [];
    const dirs: [number, number, number][] = [
      [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0],
    ];

    for (const [dx, dy, dz] of dirs) {
      const nx = cx + dx, ny = cy + dy, nz = cz + dz;
      // Is this face on the outside of the 3x3 cube?
      if (nx < -0.5 || nx > 0.5 || ny < -0.5 || ny > 0.5 || nz < -0.5 || nz > 0.5) {
        const fk = faceKey(dx, dy, dz);
        const half = CUBIE_SIZE / 2 - STICKER_INSET;
        const stickHalf = half;
        const faceOffset = CUBIE_SIZE / 2 + STICKER_DEPTH;

        // Position the sticker plane just above the face
        const offset: [number, number, number] = [
          dx * faceOffset,
          dy * faceOffset,
          dz * faceOffset,
        ];

        // Sticker plane: a quad in local space that faces Z, then rotated to face the right direction
        // Default plane is XY (facing +Z). We need to rotate it.
        let rotation: [number, number, number] = [0, 0, 0];
        if (dy === 1) rotation = [-Math.PI / 2, 0, 0];
        else if (dy === -1) rotation = [Math.PI / 2, 0, 0];
        else if (dx === 1) rotation = [0, Math.PI / 2, 0];
        else if (dx === -1) rotation = [0, -Math.PI / 2, 0];
        // dz === 1: default (facing +Z), rotation is [0,0,0]
        else if (dz === -1) rotation = [0, Math.PI, 0];

        result.push({ offset, rotation, color: COLORS[fk] });
      }
    }
    return result;
  }, [cx, cy, cz]);

  const bodyGeom = useMemo(() => new THREE.BoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE), []);
  const stickerGeom = useMemo(() => {
    const half = CUBIE_SIZE / 2 - STICKER_INSET;
    return new THREE.PlaneGeometry(half * 2, half * 2);
  }, []);

  return (
    <group position={[cx * STEP, cy * STEP, cz * STEP]}>
      {/* Dark body */}
      <mesh geometry={bodyGeom} castShadow receiveShadow>
        <meshStandardMaterial color="#1a1a1a" roughness={0.6} metalness={0.1} />
        <Edges color="#333333" threshold={15} />
      </mesh>

      {/* Colored stickers */}
      {stickers.map((s, i) => (
        <mesh
          key={i}
          position={s.offset}
          rotation={s.rotation}
          geometry={stickerGeom}
        >
          <meshStandardMaterial
            color={s.color}
            roughness={0.3}
            metalness={0.02}
          />
        </mesh>
      ))}
    </group>
  );
}

function RubiksCube({ mouseRef, reduced }: { mouseRef: React.MutableRefObject<{ x: number; y: number }>; reduced: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const targetRot = useRef({ x: -0.5, y: -0.55, z: 0.1 });
  const autoAngle = useRef(0);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    if (!reduced) {
      autoAngle.current += delta * 0.35;
      const tY = autoAngle.current + mouseRef.current.x * 0.5;
      const tX = -0.5 + mouseRef.current.y * 0.35;
      const tZ = 0.1 + mouseRef.current.x * 0.1;

      // Smooth lerp
      const lerp = 0.06;
      const r = groupRef.current.rotation;
      r.x += (tX - r.x) * lerp;
      r.y += (tY - r.y) * lerp;
      r.z += (tZ - r.z) * lerp;
    } else {
      groupRef.current.rotation.set(-0.5, -0.55, 0.1);
    }
  });

  const cubiePositions = useMemo(() => {
    const pos: [number, number, number][] = [];
    for (let cx = -1; cx <= 1; cx++)
      for (let cy = -1; cy <= 1; cy++)
        for (let cz = -1; cz <= 1; cz++)
          if (cx !== 0 || cy !== 0 || cz !== 0)
            pos.push([cx, cy, cz]);
    return pos;
  }, []);

  return (
    <group ref={groupRef} rotation={[-0.5, -0.55, 0.1]}>
      {cubiePositions.map(([cx, cy, cz], i) => (
        <Cubie key={i} cx={cx} cy={cy} cz={cz} />
      ))}
    </group>
  );
}

function Scene({ mouseRef, reduced }: { mouseRef: React.MutableRefObject<{ x: number; y: number }>; reduced: boolean }) {
  return (
    <>
      {/* Key light */}
      <directionalLight
        position={[6, 8, 6]}
        intensity={1.8}
        castShadow
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
        shadow-camera-far={25}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-bias={-0.0001}
      />
      {/* Fill light */}
      <directionalLight position={[-4, 2, -2]} intensity={0.5} />
      {/* Ambient */}
      <ambientLight intensity={0.5} />
      {/* Subtle blue rim from below */}
      <pointLight position={[0, -3, 1]} intensity={0.3} color="#4285f4" />

      {/* Shadow-catching plane */}
      <mesh receiveShadow position={[0, -2.4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[8, 8]} />
        <shadowMaterial transparent opacity={0.18} />
      </mesh>

      <RubiksCube mouseRef={mouseRef} reduced={reduced} />
    </>
  );
}

export default function CubeCanvas({ className = '' }: { className?: string }) {
  const mouseRef = useRef({ x: 0, y: 0 });

  const handlePointerMove = (e: React.PointerEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  };

  const handlePointerLeave = () => {
    mouseRef.current.x = 0;
    mouseRef.current.y = 0;
  };

  const size = 'min(480px, calc(100vw - 64px))';

  return (
    <div className={`relative ${className}`}>
      <div
        className="relative mx-auto"
        style={{ width: size, height: size }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <Canvas
          camera={{ position: [0, 1.5, 7.5], fov: 35 }}
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
          dpr={[1, 2]}
          shadows="soft"
        >
          <Suspense fallback={null}>
            <Scene mouseRef={mouseRef} reduced={false} />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}
