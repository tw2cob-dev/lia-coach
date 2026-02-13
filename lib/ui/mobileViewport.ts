export function bindAppViewportHeightVar(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }

  const root = document.documentElement;

  const updateHeight = () => {
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    root.style.setProperty("--app-vh", `${Math.round(viewportHeight)}px`);
  };

  updateHeight();

  const viewport = window.visualViewport;
  window.addEventListener("resize", updateHeight);
  window.addEventListener("orientationchange", updateHeight);
  viewport?.addEventListener("resize", updateHeight);
  viewport?.addEventListener("scroll", updateHeight);

  return () => {
    window.removeEventListener("resize", updateHeight);
    window.removeEventListener("orientationchange", updateHeight);
    viewport?.removeEventListener("resize", updateHeight);
    viewport?.removeEventListener("scroll", updateHeight);
  };
}
