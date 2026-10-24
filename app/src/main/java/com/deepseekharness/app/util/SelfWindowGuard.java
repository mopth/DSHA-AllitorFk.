package com.deepseekharness.app.util;

import java.util.concurrent.atomic.AtomicInteger;

/**
 * rc.3 T1: the AI must never drive DSHA's own windows (approval dialogs, settings, takeover UI).
 * Screen/UI bridge routes and every accessibility action are refused while an approval dialog is
 * open or while the target window belongs to DSHA itself.
 */
public final class SelfWindowGuard {
  private static final AtomicInteger APPROVALS_OPEN = new AtomicInteger();

  private SelfWindowGuard() {}

  public static void approvalShown() {
    APPROVALS_OPEN.incrementAndGet();
  }

  public static void approvalGone() {
    APPROVALS_OPEN.updateAndGet(v -> Math.max(0, v - 1));
  }

  public static boolean approvalOpen() {
    return APPROVALS_OPEN.get() > 0;
  }

  /** True when the package is this app (or one of its processes, e.g. "pkg:remote"). */
  public static boolean ownPackage(CharSequence candidate, String own) {
    if (candidate == null || own == null || own.isEmpty()) return false;
    String p = candidate.toString().trim();
    return p.equals(own) || p.startsWith(own + ":");
  }

  /** Bridge-level decision. Returns null when allowed, else an error token. */
  public static String bridgeRefusal(
      boolean screenRoute, boolean approvalOpen, boolean dshaForeground, CharSequence targetPkg,
      String own) {
    if (!screenRoute) return null;
    if (approvalOpen) return "SELF_WINDOW_APPROVAL_OPEN";
    if (dshaForeground) return "SELF_WINDOW_PROTECTED";
    if (ownPackage(targetPkg, own)) return "SELF_WINDOW_PROTECTED";
    return null;
  }

  /**
   * Touch filter for approval buttons: reject touches from obscured windows and synthetic events
   * (accessibility/instrumentation injected events carry deviceId <= 0 / virtual device).
   */
  public static boolean genuineTouch(int deviceId, boolean obscured, boolean partiallyObscured) {
    return deviceId > 0 && !obscured && !partiallyObscured;
  }

  /** Only for tests. */
  public static void resetForTest() {
    APPROVALS_OPEN.set(0);
  }
}
