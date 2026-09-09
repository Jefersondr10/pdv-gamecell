'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Dialog } from '@base-ui/react/dialog';
import { createBackHandlers, installBackGuard } from '@/lib/app-back';

const handlers = createBackHandlers();
export const BackLayerDepth = createContext(0);

export function useAppBackHandler(
  handle: () => boolean,
  enabled = true,
  priority = 0,
) {
  const latest = useRef(handle);
  useEffect(() => {
    latest.current = handle;
  });
  useEffect(
    () =>
      enabled ? handlers.register(() => latest.current(), priority) : undefined,
    [enabled, priority],
  );
}

export function useAppBackGuard(onRoot: () => void, enabled = true) {
  const latest = useRef(onRoot);
  const guard = useRef<ReturnType<typeof installBackGuard> | null>(null);
  const resume = useRef<() => void>(() => {});
  useEffect(() => {
    latest.current = onRoot;
  });
  useEffect(() => {
    if (!enabled) return;
    const install = () => {
      guard.current?.dispose();
      guard.current = installBackGuard(window, () => {
        // A select/popover over a dialog closes before its parent dialog. Escape
        // follows the primitive's own cancellation and focus-restoration logic.
        const transient = document.querySelector(
          '[data-slot="select-content"][data-open], [data-slot="popover-content"][data-open], [data-slot="dropdown-menu-content"][data-open]',
        );
        if (transient) {
          (document.activeElement ?? transient).dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Escape',
              code: 'Escape',
              bubbles: true,
            }),
          );
          return;
        }
        if (!handlers.dispatch()) latest.current();
      });
    };
    resume.current = install;
    install();
    return () => {
      guard.current?.dispose();
      guard.current = null;
      resume.current = () => {};
    };
  }, [enabled]);
  return {
    leave: (onBoundary?: () => void) => guard.current?.leave(onBoundary),
    dispose: () => guard.current?.dispose(),
    resume: () => resume.current(),
  };
}

// Use the same imperative close as the UI primitive, preserving onOpenChange
// cancellation (required guide, save in progress), focus, and controlled state.
export function useBackDismiss(props: Dialog.Root.Props) {
  const depth = useContext(BackLayerDepth);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(
    props.defaultOpen ?? false,
  );
  const internalActions = useRef<Dialog.Root.Actions | null>(null);
  const actions = props.actionsRef ?? internalActions;
  useAppBackHandler(
    () => {
      actions.current?.close();
      return true;
    },
    props.open ?? uncontrolledOpen,
    100 + depth,
  );
  const onOpenChange: NonNullable<Dialog.Root.Props['onOpenChange']> = (
    open,
    details,
  ) => {
    props.onOpenChange?.(open, details);
    if (!details.isCanceled) setUncontrolledOpen(open);
  };
  return { depth: depth + 1, rootProps: { actionsRef: actions, onOpenChange } };
}
