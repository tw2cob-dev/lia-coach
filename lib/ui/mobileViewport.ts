const COMPOSER_BOTTOM_OFFSET_CLOSED_PX = -200;
const COMPOSER_BOTTOM_OFFSET_FOCUSED_PX = 0;

export function bindAppViewportHeightVar(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }

  const root = document.documentElement;

  const updateHeight = () => {
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const viewportTop = Math.max(0, window.visualViewport?.offsetTop ?? 0);
    const keyboardLikelyOpen =
      viewportTop > 0 || window.innerHeight - viewportHeight > 80;
    root.style.setProperty("--app-vh", `${Math.round(viewportHeight)}px`);
    root.style.setProperty("--app-vv-top", `${Math.round(viewportTop)}px`);
    const composerPadClosed = `calc(env(safe-area-inset-bottom) + 4px + ${COMPOSER_BOTTOM_OFFSET_CLOSED_PX}px)`;
    const composerPadFocused = `${COMPOSER_BOTTOM_OFFSET_FOCUSED_PX}px`;
    root.style.setProperty(
      "--composer-pad-bottom",
      keyboardLikelyOpen ? composerPadFocused : composerPadClosed
    );
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
