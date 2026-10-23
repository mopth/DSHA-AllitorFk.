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
}
