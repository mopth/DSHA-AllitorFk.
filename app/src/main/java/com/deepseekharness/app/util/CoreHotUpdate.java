package com.deepseekharness.app.util;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Properties;
import java.util.regex.Pattern;

/**
 * AllitorFk D1: core (DSH runtime overlay) hot-update slots with verified staging and automatic
 * rollback. Own implementation.
 *
 * <p>Layout under {@code home}: {@code staged.bin}, {@code active.bin}, {@code previous.bin},
 * {@code state.properties}. Flow:
 *
 * <ol>
 *   <li>{@link #stage} streams a download into {@code staged.part}, enforcing the manifest size cap
 *       and SHA-256, the dsh version allow-list and the minimum app version, then renames it into
 *       place. Nothing about the running core changes.
 *   <li>{@link #promote} moves active → previous and staged → active and arms a boot trial.
 *   <li>Every core start calls {@link #beginBoot}; a trial that is started {@link #MAX_TRIAL_BOOTS}
 *       times without {@link #markHealthy} is rolled back automatically (previous → active, or back to
 *       the bundled core when there is no previous slot).
 * </ol>
 *
 * <p>Integration point: the bundled overlay is pinned by the signed runtime descriptor, so the
 * launcher must re-verify {@link #activeOverlay} against a descriptor that lists the update's
 * hash before using it. That wiring is intentionally not done in this build (see
 * docs/allitorfk/rc3.md).
 */
public final class CoreHotUpdate {
  public static final int MAX_TRIAL_BOOTS = 2;
  public static final long MAX_BYTES = 512L * 1024 * 1024;
  private static final Pattern SHA = Pattern.compile("[0-9a-f]{64}");
  private static final Pattern VERSION = Pattern.compile("0\\.2\\.1-rc\\.[3-9][0-9]*");

  /** Parsed update manifest (fetched over HTTPS from the opt-in update feed). */
  public static final class Manifest {
    public final String dshVersion, sha256;
    public final long size, minAppVersionCode;

    public Manifest(String dshVersion, String sha256, long size, long minAppVersionCode) {
      this.dshVersion = dshVersion;
      this.sha256 = sha256 == null ? "" : sha256.toLowerCase(Locale.ROOT);
      this.size = size;
      this.minAppVersionCode = minAppVersionCode;
    }

    void check(long appVersionCode) throws IOException {
      if (dshVersion == null || !VERSION.matcher(dshVersion).matches())
        throw new IOException("CORE_UPDATE_VERSION");
      if (!SHA.matcher(sha256).matches()) throw new IOException("CORE_UPDATE_SHA_FORMAT");
      if (size <= 0 || size > MAX_BYTES) throw new IOException("CORE_UPDATE_SIZE");
      if (appVersionCode < minAppVersionCode) throw new IOException("CORE_UPDATE_APP_TOO_OLD");
    }
  }

  public enum Boot { BUNDLED, ACTIVE, TRIAL, ROLLED_BACK }

  private final File home;

  public CoreHotUpdate(File home) throws IOException {
    this.home = home;
    if (!home.isDirectory() && !home.mkdirs()) throw new IOException("CORE_UPDATE_HOME");
    if (Files.isSymbolicLink(home.toPath())) throw new IOException("CORE_UPDATE_HOME_LINK");
  }

  private File f(String name) {
    return new File(home, name);
  }

  private Properties state() throws IOException {
    Properties p = new Properties();
    File s = f("state.properties");
    if (s.isFile()) try (InputStream in = new FileInputStream(s)) {
      p.load(in);
    }
    return p;
  }

  private void save(Properties p) throws IOException {
    File tmp = f("state.properties.tmp");
    try (FileOutputStream out = new FileOutputStream(tmp)) {
      p.store(out, "AllitorFk core hot-update");
      out.getFD().sync();
    }
    move(tmp, f("state.properties"));
  }

  private static void move(File from, File to) throws IOException {
    Files.move(from.toPath(), to.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
  }

  /** Verified download into the staged slot. Throws (and leaves no staged file) on any mismatch. */
  public void stage(Manifest manifest, InputStream download, long appVersionCode) throws IOException {
    manifest.check(appVersionCode);
    File part = f("staged.part");
    MessageDigest digest;
    try {
      digest = MessageDigest.getInstance("SHA-256");
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IOException(e);
    }
    long total = 0;
    try (FileOutputStream out = new FileOutputStream(part)) {
      byte[] buf = new byte[64 * 1024];
      for (int n; (n = download.read(buf)) > 0; ) {
        total += n;
        if (total > manifest.size) throw new IOException("CORE_UPDATE_TOO_LARGE");
        digest.update(buf, 0, n);
        out.write(buf, 0, n);
      }
      out.getFD().sync();
    } catch (IOException e) {
      part.delete();
      throw e;
    }
    String got = hex(digest.digest());
    if (total != manifest.size || !got.equals(manifest.sha256)) {
      part.delete();
      throw new IOException("CORE_UPDATE_VERIFY");
    }
    move(part, f("staged.bin"));
    Properties p = state();
    p.setProperty("staged.sha256", got);
    p.setProperty("staged.dshVersion", manifest.dshVersion);
    save(p);
  }

  /** staged → active (old active kept as previous) and arm the boot trial. */
  public void promote() throws IOException {
    Properties p = state();
    File staged = f("staged.bin");
    if (!staged.isFile() || !p.containsKey("staged.sha256")) throw new IOException("CORE_UPDATE_NOTHING_STAGED");
    if (!hex(sha256(staged)).equals(p.getProperty("staged.sha256"))) throw new IOException("CORE_UPDATE_STAGED_CHANGED");
    if (f("active.bin").isFile()) {
      move(f("active.bin"), f("previous.bin"));
      copyKey(p, "active", "previous");
    } else {
      f("previous.bin").delete();
      p.remove("previous.sha256");
      p.remove("previous.dshVersion");
    }
    move(staged, f("active.bin"));
    copyKey(p, "staged", "active");
    p.remove("staged.sha256");
    p.remove("staged.dshVersion");
    p.setProperty("trial.boots", "0");
    p.setProperty("trial", "1");
    save(p);
  }

  /** Called once per core start, before the core is launched. */
  public Boot beginBoot() throws IOException {
    Properties p = state();
    if (!f("active.bin").isFile()) return Boot.BUNDLED;
    if (!"1".equals(p.getProperty("trial"))) return Boot.ACTIVE;
    int boots = Integer.parseInt(p.getProperty("trial.boots", "0"));
    if (boots >= MAX_TRIAL_BOOTS) {
      rollback(p);
      return Boot.ROLLED_BACK;
    }
    p.setProperty("trial.boots", Integer.toString(boots + 1));
    save(p);
    return Boot.TRIAL;
  }

  /** The new core answered its health check: keep it. */
  public void markHealthy() throws IOException {
    Properties p = state();
    p.remove("trial");
    p.remove("trial.boots");
    save(p);
  }

  /** Explicit rollback (e.g. failed health check reported by the launcher). */
  public void rollback() throws IOException {
    rollback(state());
  }

  private void rollback(Properties p) throws IOException {
    if (f("previous.bin").isFile()) {
      move(f("previous.bin"), f("active.bin"));
      copyKey(p, "previous", "active");
      p.remove("previous.sha256");
      p.remove("previous.dshVersion");
    } else {
      f("active.bin").delete();
      p.remove("active.sha256");
      p.remove("active.dshVersion");
    }
    p.remove("trial");
    p.remove("trial.boots");
    p.setProperty("lastRollbackAt", Long.toString(System.currentTimeMillis()));
    save(p);
  }

  /** The overlay to run, or null for the APK-bundled core. Re-hashed on every call. */
  public File activeOverlay() throws IOException {
    File a = f("active.bin");
    if (!a.isFile()) return null;
    String want = state().getProperty("active.sha256", "");
    if (!hex(sha256(a)).equals(want)) {
      rollback();
      return f("active.bin").isFile() ? f("active.bin") : null;
    }
    return a;
  }

  public String activeVersion() throws IOException {
    return state().getProperty("active.dshVersion");
  }

  private static void copyKey(Properties p, String from, String to) {
    for (String k : new String[] {"sha256", "dshVersion"}) {
      String v = p.getProperty(from + "." + k);
      if (v == null) p.remove(to + "." + k);
      else p.setProperty(to + "." + k, v);
    }
  }

  static byte[] sha256(File file) throws IOException {
    try (InputStream in = new FileInputStream(file)) {
      MessageDigest d = MessageDigest.getInstance("SHA-256");
      byte[] buf = new byte[64 * 1024];
      for (int n; (n = in.read(buf)) > 0; ) d.update(buf, 0, n);
      return d.digest();
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IOException(e);
    }
  }

  static String hex(byte[] b) {
    StringBuilder s = new StringBuilder();
    for (byte x : b) s.append(String.format(Locale.ROOT, "%02x", x));
    return s.toString();
  }
}
