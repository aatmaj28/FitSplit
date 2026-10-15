import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParsedPlan, Room } from "../../types";
import { FitChecker, autoPlace, describe, newId, snapCenter, type FurnitureItem, type FurnitureKind } from "./furniture";
import { FurniturePanel } from "./FurniturePanel";
import { FALLBACK_PPF, buildModel } from "./geometry";
import { LabelLayer } from "./LabelLayer";
import { PlanScene, type ViewMode } from "./PlanScene";
import { RoomPanel } from "./RoomPanel";
import { useLayout } from "./useLayout";
import { Legend, ViewerToolbar } from "./ViewerToolbar";

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
}

/** Edit layout lowers the walls to this height (ft) so furniture stays visible in 3D; the slider still works. */
const EDIT_WALL_FT = 4;

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
}: FloorPlan3DProps) {
  const model = useMemo(() => buildModel(plan), [plan]);
  const checker = useMemo(() => new FitChecker(model), [model]);
  const [view, setView] = useState<ViewMode>(initialView);
  const [resetKey, setResetKey] = useState(0);
  const [show2D, setShow2D] = useState(initialShow2D);
  const [height, setHeight] = useState(wallHeight);
  const [ownRoom, setOwnRoom] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useLayout(layoutKey ?? plan.plan_name ?? plan.source_image);
  const [itemId, setItemId] = useState<string | null>(null);
  const [autoMessage, setAutoMessage] = useState<string | null>(null);
  const wallsBeforeEdit = useRef<{ before: number; cut: number } | null>(null);
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
  const changeView = (v: ViewMode) => (v === view ? setResetKey((k) => k + 1) : setView(v));
  const room = roomId ? (plan.rooms.find((r) => r.id === roomId) ?? null) : null;
  const roomItems = room ? items.filter((i) => i.roomId === room.id) : [];

  return (
    <div
      className={`relative h-full w-full overflow-hidden rounded-2xl bg-slate-50 ring-1 ring-slate-200 ${className}`}
      data-ready={ready}
      data-view={view}
      data-editing={editing}
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
          furniture={{ items, fits, selectedId: itemId, editing, doorZones, onSelect: selectItem, onDrag: drag }}
          focusId={editing ? roomId : null}
        />
      </Canvas>
      <LabelLayer model={model} selectedId={roomId} onSelect={selectFromScene} els={labelEls} passThrough={editing} />

      {showControls && (
        <>
          <ViewerToolbar
            view={view}
            onView={changeView}
            show2D={show2D}
            onShow2D={setShow2D}
            canShow2D={Boolean(imageUrl)}
            wallHeight={height}
            onWallHeight={setHeight}
            editable={editable}
            editing={editing}
            onEditing={(v) => {
              setEditing(v);
              if (v) {
                const cut = Math.min(height, EDIT_WALL_FT);
                wallsBeforeEdit.current = { before: height, cut };
                setHeight(cut);
              } else {
                const w = wallsBeforeEdit.current;
                if (w && height === w.cut) setHeight(w.before); // restore unless the slider was moved while editing
                wallsBeforeEdit.current = null;
                setItemId(null);
              }
            }}
            onReset={reset}
            itemCount={items.length}
          />
          <Legend model={model} editing={editing} />
        </>
      )}
      {model.scaleMissing && (
        <div className="absolute bottom-3 right-3 z-30 rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-800 ring-1 ring-amber-200">
          No scale in this plan; assumed {FALLBACK_PPF} px/ft
        </div>
      )}
      {room && (
        <RoomPanel room={room} plan={plan} onClose={() => selectFromScene(null)} onSelect={selectFromScene} compact={editing}>
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
