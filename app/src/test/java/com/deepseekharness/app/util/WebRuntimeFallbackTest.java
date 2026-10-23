package com.deepseekharness.app.util;

import org.junit.Test;
import static org.junit.Assert.*;

public class WebRuntimeFallbackTest {
  @Test
  public void silentAndCrashExitCanRetryOnce() {
    assertTrue(WebRuntimeFallback.shouldRetry("proroot", false, false, false, true, 139));
    assertTrue(WebRuntimeFallback.shouldRetry("proroot", false, false, false, true, 0));
    assertFalse(WebRuntimeFallback.shouldRetry("proroot", true, false, false, true, 139));
    assertFalse(WebRuntimeFallback.shouldRetry("proot", false, false, false, true, 139));
  }

  @Test
  public void noElapsedTimeOrPluginFailureCanTriggerFallback() {
    assertFalse(WebRuntimeFallback.shouldRetry("proroot", false, false, false, true, null));
    assertFalse(WebRuntimeFallback.shouldRetry("proroot", false, false, true, true, 1));
    assertFalse(WebRuntimeFallback.shouldRetry("proroot", false, true, false, true, 139));
    assertFalse(WebRuntimeFallback.shouldRetry("proroot", false, false, false, false, 139));
  }

  @Test
  public void everyNonProotEngineButNoUnknownNameCanRetryOnce() {
    assertTrue(WebRuntimeFallback.shouldRetry("bxroot", false, false, false, true, 1));
    assertFalse(WebRuntimeFallback.shouldRetry("bxroot", true, false, false, true, 1));
    assertFalse(WebRuntimeFallback.shouldRetry("bxroot", false, false, false, true, null));
    assertFalse(WebRuntimeFallback.shouldRetry("unknown", false, false, false, true, 1));
    assertFalse(WebRuntimeFallback.shouldRetry(null, false, false, false, true, 1));
  }

  // —— 三振切回（官方 feat/bxroot-runtime 956c0fd2），按 fix4 规则：只有明确失败计数 ——

  @Test
  public void threeDefiniteFailuresForceProotForExperimentalRuntimes() {
    WebRuntimeFallback.StartOutcome bad = WebRuntimeFallback.StartOutcome.DEFINITE_FAILURE;
    int strikes = 0;
    for (int i = 1; i <= 3; i++) {
      assertFalse(WebRuntimeFallback.shouldForceProot(strikes, "bxroot"));
      strikes = WebRuntimeFallback.nextStrikes(strikes, "bxroot", bad);
      assertEquals(i, strikes);
    }
    assertTrue(WebRuntimeFallback.shouldForceProot(strikes, "bxroot"));
    assertTrue(WebRuntimeFallback.shouldForceProot(3, "proroot"));
    assertEquals(3, WebRuntimeFallback.nextStrikes(3, "proroot", bad));
  }

  @Test
  public void timeoutNeverCountsAsStrike() {
    for (int start = 0; start <= 2; start++) {
      int strikes =
          WebRuntimeFallback.nextStrikes(start, "bxroot", WebRuntimeFallback.StartOutcome.TIMEOUT);
      assertEquals(start, strikes);
      assertFalse(WebRuntimeFallback.shouldForceProot(strikes, "bxroot"));
    }
    int strikes = 2;
    for (int i = 0; i < 50; i++)
      strikes =
          WebRuntimeFallback.nextStrikes(strikes, "proroot", WebRuntimeFallback.StartOutcome.TIMEOUT);
    assertFalse(WebRuntimeFallback.shouldForceProot(strikes, "proroot"));
  }

  @Test
  public void indeterminateNeverCountsAsStrike() {
    for (int start = 0; start <= 2; start++) {
      int strikes =
          WebRuntimeFallback.nextStrikes(
              start, "bxroot", WebRuntimeFallback.StartOutcome.INDETERMINATE);
      assertEquals(start, strikes);
      assertFalse(WebRuntimeFallback.shouldForceProot(strikes, "bxroot"));
    }
    // 退出码未知、非当前代次、具名（插件）失败都只是“不确定”，不是引擎明确失败。
    assertEquals(
        WebRuntimeFallback.StartOutcome.INDETERMINATE,
        WebRuntimeFallback.exitOutcome(false, false, true, null));
    assertEquals(
        WebRuntimeFallback.StartOutcome.INDETERMINATE,
        WebRuntimeFallback.exitOutcome(false, false, false, 1));
    assertEquals(
        WebRuntimeFallback.StartOutcome.INDETERMINATE,
        WebRuntimeFallback.exitOutcome(false, true, true, 1));
    assertEquals(
        WebRuntimeFallback.StartOutcome.SUCCESS,
        WebRuntimeFallback.exitOutcome(true, false, true, 139));
    assertEquals(
        WebRuntimeFallback.StartOutcome.DEFINITE_FAILURE,
        WebRuntimeFallback.exitOutcome(false, false, true, 139));
  }

  @Test
  public void successResetsAndProotOrUnknownNeverForce() {
    assertEquals(
        0, WebRuntimeFallback.nextStrikes(2, "bxroot", WebRuntimeFallback.StartOutcome.SUCCESS));
    WebRuntimeFallback.StartOutcome bad = WebRuntimeFallback.StartOutcome.DEFINITE_FAILURE;
    assertEquals(0, WebRuntimeFallback.nextStrikes(0, "proot", bad));
    assertEquals(0, WebRuntimeFallback.nextStrikes(0, "unknown", bad));
    assertFalse(WebRuntimeFallback.shouldForceProot(3, "proot"));
    assertFalse(WebRuntimeFallback.shouldForceProot(99, "proot"));
    assertFalse(WebRuntimeFallback.shouldForceProot(3, null));
    assertFalse(WebRuntimeFallback.shouldForceProot(3, ""));
  }
}
