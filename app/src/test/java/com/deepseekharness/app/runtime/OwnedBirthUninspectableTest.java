package com.deepseekharness.app.runtime;

import static org.junit.Assert.*;

import com.deepseekharness.app.util.ProcessBirthHandshake;
import com.deepseekharness.app.util.ProcessIdentity;
import org.junit.Test;

public class OwnedBirthUninspectableTest {
  private static ProcessIdentity born() {
    String stat = "321 (signed session) S 99 321 321 " + "0 ".repeat(15) + "123";
    return ProcessBirthHandshake.parse(ProcessBirthHandshake.PREFIX + stat, 99);
  }

  @Test
  public void deniedProcAndGetsidFallBackToPrivatePipeBirthOnlyWhileAlive() {
    var born = born();
    assertNotNull(born);
    // EACCES(-13)/EPERM(-1): ROM 拒读，仍由 SO_PEERCRED 把关
    assertSame(born, OwnedBirthEvidence.uninspectable(born, null, true, -13));
    assertSame(born, OwnedBirthEvidence.uninspectable(born, null, true, -1));
    // 已退出、进程不存在、参数无效、读到了 /proc 却不一致：一律不信任
    assertNull(OwnedBirthEvidence.uninspectable(born, null, false, -13));
    assertNull(OwnedBirthEvidence.uninspectable(born, null, true, -3));
    assertNull(OwnedBirthEvidence.uninspectable(born, null, true, -22));
    assertNull(OwnedBirthEvidence.uninspectable(born, null, true, 999));
    assertNull(OwnedBirthEvidence.uninspectable(born, born, true, -13));
    assertNull(OwnedBirthEvidence.uninspectable(null, null, true, -13));
    // 正常路径不变
    assertSame(born, OwnedBirthEvidence.current(born, null, true, 321));
    assertNull(OwnedBirthEvidence.current(born, null, true, -13));
  }

  @Test
  public void describeExplainsRecheckFailure() {
    String text = OwnedBirthEvidence.describe(born(), null, true, -13);
    assertEquals("proc=unreadable getsid=-13 alive=true birth=pid321/sid321", text);
    assertTrue(OwnedBirthEvidence.sessionUnreadable(-13));
    assertFalse(OwnedBirthEvidence.sessionUnreadable(-3));
    assertFalse(OwnedBirthEvidence.sessionUnreadable(321));
  }
}
