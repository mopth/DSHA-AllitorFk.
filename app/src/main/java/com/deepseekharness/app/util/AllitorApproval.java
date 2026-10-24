package com.deepseekharness.app.util;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * rc.3 T2: native takeover approval. The bridge validates the request fields itself, the dialog
 * text is rendered natively from those validated fields, and a genuine tap yields an ECDSA
 * signature over {@link #message()} with a key that never leaves Android Keystore.
 */
public final class AllitorApproval {
  public static final String VERSION = "allitor-approval-v1";
  public static final Map<String, Integer> MAX_MINUTES =
      Map.of("browser", 120, "browser_full", 60, "preview", 240);
  public static final Map<String, String> LABEL =
      Map.of(
          "browser", "受限浏览器（只读抓取）",
          "browser_full", "完整浏览器（JS/POST/会话/下载）",
          "preview", "本地预览分享");
  private static final Pattern ID =
      Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
  private static final Pattern NONCE = Pattern.compile("[0-9a-f]{32}");

  public final String id, scope, nonce, reason;
  public final int minutes;

  private AllitorApproval(String id, String scope, int minutes, String nonce, String reason) {
    this.id = id;
    this.scope = scope;
    this.minutes = minutes;
    this.nonce = nonce;
    this.reason = reason;
  }

  public static AllitorApproval parse(
      String id, String scope, String minutes, String nonce, String reason) {
    if (id == null || !ID.matcher(id).matches()) throw new IllegalArgumentException("BAD_ID");
    if (scope == null || !MAX_MINUTES.containsKey(scope))
      throw new IllegalArgumentException("BAD_SCOPE");
    if (minutes == null || !minutes.matches("[1-9][0-9]{0,3}"))
      throw new IllegalArgumentException("BAD_MINUTES");
    int m = Integer.parseInt(minutes);
    if (m > MAX_MINUTES.get(scope)) throw new IllegalArgumentException("BAD_MINUTES");
    if (nonce == null || !NONCE.matcher(nonce).matches())
      throw new IllegalArgumentException("BAD_NONCE");
    String r = reason == null ? "" : reason.replaceAll("[\\p{Cc}\\p{Cf}]", " ");
    if (r.length() > 300) r = r.substring(0, 300);
    return new AllitorApproval(id, scope, m, nonce, r);
  }

  public String message() {
    return VERSION + "|" + id + "|" + scope + "|" + minutes + "|" + nonce;
  }

  public byte[] messageBytes() {
    return message().getBytes(StandardCharsets.UTF_8);
  }

  /** Dialog text built natively from validated fields; reason is labelled as unverified. */
  public String question() {
    return "AllitorFk：是否批准 AI 接管？\n请求 ID："
        + id
        + "\n权限："
        + scope
        + "（"
        + LABEL.get(scope)
        + "）\n时长："
        + minutes
        + " 分钟\nAI 自述理由（未经核实）："
        + reason;
  }

  public interface Signer {
    byte[] sign(byte[] message) throws Exception;
  }

  /** JSON reply for the web side; signature only when the human tapped approve. */
  public String reply(boolean approved, Signer signer) throws Exception {
    // All fields are validated to [0-9a-f-] / base64, so plain concatenation is valid JSON.
    String head = "{\"id\":\"" + id + "\",\"nonce\":\"" + nonce + "\",\"decision\":";
    if (!approved) return head + "\"denied\"}";
    String sig = java.util.Base64.getEncoder().encodeToString(signer.sign(messageBytes()));
    return head + "\"approved\",\"sig\":\"" + sig + "\"}";
  }
}
