package com.deepseekharness.app.util;

/**
 * 兼容重试只由已确认的进程退出触发；等待时间、插件报错和用户停止都不能触发。
 * 适用于任何非 proot 引擎（proroot、bxroot）：明确退出后改用 proot 一次。
 */
public final class WebRuntimeFallback {
  private WebRuntimeFallback() {}

  public static boolean shouldRetry(
      String runtime,
      boolean retried,
      boolean hadAuth,
      boolean pluginFailure,
      boolean current,
      Integer exitCode) {
    return runtime != null
        && !"proot".equals(runtime)
        && com.deepseekharness.app.runtime.RuntimeEngine.known(runtime)
        && !retried
        && !hadAuth
        && !pluginFailure
        && current
        && exitCode != null;
  }

  /** 启动结果分类：只有 DEFINITE_FAILURE 记“一击”；超时与不确定一律不计，也不清零。 */
  public enum StartOutcome {
    SUCCESS,
    DEFINITE_FAILURE,
    TIMEOUT,
    INDETERMINATE
  }

  /** 实验引擎（proroot/bxroot）连续明确失败达到此数，自动改回 proot（三振切回，取自官方 feat/bxroot-runtime）。 */
  public static final int FORCE_PROOT_STRIKES = 3;

  static boolean experimental(String runtime) {
    return runtime != null
        && !"proot".equals(runtime)
        && com.deepseekharness.app.runtime.RuntimeEngine.known(runtime);
  }

  /**
   * 进程退出的分类：鉴权前、当前代次、退出码已确认、且没有插件等具名失败，才算引擎明确失败。
   * 退出码未知（等待/看门狗/读不到状态）是 INDETERMINATE；鉴权后退出不是启动失败。
   */
  public static StartOutcome exitOutcome(
      boolean hadAuth, boolean pluginFailure, boolean current, Integer exitCode) {
    if (hadAuth) return StartOutcome.SUCCESS;
    if (!current || exitCode == null || pluginFailure) return StartOutcome.INDETERMINATE;
    return StartOutcome.DEFINITE_FAILURE;
  }

  /**
   * 下一次的连续明确失败计数：成功清零；明确失败且是实验引擎才 +1；超时/不确定保持不变（fix4 规则：
   * 不确定结果永不触发自动切换，避免在半装好的环境上重装）。
   */
  public static int nextStrikes(int strikes, String runtime, StartOutcome outcome) {
    int current = Math.max(0, Math.min(FORCE_PROOT_STRIKES, strikes));
    if (outcome == StartOutcome.SUCCESS) return 0;
    if (outcome != StartOutcome.DEFINITE_FAILURE || !experimental(runtime)) return current;
    return Math.min(FORCE_PROOT_STRIKES, current + 1);
  }

  /** 明确失败计数达到上限且当前是实验引擎 → 改回 proot。proot 本身与未知名字永不触发。 */
  public static boolean shouldForceProot(int strikes, String runtime) {
    return strikes >= FORCE_PROOT_STRIKES && experimental(runtime);
  }
}
