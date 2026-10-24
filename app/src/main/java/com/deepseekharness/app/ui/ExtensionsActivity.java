package com.deepseekharness.app.ui;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import com.deepseekharness.app.core.HarnessController;
import com.deepseekharness.app.runtime.ExtensionPacks;
import com.deepseekharness.app.util.ExtensionReleaseLinks;
import com.deepseekharness.app.util.UiText;
import com.deepseekharness.app.util.WebPreviewPolicy;

/**
 * 扩展中心：独立 WebView 只加载本机 dsh 的 /__dsha/extensions（官方 BrowserAuth 签名 Cookie 鉴权），
 * 不挂任何 JS 桥；导入扩展包走系统文件选择器，由页面流式上传到容器内校验。
 * 唯一放行到外部的导航：本 fork Release 的 .dshx 资产地址（{@link ExtensionReleaseLinks}），交给系统浏览器下载。
 */
public final class ExtensionsActivity extends AppCompatActivity {
  private static final String PATH = "/__dsha/extensions";
  private static final int PICK = 41;
  private WebView web;
  private TextView status;
  private String base;
  private ValueCallback<Uri[]> pending;
  private boolean viaAuth;
  private static final long START_TIMEOUT_MS = 180_000L;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private LinearLayout root;
  private android.widget.Button startButton;
  private boolean opened;
  private boolean starting;
  private boolean restoring;
  private long startedAt;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    status = new TextView(this);
    status.setPadding(32, 24, 32, 24);
    root.addView(status);
    setContentView(root);
    setTitle(UiText.choose("扩展中心", "Extensions"));
    startButton = new android.widget.Button(this);
    startButton.setText(UiText.choose("启动服务", "Start service"));
    startButton.setVisibility(android.view.View.GONE);
    startButton.setOnClickListener(v -> startService());
    LinearLayout.LayoutParams lp =
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    lp.setMargins(32, 0, 32, 24);
    root.addView(startButton, lp);
    this.root = root;
    tryOpen(true);
  }

  /**
   * Web 服务没在跑（或进程重启后还没接回已运行的实例）时不再停在空白页：先尝试只读接回，
   * 接不回就给出一键「启动服务」，启动成功后自动进入扩展中心。
   */
  private void tryOpen(boolean allowRestore) {
    if (opened || isFinishing() || isDestroyed()) return;
    HarnessController controller = HarnessController.get(this);
    String authUrl = controller.getWebAuthUrl();
    String loopback =
        authUrl == null || authUrl.isEmpty() ? null : WebPreviewPolicy.loopbackBaseUrl(authUrl);
    if (loopback != null) {
      proceed(controller, authUrl, loopback);
      return;
    }
    if (allowRestore && controller.needsWebSessionRestore()) {
      status.setText(UiText.choose("正在连接已运行的 Web 服务…", "Reconnecting to the running web service…"));
      restoring = true;
      controller.restoreRunningWebSession(
          () ->
              handler.post(
                  () -> {
                    restoring = false;
                    tryOpen(false);
                  }));
      return;
    }
    if (starting) return;
    status.setText(
        UiText.choose(
            "Web 服务没有运行。扩展中心要靠它来下载和启用扩展包，点下面的按钮启动（与首页的「启动」相同）。",
            "The web service is not running. The Extensions page needs it; tap below to start it (same as Start on the home screen)."));
    startButton.setEnabled(true);
    startButton.setVisibility(android.view.View.VISIBLE);
  }

  private void startService() {
    startButton.setEnabled(false);
    starting = true;
    startedAt = android.os.SystemClock.elapsedRealtime();
    status.setText(UiText.choose("正在启动 Web 服务…", "Starting the web service…"));
    boolean queued =
        FirstRunWebStart.enqueueVisible(
            this,
            false,
            false,
            msg ->
                runOnUiThread(
                    () -> {
                      if (!opened && msg != null && !msg.isEmpty())
                        status.setText(com.deepseekharness.app.util.UiStateText.render(msg));
                    }));
    if (!queued) {
      starting = false;
      status.setText(UiText.choose("没能启动 Web 服务，请回首页点「启动」。", "Could not start the web service; use Start on the home screen."));
      startButton.setEnabled(true);
      return;
    }
    handler.postDelayed(this::waitForService, 1000);
  }

  private void waitForService() {
    if (opened || isFinishing() || isDestroyed()) return;
    String authUrl = HarnessController.get(this).getWebAuthUrl();
    if (authUrl != null && !authUrl.isEmpty()) {
      starting = false;
      tryOpen(false);
      return;
    }
    if (android.os.SystemClock.elapsedRealtime() - startedAt > START_TIMEOUT_MS) {
      starting = false;
      status.setText(
          UiText.choose(
              "Web 服务三分钟内没有就绪。请回首页查看启动状态，就绪后再打开扩展中心，或再点一次。",
              "The web service was not ready within 3 minutes. Check the home screen, or tap again."));
      startButton.setEnabled(true);
      startButton.setVisibility(android.view.View.VISIBLE);
      return;
    }
    handler.postDelayed(this::waitForService, 1000);
  }

  private void proceed(HarnessController controller, String authUrl, String loopback) {
    opened = true;
    base = loopback;
    root.removeView(startButton);
    LinearLayout root = this.root;
    status.setText(UiText.choose("正在准备扩展包…", "Preparing extension packs…"));
    Handler main = handler;
    new Thread(
            () -> {
              String error =
                  ExtensionPacks.prepare(
                      this,
                      controller.getProot(),
                      (name, done, total) ->
                          main.post(
                              () ->
                                  status.setText(
                                      UiText.choose("正在释放内置扩展包 ", "Staging bundled pack ")
                                          + name
                                          + "  "
                                          + (total > 0 ? done * 100 / total : 0)
                                          + "%")));
              main.post(() -> open(root, authUrl, error));
            },
            "dsha-ext-prepare")
        .start();
  }

  @SuppressLint("SetJavaScriptEnabled")
  private void open(LinearLayout root, String authUrl, String error) {
    if (isFinishing() || isDestroyed()) return;
    if (error != null) status.setText(UiText.choose("扩展准备未完成：", "Extensions not ready: ") + error);
    else root.removeView(status);
    web = new WebView(this);
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(false);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setMediaPlaybackRequiresUserGesture(true);
    web.setWebViewClient(
        new WebViewClient() {
          @Override
          @SuppressWarnings("deprecation")
          public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return route(view, Uri.parse(url));
          }

          @Override
          public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return route(view, request.getUrl());
          }

          private boolean route(WebView view, Uri uri) {
            String text = uri.toString();
            if (ExtensionReleaseLinks.isReleaseAsset(text)) {
              try {
                startActivity(
                    new Intent(Intent.ACTION_VIEW, Uri.parse(text))
                        .addCategory(Intent.CATEGORY_BROWSABLE));
              } catch (RuntimeException noBrowser) {
                android.widget.Toast.makeText(
                        ExtensionsActivity.this,
                        UiText.choose("没有可用的浏览器", "No browser available"),
                        android.widget.Toast.LENGTH_LONG)
                    .show();
              }
              return true;
            }
            boolean sameOrigin = uri.toString().startsWith(base);
            // 鉴权链接 303 回到 "/" 时改去扩展页；其余离开本页的导航一律拦截。
            if (sameOrigin && "/".equals(uri.getPath()) && viaAuth) {
              viaAuth = false;
              view.post(() -> view.loadUrl(base + PATH.substring(1)));
              return true;
            }
            return !(sameOrigin && PATH.equals(uri.getPath()));
          }
        });
    web.setWebChromeClient(
        new WebChromeClient() {
          @Override
          public boolean onShowFileChooser(
              WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pending != null) pending.onReceiveValue(null);
            pending = callback;
            Intent pick =
                new Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("*/*");
            try {
              startActivityForResult(pick, PICK);
            } catch (RuntimeException unavailable) {
              pending = null;
              return false;
            }
            return true;
          }
        });
    root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
    String cookie = CookieManager.getInstance().getCookie(base);
    if (cookie != null && !cookie.isEmpty()) web.loadUrl(base + PATH.substring(1));
    else {
      viaAuth = true;
      web.loadUrl(authUrl);
    }
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request != PICK || pending == null) return;
    Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
    pending.onReceiveValue(uri == null ? null : new Uri[] {uri});
    pending = null;
  }

  @Override
  protected void onResume() {
    super.onResume();
    // 用户可能去首页启动了服务再回来：直接进入。
    if (!opened && !starting && !restoring && root != null) tryOpen(false);
  }

  @Override
  protected void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    if (pending != null) pending.onReceiveValue(null);
    if (web != null) {
      ((ViewGroup) web.getParent()).removeView(web);
      web.destroy();
    }
    super.onDestroy();
  }
}
