package com.deepseekharness.app.util;

/** Product identity for the production application. */
public final class AppIdentity {
  private AppIdentity() {}

  public static String applicationId() {
    return "dsha.AllitorFk_.dsh0_2_1_rc_3";
  }

  public static String displayName() {
    return com.deepseekharness.app.BuildConfig.DISPLAY_NAME;
  }

  public static String publicDirectoryName() {
    return "DSHA-AllitorFk-rc3";
  }

  public static String defaultUpdateFeed() {
    return "";
  }

  public static boolean isExperimental() {
    return false;
  }
}
