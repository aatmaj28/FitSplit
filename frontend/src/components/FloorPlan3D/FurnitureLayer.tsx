import { CameraControlsImpl, Edges, Line, RoundedBox } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { IN, type FitResult, type FurnitureItem } from "./furniture";
import { flatGeometry } from "./geometry";
import { ACCENT } from "./theme";

const OK = "#22c55e";
const BAD = "#ef4444";
export const DOOR = "#f59e0b";

/** Floor in front of the selected room's doorways (edit mode); auto-place keeps it clear. */
export function DoorZones({ zones, y }: { zones: [number, number][][]; y: number }) {
  const geos = useMemo(() => zones.map((z) => flatGeometry(z)), [zones]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  return (
    <>
      {geos.map((g, i) => (
        <group key={i}>
          <mesh geometry={g} position-y={y + 0.03} renderOrder={2}>
            <meshBasicMaterial color={DOOR} transparent opacity={0.22} depthWrite={false} />
          </mesh>
          <Line
            points={[...zones[i], zones[i][0]].map(([x, z]) => [x, y + 0.035, z] as [number, number, number])}
            color={DOOR}
            lineWidth={1.5}
            dashed
            dashSize={0.3}
            gapSize={0.2}
          />
        </group>
      ))}
    </>
  );
}

/** Furniture boxes on the floor. Lives inside the plan-offset group, so positions are plan feet. */
export function FurnitureLayer({ items, fits, baseY, selectedId, editing, origin, onSelect, onDrag }: {
  items: FurnitureItem[];
  fits: Map<string, FitResult>;
  baseY: (item: FurnitureItem) => number;
  selectedId: string | null;
  editing: boolean;
  origin: [number, number]; // plan offset (cx, cz): world = plan - origin
  onSelect: (id: string) => void;
  onDrag: (id: string, x: number, z: number) => void;
}) {
  return (
    <>
      {items.map((it) => (
        <Piece
          key={it.id}
          item={it}
          ok={fits.get(it.id)?.ok ?? true}
          y={baseY(it)}
          selected={it.id === selectedId}
          editing={editing}
          origin={origin}
          onSelect={onSelect}
          onDrag={onDrag}
        />
      ))}
    </>
  );
}

function Piece({ item, ok, y, selected, editing, origin, onSelect, onDrag }: {
  item: FurnitureItem;
  ok: boolean;
  y: number;
  selected: boolean;
  editing: boolean;
  origin: [number, number];
  onSelect: (id: string) => void;
  onDrag: (id: string, x: number, z: number) => void;
}) {
  const controls = useThree((s) => s.controls) as unknown as CameraControlsImpl | null;
  const grab = useRef<{ dx: number; dz: number } | null>(null);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const w = item.w * IN, d = item.d * IN, h = item.h * IN;
  const radius = Math.min(0.12, w / 4, d / 4, h / 4);
  const ring = useMemo(() => {
    const [hx, hz] = [w / 2 + 0.06, d / 2 + 0.06];
    return [[-hx, 0.05, -hz], [hx, 0.05, -hz], [hx, 0.05, hz], [-hx, 0.05, hz], [-hx, 0.05, -hz]] as [number, number, number][];
  }, [w, d]);
  const body = useMemo(() => {
    const c = new THREE.Color(item.color);
    return ok ? c : c.lerp(new THREE.Color(BAD), 0.55);
  }, [item.color, ok]);

  const floorPoint = (e: ThreeEvent<PointerEvent>): [number, number] | null =>
    e.ray.intersectPlane(plane, hit) ? [hit.x + origin[0], hit.z + origin[1]] : null;

  const down = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onSelect(item.id);
    if (!editing) return;
    const p = floorPoint(e);
    if (!p) return;
    grab.current = { dx: p[0] - item.x, dz: p[1] - item.z };
    (e.target as unknown as Element).setPointerCapture(e.pointerId);
    if (controls) controls.enabled = false; // no orbiting while dragging furniture
    document.body.style.cursor = "grabbing";
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    if (!grab.current) return;
    e.stopPropagation();
    const p = floorPoint(e);
    if (p) onDrag(item.id, p[0] - grab.current.dx, p[1] - grab.current.dz);
  };
  const up = (e: ThreeEvent<PointerEvent>) => {
    if (!grab.current) return;
    e.stopPropagation();
    grab.current = null;
    (e.target as unknown as Element).releasePointerCapture(e.pointerId);
    if (controls) controls.enabled = true;
    document.body.style.cursor = editing ? "grab" : "";
  };

  return (
    <group position={[item.x, y, item.z]} rotation-y={(-item.rot * Math.PI) / 180}>
      {/* fit status plate: green = fits, red = hits a wall / furniture / sticks out */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.035} renderOrder={3}>
        <planeGeometry args={[w + 0.2, d + 0.2]} />
        <meshBasicMaterial color={ok ? OK : BAD} transparent opacity={selected ? 0.7 : 0.5} depthWrite={false} />
      </mesh>
      <Line points={ring} color={ok ? OK : BAD} lineWidth={2.5} />
      <RoundedBox
        args={[w, h, d]}
        radius={radius}
        smoothness={3}
        position-y={h / 2 + 0.04}
        castShadow
        receiveShadow
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = editing ? "grab" : "pointer";
        }}
        onPointerOut={() => {
          if (!grab.current) document.body.style.cursor = "";
        }}
      >
        <meshStandardMaterial color={body} roughness={0.75} emissive={ok ? "#000000" : BAD} emissiveIntensity={ok ? 0 : 0.18} />
      </RoundedBox>
      {selected && (
        <mesh position-y={h / 2 + 0.04}>
          <boxGeometry args={[w + 0.06, h + 0.06, d + 0.06]} />
          <meshBasicMaterial visible={false} />
          <Edges color={ACCENT} lineWidth={2.5} threshold={10} />
        </mesh>
      )}
    </group>
  );
}
