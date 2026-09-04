import { useRef, useCallback } from "react";

export function useScrollSync(
  leftRef: React.RefObject<HTMLDivElement>,
  rightRef: React.RefObject<HTMLDivElement>
) {
  const isSyncing = useRef(false);

  const handleScroll = useCallback(
    (source: "left" | "right") => {
      if (isSyncing.current) return;
      isSyncing.current = true;

      const sourceRef = source === "left" ? leftRef.current : rightRef.current;
      const targetRef = source === "left" ? rightRef.current : leftRef.current;

      if (!sourceRef || !targetRef) {
        isSyncing.current = false;
        return;
      }

      const maxScroll = sourceRef.scrollHeight - sourceRef.clientHeight;
      if (maxScroll <= 0) {
        isSyncing.current = false;
        return;
      }

      const ratio = sourceRef.scrollTop / maxScroll;
      const targetMaxScroll = targetRef.scrollHeight - targetRef.clientHeight;
      targetRef.scrollTop = ratio * targetMaxScroll;

      requestAnimationFrame(() => {
        isSyncing.current = false;
      });
    },
    [leftRef, rightRef]
  );

  return { handleScroll };
}
