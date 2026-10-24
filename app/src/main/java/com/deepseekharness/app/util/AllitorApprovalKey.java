package com.deepseekharness.app.util;

import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;

/** Non-exportable Android Keystore EC P-256 key for takeover approvals (never visible to proot). */
public final class AllitorApprovalKey {
  private static final String ALIAS = "allitorfk_takeover_approval_v1";

  private AllitorApprovalKey() {}

  private static KeyStore store() throws Exception {
    KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
    ks.load(null);
    return ks;
  }

  private static synchronized void ensure() throws Exception {
    if (store().containsAlias(ALIAS)) return;
    KeyPairGenerator g =
        KeyPairGenerator.getInstance(
            android.security.keystore.KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
    g.initialize(
        new android.security.keystore.KeyGenParameterSpec.Builder(
                ALIAS, android.security.keystore.KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
            .setDigests(android.security.keystore.KeyProperties.DIGEST_SHA256)
            .build());
    g.generateKeyPair();
  }

  /** Base64 SPKI of the verification key; this is all the web side ever gets. */
  public static String publicSpkiBase64() throws Exception {
    ensure();
    return java.util.Base64.getEncoder()
        .encodeToString(store().getCertificate(ALIAS).getPublicKey().getEncoded());
  }

  public static byte[] sign(byte[] message) throws Exception {
    ensure();
    Signature s = Signature.getInstance("SHA256withECDSA");
    s.initSign((PrivateKey) store().getKey(ALIAS, null));
    s.update(message);
    return s.sign();
  }
}
