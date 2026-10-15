import { CameraControlsImpl, Edges, Line, RoundedBox } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
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
  const group = useRef<THREE.Group>(null);
  return (
    <group ref={group}>
      <TouchControls editing={editing} items={items} selectedId={selectedId} origin={origin} group={group} onSelect={onSelect} onDrag={onDrag} />
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
    </group>
  );
}

/**
 * Touch: one finger moves a piece (the one under the finger, else the selected one), two fingers orbit and
 * zoom. Listens in the capture phase, so it decides before camera-controls sees the finger. Mouse dragging
 * is handled per piece in <Piece>.
 */
function TouchControls({ editing, items, selectedId, origin, group, onSelect, onDrag }: {
  editing: boolean;
  items: FurnitureItem[];
  selectedId: string | null;
  origin: [number, number];
  group: RefObject<THREE.Group | null>;
  onSelect: (id: string) => void;
  onDrag: (id: string, x: number, z: number) => void;
}) {
  const controls = useThree((s) => s.controls) as unknown as CameraControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const el = useThree((s) => s.events.connected) as HTMLElement | null;
  const latest = useRef({ items, selectedId, origin, camera, onSelect, onDrag });
  latest.current = { items, selectedId, origin, camera, onSelect, onDrag };

  // with a piece selected one finger is for the piece, two fingers for the camera
  useEffect(() => {
    if (!controls) return;
    const A = CameraControlsImpl.ACTION;
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
    const piece = editing && selectedId != null;
    controls.touches.one = piece ? A.NONE : ortho ? A.TOUCH_TRUCK : A.TOUCH_ROTATE;
    controls.touches.two = ortho ? A.TOUCH_ZOOM_TRUCK : piece ? A.TOUCH_DOLLY_ROTATE : A.TOUCH_DOLLY_TRUCK;
  }, [controls, camera, editing, selectedId]);

  useEffect(() => {
    if (!el || !editing) return;
    const raycaster = new THREE.Raycaster();
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const fingers = new Set<number>();
    let drag: { pointer: number; itemId: string; start: [number, number]; from: [number, number] | null } | null = null;
    const aim = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), latest.current.camera);
    };
    const floorAt = (e: PointerEvent): [number, number] | null => {
      aim(e);
      const o = latest.current.origin;
      return raycaster.ray.intersectPlane(floor, hit) ? [hit.x + o[0], hit.z + o[1]] : null;
    };
    const pieceAt = (e: PointerEvent): string | null => {
      aim(e);
      for (const h of raycaster.intersectObjects(group.current?.children ?? [], true)) {
        if (!(h.object as THREE.Mesh).isMesh) continue;
        for (let o: THREE.Object3D | null = h.object; o; o = o.parent) if (o.userData.itemId) return o.userData.itemId as string;
      }
      return null;
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      fingers.add(e.pointerId);
      if (fingers.size > 1) {
        drag = null; // second finger: the camera takes over
        return;
      }
      const piece = pieceAt(e);
      const itemId = piece ?? latest.current.selectedId;
      const start = itemId ? floorAt(e) : null;
      if (!itemId || !start) return; // nothing to move: one finger orbits
      if (controls) controls.touches.one = CameraControlsImpl.ACTION.NONE; // set before camera-controls reads it
      if (piece) latest.current.onSelect(piece);
      drag = { pointer: e.pointerId, itemId, start, from: null };
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointer || fingers.size > 1) return;
      const p = floorAt(e);
      const it = latest.current.items.find((i) => i.id === drag!.itemId);
      if (!p || !it) return;
      drag.from ??= [it.x, it.z];
      latest.current.onDrag(it.id, drag.from[0] + p[0] - drag.start[0], drag.from[1] + p[1] - drag.start[1]);
    };
    const up = (e: PointerEvent) => {
      fingers.delete(e.pointerId);
      if (drag?.pointer === e.pointerId) drag = null;
    };
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, [el, editing, controls, group]);
  return null;
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
    if (e.pointerType === "touch") return; // <TouchControls> selects and drags on touch
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
    <group position={[item.x, y, item.z]} rotation-y={(-item.rot * Math.PI) / 180} userData={{ itemId: item.id }}>
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
        onClick={(e) => e.stopPropagation()} // a click on a piece must not reach the floor (that would deselect it)
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
