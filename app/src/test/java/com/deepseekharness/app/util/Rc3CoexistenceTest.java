package com.deepseekharness.app.util;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.Test;

/** AllitorFk rc.3 must install next to rc.2 and the official app without sharing anything. */
public class Rc3CoexistenceTest {
  private static String read(String path) throws Exception {
    File f = new File(path);
    if (!f.exists()) f = new File("app/" + path);
    if (!f.exists()) f = new File("../" + path);
    return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
  }

  @Test
  public void portsMoveToTheRc3Range() {
    assertEquals(3180, Constants.DSH_WEB_PORT);
    assertEquals(3181, Constants.LAN_BRIDGE_PORT);
    assertEquals(3190, Constants.SHELL_BRIDGE_PORT);
    assertEquals("0.2.1-rc.3", Constants.DSH_VERSION);
  }

  @Test
  public void identityIsRc3Only() throws Exception {
    assertEquals("dsha.AllitorFk_.dsh0_2_1_rc_3", AppIdentity.applicationId());
    assertEquals("DSHA-AllitorFk-rc3", AppIdentity.publicDirectoryName());
    String manifest = read("src/main/AndroidManifest.xml");
    assertFalse(manifest.contains("sharedUserId"));
    // rc.3 owns dsha-rc3://install; it must not claim dsha:// or dsha.cc shared with rc.2/official.
    assertTrue(manifest.contains("android:scheme=\"dsha-rc3\""));
    assertFalse(manifest.contains("android:scheme=\"dsha\""));
    assertFalse(manifest.contains("android:host=\"dsha.cc\""));
    Matcher m = Pattern.compile("android:authorities=\"([^\"]+)\"").matcher(manifest);
    int n = 0;
    while (m.find()) {
      n++;
      assertTrue(m.group(1), m.group(1).startsWith("${applicationId}."));
    }
    assertTrue(n >= 3);
  }

  @Test
  public void extensionCatalogIsBoundToRc3() throws Exception {
    String cat = read("src/main/assets/app-integration/ext-catalog.json");
    assertTrue(cat.contains("\"dshVersion\": \"0.2.1-rc.3\""));
    assertTrue(cat.contains("/releases/download/dsha-AllitorFk.-dsh0.2.1-rc.3\""));
    assertFalse(cat.contains("dsh0.2.1-rc.2"));
  }
}
