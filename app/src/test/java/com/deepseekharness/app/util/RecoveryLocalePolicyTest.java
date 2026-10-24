package com.deepseekharness.app.util;

import org.junit.Test;
import static org.junit.Assert.*;

public class RecoveryLocalePolicyTest {
  @Test
  public void convertsOnlyFormalLoopbackAuthorityAndPreservesRawQuery() {
    assertEquals(
        "http://localhost:3181/auth?token=x%2F127.0.0.1#home",
        RecoveryLocalePolicy.toLocalhostUrl("http://127.0.0.1:3181/auth?token=x%2F127.0.0.1#home"));
    assertNull(RecoveryLocalePolicy.toLocalhostUrl("http://127.0.0.1:3181@evil.test/auth"));
    assertNull(RecoveryLocalePolicy.toLocalhostUrl("http://localhost:3181/auth"));
    // An @ after the slash belongs to the path; only authority userinfo is rejected.
    assertEquals(
        "http://localhost:3181/auth@evil.test",
        RecoveryLocalePolicy.toLocalhostUrl("http://127.0.0.1:3181/auth@evil.test"));
  }

  @Test
  public void emergencyLocaleBridgeIsExactLocalhostAuthority() {
    String base = "http://localhost:3181/";
    assertTrue(RecoveryLocalePolicy.sameOrigin(base, "http://localhost:3181/chat?token=secret"));
    assertFalse(RecoveryLocalePolicy.sameOrigin(base, "http://127.0.0.1:3181/chat"));
    assertFalse(RecoveryLocalePolicy.sameOrigin(base, "http://localhost:3082/chat"));
    assertFalse(RecoveryLocalePolicy.sameOrigin(base, "http://localhost:3181@evil.test/chat"));
    assertTrue(RecoveryLocalePolicy.supportedLanguage("zh"));
    assertTrue(RecoveryLocalePolicy.supportedLanguage("en"));
    assertFalse(RecoveryLocalePolicy.supportedLanguage("fr"));
    assertTrue(RecoveryLocalePolicy.pageScript("en").contains("window.__DSHA_LANGUAGE__='en'"));
    assertThrows(
        IllegalArgumentException.class,
        () -> RecoveryLocalePolicy.pageScript("javascript:alert(1)"));
  }

  @Test
  public void formalEmergencyLaunchResolvesTheSameOriginForBothBrowserKernels() {
    var launch =
        RecoveryLocalePolicy.launch(
            "http://127.0.0.1:3181/", "http://127.0.0.1:3181/?token=keep%2Fraw");
    assertNotNull(launch);
    assertEquals("http://localhost:3181/", launch.origin);
    assertEquals("http://localhost:3181/?token=keep%2Fraw", launch.authUrl);
    assertNull(
        RecoveryLocalePolicy.launch("http://127.0.0.1:3181/", "http://127.0.0.1:3082/?token=x"));
    assertNull(
        RecoveryLocalePolicy.launch("http://localhost:3181/", "http://localhost:3181/?token=x"));
  }

  @Test
  public void oldWebViewFinishedPageLanguageBridgeStaysOnEmergencyOrigin() {
    String base = "http://localhost:3181/";
    assertTrue(
        RecoveryLocalePolicy.needsFinishedPageLanguageBridge(
            base, "http://localhost:3181/chat", false));
    assertFalse(
        RecoveryLocalePolicy.needsFinishedPageLanguageBridge(
            base, "http://localhost:3181/chat", true));
    assertFalse(
        RecoveryLocalePolicy.needsFinishedPageLanguageBridge(
            base, "http://127.0.0.1:3181/chat", false));
    assertFalse(
        RecoveryLocalePolicy.needsFinishedPageLanguageBridge(
            base, "http://localhost:3082/chat", false));
    assertFalse(
        RecoveryLocalePolicy.needsFinishedPageLanguageBridge(
            base, "http://localhost:3181@evil.test/chat", false));
  }
}
