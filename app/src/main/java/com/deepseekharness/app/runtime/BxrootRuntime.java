package com.deepseekharness.app.runtime;

import android.content.Context;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * bxroot（MIT，来源与补丁见 tools/bxroot/lock.json）：glibc ULX 执行闭包，不借 proot/proroot 的
 * loader 或环境。三件 so 的字节由 assets/bxroot-native-lock.json 锁定，prepare() 逐一核对。
 */
public final class BxrootRuntime implements ContainerRuntime {
  public static final String[] LIBS = {"libbxroot.so", "libbxroot-runtime.so", "libbxroot-ulx.so"};
  private static final int LOCK_LIMIT = 32768;
  private final Context context;
  private final File directory;
  private volatile boolean verified;

  public BxrootRuntime(Context context) {
    this(context, new File(context.getApplicationInfo().nativeLibraryDir));
  }

  BxrootRuntime(Context context, File directory) {
    this.context = context;
    this.directory = directory;
  }

  @Override
  public String id() {
    return RuntimeEngine.BXROOT.id;
  }

  @Override
  public String displayName() {
    return com.deepseekharness.app.util.UiText.choose("bxroot（开源，实验）", "bxroot (open source, experimental)");
  }

  @Override
  public boolean available() {
    for (String name : LIBS) {
      File file = new File(directory, name);
      if (!file.isFile() || file.length() == 0) return false;
    }
    return true;
  }

  @Override
  public String unavailableReason() {
    for (String name : LIBS) {
      File file = new File(directory, name);
      if (!file.isFile() || file.length() == 0) return "BXROOT_NATIVE_MISSING:" + name;
    }
    return "";
  }

  @Override
  public void prepare() throws IOException {
    if (!available()) throw new IOException(unavailableReason());
    if (verified) return;
    org.json.JSONObject lock;
    try (var input = context.getAssets().open("bxroot-native-lock.json")) {
      lock = new org.json.JSONObject(read(input));
    } catch (org.json.JSONException invalid) {
      throw new IOException("BXROOT_NATIVE_LOCK_INVALID", invalid);
    }
    verify(lock, directory);
    verified = true;
  }

  static void verify(org.json.JSONObject lock, File directory) throws IOException {
    try {
      org.json.JSONObject hashes = lock.getJSONObject("nativeHashes");
      Map<String, String> expected = new java.util.HashMap<>();
      for (String name : LIBS) expected.put(name, hashes.getString(name));
      verify(lock.getInt("schema"), lock.getString("sourceCommit"), expected, directory);
    } catch (org.json.JSONException invalid) {
      throw new IOException("BXROOT_NATIVE_LOCK_INVALID", invalid);
    }
  }

  /** 纯校验：锁格式正确，且三件原生文件逐字节与锁一致。 */
  static void verify(int schema, String sourceCommit, Map<String, String> hashes, File directory)
      throws IOException {
    if (schema != 1 || sourceCommit == null || !sourceCommit.matches("[a-f0-9]{40}"))
      throw new IOException("BXROOT_NATIVE_LOCK_SCHEMA");
    for (String name : LIBS) {
      String expected = hashes.get(name);
      if (expected == null || !expected.matches("[a-f0-9]{64}"))
        throw new IOException("BXROOT_NATIVE_LOCK_HASH");
      if (!expected.equals(sha256(new File(directory, name))))
        throw new IOException("BXROOT_NATIVE_HASH_MISMATCH:" + name);
    }
  }

  private static String read(java.io.InputStream input) throws IOException {
    var content = new java.io.ByteArrayOutputStream();
    byte[] chunk = new byte[4096];
    int size;
    while ((size = input.read(chunk)) != -1) {
      if (content.size() + size > LOCK_LIMIT) throw new IOException("BXROOT_NATIVE_LOCK_LIMIT");
      content.write(chunk, 0, size);
    }
    return new String(content.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
  }

  private static String sha256(File file) throws IOException {
    try {
      var digest = java.security.MessageDigest.getInstance("SHA-256");
      try (var bytes = new java.io.FileInputStream(file)) {
        byte[] buffer = new byte[65536];
        int count;
        while ((count = bytes.read(buffer)) != -1) digest.update(buffer, 0, count);
      }
      StringBuilder actual = new StringBuilder();
      for (byte value : digest.digest())
        actual.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
      return actual.toString();
    } catch (java.security.NoSuchAlgorithmException impossible) {
      throw new IOException("SHA256_UNAVAILABLE", impossible);
    }
  }

  @Override
  public List<String> baseArgv(File rootfs, boolean links) {
    return baseArgv(rootfs, links, context.getFilesDir());
  }

  @Override
  public List<String> baseArgv(File rootfs, boolean links, File dataDomain) {
    try {
      var authority =
          new BxrootPrivateRoot(
              new com.deepseekharness.app.backup.AndroidBackupFileSystem(), context.getFilesDir());
      File physicalRoot = authority.root(rootfs), physicalDomain = authority.dataDomain(dataDomain);
      List<String> argv = arguments(directory, physicalRoot, physicalDomain);
      authority.verify();
      return argv;
    } catch (IOException failure) {
      throw new IllegalStateException("BXROOT_PRIVATE_ROOT_UNREADABLE", failure);
    }
  }

  /** 纯参数构造：-l 永远开启 link2symlink，L2S 目录与宿主同路径绑定。 */
  static List<String> arguments(File nativeDirectory, File rootfs, File dataDomain) {
    List<String> argv = new ArrayList<>();
    java.util.Collections.addAll(
        argv,
        new File(nativeDirectory, "libbxroot.so").getAbsolutePath(),
        "--kill-on-exit",
        "-r",
        rootfs.getAbsolutePath(),
        "-0",
        "-l",
        "-w",
        "/root");
    for (Bind bind : ContainerRuntime.binds())
      if (new File(bind.host()).exists()) {
        argv.add("-b");
        argv.add(bind.host() + ":" + bind.guest());
      }
    File l2s = new File(rootfs, ".l2s");
    if (!l2s.isDirectory() && !l2s.mkdirs())
      throw new IllegalStateException("BXROOT_L2S_DIRECTORY_UNAVAILABLE");
    argv.add("-b");
    argv.add(l2s.getAbsolutePath() + ":" + l2s.getAbsolutePath());
    if (dataDomain != null) UserDataBindings.append(argv, rootfs, dataDomain);
    return argv;
  }

  /** bxroot 需要 rootfs 才能定位 L2S；只有 RuntimeLauncher 的五参数入口是合法调用。 */
  @Override
  public void applyEnv(ProcessBuilder builder, File base, File lib, File tmp) throws IOException {
    throw new IOException("BXROOT_EXPLICIT_ROOT_REQUIRED");
  }

  @Override
  public void applyEnv(ProcessBuilder builder, File base, File lib, File tmp, File rootfs)
      throws IOException {
    prepare();
    finalizeEnvironment(builder.environment(), directory, tmp, rootfs);
  }

  /** 在宿主写完通用环境之后再收口一次：清掉其它引擎残留，写入 bxroot 固定配置。 */
  @Override
  public void finalizeEnvironment(Map<String, String> env, File tmp, File rootfs) {
    finalizeEnvironment(env, directory, tmp, rootfs);
  }

  static void finalizeEnvironment(Map<String, String> env, File nativeDir, File tmp, File rootfs) {
    env.keySet()
        .removeIf(
            key ->
                key.startsWith("PROROOT_") || key.startsWith("PROOT_") || key.startsWith("BXROOT_"));
    env.remove("LD_PRELOAD");
    env.remove("LD_LIBRARY_PATH");
    env.put("BXROOT_LIB_PATH", new File(nativeDir, "libbxroot-runtime.so").getAbsolutePath());
    env.put("BXROOT_TMP_DIR", tmp.getAbsolutePath());
    env.put("BXROOT_L2S_DIR", new File(rootfs, ".l2s").getAbsolutePath());
    env.put("BXROOT_AUTO_HOST", "1");
    env.put("BXROOT_HOST_PATH", "");
    env.put("BXROOT_REENTRY", "0");
    env.put("DSHA_BXROOT_STRICT_EXEC", "1");
  }
}
