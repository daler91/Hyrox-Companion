import { useEffect, useRef } from "react";

/**
 * Attaches an IntersectionObserver to the returned ref's descendants with the
 * `fade-up` class, adding `animate-in` as they scroll into view.
 */
export function useInView() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("animate-in");
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    const children = el.querySelectorAll(".fade-up");
    children.forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, []);
  return ref;
}
