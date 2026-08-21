package industry.nomads.iptv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.IOException;
import java.net.ServerSocket;

/**
 * NOMADS INDUSTRY IPTV — Android TV kabuğu.
 *
 * Web uygulamasını, uygulamanın içinde çalışan yerel sunucudan (127.0.0.1)
 * yükler. Böylece tarayıcıda karşılaşılan üç engel de ortadan kalkar:
 * karışık içerik, CORS ve değiştirilemeyen User-Agent / Referer başlıkları.
 * Kumanda tuşları doğrudan WebView'e geçer; web tarafındaki tuş eşlemesi
 * (js/nav.js) zaten Android TV kodlarını tanıyor.
 */
public class MainActivity extends Activity {

    private WebView web;
    private LocalServer server;
    private long lastBack = 0;
    private int port;
    private int loadTries = 0;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setBackgroundDrawableResource(android.R.color.black);

        port = freePort();
        server = new LocalServer(getAssets(), port);
        new Thread(server, "nomads-http").start();

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);   /* kanal açılınca kendi başlasın */
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT && isDebuggable()) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return false;   /* her şey kendi sunucumuzda; dışarı çıkma */
            }

            /* Eski sürümler bu imzayı çağırır */
            @Override
            public void onReceivedError(WebView v, int code, String desc, String failingUrl) {
                if (failingUrl != null && failingUrl.startsWith("http://127.0.0.1")) {
                    onLoadFailed(code + " " + desc);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                android.util.Log.d("NomadsWeb", m.message() + " @" + m.lineNumber());
                return true;
            }
        });

        hideSystemUi();
        startWhenServerReady();
    }

    /**
     * Sunucu iş parçacığı başlatıldığı anda soket henüz bağlanmış olmayabilir.
     * Sayfayı hemen istersek bağlantı reddedilir ve kullanıcı sebebini
     * anlamadığı bomboş siyah ekran görür — hele ki ilk kurulumda. Bu yüzden
     * yükleme, sunucunun gerçekten dinlemeye başlamasını bekliyor.
     */
    private void startWhenServerReady() {
        new Thread(new Runnable() {
            @Override public void run() {
                final boolean ok = server.awaitReady(10000);
                final Exception err = server.startError();
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (ok) {
                            loadTries = 0;
                            web.loadUrl("http://127.0.0.1:" + port + "/index.html?native=1&proxy=" + port);
                        } else {
                            showFatal("Yerel sunucu başlatılamadı"
                                    + (err != null ? ": " + err.getMessage() : " (zaman aşımı)"));
                        }
                    }
                });
            }
        }, "nomads-boot").start();
    }

    /** Sayfa yüklenemedi: birkaç kez yeniden dene, sonra sebebi ekranda göster. */
    private void onLoadFailed(final String detail) {
        loadTries++;
        if (loadTries <= 3) {
            web.postDelayed(new Runnable() {
                @Override public void run() {
                    web.loadUrl("http://127.0.0.1:" + port + "/index.html?native=1&proxy=" + port);
                }
            }, 600L * loadTries);
            return;
        }
        showFatal("Uygulama sayfası açılamadı: " + detail);
    }

    /**
     * Hata ekranı. Bilerek sade ve okunur: kurulumu yapan kişi TV'nin karşısında
     * olacak, elinde hata ayıklayıcı olmayacak. Ekranı fotoğraflayıp
     * gönderebilsin diye teknik bilgiyi de yazıyoruz.
     */
    private void showFatal(String message) {
        String html =
            "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'>" +
            "<style>body{background:#0b0f16;color:#e8eef7;font-family:sans-serif;" +
            "margin:0;padding:8% 10%;line-height:1.6}" +
            "h1{font-weight:300;font-size:6vw;color:#ff9b9b;margin:0 0 3vw}" +
            "p{font-size:3vw;margin:0 0 2vw}" +
            ".d{font-size:2.4vw;color:#8fa3bd;word-break:break-all}</style></head><body>" +
            "<h1>Uygulama açılamadı</h1>" +
            "<p>" + esc(message) + "</p>" +
            "<p class='d'>Port: " + port + "<br>Android: " + Build.VERSION.RELEASE +
            " (API " + Build.VERSION.SDK_INT + ")<br>Cihaz: " + esc(Build.MANUFACTURER + " " + Build.MODEL) +
            "</p>" +
            "<p class='d'>Uygulamayı kapatıp yeniden açmayı dene. Sürerse bu ekranın " +
            "fotoğrafını gönder.</p>" +
            "</body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private boolean isDebuggable() {
        return (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    /** Boş bir port bul; sabit port başka uygulamayla çakışabilir. */
    private static int freePort() {
        try {
            ServerSocket s = new ServerSocket(0);
            int p = s.getLocalPort();
            s.close();
            return p;
        } catch (IOException e) {
            return 47811;
        }
    }

    private void hideSystemUi() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean has) {
        super.onWindowFocusChanged(has);
        if (has) hideSystemUi();
    }

    /**
     * Geri tuşu web tarafına gider (uygulama içinde ekranlar arası geri gitmek için).
     * Web tarafı kök ekrandayken ikinci basışta uygulamadan çıkılır.
     */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            long now = System.currentTimeMillis();
            if (now - lastBack < 2000) {
                finish();
                return true;
            }
            lastBack = now;
            /* web tarafındaki Nav 'back' olarak görsün */
            web.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK));
            web.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK));
            Toast.makeText(this, "Çıkmak için tekrar Geri", Toast.LENGTH_SHORT).show();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stop();
        if (web != null) {
            web.loadUrl("about:blank");
            web.destroy();
        }
        super.onDestroy();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        hideSystemUi();
    }
}
