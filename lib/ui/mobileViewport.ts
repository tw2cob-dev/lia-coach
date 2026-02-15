export function bindAppViewportHeightVar(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }

  const root = document.documentElement;
  const chatTailOffsetClosed = "0px";
  const chatTailOffsetFocused = "0px";

  const updateHeight = () => {
    const visualViewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const fullViewportHeight = Math.max(
      window.outerHeight || 0,
      window.screen?.height || 0,
      window.innerHeight || 0
    );
    const viewportTop = Math.max(0, window.visualViewport?.offsetTop ?? 0);
    const keyboardLikelyOpen =
      viewportTop > 0 || window.innerHeight - visualViewportHeight > 80;
    const viewportHeight = keyboardLikelyOpen ? visualViewportHeight : fullViewportHeight;
    root.style.setProperty("--app-vh", `${Math.round(viewportHeight)}px`);
    root.style.setProperty("--app-vv-top", `${Math.round(viewportTop)}px`);
    const composerPadClosed = "calc(env(safe-area-inset-bottom) + 2px)";
    const composerPadFocused = "calc(env(safe-area-inset-bottom) - 25px)";
    root.style.setProperty(
      "--composer-pad-bottom",
      keyboardLikelyOpen ? composerPadFocused : composerPadClosed
    );
    root.style.setProperty(
      "--chat-tail-offset",
      keyboardLikelyOpen ? chatTailOffsetFocused : chatTailOffsetClosed
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
