package com.deepseekharness.app.util;

import static org.junit.Assert.*;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Test;

public class CoreHotUpdateTest {
  private static byte[] bytes(String s) {
    return s.getBytes(StandardCharsets.UTF_8);
  }

  private static CoreHotUpdate.Manifest manifest(byte[] data, String version) throws Exception {
    return new CoreHotUpdate.Manifest(
        version, CoreHotUpdate.hex(java.security.MessageDigest.getInstance("SHA-256").digest(data)), data.length, 1);
  }

  private static File tmp() throws IOException {
    return Files.createTempDirectory("core-hot").toFile();
  }

  @Test
  public void verifiedStagePromoteAndHealthyKeep() throws Exception {
    CoreHotUpdate u = new CoreHotUpdate(tmp());
    assertEquals(CoreHotUpdate.Boot.BUNDLED, u.beginBoot());
    byte[] v4 = bytes("core-rc4");
    u.stage(manifest(v4, "0.2.1-rc.4"), new ByteArrayInputStream(v4), 5);
    assertNull("staging does not change the running core", u.activeOverlay());
    u.promote();
    assertEquals(CoreHotUpdate.Boot.TRIAL, u.beginBoot());
    u.markHealthy();
    assertEquals(CoreHotUpdate.Boot.ACTIVE, u.beginBoot());
    assertArrayEquals(v4, Files.readAllBytes(u.activeOverlay().toPath()));
    assertEquals("0.2.1-rc.4", u.activeVersion());
  }

  @Test
  public void unhealthyTrialRollsBackAutomatically() throws Exception {
    CoreHotUpdate u = new CoreHotUpdate(tmp());
    byte[] a = bytes("good"), b = bytes("bad");
    u.stage(manifest(a, "0.2.1-rc.4"), new ByteArrayInputStream(a), 1);
    u.promote();
    u.beginBoot();
    u.markHealthy();
    u.stage(manifest(b, "0.2.1-rc.5"), new ByteArrayInputStream(b), 1);
    u.promote();
    assertEquals(CoreHotUpdate.Boot.TRIAL, u.beginBoot());
    assertEquals(CoreHotUpdate.Boot.TRIAL, u.beginBoot());
    assertEquals(CoreHotUpdate.Boot.ROLLED_BACK, u.beginBoot());
    assertArrayEquals(a, Files.readAllBytes(u.activeOverlay().toPath()));
    assertEquals("0.2.1-rc.4", u.activeVersion());
    assertEquals(CoreHotUpdate.Boot.ACTIVE, u.beginBoot());
  }

  @Test
  public void firstUpdateRollsBackToBundledCore() throws Exception {
    CoreHotUpdate u = new CoreHotUpdate(tmp());
    byte[] a = bytes("x");
    u.stage(manifest(a, "0.2.1-rc.4"), new ByteArrayInputStream(a), 1);
    u.promote();
    u.rollback();
    assertNull(u.activeOverlay());
    assertEquals(CoreHotUpdate.Boot.BUNDLED, u.beginBoot());
  }

  @Test
  public void rejectsBadDownloadsAndManifests() throws Exception {
    File home = tmp();
    CoreHotUpdate u = new CoreHotUpdate(home);
    byte[] a = bytes("payload");
    CoreHotUpdate.Manifest m = manifest(a, "0.2.1-rc.4");
    assertThrows(IOException.class, () -> u.stage(m, new ByteArrayInputStream(bytes("tampered")), 1));
    assertThrows(IOException.class, () -> u.stage(m, new ByteArrayInputStream(bytes("payload+more")), 1));
    assertThrows(IOException.class, () -> u.stage(manifest(a, "0.2.1-rc.2"), new ByteArrayInputStream(a), 1));
    assertThrows(IOException.class, () -> u.stage(m, new ByteArrayInputStream(a), 0));
    assertFalse(new File(home, "staged.part").exists());
    assertFalse(new File(home, "staged.bin").exists());
    assertThrows(IOException.class, u::promote);
  }

  @Test
  public void tamperedActiveSlotIsNotUsed() throws Exception {
    File home = tmp();
    CoreHotUpdate u = new CoreHotUpdate(home);
    byte[] a = bytes("good");
    u.stage(manifest(a, "0.2.1-rc.4"), new ByteArrayInputStream(a), 1);
    u.promote();
    Files.write(new File(home, "active.bin").toPath(), bytes("evil"));
    assertNull(u.activeOverlay());
  }
}
