import { CameraControls, CameraControlsImpl, Line, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import type { FitResult, FurnitureItem } from "./furniture";
import { DoorZones, FurnitureLayer } from "./FurnitureLayer";
import { flatGeometry, plankTexture, pointInPoly, wallGeometry, type PlanModel, type RoomEntry } from "./geometry";
import { ACCENT, ACCENT_SOFT, BACKGROUND, GROUND, ROOM_COLORS, SLAB, WALL_CAP, WALL_SIDE } from "./theme";

export type ViewMode = "3d" | "top";
/** Camera angle presets for the 3D view (the top view is its own orthographic camera). */
export type Angle = "corner" | "front" | "side";

/** What the camera rig last fitted: camera-controls applies zoom/dolly on its next frame, so the
 *  camera itself can't be read back reliably right after a fit. */
interface FitState {
  zoom: number;
  distance: number;
}

// heights (ft) of the flat layers, bottom to top
const Y_GROUND = -0.6;
const Y_BALCONY = -0.35;
const Y_SLAB = 0;
const Y_ROOM = 0.02;
const Y_IMAGE = 0.06;
const Y_OUTLINE = 0.1;
const LABEL_LIFT = 0.8; // labels float this far above the wall tops
const TOP_CAMERA_Y = 80; // orthographic: height doesn't change the view, but keep it well inside the fog-free range

// 3D presets, degrees: azimuth 0 = from the image bottom (south), 90 = from the right (east);
// polar = down from vertical, steeper when framing one room so you look down into it
const ANGLES: Record<Angle, { azimuth: number; polar: number; focusPolar: number }> = {
  corner: { azimuth: 28, polar: 44, focusPolar: 34 },
  front: { azimuth: 0, polar: 52, focusPolar: 42 },
  side: { azimuth: 90, polar: 52, focusPolar: 42 },
};
const SMOOTH_TIME = 0.35; // s, camera transitions between presets
// px kept free top and bottom for the toolbar and legend (the toolbar wraps on phones)
const uiMargin = (width: number) => (width < 640 ? 64 : 60);

interface SceneProps {
  model: PlanModel;
  view: ViewMode;
  resetKey: number;
  show2D: boolean;
  imageUrl?: string;
  wallHeight: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onReady?: () => void;
  /** label buttons rendered by <LabelLayer> outside the canvas, positioned here every frame */
  labelEls: RefObject<(HTMLElement | null)[]>;
  furniture?: FurnitureProps;
  /** frame this room instead of the whole plan (editing its furniture) */
  focusId?: string | null;
  /** 3D view angle preset, plus degrees added to its azimuth (rotate buttons used from the top view) */
  angle?: Angle;
  angleOffset?: number;
  /** "rotate 45°" in the 3D view: rotates the current camera by `deg` each time `seq` changes */
  spin?: { seq: number; deg: number };
  /** phones: the room sheet is folded to its title row */
  panelFolded?: boolean;
  /** the room panel covers part of the canvas (default: whenever a room is selected) */
  panelOpen?: boolean;
}

export interface FurnitureProps {
  items: FurnitureItem[];
  fits: Map<string, FitResult>;
  selectedId: string | null;
  editing: boolean;
  /** clearance in front of the selected room's doorways (edit mode) */
  doorZones?: [number, number][][];
  onSelect: (id: string) => void;
  onDrag: (id: string, x: number, z: number) => void;
}

export function PlanScene({ model, view, resetKey, show2D, imageUrl, wallHeight, selectedId, onSelect, onReady, labelEls, furniture,
  focusId = null, angle = "corner", angleOffset = 0, spin, panelFolded = false, panelOpen }: SceneProps) {
  const { cx, cz, sx, sz } = model.bounds;
  const roomType = useMemo(() => new Map(model.rooms.map((r) => [r.room.id, r.room.type])), [model]);
  const fit = useRef<FitState>({ zoom: 1, distance: 50 }); // last fit, the panel offset's baseline
  const fogNear = Math.max(sx, sz) * 4 + 100; // only the far ground fades into the background
  const [hoverId, setHoverId] = useState<string | null>(null);
  const sizeKey = useSettledSize();
  // cutaway: walls between the camera and the selected room fade (world coordinates)
  const cut = useMemo(() => {
    const r = selectedId ? model.rooms.find((e) => e.room.id === selectedId) : undefined;
    if (!r) return null;
    const xs = r.poly.map((p) => p[0]), zs = r.poly.map((p) => p[1]);
    return {
      minX: Math.min(...xs) - cx, maxX: Math.max(...xs) - cx, minZ: Math.min(...zs) - cz, maxZ: Math.max(...zs) - cz,
      y: r.room.type === "balcony" ? Y_BALCONY : Y_ROOM,
    };
  }, [model, selectedId, cx, cz]);
  return (
    <>
      <color attach="background" args={[BACKGROUND]} />
      <fog attach="fog" args={[BACKGROUND, fogNear, fogNear * 4]} />
      <Lights model={model} />
      <PerspectiveCamera makeDefault={view === "3d"} fov={38} near={0.3} far={4000} position={[0, 60, 60]} />
      <OrthographicCamera makeDefault={view === "top"} near={0.1} far={4000} position={[0, TOP_CAMERA_Y, 0.001]} />
      <CameraControls makeDefault smoothTime={SMOOTH_TIME} />
      <CameraRig model={model} view={view} resetKey={resetKey} wallHeight={wallHeight} onReady={onReady} fit={fit} focusId={focusId}
        angle={angle} angleOffset={angleOffset} sizeKey={sizeKey} />
      <Spin spin={spin} view={view} />
      <PanelOffset open={panelOpen ?? selectedId != null} view={view} resetKey={resetKey} fit={fit} focusId={focusId} sizeKey={sizeKey} angle={angle}
        angleOffset={angleOffset} folded={panelFolded} />
      {/* plan center at the origin: the shadow light and the camera target both default to it */}
      <group position={[-cx, 0, -cz]}>
        <Ground model={model} />
        <Slab model={model} />
        {model.rooms.map((r) => (
          <RoomFloor
            key={r.room.id}
            entry={r}
            selected={r.room.id === selectedId}
            hovered={r.room.id === hoverId}
            subtle={Boolean(furniture?.editing)}
            onSelect={onSelect}
            onHover={setHoverId}
          />
        ))}
        <Walls model={model} height={wallHeight} ghost={show2D} cut={cut} openings={view === "3d"} />
        {show2D && imageUrl && <PlanImage model={model} url={imageUrl} />}
        {furniture && (
          <FurnitureLayer
            items={furniture.items}
            fits={furniture.fits}
            baseY={(it) => (it.roomId && roomType.get(it.roomId) === "balcony" ? Y_BALCONY : Y_ROOM)}
            selectedId={furniture.selectedId}
            editing={furniture.editing}
            origin={[cx, cz]}
            onSelect={furniture.onSelect}
            onDrag={furniture.onDrag}
          />
        )}
        {furniture?.doorZones && furniture.doorZones.length > 0 && (
          <DoorZones zones={furniture.doorZones} y={selectedId && roomType.get(selectedId) === "balcony" ? Y_BALCONY : Y_ROOM} />
        )}
      </group>
      <LabelProjector model={model} height={wallHeight} selectedId={selectedId} els={labelEls} overlay={show2D && view === "top"} />
      {import.meta.env.DEV && <DevProbe origin={[cx, cz]} />}
    </>
  );
}

/** Dev builds only: `window.__fp3dProject(x, z, y)` maps plan feet to page px, for browser tests. */
function DevProbe({ origin }: { origin: [number, number] }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    const w = window as unknown as { __fp3dProject?: (x: number, z: number, y?: number) => [number, number] };
    w.__fp3dProject = (x, z, y = 0) => {
      const { camera, gl } = get();
      const v = new THREE.Vector3(x - origin[0], y, z - origin[1]).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    };
    return () => {
      delete w.__fp3dProject;
    };
  }, [get, origin[0], origin[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Lights({ model }: { model: PlanModel }) {
  const light = useRef<THREE.DirectionalLight>(null!);
  const r = Math.max(model.bounds.sx, model.bounds.sz) / 2 + 6;
  useLayoutEffect(() => {
    const cam = light.current.shadow.camera;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = 1;
    cam.far = r * 6;
    cam.updateProjectionMatrix();
  }, [r]);
  return (
    <>
      {/* physically based units: ~pi total for full-brightness surfaces */}
      <hemisphereLight args={["#ffffff", "#e2ddd5", 2.1]} />
      {/* sun from the south-west, on the camera's side, so the faces we look at are lit */}
      <directionalLight
        ref={light}
        castShadow
        position={[-r * 0.7, r * 1.7, r * 0.9]}
        intensity={1.7}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.05}
        shadow-radius={5}
      />
    </>
  );
}

/** Smallest distance along `dir` at which every point projects inside the frustum (|ndc| <= mx, my). */
function fitDistance(camera: THREE.PerspectiveCamera, points: THREE.Vector3[], center: THREE.Vector3, dir: THREE.Vector3,
  mx: number, my: number): number {
  const cam = camera.clone();
  cam.updateProjectionMatrix();
  const p = new THREE.Vector3();
  // lateral fit only: "inside the far plane" is not monotonic in distance and would break the search
  let lo = 0.5, hi = camera.far * 0.5;
  for (let i = 0; i < 40; i++) {
    const d = (lo + hi) / 2;
    cam.position.copy(center).addScaledVector(dir, d);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    const fits = points.every((c) => {
      p.copy(c).project(cam);
      return Math.abs(p.x) <= mx && Math.abs(p.y) <= my;
    });
    if (fits) hi = d;
    else lo = d;
  }
  return hi;
}

/** Outline vertices to frame (whole plan, or one room plus a margin) at floor and wall-top
 *  height, in scene coordinates (plan center at the origin). */
function fitPoints(model: PlanModel, height: number, focusId: string | null): THREE.Vector3[] {
  const { cx, cz } = model.bounds;
  const pts: THREE.Vector3[] = [];
  const add = ([x, z]: [number, number]) => {
    pts.push(new THREE.Vector3(x - cx, 0, z - cz), new THREE.Vector3(x - cx, height, z - cz));
  };
  const room = focusId ? model.rooms.find((r) => r.room.id === focusId) : undefined;
  if (room) {
    const m = 2; // ft of context around the room
    const xs = room.poly.map((p) => p[0]), zs = room.poly.map((p) => p[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs) - m, Math.max(...xs) + m, Math.min(...zs) - m, Math.max(...zs) + m];
    ([[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as [number, number][]).forEach(add);
  } else {
    model.walls.forEach((w) => w.outer.forEach(add));
    model.rooms.forEach((r) => r.poly.forEach(add));
  }
  return pts;
}

/** Canvas size, updated only once a resize has settled (re-fitting on every resize event would fight the user). */
function useSettledSize(): string {
  const size = useThree((s) => s.size);
  const [key, setKey] = useState(() => `${Math.round(size.width)}x${Math.round(size.height)}`);
  useEffect(() => {
    const next = `${Math.round(size.width)}x${Math.round(size.height)}`;
    if (next === key) return;
    const t = setTimeout(() => setKey(next), 250);
    return () => clearTimeout(t);
  }, [size.width, size.height, key]);
  return key;
}

/** Perspective view from one of the angle presets, or straight-down orthographic view, both fitted to the
 *  plan (or to the focused room). Re-fits when the view, preset, focus or canvas size changes. */
function CameraRig({ model, view, resetKey, wallHeight, onReady, fit, focusId, angle, angleOffset, sizeKey }: {
  model: PlanModel;
  view: ViewMode;
  resetKey: number;
  wallHeight: number;
  onReady?: () => void;
  fit: RefObject<FitState>;
  focusId: string | null;
  angle: Angle;
  angleOffset: number;
  sizeKey: string;
}) {
  const controls = useThree((s) => s.controls) as unknown as CameraControlsImpl | null;
  const get = useThree((s) => s.get);
  const last = useRef<CameraControlsImpl | null>(null);
  const height = useRef(wallHeight);
  height.current = wallHeight; // re-fit on view changes only, not while dragging the slider

  useEffect(() => {
    if (!controls) return;
    const animate = last.current === controls; // same camera: smooth reset; new camera: jump
    last.current = controls;
    const { camera, size } = get();
    const pts = fitPoints(model, height.current, focusId);
    const frame = new THREE.Box3().setFromPoints(pts);
    const center = frame.getCenter(new THREE.Vector3());
    const sx = frame.max.x - frame.min.x, sz = frame.max.z - frame.min.z;
    const pad = focusId ? 0.5 : Math.max(1.5, Math.max(sx, sz) * 0.03);
    const top = view === "top";
    const A = CameraControlsImpl.ACTION;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = top ? 0 : THREE.MathUtils.degToRad(84);
    controls.minAzimuthAngle = top ? 0 : -Infinity;
    controls.maxAzimuthAngle = top ? 0 : Infinity;
    controls.mouseButtons.left = top ? A.TRUCK : A.ROTATE;
    controls.touches.one = top ? A.TOUCH_TRUCK : A.TOUCH_ROTATE;
    controls.dollyToCursor = true;
    let cancelled = false;
    (async () => {
      if (top) {
        // camera on the +Z side of straight-down: screen-up = -Z = image top, screen-right = +X
        const ui = uiMargin(size.width);
        const zoom = Math.min(size.width / (sx + 2 * pad), Math.max(100, size.height - 2 * ui) / (sz + 2 * pad));
        fit.current = { zoom, distance: TOP_CAMERA_Y };
        await Promise.all([
          controls.setLookAt(center.x, TOP_CAMERA_Y, center.z + 0.001, center.x, 0, center.z, animate),
          controls.zoomTo(zoom, animate),
        ]);
      } else {
        const a = ANGLES[angle];
        const dir = new THREE.Vector3().setFromSphericalCoords(
          1,
          THREE.MathUtils.degToRad(focusId ? a.focusPolar : a.polar),
          THREE.MathUtils.degToRad(a.azimuth + angleOffset),
        );
        const my = Math.max(0.4, 1 - (2 * uiMargin(size.width)) / size.height);
        const d = fitDistance(camera as THREE.PerspectiveCamera, pts, center, dir, 0.92, my);
        fit.current = { zoom: 1, distance: d };
        const eye = center.clone().addScaledVector(dir, d);
        await controls.setLookAt(eye.x, eye.y, eye.z, center.x, center.y, center.z, animate);
      }
      if (!cancelled) onReady?.();
    })();
    return () => {
      cancelled = true;
    };
  }, [controls, view, resetKey, model, onReady, get, fit, focusId, angle, angleOffset, sizeKey]);
  return null;
}

/** "Rotate 45°": turn the current 3D camera around its target (relative, so manual orbits are kept). */
function Spin({ spin, view }: { spin?: { seq: number; deg: number }; view: ViewMode }) {
  const controls = useThree((s) => s.controls) as unknown as CameraControlsImpl | null;
  const done = useRef(spin?.seq ?? 0);
  useEffect(() => {
    if (!controls || !spin || spin.seq === done.current) return;
    done.current = spin.seq;
    if (view === "3d") controls.rotate(THREE.MathUtils.degToRad(spin.deg), 0, true);
  }, [controls, spin, view]);
  return null;
}

/**
 * Keep the model clear of the room panel: shrink it into the visible part of the canvas and shift
 * it left (desktop side panel) or up (phone bottom sheet); undo when the panel closes.
 */
function PanelOffset({ open, view, resetKey, fit, focusId, sizeKey, angle, angleOffset, folded }: {
  open: boolean;
  view: ViewMode;
  resetKey: number;
  fit: RefObject<FitState>;
  // the framing changed: recompute the offset at the new zoom / distance
  focusId: string | null;
  sizeKey: string;
  angle: Angle;
  angleOffset: number;
  folded: boolean;
}) {
  const controls = useThree((s) => s.controls) as unknown as CameraControlsImpl | null;
  const get = useThree((s) => s.get);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!controls || (!open && !wasOpen.current)) return; // nothing to undo
    wasOpen.current = open;
    const t = setTimeout(() => {
      const { camera, size } = get();
      const phone = size.width < 640;
      const panel = phone ? (folded ? 64 : 0.46 * size.height) : Math.min(300, size.width * 0.45); // px the panel covers
      const keep = open ? Math.max(0.45, 1 - panel / (phone ? size.height : size.width)) : 1;
      const shift: [number, number] = open ? (phone ? [0, panel / 2] : [panel / 2, 0]) : [0, 0];
      // camera-controls focal offset: +x shifts the scene left, +y shifts it up on screen
      if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
        const zoom = fit.current.zoom * keep;
        controls.zoomTo(zoom, true);
        controls.setFocalOffset(shift[0] / zoom, shift[1] / zoom, 0, true);
      } else {
        const dist = fit.current.distance / keep;
        controls.dollyTo(dist, true);
        const perPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov) / 2)) / size.height;
        controls.setFocalOffset(shift[0] * perPx, shift[1] * perPx, 0, true);
      }
    }, 0); // after the view fit has run
    return () => clearTimeout(t);
  }, [controls, open, view, resetKey, get, fit, focusId, sizeKey, angle, angleOffset, folded]);
  return null;
}

/** With the 2D plan under the top view, move each label off the printed room name and dims (two lines):
 *  below them, or above if below is outside the room. Small rooms get no label there unless selected. */
function overlayAnchors(model: PlanModel): ([number, number] | null)[] {
  return model.rooms.map(({ room, poly }) => {
    if (room.type === "closet" || (room.area_sqft_final ?? 0) < 30) return null;
    const [px, pz] = [room.label_point[0] / model.ppf, room.label_point[1] / model.ppf];
    for (const dz of [3.4, -2.6, 4.4, -3.6]) if (pointInPoly([px, pz + dz], poly)) return [px, pz + dz];
    return null;
  });
}

/** Positions the DOM labels every frame; bigger rooms win when labels would overlap. */
function LabelProjector({ model, height, selectedId, els, overlay }: {
  model: PlanModel;
  height: number;
  selectedId: string | null;
  els: RefObject<(HTMLElement | null)[]>;
  overlay: boolean;
}) {
  const v = useMemo(() => new THREE.Vector3(), []);
  const anchors = useMemo(() => overlayAnchors(model), [model]);
  const order = useMemo(() => {
    const score = (e: RoomEntry) =>
      (e.room.id === selectedId ? 1e9 : 0) + (e.room.type === "closet" ? 0 : 1e6) + (e.room.area_sqft_final ?? 0);
    return model.rooms.map((_, i) => i).sort((a, b) => score(model.rooms[b]) - score(model.rooms[a]));
  }, [model, selectedId]);
  useFrame(({ camera, size }) => {
    const placed: number[][] = [];
    const { cx, cz } = model.bounds;
    for (const i of order) {
      const el = els.current?.[i];
      if (!el) continue;
      const entry = model.rooms[i];
      const isSel = entry.room.id === selectedId;
      const anchor = overlay ? (anchors[i] ?? (isSel ? entry.labelAt : null)) : entry.labelAt;
      // phones: no labels for closets and other tiny rooms unless selected
      const tiny = size.width < 640 && (entry.room.type === "closet" || (entry.room.area_sqft_final ?? 0) < 30);
      if (!anchor || (tiny && !isSel)) {
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        continue;
      }
      const [x, z] = anchor;
      v.set(x - cx, height + LABEL_LIFT, z - cz).project(camera);
      const px = ((v.x + 1) / 2) * size.width;
      const py = ((1 - v.y) / 2) * size.height;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // try the spot itself, then nudged up / down by one label height; hide if all collide
      let dy = 0;
      let r: number[] = [];
      let free = false;
      for (const off of [0, -(h + 3), h + 3]) {
        r = [px - w / 2 - 2, py + off - h / 2 - 1, px + w / 2 + 2, py + off + h / 2 + 1];
        free = !placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
        if (free) {
          dy = off;
          break;
        }
      }
      const selected = model.rooms[i].room.id === selectedId;
      if (!free) dy = 0;
      const show = v.z > -1 && v.z < 1 && (free || selected);
      el.style.transform = `translate(${Math.round(px - w / 2)}px, ${Math.round(py + dy - h / 2)}px)`;
      el.style.opacity = show ? "1" : "0";
      el.style.pointerEvents = show ? "auto" : "none";
      if (show) placed.push(free ? r : [px - w / 2, py - h / 2, px + w / 2, py + h / 2]);
    }
  });
  return null;
}

function Ground({ model }: { model: PlanModel }) {
  const { cx, cz, sx, sz } = model.bounds;
  const size = Math.max(sx, sz) * 30 + 600;
  return (
    <mesh position={[cx, Y_GROUND, cz]} rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color={GROUND} roughness={1} />
    </mesh>
  );
}

/** One continuous floor under walls + hallways (rooms sit on top of it): any floor no room covers
 *  shows the slab, in the neutral hallway color. */
function Slab({ model }: { model: PlanModel }) {
  const geos = useMemo(() => model.footprint.map((p) => flatGeometry(p)), [model]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  return (
    <>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} position-y={Y_SLAB} receiveShadow>
          <meshStandardMaterial color={SLAB} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

function RoomFloor({ entry, selected, hovered, subtle, onSelect, onHover }: {
  entry: RoomEntry;
  selected: boolean;
  hovered: boolean;
  /** editing furniture: only tint the selected room, so the green / red fit plates stand out */
  subtle: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const { room, poly } = entry;
  const balcony = room.type === "balcony";
  const geo = useMemo(() => flatGeometry(poly), [poly]);
  const planks = useMemo(() => (balcony ? plankTexture() : null), [balcony]);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => planks?.dispose(), [planks]);
  const outline = useMemo(() => [...poly, poly[0]].map(([x, z]) => [x, Y_OUTLINE, z] as [number, number, number]), [poly]);

  const base = new THREE.Color(ROOM_COLORS[room.type] ?? ROOM_COLORS.other);
  const color = selected
    ? subtle
      ? base.clone().lerp(new THREE.Color(ACCENT_SOFT), 0.3)
      : new THREE.Color(ACCENT_SOFT)
    : hovered
      ? base.clone().lerp(new THREE.Color("#ffffff"), 0.35)
      : base;
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // that was an orbit drag
    e.stopPropagation();
    onSelect(room.id);
  };
  return (
    <>
      <mesh
        geometry={geo}
        position-y={balcony ? Y_BALCONY : Y_ROOM}
        receiveShadow
        onClick={click}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(room.id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = "";
        }}
      >
        {balcony ? (
          <meshStandardMaterial map={planks} color={selected ? ACCENT_SOFT : "#ffffff"} roughness={1} side={THREE.DoubleSide} />
        ) : (
          <meshStandardMaterial color={color} roughness={0.85} side={THREE.DoubleSide} />
        )}
      </mesh>
      {selected && (
        <Line points={balcony ? outline.map(([x, , z]) => [x, Y_BALCONY + 0.08, z] as [number, number, number]) : outline} color={ACCENT} lineWidth={3} />
      )}
    </>
  );
}

interface Cut {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number; // floor height of the room
}

type CutUniforms = {
  uCutOn: { value: number };
  uEye: { value: THREE.Vector3 };
  uCutBox: { value: THREE.Vector4 };
  uCutY: { value: number };
};

// A wall fragment is "in the way" when the ray from the eye through it, continued, lands inside the selected
// room's box at floor height or at 3 ft (furniture height). Those fragments fade, and stop casting shadows.
const CUT_GLSL = /* glsl */ `
varying vec3 vCutWorld;
uniform float uCutOn;
uniform vec3 uEye;
uniform vec4 uCutBox; // minX, minZ, maxX, maxZ (world)
uniform float uCutY;
float cutHit(float h) {
  vec3 d = vCutWorld - uEye;
  if (vCutWorld.y <= h + 0.05 || d.y > -1e-4) return 0.0;
  float t = (h - uEye.y) / d.y;
  vec2 p = uEye.xz + t * d.xz;
  return (t > 1.0 && p.x > uCutBox.x && p.x < uCutBox.z && p.y > uCutBox.y && p.y < uCutBox.w) ? 1.0 : 0.0;
}
float cutAmount() { return uCutOn * max(cutHit(uCutY), cutHit(uCutY + 3.0)); }
`;

function withCutaway<M extends THREE.Material>(mat: M, uniforms: CutUniforms, depth: boolean): M {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCutWorld;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>\n${CUT_GLSL}`);
    shader.fragmentShader = depth
      ? shader.fragmentShader.replace("void main() {", "void main() {\n  if (cutAmount() > 0.5) discard;")
      : shader.fragmentShader.replace("#include <dithering_fragment>", "#include <dithering_fragment>\n  gl_FragColor.a *= mix(1.0, 0.14, cutAmount());");
  };
  mat.customProgramCacheKey = () => (depth ? "cutaway-depth" : "cutaway");
  return mat;
}

// doors and windows (ft): heads line up, windows sit on a sill
const HEAD_FT = 6.9;
const SILL_FT = 2.8;
const FRAME = "#9a7b5e";
const GLASS = "#a9d6ea";

type Piece = { size: [number, number, number]; pos: [number, number, number] };

/** Boxes that turn the parser's openings into doors and windows: the wall above every opening, the
 *  sill below windows (both cut away like walls), glass, and door frames. */
function openingPieces(model: PlanModel, height: number): { wall: Piece[]; glass: Piece[]; frame: Piece[] } {
  const head = Math.min(HEAD_FT, height - 0.3);
  const wall: Piece[] = [], glass: Piece[] = [], frame: Piece[] = [];
  for (const o of model.openings) {
    const along = o.axis === "h" ? o.x1 - o.x0 : o.z1 - o.z0;
    const deep = o.axis === "h" ? o.z1 - o.z0 : o.x1 - o.x0;
    const [cx, cz] = [(o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2];
    const box = (l: number, h: number, d: number, y: number, shift = 0): Piece => ({
      size: o.axis === "h" ? [l, h, d] : [d, h, l],
      pos: o.axis === "h" ? [cx + shift, y, cz] : [cx, y, cz + shift],
    });
    if (height - head > 0.05) wall.push(box(along, height - head, deep, (head + height) / 2));
    if (o.kind === "window") {
      wall.push(box(along, SILL_FT, deep, SILL_FT / 2));
      glass.push(box(along, head - SILL_FT, 0.05, (SILL_FT + head) / 2));
      frame.push(box(along, 0.1, deep * 0.6, SILL_FT + 0.05), box(along, 0.1, deep * 0.6, head - 0.05));
    } else if (o.kind === "door" && along > 0.6) {
      const post = 0.12;
      frame.push(box(post, head, deep, head / 2, -along / 2 + post / 2), box(post, head, deep, head / 2, along / 2 - post / 2), box(along, 0.14, deep, head - 0.07));
    }
  }
  return { wall, glass, frame };
}

function Walls({ model, height, ghost, cut, openings }: { model: PlanModel; height: number; ghost: boolean; cut: Cut | null; openings: boolean }) {
  const geos = useMemo(() => model.walls.map((w) => wallGeometry(w.outer, w.holes)), [model]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  const uniforms = useMemo<CutUniforms>(
    () => ({ uCutOn: { value: 0 }, uEye: { value: new THREE.Vector3() }, uCutBox: { value: new THREE.Vector4() }, uCutY: { value: 0 } }),
    [],
  );
  const mats = useMemo(
    () => [WALL_CAP, WALL_SIDE].map((color) => withCutaway(new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: true }), uniforms, false)),
    [uniforms],
  );
  const depthMat = useMemo(() => withCutaway(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), uniforms, true), [uniforms]);
  // door frames fade with the walls they sit in
  const frameMat = useMemo(() => withCutaway(new THREE.MeshStandardMaterial({ color: FRAME, roughness: 0.7, transparent: true }), uniforms, false), [uniforms]);
  useEffect(() => () => [...mats, depthMat, frameMat].forEach((m) => m.dispose()), [mats, depthMat, frameMat]);
  useEffect(() => {
    for (const m of mats) {
      m.opacity = ghost ? 0.45 : 1; // see-through walls while the 2D plan is shown, so the drawn walls stay visible
      m.depthWrite = !ghost;
      m.needsUpdate = true;
    }
  }, [ghost, mats]);
  useFrame(({ camera }) => {
    uniforms.uEye.value.copy(camera.position);
    uniforms.uCutOn.value = cut && !(camera as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
    if (cut) {
      uniforms.uCutBox.value.set(cut.minX, cut.minZ, cut.maxX, cut.maxZ);
      uniforms.uCutY.value = cut.y;
    }
  });
  const pieces = useMemo(() => (openings ? openingPieces(model, height) : { wall: [], glass: [], frame: [] }), [model, height, openings]);
  // drawn after the floor plates / doorway zones (transparent too), so those show through faded walls
  return (
    <>
      <group scale={[1, height, 1]}>
        {geos.map((g, i) => (
          <mesh key={i} geometry={g} material={mats} customDepthMaterial={depthMat} castShadow={!ghost} receiveShadow renderOrder={10} />
        ))}
      </group>
      {pieces.wall.map((p, i) => (
        <mesh key={`w${i}`} position={p.pos} material={mats[1]} customDepthMaterial={depthMat} castShadow={!ghost} receiveShadow renderOrder={10}>
          <boxGeometry args={p.size} />
        </mesh>
      ))}
      {pieces.frame.map((p, i) => (
        <mesh key={`f${i}`} position={p.pos} material={frameMat} customDepthMaterial={depthMat} castShadow receiveShadow renderOrder={10}>
          <boxGeometry args={p.size} />
        </mesh>
      ))}
      {pieces.glass.map((p, i) => (
        <mesh key={`g${i}`} position={p.pos} renderOrder={11}>
          <boxGeometry args={p.size} />
          <meshStandardMaterial color={GLASS} transparent opacity={0.38} roughness={0.08} metalness={0.1} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

/** The original image laid on the floor, multiplied over it: white paper disappears, ink stays. */
function PlanImage({ model, url }: { model: PlanModel; url: string }) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let alive = true;
    new THREE.TextureLoader().load(
      url,
      (t) => {
        if (!alive) return t.dispose();
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        setTex(t);
      },
      undefined,
      () => setTex(null),
    );
    return () => {
      alive = false;
    };
  }, [url]);
  useEffect(() => () => tex?.dispose(), [tex]);
  if (!tex) return null;
  const { w, h } = model.image;
  // image pixel (0,0) is scene (0,0); local +Y (image top) maps to -Z after the rotation
  return (
    <mesh position={[w / 2, Y_IMAGE, h / 2]} rotation-x={-Math.PI / 2} renderOrder={1}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial
        map={tex}
        transparent
        opacity={0.85}
        blending={THREE.MultiplyBlending}
        premultipliedAlpha
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
