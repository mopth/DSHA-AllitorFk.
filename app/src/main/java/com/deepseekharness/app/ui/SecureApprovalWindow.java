package com.deepseekharness.app.ui;

import androidx.appcompat.app.AlertDialog;
import android.os.Build;
import android.os.Bundle;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityNodeInfo;
import com.deepseekharness.app.util.SelfWindowGuard;

/**
 * rc.3 T1: approval dialogs are not screen-capturable, ignore obscured/overlay touches and refuse
 * accessibility-injected clicks, so the AI cannot press its own "批准" through screen control.
 */
public final class SecureApprovalWindow {
  private SecureApprovalWindow() {}

  /** Call before show(). */
  public static void secure(AlertDialog dialog) {
    if (dialog.getWindow() != null)
      dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
  }

  /** Call after show(), once the buttons exist. */
  public static void harden(AlertDialog dialog) {
    for (int which :
        new int[] {
          android.content.DialogInterface.BUTTON_POSITIVE,
          android.content.DialogInterface.BUTTON_NEGATIVE,
          android.content.DialogInterface.BUTTON_NEUTRAL
        }) {
      View b = dialog.getButton(which);
      if (b != null) hardenButton(b);
    }
  }

  static boolean genuine(MotionEvent e) {
    int flags = e.getFlags();
    boolean obscured = (flags & MotionEvent.FLAG_WINDOW_IS_OBSCURED) != 0;
    boolean partial =
        Build.VERSION.SDK_INT >= 29 && (flags & MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED) != 0;
    return SelfWindowGuard.genuineTouch(e.getDeviceId(), obscured, partial);
  }

  public static void hardenButton(View b) {
    b.setFilterTouchesWhenObscured(true);
    // Injected gestures (dispatchGesture / input injection) arrive with a virtual deviceId.
    b.setOnTouchListener((v, e) -> !genuine(e));
    b.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
    b.setAccessibilityDelegate(
        new View.AccessibilityDelegate() {
          @Override
          public boolean performAccessibilityAction(View host, int action, Bundle args) {
            if (action == AccessibilityNodeInfo.ACTION_CLICK
                || action == AccessibilityNodeInfo.ACTION_LONG_CLICK) return false;
            return super.performAccessibilityAction(host, action, args);
          }
        });
    // Keyboard/DPAD "click" from an injected key event is also refused unless from a real device.
    b.setOnKeyListener((v, code, e) -> e.getDeviceId() <= 0);
  }
}
