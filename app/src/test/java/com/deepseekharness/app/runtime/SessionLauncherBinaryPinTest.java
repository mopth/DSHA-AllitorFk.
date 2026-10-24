package com.deepseekharness.app.runtime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import org.junit.Test;

/**
 * AllitorFk keeps the official build190 libdsha-session.so because the Java side only uses
 * --birth-handshake. Mixing a newer launcher with older Java (or the reverse) broke cold
 * install in fix3, so the binary is pinned here together with the flags Java passes to it.
 */
public class SessionLauncherBinaryPinTest {
  private static final String SHA256 =
      "12ace2a08056105a663f0ebc492e568d8322a6b252550a16bc05668ed9a58ed5";

  private static File file(String relative) {
    File f = new File(relative);
    return f.exists() ? f : new File("app", relative);
  }

  @Test
  public void officialLauncherIsPinnedAndSupportsTheFlagsJavaUses() throws Exception {
    byte[] so = Files.readAllBytes(file("src/main/jniLibs/arm64-v8a/libdsha-session.so").toPath());
    StringBuilder hex = new StringBuilder();
    for (byte b : MessageDigest.getInstance("SHA-256").digest(so)) hex.append(String.format("%02x", b));
    assertEquals(SHA256, hex.toString());
    String bytes = new String(so, StandardCharsets.ISO_8859_1);
    assertTrue(bytes.contains("--birth-handshake\0"));
    String java =
        new String(
            Files.readAllBytes(
                file("src/main/java/com/deepseekharness/app/runtime/IsolatedInstallProcess.java")
                    .toPath()),
            StandardCharsets.UTF_8);
    assertTrue(java.contains("\"--birth-handshake\""));
    // Java must not start depending on launcher V2 flags without swapping the binary.
    assertTrue(!java.contains("\"--control\""));
  }
}
