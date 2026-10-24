package com.deepseekharness.app.util;

import static org.junit.Assert.*;

import org.junit.After;
import org.junit.Test;

public class SelfWindowGuardTest {
  private static final String OWN = "com.deepseekharness.app.allitorfk";

  @After
  public void reset() {
    SelfWindowGuard.resetForTest();
  }

  @Test
  public void uiAndVscreenRefusedWhileApprovalOpen() {
    SelfWindowGuard.approvalShown();
    assertTrue(SelfWindowGuard.approvalOpen());
    assertEquals(
        "SELF_WINDOW_APPROVAL_OPEN",
        SelfWindowGuard.bridgeRefusal(true, SelfWindowGuard.approvalOpen(), false, "com.other", OWN));
    assertNull(SelfWindowGuard.bridgeRefusal(false, true, true, OWN, OWN));
    SelfWindowGuard.approvalGone();
    assertFalse(SelfWindowGuard.approvalOpen());
    SelfWindowGuard.approvalGone(); // never negative
    assertFalse(SelfWindowGuard.approvalOpen());
  }

  @Test
  public void ownWindowsRefusedEvenWithoutApproval() {
    assertEquals(
        "SELF_WINDOW_PROTECTED", SelfWindowGuard.bridgeRefusal(true, false, true, null, OWN));
    assertEquals(
        "SELF_WINDOW_PROTECTED", SelfWindowGuard.bridgeRefusal(true, false, false, OWN, OWN));
    assertEquals(
        "SELF_WINDOW_PROTECTED",
        SelfWindowGuard.bridgeRefusal(true, false, false, OWN + ":web", OWN));
    assertNull(SelfWindowGuard.bridgeRefusal(true, false, false, "com.android.settings", OWN));
    assertFalse(SelfWindowGuard.ownPackage(OWN + "x", OWN));
    assertFalse(SelfWindowGuard.ownPackage(null, OWN));
  }

  @Test
  public void injectedOrObscuredTouchesRejected() {
    assertTrue(SelfWindowGuard.genuineTouch(3, false, false));
    assertFalse(SelfWindowGuard.genuineTouch(-1, false, false)); // accessibility/injected
    assertFalse(SelfWindowGuard.genuineTouch(0, false, false));
    assertFalse(SelfWindowGuard.genuineTouch(3, true, false)); // overlay on top
    assertFalse(SelfWindowGuard.genuineTouch(3, false, true));
  }
}
