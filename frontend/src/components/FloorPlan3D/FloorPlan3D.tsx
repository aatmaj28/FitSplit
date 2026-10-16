import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ParsedPlan, Room } from "../../types";
import { FitChecker, autoPlace, describe, newId, snapCenter, type FurnitureItem, type FurnitureKind } from "./furniture";
import { FurniturePanel } from "./FurniturePanel";
import { FALLBACK_PPF, buildModel } from "./geometry";
import { LabelLayer } from "./LabelLayer";
import { furnish, styleOf, type RoomStyle } from "./livedIn";
import { PlanScene, type Angle, type ViewMode } from "./PlanScene";
import { RoomPanel } from "./RoomPanel";
import { estimateLabel, isEstimated } from "./theme";
import { useLayout } from "./useLayout";
import { Legend, ResetViewButton, ViewerToolbar } from "./ViewerToolbar";

export interface FloorPlan3DProps {
  /** Parsed plan JSON from the backend (`POST /api/parse` or `GET /api/plans/{name}`). */
  plan: ParsedPlan;
  /** Original floor plan image; enables "Show 2D plan". */
  imageUrl?: string;
  /** Wall height in feet (the slider starts here). */
  wallHeight?: number;
  initialView?: ViewMode;
  initialShow2D?: boolean;
  /** Hide the toolbar / legend, e.g. for small embeds. */
  showControls?: boolean;
  className?: string;
  /** Adds "Edit layout": place furniture and check whether it fits (saved per plan in localStorage). */
  editable?: boolean;
  /** Controlled room selection (e.g. synced with <RentSplit />). Leave undefined to let the viewer own it. */
  selectedRoomId?: string | null;
  onRoomSelect?: (room: Room | null) => void;
  /** localStorage key for the furniture layout; defaults to the plan name. */
  layoutKey?: string;
  /** Furniture shown until the user saves their own layout under `layoutKey`. */
  defaultLayout?: FurnitureItem[];
  /** Show the clicked room's details panel (embeds that show room facts themselves turn it off). */
  roomPanel?: boolean;
  /** Start in the lived-in look (painted walls, floor materials) instead of the plan's type colors. */
  initialLivedIn?: boolean;
  /** Per-room paint / floor from the listing's photos (room id -> style); others use the soft palette. */
  roomStyle?: Record<string, RoomStyle>;
  /** Extra content in a clicked room's panel, e.g. the listing's photos of that room. */
  roomExtra?: (room: Room) => ReactNode;
}

/** 3D model of a parsed floor plan: 1 scene unit = 1 ft, top view matches the 2D image. */
export function FloorPlan3D({
  plan,
  imageUrl,
  wallHeight = 9,
  initialView = "3d",
  initialShow2D = false,
  showControls = true,
  className = "",
  editable = false,
  selectedRoomId,
  onRoomSelect,
  layoutKey,
  defaultLayout,
  roomPanel = true,
  initialLivedIn = false,
  roomStyle,
  roomExtra,
}: FloorPlan3DProps) {
  const model = useMemo(() => buildModel(plan), [plan]);
  const checker = useMemo(() => new FitChecker(model), [model]);
  const [livedIn, setLivedIn] = useState(initialLivedIn);
  const [furnished, setFurnished] = useState(false);
  const styleKey = JSON.stringify(roomStyle ?? null);
  const styles = useMemo(
    () => (livedIn ? new Map(plan.rooms.map((r) => [r.id, styleOf(r.type, roomStyle?.[r.id])])) : null),
    [livedIn, plan, styleKey], // eslint-disable-line react-hooks/exhaustive-deps -- roomStyle by value
  );
  const furnishedItems = useMemo(() => (furnished ? furnish(model, checker) : []), [furnished, model, checker]);
  const [view, setView] = useState<ViewMode>(initialView);
  const [angle, setAngle] = useState<Angle>("corner");
  const [angleOffset, setAngleOffset] = useState(0);
  const [spin, setSpin] = useState({ seq: 0, deg: 0 });
  const [resetKey, setResetKey] = useState(0);
  const [show2D, setShow2D] = useState(initialShow2D);
  const [height, setHeight] = useState(wallHeight);
  const [ownRoom, setOwnRoom] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useLayout(layoutKey ?? plan.plan_name ?? plan.source_image, defaultLayout);
  const [itemId, setItemId] = useState<string | null>(null);
  const [autoMessage, setAutoMessage] = useState<string | null>(null);
  const [folded, setFolded] = useState(false); // phones: room sheet folded to its title row
  const pointerDown = useRef<[number, number] | null>(null);
  const labelEls = useRef<(HTMLElement | null)[]>([]);

  const controlled = selectedRoomId !== undefined;
  const roomId = controlled ? selectedRoomId : ownRoom;

  useEffect(() => {
    setOwnRoom(null);
    setItemId(null);
    setReady(false);
  }, [plan]);

  const fits = useMemo(() => new Map(items.map((it) => [it.id, checker.check(it, items)])), [items, checker]);
  // furnished view: the auto-placed set while not editing (your own layout comes back in edit mode)
  const showFurnished = furnished && !editing;
  const shownItems = showFurnished ? furnishedItems : items;
  const shownFits = useMemo(() => (showFurnished ? new Map(furnishedItems.map((it) => [it.id, { ok: true, issues: [] } as unknown as ReturnType<FitChecker["check"]>])) : fits), [showFurnished, furnishedItems, fits]);
  const doorZones = useMemo(
    () => (editing && roomId ? checker.doorways(roomId).map((d) => d.zone as [number, number][]) : []),
    [editing, roomId, checker],
  );
  const describeItem = useCallback(
    (it: FurnitureItem) => describe(it, fits.get(it.id), it.roomId ? (checker.rooms.get(it.roomId)?.name ?? null) : null),
    [fits, checker],
  );

  const selectRoom = useCallback(
    (id: string | null) => {
      if (!controlled) setOwnRoom(id);
      onRoomSelect?.(id ? (plan.rooms.find((r) => r.id === id) ?? null) : null);
      setAutoMessage(null);
    },
    [controlled, onRoomSelect, plan],
  );
  const selectFromScene = useCallback(
    (id: string | null) => {
      setItemId(null);
      selectRoom(id);
    },
    [selectRoom],
  );
  const selectItem = useCallback(
    (id: string) => {
      setItemId(id);
      const it = items.find((i) => i.id === id);
      if (it?.roomId && it.roomId !== roomId) selectRoom(it.roomId);
    },
    [items, roomId, selectRoom],
  );

  /** Move an item: snap to the 3" grid of the room it lands in. It changes rooms only when its
   *  center is inside another room; pushed into a wall or a doorway it keeps its room (and shows red). */
  const place = useCallback(
    (it: FurnitureItem, x: number, z: number): FurnitureItem => {
      const target = checker.roomAt([x, z]) ?? it.roomId;
      const [sx, sz] = snapCenter(it, x, z, checker.roomOrigin(target));
      return { ...it, x: sx, z: sz, roomId: checker.roomAt([sx, sz]) ?? it.roomId };
    },
    [checker],
  );
  const update = useCallback(
    (id: string, f: (it: FurnitureItem) => FurnitureItem) => setItems((prev) => prev.map((i) => (i.id === id ? f(i) : i))),
    [setItems],
  );
  const add = (k: FurnitureKind) => {
    const entry = model.rooms.find((r) => r.room.id === roomId);
    if (!entry) return;
    const [x, z] = entry.labelAt; // near the room center
    const it = place({ id: newId(), kind: k.kind, name: k.name, w: k.w, d: k.d, h: k.h, color: k.color, x, z, rot: 0, roomId: entry.room.id }, x, z);
    setItems((prev) => [...prev, it]);
    setItemId(it.id);
  };
  const rotate = useCallback((id: string) => update(id, (i) => place({ ...i, rot: (i.rot + 90) % 360 }, i.x, i.z)), [update, place]);
  const remove = useCallback(
    (id: string) => {
      setItems((prev) => prev.filter((i) => i.id !== id));
      setItemId((cur) => (cur === id ? null : cur));
    },
    [setItems],
  );
  const nudge = useCallback((id: string, dx: number, dz: number) => update(id, (i) => place(i, i.x + dx, i.z + dz)), [update, place]);
  const drag = useCallback((id: string, x: number, z: number) => update(id, (i) => place(i, x, z)), [update, place]);
  const runAutoPlace = (kinds: FurnitureKind[]) => {
    if (!roomId) return;
    const { placed, failed, blocking } = autoPlace(kinds, roomId, items, checker);
    setItems((prev) => [...prev, ...placed]);
    const room = checker.rooms.get(roomId)?.name ?? "this room";
    const inTheWay = blocking.length ? ` ${blocking.map((p) => p.name).join(", ")} had to go in front of a doorway.` : "";
    setAutoMessage(
      (failed.length === 0
        ? `All ${placed.length} fit in ${room} ✓`
        : `${placed.length ? `Placed ${placed.map((p) => p.name).join(", ")}. ` : ""}No room left for ${failed.map((f) => f.name).join(", ")}.`) + inTheWay,
    );
  };
  const reset = () => {
    setItems([]);
    setItemId(null);
    setAutoMessage(null);
  };

  // the panel follows a selected piece that was moved into another room
  const selectedItemRoom = items.find((i) => i.id === itemId)?.roomId ?? null;
  useEffect(() => {
    if (selectedItemRoom && selectedItemRoom !== roomId) selectRoom(selectedItemRoom);
  }, [selectedItemRoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // R rotate, Delete remove, arrows nudge 3" (Shift: 1 ft), Esc deselect
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!itemId || (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)))) return;
      const step = e.shiftKey ? 1 : 0.25;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (e.key === "r" || e.key === "R") rotate(itemId);
      else if (e.key === "Delete" || e.key === "Backspace") remove(itemId);
      else if (moves[e.key]) nudge(itemId, ...moves[e.key]);
      else if (e.key === "Escape") setItemId(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, itemId, rotate, remove, nudge]);

  const onReady = useCallback(() => setReady(true), []);
  /** Top, or one of the 3D angle presets; picking the active one again re-fits the camera. */
  const pickPreset = (p: "top" | Angle) => {
    if (p === "top") return view === "top" ? setResetKey((k) => k + 1) : setView("top");
    if (view === "3d" && angle === p && angleOffset === 0) return setResetKey((k) => k + 1);
    setAngle(p);
    setAngleOffset(0);
    setView("3d");
  };
  /** Reset view: the starting view and angle, re-fitted (also after orbiting, zooming or panning by hand). */
  const resetView = () => {
    setView(initialView);
    setAngle("corner");
    setAngleOffset(0);
    setResetKey((k) => k + 1);
  };
  /** Rotate 45°: turns the 3D camera; from the top view it switches to the 3D corner view turned by 45°. */
  const rotateView = (deg: number) => {
    if (view === "top") {
      setAngle("corner");
      setAngleOffset(deg);
      setView("3d");
    } else setSpin((s) => ({ seq: s.seq + 1, deg }));
  };
  const room = roomId ? (plan.rooms.find((r) => r.id === roomId) ?? null) : null;
  useEffect(() => setFolded(false), [roomId]);
  const roomItems = room ? items.filter((i) => i.roomId === room.id) : [];

  return (
    <div
      className={`relative h-full w-full overflow-hidden rounded-2xl bg-slate-50 ring-1 ring-slate-200 ${className}`}
      data-ready={ready}
      data-view={view}
      data-angle={view === "top" ? "top" : angle}
      data-editing={editing}
      data-lived-in={livedIn}
      data-furnished={showFurnished ? furnishedItems.length : undefined}
      data-item-selected={editing && itemId != null}
      onPointerDown={(e) => {
        pointerDown.current = [e.clientX, e.clientY];
      }}
    >
      <Canvas
        shadows="percentage"
        flat
        dpr={[1, 2]}
        gl={{ antialias: true }}
        onPointerMissed={(e) => {
          const d = pointerDown.current;
          if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) < 5) selectFromScene(null); // not after an orbit drag
        }}
      >
        <PlanScene
          model={model}
          view={view}
          resetKey={resetKey}
          show2D={show2D}
          imageUrl={imageUrl}
          wallHeight={height}
          selectedId={roomId}
          onSelect={selectFromScene}
          onReady={onReady}
          labelEls={labelEls}
          furniture={{ items: shownItems, fits: shownFits, selectedId: showFurnished ? null : itemId, editing, doorZones, onSelect: selectItem, onDrag: drag, plain: showFurnished }}
          styles={styles}
          focusId={editing ? roomId : null}
          angle={angle}
          angleOffset={angleOffset}
          spin={spin}
          panelFolded={folded}
          panelOpen={Boolean(room) && roomPanel}
        />
      </Canvas>
      <LabelLayer model={model} selectedId={roomId} onSelect={selectFromScene} els={labelEls} passThrough={editing} />

      {showControls && (
        <>
          <ViewerToolbar
            preset={view === "top" ? "top" : angle}
            onPreset={pickPreset}
            onRotate={rotateView}
            onResetView={resetView}
            show2D={show2D}
            onShow2D={setShow2D}
            canShow2D={Boolean(imageUrl)}
            wallHeight={height}
            onWallHeight={setHeight}
            editable={editable}
            editing={editing}
            onEditing={(v) => {
              setEditing(v);
              if (!v) setItemId(null);
            }}
            onReset={reset}
            itemCount={items.length}
            livedIn={livedIn}
            onLivedIn={setLivedIn}
            furnished={furnished}
            onFurnished={setFurnished}
          />
          <Legend model={model} editing={editing} styles={styles} />
        </>
      )}
      {!showControls && (
        <div className="absolute left-2 top-2 z-30 rounded-full bg-white/90 p-0.5 shadow-sm ring-1 ring-slate-200 backdrop-blur sm:left-3 sm:top-3">
          <ResetViewButton onClick={resetView} />
        </div>
      )}
      {isEstimated(plan) && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-30 rounded-full bg-amber-50/95 px-3 py-1 text-xs font-medium text-amber-900 shadow-sm ring-1 ring-amber-200" data-estimated
          title="Room sizes come from objects of known size in the photos (doors, appliances, beds); room positions are schematic.">
          {estimateLabel(plan)}
        </div>
      )}
      {model.scaleMissing && (
        <div className="absolute bottom-3 right-3 z-30 rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-800 ring-1 ring-amber-200">
          No scale in this plan; assumed {FALLBACK_PPF} px/ft
        </div>
      )}
      {room && roomPanel && (
        <RoomPanel room={room} plan={plan} onClose={() => selectFromScene(null)} onSelect={selectFromScene} compact={editing} folded={folded} onFold={setFolded}>
          {!editing && roomExtra?.(room)}
          {editing && (
            <FurniturePanel
              items={roomItems}
              fits={fits}
              describe={describeItem}
              freeSqft={checker.freeArea(room.id, items)}
              totalSqft={checker.rooms.get(room.id)?.area ?? 0}
              selectedItemId={itemId}
              onSelectItem={setItemId}
              onAdd={add}
              onRotate={rotate}
              onDelete={remove}
              onAutoPlace={runAutoPlace}
              autoMessage={autoMessage}
            />
          )}
        </RoomPanel>
      )}
    </div>
  );
}
