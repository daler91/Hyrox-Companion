import { useLayoutEffect, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let activeBlockingLayers = 0;

function emitChange() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function hasBlockingLayer() {
  return activeBlockingLayers > 0;
}

function registerBlockingModalLayer() {
  activeBlockingLayers += 1;
  emitChange();

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    activeBlockingLayers = Math.max(0, activeBlockingLayers - 1);
    emitChange();
  };
}

function useBlockingModalLayer() {
  useLayoutEffect(() => registerBlockingModalLayer(), []);
}

export function BlockingModalLayerRegistration() {
  useBlockingModalLayer();
  return null;
}

export function useHasBlockingModalLayer() {
  return useSyncExternalStore(subscribe, hasBlockingLayer, () => false);
}
