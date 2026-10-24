package com.deepseekharness.app.runtime;

import android.content.Context;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 离线扩展包的原生侧准备：只写基底身份（rootfs 版本与 APK 一致时）并把 APK 内置的扩展包（目前标准版与低版本都不内置，此步为空）
 * 落到容器 /root/.dsha-ext/packs。安装/移除完全由容器内 app-integration 完成（dpkg/apt）。
 */
public final class ExtensionPacks {
  public static final String CATALOG_ASSET = "app-integration/ext-catalog.json";
  public static final String BUNDLED_DIR = "ext-packs";
  private static final long RESERVE = 256L * 1024 * 1024;

  public interface Progress {
    void update(String name, long done, long total);
  }

  private ExtensionPacks() {}

  /** 随 APK 内置的扩展包文件名（目前为空：扩展包从 Release 下载或导入）。 */
  public static List<String> bundled(Context context) {
    List<String> out = new ArrayList<>();
    try {
      String[] names = context.getAssets().list(BUNDLED_DIR);
      if (names != null)
        for (String name : names)
          if (name.matches("[a-z0-9][a-z0-9-]{0,31}\\.dshx")) out.add(name);
    } catch (IOException ignored) {
    }
    return out;
  }

  /**
   * @return null 表示就绪；否则为用户可读的错误码。
   */
  public static String prepare(Context context, ProotBootstrap boot, Progress progress) {
    try {
      if (!boot.rootfsVersionMatches()) return "EXT_BASE_NOT_READY";
      File rootfs = RuntimeAssetFiles.root(context, boot.getRootfsDir());
      String version = boot.readAssetString(ProotBootstrap.OFFLINE_VERSION_ASSET).trim();
      if (!version.matches("[0-9A-Za-z._-]{1,32}")) return "EXT_BASE_VERSION";
      RuntimeAssetFiles.write(
          context,
          new File(boot.getRootfsDir(), "root/.dsha-ext/base-identity"),
          (version + "\n").getBytes(StandardCharsets.US_ASCII),
          false);
      JSONObject catalog = new JSONObject(boot.readAssetString(CATALOG_ASSET));
      JSONArray packs = catalog.getJSONArray("packs");
      File dir = new File(rootfs, "root/.dsha-ext/packs");
      for (String name : bundled(context)) {
        JSONObject entry = null;
        for (int i = 0; i < packs.length(); i++)
          if (name.equals(packs.getJSONObject(i).optString("file"))) entry = packs.getJSONObject(i);
        if (entry == null) return "EXT_BUNDLED_UNKNOWN:" + name;
        stage(context, dir, name, entry.getLong("bytes"), entry.getString("sha256"), progress);
      }
      return null;
    } catch (IOException | org.json.JSONException | RuntimeException error) {
      String message = error.getMessage();
      return message != null && message.startsWith("EXT_") ? message : "EXT_PREPARE:" + error.getClass().getSimpleName();
    }
  }

  static void stage(Context context, File dir, String name, long bytes, String sha256, Progress progress)
      throws IOException {
    File target = new File(dir, name);
    if (java.nio.file.Files.isSymbolicLink(dir.toPath())) throw new IOException("EXT_STAGE_LINK");
    if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("EXT_STAGE_DIR");
    if (java.nio.file.Files.isSymbolicLink(target.toPath())) throw new IOException("EXT_STAGE_LINK");
    // 大小一致即视为已落盘；内容由容器侧启用前按目录 sha256 再核一次。
    if (target.isFile() && target.length() == bytes) return;
    if (dir.getUsableSpace() < bytes + RESERVE) throw new IOException("EXT_NO_SPACE");
    File part = new File(dir, "." + name + ".part");
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      long done = 0;
      try (InputStream in = context.getAssets().open(BUNDLED_DIR + "/" + name);
          FileOutputStream out = new FileOutputStream(part)) {
        byte[] buffer = new byte[1 << 20];
        int n;
        while ((n = in.read(buffer)) > 0) {
          out.write(buffer, 0, n);
          digest.update(buffer, 0, n);
          done += n;
          if (progress != null) progress.update(name, done, bytes);
        }
        out.getFD().sync();
      }
      StringBuilder hex = new StringBuilder();
      for (byte b : digest.digest()) hex.append(String.format("%02x", b));
      if (done != bytes || !hex.toString().equals(sha256)) throw new IOException("EXT_BUNDLED_DIGEST");
      if (!part.renameTo(target)) throw new IOException("EXT_STAGE_RENAME");
    } catch (java.security.NoSuchAlgorithmException impossible) {
      throw new IOException("EXT_DIGEST", impossible);
    } finally {
      if (part.exists() && !part.delete()) part.deleteOnExit();
    }
  }
}
