import { useEffect, useRef, useState } from 'react';

/** Width of an element in px (0 until measured, and in environments without layout such as unit tests). */
export function useElementWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry?.contentRect.width ?? 0)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
