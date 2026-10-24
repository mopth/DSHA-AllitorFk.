package com.deepseekharness.app.util;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.Test;

public class ExtensionReleaseLinksTest {
  private static final String BASE =
      "https://github.com/mopth/DSHA-AllitorFk./releases/download/dsha-AllitorFk.-dsh0.2.1-rc.3/";

  @Test
  public void allowsOnlyPinnedReleaseDshxAssets() {
    assertTrue(ExtensionReleaseLinks.isReleaseAsset(BASE + "dev-base.dshx"));
    assertTrue(ExtensionReleaseLinks.isReleaseAsset(BASE + "texlive.dshx"));
  }

  @Test
  public void rejectsEverythingElse() {
    String[] bad = {
      null,
      "",
      BASE + "dev-base.dshx?x=1",
      BASE + "dev-base.dshx#f",
      BASE + "DSHA-AllitorFk.-dsh0.2.1-rc.3.apk",
      BASE + "Dev-Base.dshx",
      BASE + "../x.dshx",
      "https://github.com/mopth/DSHA-AllitorFk./releases/download/../x/dev-base.dshx",
      "https://github.com/mopth/DSHA-AllitorFk./releases/download/a..b/dev-base.dshx",
      "http://github.com/mopth/DSHA-AllitorFk./releases/download/t/dev-base.dshx",
      "https://github.com:443/mopth/DSHA-AllitorFk./releases/download/t/dev-base.dshx",
      "https://user@github.com/mopth/DSHA-AllitorFk./releases/download/t/dev-base.dshx",
      "https://github.com.evil.example/mopth/DSHA-AllitorFk./releases/download/t/dev-base.dshx",
      "https://github.com/other/DSHA-AllitorFk./releases/download/t/dev-base.dshx",
      "https://github.com/mopth/DSHA-AllitorFk./releases/download/t/sub/dev-base.dshx",
      "javascript:alert(1)",
      "intent://x#Intent;end",
      "file:///sdcard/dev-base.dshx",
    };
    for (String url : bad) assertFalse(String.valueOf(url), ExtensionReleaseLinks.isReleaseAsset(url));
  }

  @Test
  public void everyCatalogPackUrlIsAllowed() throws Exception {
    File f = new File("src/main/assets/app-integration/ext-catalog.json");
    if (!f.exists()) f = new File("app", f.getPath());
    String text = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
    Matcher base = Pattern.compile("\"download\":\\s*\\{\\s*\"base\":\\s*\"([^\"]+)\"").matcher(text);
    assertTrue(base.find());
    assertTrue(base.group(1).startsWith(ExtensionReleaseLinks.PREFIX));
    Matcher file = Pattern.compile("\"file\":\\s*\"([^\"]+)\"").matcher(text);
    int count = 0;
    while (file.find()) {
      String url = base.group(1) + "/" + file.group(1);
      assertTrue(url, ExtensionReleaseLinks.isReleaseAsset(url));
      count++;
    }
    assertTrue(count >= 16);
  }
}
