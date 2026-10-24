package com.deepseekharness.app.util;

import java.util.regex.Pattern;

/**
 * 扩展中心“在浏览器中下载”只允许打开本 fork Release 的扩展包资产：
 * https://github.com/mopth/DSHA-AllitorFk./releases/download/&lt;tag&gt;/&lt;id&gt;.dshx 。
 * 不带查询串、片段、用户信息或端口；其余一律不放行。下载下来的文件仍要在扩展中心导入并按内置目录校验 sha256。
 */
public final class ExtensionReleaseLinks {
  public static final String PREFIX = "https://github.com/mopth/DSHA-AllitorFk./releases/download/";
  private static final Pattern ASSET =
      Pattern.compile(
          "https://github\\.com/mopth/DSHA-AllitorFk\\./releases/download/"
              + "[A-Za-z0-9][A-Za-z0-9._-]{0,100}/[a-z0-9][a-z0-9-]{0,31}\\.dshx");

  private ExtensionReleaseLinks() {}

  public static boolean isReleaseAsset(String url) {
    if (url == null || url.length() > 300) return false;
    if (!ASSET.matcher(url).matches()) return false;
    String tag = url.substring(PREFIX.length(), url.lastIndexOf('/'));
    return !tag.contains("..");
  }
}
