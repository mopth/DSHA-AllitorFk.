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
import com.deepseekharness.app.util.UiText;
import com.deepseekharness.app.util.WebPreviewPolicy;

/**
 * 扩展中心：独立 WebView 只加载本机 dsh 的 /__dsha/extensions（官方 BrowserAuth 签名 Cookie 鉴权），
 * 不挂任何 JS 桥；导入扩展包走系统文件选择器，由页面流式上传到容器内校验。
 */
public final class ExtensionsActivity extends AppCompatActivity {
  private static final String PATH = "/__dsha/extensions";
  private static final int PICK = 41;
  private WebView web;
  private TextView status;
  private String base;
  private ValueCallback<Uri[]> pending;
  private boolean viaAuth;

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
    HarnessController controller = HarnessController.get(this);
    String authUrl = controller.getWebAuthUrl();
    base = authUrl == null || authUrl.isEmpty() ? null : WebPreviewPolicy.loopbackBaseUrl(authUrl);
    if (base == null) {
      status.setText(UiText.choose("请先启动 Web 服务，再打开扩展中心。", "Start the web service first."));
      return;
    }
    status.setText(UiText.choose("正在准备扩展包…", "Preparing extension packs…"));
    Handler main = new Handler(Looper.getMainLooper());
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
  protected void onDestroy() {
    if (pending != null) pending.onReceiveValue(null);
    if (web != null) {
      ((ViewGroup) web.getParent()).removeView(web);
      web.destroy();
    }
    super.onDestroy();
  }
}
