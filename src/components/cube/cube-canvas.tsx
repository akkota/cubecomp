'use client';

import { useEffect, useRef } from 'react';

// ═══════════════════════════════════════════════════════
// WCA standard Rubik's cube colors
// ═══════════════════════════════════════════════════════
const COL = {
  w: '#FFFFFF', r: '#B71234', b: '#0046B8',
  g: '#009B48', y: '#FFD500', o: '#FF5900',
};

const CUBIE = 1.0;
const GAP = 0.08;
const STEP = CUBIE + GAP;
const R = 0.12;

// Face colors by direction
const FACE_COLORS: Record<string, string> = {
  '+y': COL.w, '-y': COL.g, '+z': COL.r, '-z': COL.o, '+x': COL.b, '-x': COL.y,
};

const faceKey = (dx: number, dy: number, dz: number) => {
  if (dy === 1) return '+y'; if (dy === -1) return '-y';
  if (dz === 1) return '+z'; if (dz === -1) return '-z';
  if (dx === 1) return '+x'; if (dx === -1) return '-x';
  return '';
};

/** Rounded rectangle path for cubie body */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Project a 3D point to 2D screen space */
function project(
  x: number, y: number, z: number,
  rx: number, ry: number,
  dist: number, cx: number, cy: number,
): [number, number, number] {
  // Apply rotation about X axis
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const y1 = y * cosX - z * sinX;
  const z1 = y * sinX + z * cosX;
  // Apply rotation about Y axis
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const x2 = x * cosY + z1 * sinY;
  const z2 = -x * sinY + z1 * cosY + dist;
  const s = 1 / (z2 / dist + 1);
  return [x2 * s * dist + cx, -y1 * s * dist + cy, z2];
}

interface CubieFace {
  dx: number; dy: number; dz: number;
  color: string;
}

interface Cubie {
  cx: number; cy: number; cz: number;
  faces: CubieFace[];
}

function buildCubies(): Cubie[] {
  const result: Cubie[] = [];
  for (let cx = -1; cx <= 1; cx++) {
    for (let cy = -1; cy <= 1; cy++) {
      for (let cz = -1; cz <= 1; cz++) {
        if (cx === 0 && cy === 0 && cz === 0) continue;
        const faces: CubieFace[] = [];
        const dirs = [
          [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0],
        ];
        for (const [dx, dy, dz] of dirs) {
          const nx = cx + dx, ny = cy + dy, nz = cz + dz;
          if (nx < -1 || nx > 1 || ny < -1 || ny > 1 || nz < -1 || nz > 1) {
            faces.push({ dx, dy, dz, color: FACE_COLORS[faceKey(dx, dy, dz)] });
          }
        }
        result.push({ cx, cy, cz, faces });
      }
    }
  }
  return result;
}

const CUBIES = buildCubies();

// Face vertex definitions for the 6 cube faces (in cubie-local space)
const FACE_VERTS: Record<string, [number, number, number][]> = {
  '+y': [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]],
  '-y': [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]],
  '+z': [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]],
  '-z': [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]],
  '+x': [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]],
  '-x': [[-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]],
};

export default function CubeCanvas({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const stateRef = useRef({ rx: -0.45, ry: 0, autoAngle: 0, mouseRx: 0, mouseRy: 0, reduced: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    stateRef.current.reduced = media.matches;

    const dpr = Math.min(window.devicePixelRatio, 2);
    const size = Math.min(280, window.innerWidth - 48);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const half = size / 2;

    // Store cubies sorted by depth every frame for painter's algorithm
    const sortedCubies: Cubie[] = [...CUBIES];

    const draw = (time: number) => {
      frameRef.current = requestAnimationFrame(draw);
      const st = stateRef.current;

      // Auto-rotation
      if (!st.reduced) {
        st.autoAngle += 0.008;
        st.ry = st.autoAngle + st.mouseRy;
        st.rx = -0.45 + st.mouseRx;
      } else {
        st.rx = -0.45;
        st.ry = -0.55;
      }

      ctx.clearRect(0, 0, size, size);

      // ── Shadow ──
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath();
      const shadowY = half + 48;
      ctx.ellipse(half, shadowY, 80, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // ── Sort cubies back-to-front for proper occlusion ──
      sortedCubies.length = 0;
      for (const c of CUBIES) sortedCubies.push(c);
      sortedCubies.sort((a, b) => {
        const [, , za] = project(
          a.cx * STEP, a.cy * STEP, a.cz * STEP,
          st.rx, st.ry, 5, half, half,
        );
        const [, , zb] = project(
          b.cx * STEP, b.cy * STEP, b.cz * STEP,
          st.rx, st.ry, 5, half, half,
        );
        return za - zb; // ascending = back to front
      });

      for (const cubie of sortedCubies) {
        // Sort faces back-to-front for this cubie
        const sortedFaces = [...cubie.faces].sort((a, b) => {
          const [, , za] = project(
            cubie.cx * STEP + a.dx * 0.55,
            cubie.cy * STEP + a.dy * 0.55,
            cubie.cz * STEP + a.dz * 0.55,
            st.rx, st.ry, 5, half, half,
          );
          const [, , zb] = project(
            cubie.cx * STEP + b.dx * 0.55,
            cubie.cy * STEP + b.dy * 0.55,
            cubie.cz * STEP + b.dz * 0.55,
            st.rx, st.ry, 5, half, half,
          );
          return zb - za; // far to near
        });

        // Draw dark body
        const bodyVerts = [
          [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
          [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
        ];

        // Project all body corners
        const projBody = bodyVerts.map(([vx, vy, vz]) =>
          project(
            cubie.cx * STEP + vx * CUBIE,
            cubie.cy * STEP + vy * CUBIE,
            cubie.cz * STEP + vz * CUBIE,
            st.rx, st.ry, 5, half, half,
          ),
        );

        // Draw body as a filled shape with outline
        // For simplicity, draw the visible faces (up to 3 faces visible at a time)
        // Draw body outline (simplified - draw rounded rect at projected center)
        const [bcx, bcy] = project(
          cubie.cx * STEP, cubie.cy * STEP, cubie.cz * STEP,
          st.rx, st.ry, 5, half, half,
        );

        const scale = 14 * (1 / (projBody[0][2] / 5 + 1)); // approximate scale from depth

        // Draw body as a small rounded square
        ctx.save();
        ctx.globalAlpha = 1;
        roundedRect(ctx, bcx - scale, bcy - scale, scale * 2, scale * 2, 3);
        ctx.fillStyle = '#1a1a1a';
        ctx.fill();
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.stroke();
        ctx.restore();

        // Draw sticker faces
        for (const face of sortedFaces) {
          const fk = faceKey(face.dx, face.dy, face.dz);
          const verts = FACE_VERTS[fk];
          if (!verts) continue;

          const proj = verts.map(([vx, vy, vz]) =>
            project(
              cubie.cx * STEP + vx * CUBIE,
              cubie.cy * STEP + vy * CUBIE,
              cubie.cz * STEP + vz * CUBIE,
              st.rx, st.ry, 5, half, half,
            ),
          );

          // Check if face is facing camera
          const v0 = [proj[1][0] - proj[0][0], proj[1][1] - proj[0][1]];
          const v1 = [proj[2][0] - proj[0][0], proj[2][1] - proj[0][1]];
          const cross = v0[0] * v1[1] - v0[1] * v1[0];
          if (cross <= 0) continue; // backface

          // Shrink sticker slightly inside the face
          const margin = 0.1;
          const insetVerts = verts.map(([vx, vy, vz]) => {
            const cx = cubie.cx * STEP;
            const cy = cubie.cy * STEP;
            const cz = cubie.cz * STEP;
            // Move toward cubie center by margin along each axis
            const signX = face.dx !== 0 ? 0 : 1;
            const signY = face.dy !== 0 ? 0 : 1;
            const signZ = face.dz !== 0 ? 0 : 1;
            return [
              cx + vx * CUBIE * (1 - margin * signX * 2),
              cy + vy * CUBIE * (1 - margin * signY * 2),
              cz + vz * CUBIE * (1 - margin * signZ * 2),
            ];
          });

          const projInset = insetVerts.map(([x, y, z]) =>
            project(x, y, z, st.rx, st.ry, 5, half, half),
          );

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(projInset[0][0], projInset[0][1]);
          for (let i = 1; i < projInset.length; i++) {
            ctx.lineTo(projInset[i][0], projInset[i][1]);
          }
          ctx.closePath();
          ctx.fillStyle = face.color;

          // Subtle shadow under sticker
          const baseZ = proj[0][2];
          const darken = Math.max(0.7, 1 - (baseZ - 3) * 0.08);

          // Parse hex color and darken
          const hex = face.color.replace('#', '');
          const r = parseInt(hex.substring(0, 2), 16);
          const g = parseInt(hex.substring(2, 4), 16);
          const b = parseInt(hex.substring(4, 6), 16);
          ctx.fillStyle = `rgb(${Math.round(r * darken)},${Math.round(g * darken)},${Math.round(b * darken)})`;
          ctx.fill();

          // Subtle highlight on top edge
          ctx.strokeStyle = 'rgba(255,255,255,0.25)';
          ctx.lineWidth = 0.5;
          ctx.stroke();
          ctx.restore();
        }
      }

      // ── Subtle glow under cube ──
      ctx.save();
      const glow = ctx.createRadialGradient(half, half + 30, 20, half, half + 30, 100);
      glow.addColorStop(0, 'rgba(66,133,244,0.08)');
      glow.addColorStop(1, 'rgba(66,133,244,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);
      ctx.restore();
    };

    // Mouse parallax
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - (rect.left + rect.width / 2)) / rect.width;
      const py = (e.clientY - (rect.top + rect.height / 2)) / rect.height;
      stateRef.current.mouseRx = py * 0.3;
      stateRef.current.mouseRy = px * 0.4;
    };

    // Resize handler
    const onResize = () => {
      const newSize = Math.min(280, window.innerWidth - 48);
      canvas.width = newSize * dpr;
      canvas.height = newSize * dpr;
      canvas.style.width = `${newSize}px`;
      canvas.style.height = `${newSize}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('resize', onResize);
    media.addEventListener('change', (e: MediaQueryListEvent) => {
      stateRef.current.reduced = e.matches;
    });

    frameRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
