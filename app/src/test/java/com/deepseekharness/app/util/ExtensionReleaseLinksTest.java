package com.deepseekharness.app.util;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

@RunWith(RobolectricTestRunner.class)
public class ExtensionReleaseLinksTest {
  private static final String BASE =
      "https://github.com/mopth/DSHA-AllitorFk./releases/download/dsha-AllitorFk.-dsh0.2.1-rc.2/";

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
      BASE + "dsha-AllitorFk.-dsh0.2.1-rc.2.apk",
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
    JSONObject catalog = new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
    String base = catalog.getJSONObject("download").getString("base");
    assertTrue(base.startsWith(ExtensionReleaseLinks.PREFIX));
    JSONArray packs = catalog.getJSONArray("packs");
    assertTrue(packs.length() >= 16);
    for (int i = 0; i < packs.length(); i++) {
      String url = base + "/" + packs.getJSONObject(i).getString("file");
      assertTrue(url, ExtensionReleaseLinks.isReleaseAsset(url));
    }
  }
}
