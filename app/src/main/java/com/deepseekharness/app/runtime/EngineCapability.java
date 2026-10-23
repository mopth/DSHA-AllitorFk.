package com.deepseekharness.app.runtime;

import android.content.Context;

/**
 * 引擎的宿主能力预检（不运行 guest）。三态：明确支持、明确不支持（可回落 proot 并记录原因）、
 * 未知（读不到判定依据，调用方不得据此切换引擎）。
 */
public final class EngineCapability {
  public enum Verdict {
    SUPPORTED,
    UNSUPPORTED,
    UNKNOWN
  }

  public final RuntimeEngine engine;
  public final Verdict verdict;
  public final String reason;

  private EngineCapability(RuntimeEngine engine, Verdict verdict, String reason) {
    this.engine = engine;
    this.verdict = verdict;
    this.reason = reason == null ? "" : reason;
  }

  public static EngineCapability supported(RuntimeEngine engine) {
    return new EngineCapability(engine, Verdict.SUPPORTED, "");
  }

  /**
   * 纯判定，便于单测。kernelRelease 为 null 表示内核版本读取失败；nativeFailure 为 null 表示原生
   * 文件检查本身没能完成，空串表示通过，其余是明确失败原因。
   */
  public static EngineCapability evaluate(
      RuntimeEngine engine, int sdk, String kernelRelease, String nativeFailure) {
    if (engine.isProot()) return supported(engine);
    if (sdk < engine.minSdk)
      return new EngineCapability(
          engine,
          Verdict.UNSUPPORTED,
          engine.id + ": requires API " + engine.minSdk + ", device API " + sdk);
    if (engine == RuntimeEngine.BXROOT) {
      if (kernelRelease == null)
        return new EngineCapability(engine, Verdict.UNKNOWN, "bxroot: kernel release unreadable");
      if (!RuntimeEngine.bxrootKernel(kernelRelease))
        return new EngineCapability(
            engine, Verdict.UNSUPPORTED, "bxroot: requires Linux 4.11+, kernel " + kernelRelease);
    }
    if (nativeFailure == null)
      return new EngineCapability(engine, Verdict.UNKNOWN, engine.id + ": native check incomplete");
    if (!nativeFailure.isEmpty())
      return new EngineCapability(engine, Verdict.UNSUPPORTED, engine.id + ": " + nativeFailure);
    return supported(engine);
  }

  public static EngineCapability probe(
      Context context, RuntimeEngine engine, RuntimeHostPorts.Settings settings) {
    String release;
    try {
      release = android.system.Os.uname().release;
    } catch (RuntimeException unreadable) {
      release = null;
    }
    String nativeFailure;
    try {
      ContainerRuntime candidate = engine.create(context, settings, null);
      if (!candidate.available()) nativeFailure = "UNAVAILABLE " + candidate.unavailableReason();
      else {
        candidate.prepare();
        nativeFailure = "";
      }
    } catch (Exception failed) {
      // 原生文件缺失、锁哈希不一致等都是确定的失败。
      nativeFailure = "PREPARE_FAILED " + com.deepseekharness.app.util.SensitiveData.redact(String.valueOf(failed));
    }
    return evaluate(engine, android.os.Build.VERSION.SDK_INT, release, nativeFailure);
  }
}
