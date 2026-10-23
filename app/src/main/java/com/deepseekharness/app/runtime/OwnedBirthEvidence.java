package com.deepseekharness.app.runtime;

import com.deepseekharness.app.util.ProcessIdentity;

/**
 * 独立会话监督器出生身份的复核规则（移植自 fix2 f4d382c，适配官方 V1 会话启动器）。
 *
 * <p>只用于本次刚启动、尚未回收的监督器；从不用于认领旧 PID 或解除退出屏障。
 */
final class OwnedBirthEvidence {
  private static final int ESRCH = 3, EINVAL = 22;

  private OwnedBirthEvidence() {}

  /** 正常路径：/proc 可读时要求与出生行一致；不可读时要求 getsid 与出生会话一致。 */
  static ProcessIdentity current(
      ProcessIdentity born, ProcessIdentity inspected, boolean rawAlive, int sid) {
    if (born == null || !rawAlive || !born.ownsSession() || born.exited()) return null;
    if (inspected != null)
      return born.sameProcess(inspected) && inspected.ownsSession() && !inspected.exited()
          ? inspected
          : null;
    return sid == born.session ? born : null;
  }

  /**
   * 部分 ROM（如 OnePlus/ColorOS 15）同时拒读子进程 /proc/&lt;pid&gt;/stat 与 getsid。出生行来自
   * 本进程私有管道、由监督器自读 /proc/self/stat 写出（父进程为本进程、会话领导、未退出）。
   * 此时「无法检查」不等于「身份错误」；ESRCH/EINVAL（进程不存在/参数无效）仍然拒绝。
   * 调用方另须核对 Java Process 句柄的 pid 与出生行一致。
   */
  static ProcessIdentity uninspectable(
      ProcessIdentity born, ProcessIdentity inspected, boolean rawAlive, int sid) {
    if (born == null || inspected != null || !rawAlive || !born.ownsSession() || born.exited())
      return null;
    return sessionUnreadable(sid) ? born : null;
  }

  static boolean sessionUnreadable(int sid) {
    return sid < 0 && sid != -ESRCH && sid != -EINVAL;
  }

  static String describe(
      ProcessIdentity born, ProcessIdentity inspected, boolean rawAlive, int sid) {
    return "proc="
        + (inspected == null
            ? "unreadable"
            : "pid"
                + inspected.pid
                + "/ppid"
                + inspected.parent
                + "/pgid"
                + inspected.group
                + "/sid"
                + inspected.session
                + "/state"
                + inspected.state
                + "/same="
                + (born != null && born.sameProcess(inspected)))
        + " getsid="
        + sid
        + " alive="
        + rawAlive
        + (born == null ? "" : " birth=pid" + born.pid + "/sid" + born.session);
  }
}
