import { useCallback, useEffect, useRef, useState } from "react";

interface NavigateOptions {
  replace?: boolean;
}

type Navigate = (to: string, options?: NavigateOptions) => void;

interface PendingNavigation {
  to: string;
  options?: NavigateOptions;
  beforeNavigate?: () => void;
}

interface UseUnsavedChangesPromptOptions {
  readonly enabled: boolean;
  readonly currentPath: string;
  readonly navigate: Navigate;
}

function browserPath(): string {
  return `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`;
}

function normalizeInternalPath(to: string): string {
  const url = new URL(to, globalThis.location.origin);
  return `${url.pathname}${url.search}${url.hash}`;
}

function isSamePath(first: string, second: string): boolean {
  return normalizeInternalPath(first) === normalizeInternalPath(second);
}

function shouldHandleAnchorClick(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !anchor.hasAttribute("download") &&
    (!anchor.target || anchor.target === "_self")
  );
}

export function useUnsavedChangesPrompt({
  enabled,
  currentPath,
  navigate,
}: UseUnsavedChangesPromptOptions) {
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const enabledRef = useRef(enabled);
  const currentPathRef = useRef(currentPath);
  const allowNextNavigationRef = useRef(false);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  const closePrompt = useCallback(() => {
    setIsPromptOpen(false);
    setPendingNavigation(null);
  }, []);

  const requestNavigation = useCallback(
    (to: string, options?: NavigateOptions, beforeNavigate?: () => void): boolean => {
      if (!enabledRef.current || allowNextNavigationRef.current || isSamePath(to, currentPathRef.current)) {
        beforeNavigate?.();
        navigate(to, options);
        return true;
      }

      setPendingNavigation({ to, options, beforeNavigate });
      setIsPromptOpen(true);
      return false;
    },
    [navigate],
  );

  const discardChangesAndNavigate = useCallback(() => {
    if (!pendingNavigation) {
      return;
    }

    allowNextNavigationRef.current = true;
    pendingNavigation.beforeNavigate?.();
    navigate(pendingNavigation.to, pendingNavigation.options);
    closePrompt();
    queueMicrotask(() => {
      allowNextNavigationRef.current = false;
    });
  }, [closePrompt, navigate, pendingNavigation]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || !shouldHandleAnchorClick(event, anchor)) {
        return;
      }

      const url = new URL(anchor.href, globalThis.location.href);
      if (url.origin !== globalThis.location.origin) {
        return;
      }

      const destination = `${url.pathname}${url.search}${url.hash}`;
      if (isSamePath(destination, currentPathRef.current)) {
        return;
      }

      event.preventDefault();
      requestNavigation(destination);
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [enabled, requestNavigation]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const handlePopState = () => {
      if (allowNextNavigationRef.current) {
        return;
      }

      const destination = browserPath();
      if (isSamePath(destination, currentPathRef.current)) {
        return;
      }

      globalThis.history.pushState(null, "", currentPathRef.current);
      setPendingNavigation({ to: destination });
      setIsPromptOpen(true);
    };

    globalThis.addEventListener("popstate", handlePopState);
    return () => globalThis.removeEventListener("popstate", handlePopState);
  }, [enabled]);

  return {
    cancelNavigation: closePrompt,
    discardChangesAndNavigate,
    isPromptOpen,
    requestNavigation,
  };
}
