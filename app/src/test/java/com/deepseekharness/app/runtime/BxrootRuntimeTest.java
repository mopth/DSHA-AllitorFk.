package com.deepseekharness.app.runtime;

import static org.junit.Assert.*;

import java.io.File;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class BxrootRuntimeTest {
  @Rule public TemporaryFolder temporary = new TemporaryFolder();

  @Test
  public void argumentsUseKillOnExitLinkEmulationAndPrivateL2s() throws Exception {
    File nativeDir = temporary.newFolder("native"), rootfs = temporary.newFolder("rootfs");
    List<String> argv = BxrootRuntime.arguments(nativeDir, rootfs, null);
    assertEquals(new File(nativeDir, "libbxroot.so").getAbsolutePath(), argv.get(0));
    assertEquals(
        List.of("--kill-on-exit", "-r", rootfs.getAbsolutePath(), "-0", "-l", "-w", "/root"),
        argv.subList(1, 8));
    String l2s = new File(rootfs, ".l2s").getAbsolutePath();
    assertEquals(l2s + ":" + l2s, argv.get(argv.size() - 1));
    assertTrue(new File(l2s).isDirectory());
  }

  @Test
  public void finalEnvironmentStripsOtherEnginesAndPreloads() {
    Map<String, String> env = new HashMap<>();
    env.put("PROOT_LOADER", "x");
    env.put("PROOT_NO_SECCOMP", "1");
    env.put("PROROOT_LIB_PATH", "x");
    env.put("BXROOT_STALE", "x");
    env.put("LD_PRELOAD", "x");
    env.put("LD_LIBRARY_PATH", "x");
    env.put("HOME", "/root");
    File nativeDir = new File("/n"), tmp = new File("/t"), rootfs = new File("/r");
    BxrootRuntime.finalizeEnvironment(env, nativeDir, tmp, rootfs);
    assertEquals("/root", env.get("HOME"));
    for (String key : env.keySet())
      assertFalse(key, key.startsWith("PROOT_") || key.startsWith("PROROOT_") || key.startsWith("LD_"));
    assertFalse(env.containsKey("BXROOT_STALE"));
    assertEquals(new File(nativeDir, "libbxroot-runtime.so").getAbsolutePath(), env.get("BXROOT_LIB_PATH"));
    assertEquals(new File(rootfs, ".l2s").getAbsolutePath(), env.get("BXROOT_L2S_DIR"));
    assertEquals("0", env.get("BXROOT_REENTRY"));
    assertEquals("1", env.get("DSHA_BXROOT_STRICT_EXEC"));
  }

  @Test
  public void lockRejectsChangedNativeBytes() throws Exception {
    File nativeDir = temporary.newFolder("lib");
    Map<String, String> hashes = new HashMap<>();
    for (String name : BxrootRuntime.LIBS) {
      File file = new File(nativeDir, name);
      Files.write(file.toPath(), name.getBytes(java.nio.charset.StandardCharsets.UTF_8));
      hashes.put(name, sha(file));
    }
    String commit = "d5f9ac30".repeat(5);
    BxrootRuntime.verify(1, commit, hashes, nativeDir);
    assertThrows(
        java.io.IOException.class, () -> BxrootRuntime.verify(2, commit, hashes, nativeDir));
    Files.write(new File(nativeDir, "libbxroot-ulx.so").toPath(), new byte[] {1});
    java.io.IOException changed =
        assertThrows(
            java.io.IOException.class, () -> BxrootRuntime.verify(1, commit, hashes, nativeDir));
    assertEquals("BXROOT_NATIVE_HASH_MISMATCH:libbxroot-ulx.so", changed.getMessage());
  }

  @Test
  public void bundledLockMatchesBundledLibraries() throws Exception {
    File repo = new File(System.getProperty("user.dir"));
    if (!new File(repo, "src/main/assets").isDirectory()) repo = new File(repo, "app");
    File lockFile = new File(repo, "src/main/assets/bxroot-native-lock.json");
    String text = new String(Files.readAllBytes(lockFile.toPath()), "UTF-8");
    Map<String, String> hashes = new HashMap<>();
    for (String name : BxrootRuntime.LIBS) {
      var match =
          java.util.regex.Pattern.compile("\"" + java.util.regex.Pattern.quote(name) + "\"\\s*:\\s*\"([a-f0-9]{64})\"")
              .matcher(text);
      assertTrue(name, match.find());
      hashes.put(name, match.group(1));
    }
    var commit = java.util.regex.Pattern.compile("\"sourceCommit\"\\s*:\\s*\"([a-f0-9]{40})\"").matcher(text);
    assertTrue(commit.find());
    BxrootRuntime.verify(1, commit.group(1), hashes, new File(repo, "src/main/jniLibs/arm64-v8a"));
  }

  private static String sha(File file) throws Exception {
    byte[] digest =
        java.security.MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file.toPath()));
    StringBuilder out = new StringBuilder();
    for (byte value : digest) out.append(String.format("%02x", value & 255));
    return out.toString();
  }
}
