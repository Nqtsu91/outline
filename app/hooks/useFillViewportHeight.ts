import * as React from "react";

/**
 * Computes the height that lets an element reach the bottom of the viewport
 * from wherever it currently sits, so full-bleed surfaces (canvas, tree) use
 * all the room left under the header and any notice above them.
 *
 * @param ref the element to size.
 * @returns the height in pixels, or undefined before the first measure.
 */
export default function useFillViewportHeight(
  ref: React.RefObject<HTMLElement>
): number | undefined {
  const [height, setHeight] = React.useState<number>();

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }

    let frame = 0;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(0, Math.floor(window.innerHeight - top)));
    };
    // Deferred so a measure triggered by the observer never resizes the
    // observed subtree within the same observation pass.
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("resize", schedule);

    // Content appearing above the element (a notice, a banner) moves it
    // without any window resize; the parent's size changes when it does.
    const parent = el.parentElement;
    const observer =
      parent && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(schedule)
        : undefined;
    if (parent) {
      observer?.observe(parent);
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [ref]);

  return height;
}
