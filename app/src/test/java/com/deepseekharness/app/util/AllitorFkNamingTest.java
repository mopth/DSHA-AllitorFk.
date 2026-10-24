package com.deepseekharness.app.util;

import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Test;

/** 名称约定：手机显示名 DSHA-AllitorFk.；APK 文件名带版本；包名不变；versionName 后缀干净。 */
public class AllitorFkNamingTest {
  private static String gradle() throws Exception {
    File f = new File("build.gradle");
    if (!f.exists() || !new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8).contains("productFlavors"))
      f = new File("app/build.gradle");
    return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
  }

  @Test
  public void namesFollowTheAgreedCasing() throws Exception {
    String g = gradle();
    assertTrue(g.contains("ext.dshaDisplayName = 'DSHA-AllitorFk.'"));
    assertTrue(g.contains("resValue 'string', 'app_name', dshaDisplayName"));
    assertTrue(g.contains("ext.dshaReleaseName = 'DSHA-AllitorFk.-dsh0.2.1-rc.3'"));
    assertTrue(g.contains("applicationId 'dsha.AllitorFk_.dsh0_2_1_rc_3'") || g.contains("applicationId \"dsha.AllitorFk_.dsh0_2_1_rc_3\""));
    assertTrue(g.contains("-dsh0.2.1-rc.3-AllitorFk\""));
    assertTrue(g.contains("versionNameSuffix '-low'"));
    assertTrue(!g.contains("versionNameSuffix 'full'") && !g.contains("full {"));
  }
}
