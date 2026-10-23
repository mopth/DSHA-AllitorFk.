package com.deepseekharness.app.runtime;

import static org.junit.Assert.*;

import org.junit.Test;

/** 统一引擎层：标识、门槛与三态能力判定（AllitorFk phase2）。 */
public class RuntimeEngineTest {
  @Test
  public void parseKeepsKnownEnginesAndFallsBackToDefaultProot() {
    assertEquals(RuntimeEngine.PROOT, RuntimeEngine.DEFAULT);
    assertEquals(RuntimeEngine.PROROOT, RuntimeEngine.parse("proroot"));
    assertEquals(RuntimeEngine.BXROOT, RuntimeEngine.parse("bxroot"));
    assertEquals(RuntimeEngine.PROOT, RuntimeEngine.parse("proot"));
    assertEquals(RuntimeEngine.PROOT, RuntimeEngine.parse("PROROOT"));
    assertEquals(RuntimeEngine.PROOT, RuntimeEngine.parse(null));
    assertEquals(RuntimeEngine.PROOT, RuntimeEngine.parse(Boolean.TRUE));
    assertTrue(RuntimeEngine.known("bxroot"));
    assertFalse(RuntimeEngine.known("termux"));
  }

  @Test
  public void boundedCommandsNeedSessionOnlyForPreloadEngines() {
    assertFalse(RuntimeEngine.PROOT.boundedNeedsSession);
    assertTrue(RuntimeEngine.PROROOT.boundedNeedsSession);
    assertTrue(RuntimeEngine.BXROOT.boundedNeedsSession);
  }

  @Test
  public void bxrootKernelGateIsStrict() {
    assertTrue(RuntimeEngine.bxrootKernel("4.11.0"));
    assertTrue(RuntimeEngine.bxrootKernel("4.14.186-perf+"));
    assertTrue(RuntimeEngine.bxrootKernel("5.10.198-android12-9-g1"));
    assertTrue(RuntimeEngine.bxrootKernel("6.1"));
    assertFalse(RuntimeEngine.bxrootKernel("4.9.337"));
    assertFalse(RuntimeEngine.bxrootKernel("3.18.140"));
    assertFalse(RuntimeEngine.bxrootKernel("garbage"));
    assertFalse(RuntimeEngine.bxrootKernel(null));
  }

  @Test
  public void capabilityIsSupportedUnsupportedOrUnknown() {
    var sv = EngineCapability.Verdict.SUPPORTED;
    var no = EngineCapability.Verdict.UNSUPPORTED;
    var unknown = EngineCapability.Verdict.UNKNOWN;
    assertEquals(sv, EngineCapability.evaluate(RuntimeEngine.PROOT, 23, null, null).verdict);
    assertEquals(no, EngineCapability.evaluate(RuntimeEngine.PROROOT, 25, "5.4", "").verdict);
    assertEquals(sv, EngineCapability.evaluate(RuntimeEngine.PROROOT, 26, null, "").verdict);
    assertEquals(no, EngineCapability.evaluate(RuntimeEngine.BXROOT, 25, "5.4", "").verdict);
    assertEquals(no, EngineCapability.evaluate(RuntimeEngine.BXROOT, 30, "4.9.1", "").verdict);
    assertEquals(unknown, EngineCapability.evaluate(RuntimeEngine.BXROOT, 30, null, "").verdict);
    assertEquals(sv, EngineCapability.evaluate(RuntimeEngine.BXROOT, 30, "5.4.1", "").verdict);
    var missing = EngineCapability.evaluate(RuntimeEngine.BXROOT, 30, "5.4.1", "MISSING x");
    assertEquals(no, missing.verdict);
    assertTrue(missing.reason, missing.reason.contains("MISSING x"));
    assertEquals(
        unknown, EngineCapability.evaluate(RuntimeEngine.PROROOT, 30, "5.4.1", null).verdict);
  }

  @Test
  public void settingsCarryEngineAndKeepLegacyBooleanConstructor() {
    var legacy = new RuntimeHostPorts.Settings("auto", true, true, false);
    assertEquals("proroot", legacy.engine);
    assertTrue(legacy.proroot);
    var bx = new RuntimeHostPorts.Settings("auto", "bxroot", true, false);
    assertFalse(bx.proroot);
    assertEquals(RuntimeEngine.BXROOT, bx.runtimeEngine());
    assertThrows(
        IllegalArgumentException.class,
        () -> new RuntimeHostPorts.Settings("auto", "other", true, false));
  }
}
