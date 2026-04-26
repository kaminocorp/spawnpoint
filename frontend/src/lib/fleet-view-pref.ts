import { useSyncExternalStore } from "react";

export type FleetView = "list" | "gallery";

const KEY = "corellia.fleet.view";
const DEFAULT: FleetView = "gallery";

function read(): FleetView {
  if (typeof window === "undefined") return DEFAULT;
  const v = window.localStorage.getItem(KEY);
  return v === "list" || v === "gallery" ? v : DEFAULT;
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function setFleetView(v: FleetView): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, v);
  listeners.forEach((cb) => cb());
}

export function useFleetView(): FleetView {
  return useSyncExternalStore(subscribe, read, () => DEFAULT);
}
