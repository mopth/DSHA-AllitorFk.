package com.deepseekharness.app.runtime;

import android.content.Context;
import java.io.File;

/**
 * AllitorFk 统一引擎表：proot（官方默认）/ proroot（官方可选，闭源原样随包）/ bxroot（开源，fix4）。
 *
 * <p>引擎差异只在这里登记：标识、最低系统、内核门槛、有界命令是否需要独立会话，以及如何构造
 * {@link ContainerRuntime}。调用方不得再写 {@code "proroot".equals(...)} 之类的分支来推断能力。
 */
public enum RuntimeEngine {
  /** Termux proot（ptrace），所有 flavor 都可用，是唯一的兜底引擎。 */
  PROOT("proot", 23, false),
  /** coderredlab proroot（LD_PRELOAD，闭源 so 原样随包），API 26+。 */
  PROROOT("proroot", 26, true),
  /** bxroot（开源 MIT，glibc ULX），需要 Linux 4.11+ 内核。 */
  BXROOT("bxroot", 26, true);

  public static final RuntimeEngine DEFAULT = PROOT;

  public final String id;
  public final int minSdk;
  /** 启动器不保证 kill-on-exit 传播到全部 guest，有界命令必须走独立会话监督器。 */
  public final boolean boundedNeedsSession;

  RuntimeEngine(String id, int minSdk, boolean boundedNeedsSession) {
    this.id = id;
    this.minSdk = minSdk;
    this.boundedNeedsSession = boundedNeedsSession;
  }

  /** 未知或历史值一律回到默认引擎；偏好里的字符串不能成为执行权限。 */
  public static RuntimeEngine parse(Object value) {
    if (value instanceof String)
      for (RuntimeEngine engine : values()) if (engine.id.equals(value)) return engine;
    return DEFAULT;
  }

  public static boolean known(Object value) {
    if (!(value instanceof String)) return false;
    for (RuntimeEngine engine : values()) if (engine.id.equals(value)) return true;
    return false;
  }

  public boolean isProot() {
    return this == PROOT;
  }

  /** bxroot 依赖的 seccomp/clone3/内存映射行为在 4.11 之前的内核上不可用。 */
  public static boolean bxrootKernel(String release) {
    if (release == null) return false;
    java.util.regex.Matcher match =
        java.util.regex.Pattern.compile("^(\\d+)\\.(\\d+)(?:[.+\\-~].*)?$").matcher(release);
    if (!match.matches()) return false;
    try {
      int major = Integer.parseInt(match.group(1)), minor = Integer.parseInt(match.group(2));
      return major > 4 || major == 4 && minor >= 11;
    } catch (NumberFormatException invalid) {
      return false;
    }
  }

  /** 纯逻辑支持判定（便于单测）：返回空串表示支持，否则是可记录的明确原因。 */
  public String unsupportedReason(int sdk, String kernelRelease) {
    if (sdk < minSdk) return id + ": requires API " + minSdk + ", device API " + sdk;
    if (this == BXROOT && !bxrootKernel(kernelRelease))
      return "bxroot: requires Linux 4.11+, kernel " + kernelRelease;
    return "";
  }

  /**
   * 构造运行时。settings 为空时使用宿主当前快照；prootBinary 为空时按 flavor 选择随包 proot。
   */
  public ContainerRuntime create(
      Context context, RuntimeHostPorts.Settings settings, File prootBinary) {
    switch (this) {
      case PROROOT:
        return settings == null
            ? new ContainerRuntime.Proroot(context, ContainerRuntime.Proroot.defaultDir(context))
            : new ContainerRuntime.Proroot(
                context, ContainerRuntime.Proroot.defaultDir(context), settings.staticLoader);
      case BXROOT:
        return new BxrootRuntime(context);
      case PROOT:
      default:
        File binary = prootBinary == null ? defaultProot(context) : prootBinary;
        return settings == null
            ? new ContainerRuntime.Proot(context, binary)
            : new ContainerRuntime.Proot(context, binary, settings);
    }
  }

  static File defaultProot(Context context) {
    File directory = new File(context.getApplicationInfo().nativeLibraryDir);
    File legacy = new File(directory, "libproot_legacy.so");
    return com.deepseekharness.app.BuildConfig.LOW_ANDROID && legacy.isFile()
        ? legacy
        : new File(directory, "libproot.so");
  }
}
