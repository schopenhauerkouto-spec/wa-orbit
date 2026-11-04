package ci.waorbit.mobile;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.http.SslError;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final String SERVER_KEY = "server_url";
    private static final int FILE_PICKER_REQUEST = 4107;

    private TextView titleView;
    private Button changeServerButton;
    private WebView webView;
    private String allowedHost = "";
    private ValueCallback<Uri[]> filePickerCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(13, 29, 43));
        getWindow().setNavigationBarColor(Color.rgb(13, 29, 43));
        buildLayout();
        configureWebView();

        String savedUrl = getPreferences(Context.MODE_PRIVATE).getString(SERVER_KEY, "");
        if (savedUrl.isEmpty()) showSetupScreen();
        else loadSavedServer(savedUrl);
    }

    private void buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(248, 250, 252));

        LinearLayout topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setPadding(dp(18), dp(10), dp(12), dp(10));
        topBar.setBackgroundColor(Color.rgb(13, 29, 43));

        titleView = new TextView(this);
        titleView.setText("WA ORBIT");
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(16);
        titleView.setLetterSpacing(0.12f);
        titleView.setTypeface(null, android.graphics.Typeface.BOLD);
        topBar.addView(titleView, new LinearLayout.LayoutParams(0, dp(42), 1));

        changeServerButton = new Button(this);
        changeServerButton.setText("Serveur");
        changeServerButton.setTextSize(12);
        changeServerButton.setAllCaps(false);
        changeServerButton.setTextColor(Color.WHITE);
        changeServerButton.setBackgroundTintList(
            android.content.res.ColorStateList.valueOf(Color.rgb(34, 111, 100))
        );
        changeServerButton.setOnClickListener(v -> showChangeServerConfirmation());
        topBar.addView(changeServerButton, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, dp(40)
        ));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(248, 250, 252));
        root.addView(topBar, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(60)
        ));
        root.addView(webView, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1
        ));
        setContentView(root);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setLoadsImagesAutomatically(true);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(Uri.parse(url));
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                Toast.makeText(MainActivity.this,
                    "Connexion HTTPS refusée : certificat non fiable.", Toast.LENGTH_LONG).show();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) {
                    Toast.makeText(MainActivity.this,
                        "Serveur inaccessible. Vérifie l'adresse et ta connexion Internet.",
                        Toast.LENGTH_LONG).show();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePickerCallback != null) filePickerCallback.onReceiveValue(null);
                filePickerCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try {
                    startActivityForResult(intent, FILE_PICKER_REQUEST);
                } catch (Exception error) {
                    filePickerCallback = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this,
                        "Impossible d'ouvrir le sélecteur de fichiers.", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) ->
            downloadFile(url, userAgent, contentDisposition, mimeType)
        );
    }

    private boolean handleNavigation(Uri uri) {
        if (uri == null) return true;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);

        if ("https".equals(scheme) && !allowedHost.isEmpty() && allowedHost.equals(host)) {
            return false;
        }
        if ("https".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme)
                || "whatsapp".equals(scheme)) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {
                Toast.makeText(this, "Aucune application ne peut ouvrir ce lien.", Toast.LENGTH_SHORT).show();
            }
        }
        return true;
    }

    private String validateServerUrl(String rawUrl) {
        if (rawUrl == null) throw new IllegalArgumentException("URL manquante.");
        Uri uri = Uri.parse(rawUrl.trim());
        String path = uri.getPath();
        if (!"https".equalsIgnoreCase(uri.getScheme())
                || uri.getHost() == null
                || uri.getHost().trim().isEmpty()
                || uri.getUserInfo() != null
                || uri.getQuery() != null
                || uri.getFragment() != null
                || (path != null && !path.isEmpty() && !"/".equals(path))) {
            throw new IllegalArgumentException(
                "Utilise l'adresse HTTPS principale du serveur, sans /api ni autre chemin."
            );
        }
        return "https://" + uri.getAuthority();
    }

    private void loadSavedServer(String rawUrl) {
        try {
            String normalized = validateServerUrl(rawUrl);
            allowedHost = Uri.parse(normalized).getHost().toLowerCase(Locale.ROOT);
            changeServerButton.setVisibility(View.VISIBLE);
            titleView.setText("WA ORBIT");
            webView.removeJavascriptInterface("OrbitSetup");
            webView.loadUrl(normalized);
        } catch (IllegalArgumentException error) {
            getPreferences(Context.MODE_PRIVATE).edit().remove(SERVER_KEY).apply();
            showSetupScreen();
        }
    }

    private void showSetupScreen() {
        allowedHost = "";
        titleView.setText("CONFIGURATION");
        changeServerButton.setVisibility(View.GONE);
        webView.removeJavascriptInterface("OrbitSetup");
        webView.addJavascriptInterface(new SetupBridge(), "OrbitSetup");
        try (InputStream input = getAssets().open("launcher.html");
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            String html = new String(output.toByteArray(), StandardCharsets.UTF_8);
            webView.loadDataWithBaseURL(
                "https://appassets.androidplatform.net/assets/",
                html, "text/html", "UTF-8", null
            );
        } catch (Exception error) {
            Toast.makeText(this, "Écran de configuration indisponible.", Toast.LENGTH_LONG).show();
        }
    }

    private void showChangeServerConfirmation() {
        new android.app.AlertDialog.Builder(this)
            .setTitle("Changer de serveur ?")
            .setMessage("Saisis l'adresse HTTPS de ton instance WA Orbit.")
            .setNegativeButton("Annuler", (dialog, which) -> dialog.dismiss())
            .setPositiveButton("Changer", (dialog, which) -> {
                getPreferences(Context.MODE_PRIVATE).edit().remove(SERVER_KEY).apply();
                webView.stopLoading();
                showSetupScreen();
            })
            .show();
    }

    private void connectToServer(String rawUrl) {
        try {
            String normalized = validateServerUrl(rawUrl);
            getPreferences(Context.MODE_PRIVATE).edit().putString(SERVER_KEY, normalized).apply();
            loadSavedServer(normalized);
        } catch (IllegalArgumentException error) {
            Toast.makeText(this, error.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void downloadFile(String url, String userAgent, String contentDisposition, String mimeType) {
        try {
            Uri uri = Uri.parse(url);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !allowedHost.equalsIgnoreCase(uri.getHost())) {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return;
            }
            DownloadManager.Request request = new DownloadManager.Request(uri);
            request.setMimeType(mimeType);
            request.addRequestHeader("User-Agent", userAgent);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            request.setTitle(URLUtil.guessFileName(url, contentDisposition, mimeType));
            request.setDescription("Téléchargement depuis WA Orbit");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(
                Environment.DIRECTORY_DOWNLOADS,
                URLUtil.guessFileName(url, contentDisposition, mimeType)
            );
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
            Toast.makeText(this, "Téléchargement lancé.", Toast.LENGTH_SHORT).show();
        } catch (Exception error) {
            Toast.makeText(this, "Téléchargement impossible.", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_PICKER_REQUEST && filePickerCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
            filePickerCallback.onReceiveValue(result);
            filePickerCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && !allowedHost.isEmpty() && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (filePickerCallback != null) filePickerCallback.onReceiveValue(null);
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private final class SetupBridge {
        @JavascriptInterface
        public void connect(String url) {
            runOnUiThread(() -> connectToServer(url));
        }
    }
}
