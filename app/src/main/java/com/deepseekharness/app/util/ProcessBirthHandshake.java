package com.deepseekharness.app.util;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.function.BooleanSupplier;

/** 在任何 guest 启动前消费签名会话启动器的有界自读 stat 行。 */
public final class ProcessBirthHandshake {
  public static final String PREFIX = "DSHA_SESSION_STAT_V1 ";
  private static final int LIMIT = 8192;

  public static ProcessIdentity read(
      InputStream input, int owner, BooleanSupplier running, long timeoutMs)
      throws IOException, InterruptedException {
    long started = System.nanoTime();
    long budget = java.util.concurrent.TimeUnit.MILLISECONDS.toNanos(timeoutMs);
    ByteArrayOutputStream line = new ByteArrayOutputStream();
    while (System.nanoTime() - started < budget) {
      while (input.available() > 0) {
        int value = input.read();
        if (value < 0) throw new IOException("PROCESS_BIRTH_HANDSHAKE_EOF:" + safe(line));
        if (value == '\n') {
          ProcessIdentity identity = parse(line.toString(StandardCharsets.US_ASCII.name()), owner);
          if (identity == null)
            throw new IOException("PROCESS_BIRTH_HANDSHAKE_INVALID:" + safe(line));
          return identity;
        }
        if (line.size() >= LIMIT) throw new IOException("PROCESS_BIRTH_HANDSHAKE_LIMIT");
        line.write(value);
      }
      if (!running.getAsBoolean())
        throw new IOException("PROCESS_BIRTH_HANDSHAKE_EXITED:" + safe(line));
      Thread.sleep(5);
    }
    throw new IOException("PROCESS_BIRTH_HANDSHAKE_TIMEOUT:" + timeoutMs + "ms:" + safe(line));
  }

  /** 启动器在握手前的输出（如 DSHA_SESSION_*）有助定位；脱敏、去控制字符并限长（fix2）。 */
  static String safe(ByteArrayOutputStream line) {
    String text =
        new String(line.toByteArray(), StandardCharsets.US_ASCII).replaceAll("[^\\x20-\\x7e]", "?");
    text = SensitiveData.redact(text);
    return text.length() > 160 ? text.substring(0, 160) : text;
  }

  public static ProcessIdentity parse(String line, int owner) {
    if (line == null || line.length() > LIMIT || !line.startsWith(PREFIX)) return null;
    String stat = line.substring(PREFIX.length());
    int split = stat.indexOf(" (");
    if (split < 1 || !stat.substring(0, split).matches("[1-9][0-9]{0,9}")) return null;
    try {
      int pid = Integer.parseInt(stat.substring(0, split));
      ProcessIdentity identity = ProcessIdentity.fromStat(stat, pid, owner);
      return identity != null && identity.ownsSession() && !identity.exited() ? identity : null;
    } catch (NumberFormatException invalid) {
      return null;
    }
  }

  private ProcessBirthHandshake() {}
}
