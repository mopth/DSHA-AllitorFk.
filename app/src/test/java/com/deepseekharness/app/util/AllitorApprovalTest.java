package com.deepseekharness.app.util;

import static org.junit.Assert.*;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import org.junit.Test;

public class AllitorApprovalTest {
  private static final String ID = "11111111-2222-4333-8444-555555555555";
  private static final String NONCE = "0123456789abcdef0123456789abcdef";

  private static KeyPair ec() throws Exception {
    KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
    g.initialize(new ECGenParameterSpec("secp256r1"));
    return g.generateKeyPair();
  }

  @Test
  public void rejectsMalformedOrOverlongRequests() {
    String[][] bad = {
      {"not-a-uuid", "browser", "10", NONCE},
      {ID, "root", "10", NONCE},
      {ID, "browser_full", "61", NONCE},
      {ID, "preview", "0", NONCE},
      {ID, "browser", "10", "short"},
      {ID, "browser", "10", NONCE.toUpperCase()},
    };
    for (String[] b : bad)
      assertThrows(
          IllegalArgumentException.class, () -> AllitorApproval.parse(b[0], b[1], b[2], b[3], ""));
  }

  @Test
  public void questionShowsIdScopeMinutesAndStripsControls() {
    var a = AllitorApproval.parse(ID, "browser_full", "60", NONCE, "x\u202e\n批准");
    String q = a.question();
    assertTrue(q.contains("请求 ID：" + ID));
    assertTrue(q.contains("权限：browser_full"));
    assertTrue(q.contains("时长：60 分钟"));
    assertFalse(a.reason.contains("\u202e"));
    assertFalse(a.reason.contains("\n"));
    assertEquals("allitor-approval-v1|" + ID + "|browser_full|60|" + NONCE, a.message());
  }

  @Test
  public void approvedReplyCarriesVerifiableSignatureDeniedCarriesNone() throws Exception {
    KeyPair kp = ec();
    var a = AllitorApproval.parse(ID, "browser", "120", NONCE, "r");
    String ok =
            (a.reply(
                true,
                m -> {
                  Signature s = Signature.getInstance("SHA256withECDSA");
                  s.initSign(kp.getPrivate());
                  s.update(m);
                  return s.sign();
                }));
    assertTrue(ok.contains("\"decision\":\"approved\""));
    assertTrue(ok.contains("\"nonce\":\"" + NONCE + "\""));
    String sig = ok.replaceAll(".*\"sig\":\"([^\"]+)\".*", "$1");
    Signature v = Signature.getInstance("SHA256withECDSA");
    v.initVerify(kp.getPublic());
    v.update(a.messageBytes());
    assertTrue(v.verify(java.util.Base64.getDecoder().decode(sig)));
    // the same signature does not verify for another nonce (no replay)
    var other = AllitorApproval.parse(ID, "browser", "120", NONCE.replace('0', '1'), "r");
    v.initVerify(kp.getPublic());
    v.update(other.messageBytes());
    assertFalse(v.verify(java.util.Base64.getDecoder().decode(sig)));
    String no = a.reply(false, null);
    assertTrue(no.contains("\"decision\":\"denied\""));
    assertFalse(no.contains("sig"));
  }

  @Test
  public void routeIsDedicated() {
    assertEquals(BridgeRoutes.Route.ALLITOR_APPROVE, BridgeRoutes.match("/app/allitor/approve"));
  }
}
