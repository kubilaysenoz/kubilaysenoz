package industry.nomads.iptv;

import android.content.res.AssetManager;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Uygulamanın içinde çalışan küçük HTTP sunucusu. İki iş yapar:
 *
 *   1. Web uygulamasını assets/ klasöründen http://127.0.0.1:PORT/ üzerinden sunar.
 *      Sayfa http:// olduğu için "karışık içerik" engeli hiç devreye girmez —
 *      http:// yayınlar doğrudan oynar.
 *
 *   2. /proxy ucuyla yayınları aktarır: CORS başlığı ekler (hls.js ve mpegts.js
 *      için şart), User-Agent / Referer ayarlar (WebView bunları değiştiremez) ve
 *      .m3u8 dosyalarının içindeki adresleri de vekile yönlendirir.
 *
 * Yalnızca 127.0.0.1'e bağlanır; dışarıdan erişilemez.
 */
class LocalServer implements Runnable {

    private static final String UA =
            "Mozilla/5.0 (SmartTV; Linux) AppleWebKit/537.36 Chrome/120 Safari/537.36";

    private final AssetManager assets;
    private final int port;
    private ServerSocket socket;
    private final ExecutorService pool = Executors.newFixedThreadPool(8);
    private volatile boolean running = true;

    LocalServer(AssetManager assets, int port) {
        this.assets = assets;
        this.port = port;
    }

    int port() { return port; }

    void stop() {
        running = false;
        try { if (socket != null) socket.close(); } catch (IOException ignored) {}
        pool.shutdownNow();
    }

    @Override
    public void run() {
        try {
            socket = new ServerSocket(port, 32, InetAddress.getByName("127.0.0.1"));
            while (running) {
                final Socket client = socket.accept();
                pool.execute(new Runnable() {
                    @Override public void run() { handle(client); }
                });
            }
        } catch (IOException e) {
            if (running) android.util.Log.e("NomadsServer", "sunucu durdu", e);
        }
    }

    /* ----------------------------------------------------------- istek */

    /**
     * Tek bir bağlantıyı işler.
     *
     * HTTP/1.1'de bağlantılar varsayılan olarak kalıcıdır: istemci aynı soket
     * üzerinden arka arkaya istek atar. Android WebView'in ağ yığını da böyle
     * çalışır. Bu yüzden yanıttan sonra soketi kapatmak yetmez — kapatacaksak
     * "Connection: close" demek, demiyorsak soketi açık tutup sıradaki isteği
     * beklemek zorundayız. Aksi halde yeniden kullanılan soketteki istekler
     * sessizce düşer; yayında bu, segmentlerin rastgele gelmemesi demektir.
     *
     * Soketi ancak yanıtın uzunluğu belli değilse (canlı akış) kapatıyoruz;
     * orada zaten "Connection: close" gönderiliyor.
     */
    private void handle(Socket client) {
        try {
            client.setSoTimeout(30000);
            InputStream in = client.getInputStream();
            OutputStream out = client.getOutputStream();
            BufferedReader r = new BufferedReader(new InputStreamReader(in, "UTF-8"), 8192);

            boolean keepAlive = true;
            while (keepAlive) {
                String requestLine = r.readLine();
                if (requestLine == null) break;                 /* istemci kapattı */
                if (requestLine.length() == 0) continue;        /* araya kaçan boş satır */

                String[] parts = requestLine.split(" ");
                if (parts.length < 2) break;
                String method = parts[0];
                String target = parts[1];

                Map<String, String> headers = new HashMap<>();
                String line;
                while ((line = r.readLine()) != null && line.length() > 0) {
                    int c = line.indexOf(':');
                    if (c > 0) headers.put(line.substring(0, c).trim().toLowerCase(Locale.US),
                                           line.substring(c + 1).trim());
                }

                boolean clientWantsClose =
                        "close".equalsIgnoreCase(String.valueOf(headers.get("connection")));

                boolean framed;   /* yanıtın uzunluğu belli mi? belli değilse soket kapanmalı */
                if ("OPTIONS".equals(method)) {
                    writeHead(out, 204, "text/plain", 0, true, null);
                    framed = true;
                } else {
                    String path = target;
                    String query = "";
                    int q = target.indexOf('?');
                    if (q >= 0) { path = target.substring(0, q); query = target.substring(q + 1); }

                    if (path.equals("/proxy")) {
                        framed = doProxy(out, param(query, "url"), param(query, "ua"),
                                         param(query, "ref"), headers.get("range"), 0);
                    } else {
                        framed = serveAsset(out, path, "HEAD".equals(method));
                    }
                }
                out.flush();
                keepAlive = framed && !clientWantsClose;
            }
            client.close();
        } catch (Exception e) {
            try { client.close(); } catch (IOException ignored) {}
        }
    }

    private static String param(String query, String name) {
        for (String kv : query.split("&")) {
            int e = kv.indexOf('=');
            if (e < 0) continue;
            if (kv.substring(0, e).equals(name)) {
                try { return URLDecoder.decode(kv.substring(e + 1), "UTF-8"); }
                catch (Exception ex) { return ""; }
            }
        }
        return "";
    }

    /* ------------------------------------------------------ statik dosya */

    /** @return yanıtın uzunluğu belli mi (bağlantı açık tutulabilir mi) */
    private boolean serveAsset(OutputStream out, String path, boolean headOnly) throws IOException {
        String rel = path;
        try { rel = URLDecoder.decode(path, "UTF-8"); } catch (Exception ignored) {}
        if (rel.equals("/") || rel.isEmpty()) rel = "/index.html";
        if (rel.startsWith("/")) rel = rel.substring(1);
        if (rel.contains("..")) { return writeError(out, 403, "Yasak"); }

        InputStream is;
        try {
            is = assets.open("web/" + rel);
        } catch (IOException e) {
            return writeError(out, 404, "Bulunamadı: " + rel);
        }

        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[16384];
        int n;
        while ((n = is.read(chunk)) > 0) buf.write(chunk, 0, n);
        is.close();
        byte[] body = buf.toByteArray();

        writeHead(out, 200, mime(rel), body.length, true, null);
        if (!headOnly) out.write(body);
        return true;
    }

    private static String mime(String p) {
        String l = p.toLowerCase(Locale.US);
        if (l.endsWith(".html")) return "text/html; charset=utf-8";
        if (l.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (l.endsWith(".css")) return "text/css; charset=utf-8";
        if (l.endsWith(".json") || l.endsWith(".webmanifest")) return "application/json; charset=utf-8";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".m3u") || l.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
        if (l.endsWith(".xml")) return "application/xml";
        return "application/octet-stream";
    }

    /* ------------------------------------------------------------ vekil */

    /** @return yanıtın uzunluğu belli mi (bağlantı açık tutulabilir mi) */
    private boolean doProxy(OutputStream out, String url, String ua, String ref,
                            String range, int depth) throws IOException {
        if (depth > 5) return writeError(out, 508, "Çok fazla yönlendirme");
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            return writeError(out, 400, "Yalnızca http/https adresleri");
        }

        HttpURLConnection conn;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
        } catch (Exception e) {
            return writeError(out, 400, "Geçersiz adres");
        }
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        conn.setRequestProperty("User-Agent", ua != null && ua.length() > 0 ? ua : UA);
        conn.setRequestProperty("Accept", "*/*");
        if (ref != null && ref.length() > 0) {
            conn.setRequestProperty("Referer", ref);
            try { conn.setRequestProperty("Origin", new URL(ref).getProtocol() + "://" + new URL(ref).getHost()); }
            catch (Exception ignored) {}
        }
        if (range != null && range.length() > 0) conn.setRequestProperty("Range", range);

        int code;
        try { code = conn.getResponseCode(); }
        catch (Exception e) { return writeError(out, 502, "Bağlanılamadı: " + e.getMessage()); }

        if (code >= 300 && code < 400) {
            String loc = conn.getHeaderField("Location");
            conn.disconnect();
            if (loc != null) {
                String next;
                try { next = new URL(new URL(url), loc).toString(); } catch (Exception e) { next = loc; }
                return doProxy(out, next, ua, ref, range, depth + 1);
            }
        }

        String ctype = conn.getContentType();
        if (ctype == null) ctype = "application/octet-stream";
        String lowPath;
        try { lowPath = new URL(url).getPath().toLowerCase(Locale.US); } catch (Exception e) { lowPath = ""; }
        boolean playlist = ctype.toLowerCase(Locale.US).contains("mpegurl")
                || lowPath.endsWith(".m3u8") || lowPath.endsWith(".m3u");

        InputStream body;
        try { body = code >= 400 ? conn.getErrorStream() : conn.getInputStream(); }
        catch (Exception e) { return writeError(out, 502, "Okunamadı: " + e.getMessage()); }
        if (body == null) return writeError(out, 502, "Boş yanıt");

        if (playlist) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[16384];
            int n, total = 0;
            while ((n = body.read(chunk)) > 0) {
                total += n;
                if (total > 8 * 1024 * 1024) break;   /* çalma listesi bu kadar büyük olmaz */
                buf.write(chunk, 0, n);
            }
            body.close();
            conn.disconnect();

            String text = new String(buf.toByteArray(), "UTF-8");
            if (text.contains("#EXTM3U")) {
                byte[] rewritten = rewriteM3u8(text, url, ua, ref).getBytes("UTF-8");
                writeHead(out, code, "application/vnd.apple.mpegurl", rewritten.length, true, "no-cache, no-store");
                out.write(rewritten);
            } else {
                byte[] raw = buf.toByteArray();
                writeHead(out, code, ctype, raw.length, true, "no-cache, no-store");
                out.write(raw);
            }
            return true;
        }

        int len = conn.getContentLength();
        String contentRange = conn.getHeaderField("Content-Range");
        writeHead(out, code, ctype, len, true, "no-cache, no-store", contentRange,
                  conn.getHeaderField("Accept-Ranges"));
        byte[] chunk = new byte[32768];
        int n;
        long written = 0;
        boolean complete = false;
        try {
            while ((n = body.read(chunk)) > 0) { out.write(chunk, 0, n); written += n; }
            complete = true;
        } catch (IOException ignored) {
            /* oynatıcı kanal değiştirdi; bağlantıyı kapatmak normal */
        } finally {
            try { body.close(); } catch (IOException ignored) {}
            conn.disconnect();
        }
        /* Uzunluğu bilmiyorsak ya da tam yazamadıysak soket yeniden
           kullanılamaz: sınırı istemci ancak kapanmadan anlayamaz. */
        return complete && len >= 0 && written == len;
    }

    /** .m3u8 içindeki tüm adresleri vekile yönlendirir; segmentler de buradan geçsin. */
    private String rewriteM3u8(String text, String baseUrl, String ua, String ref) {
        StringBuilder sb = new StringBuilder(text.length() + 512);
        for (String raw : text.split("\r?\n", -1)) {
            String line = raw.trim();
            if (line.isEmpty()) { sb.append(raw).append('\n'); continue; }
            if (line.charAt(0) == '#') {
                int idx = line.indexOf("URI=\"");
                if (idx >= 0) {
                    int start = idx + 5;
                    int end = line.indexOf('"', start);
                    if (end > start) {
                        String inner = line.substring(start, end);
                        line = line.substring(0, start) + proxyLink(abs(inner, baseUrl), ua, ref)
                                + line.substring(end);
                    }
                }
                sb.append(line).append('\n');
                continue;
            }
            sb.append(proxyLink(abs(line, baseUrl), ua, ref)).append('\n');
        }
        return sb.toString();
    }

    private static String abs(String u, String base) {
        try { return new URL(new URL(base), u).toString(); } catch (Exception e) { return u; }
    }

    private String proxyLink(String target, String ua, String ref) {
        try {
            StringBuilder s = new StringBuilder("/proxy?url=");
            s.append(URLEncoder.encode(target, "UTF-8"));
            if (ua != null && ua.length() > 0) s.append("&ua=").append(URLEncoder.encode(ua, "UTF-8"));
            if (ref != null && ref.length() > 0) s.append("&ref=").append(URLEncoder.encode(ref, "UTF-8"));
            return s.toString();
        } catch (Exception e) {
            return target;
        }
    }

    /* ------------------------------------------------------------ yanıt */

    private void writeHead(OutputStream out, int code, String ctype, int len,
                           boolean cors, String cache, String... extra) throws IOException {
        StringBuilder h = new StringBuilder();
        h.append("HTTP/1.1 ").append(code).append(' ').append(reason(code)).append("\r\n");
        h.append("Content-Type: ").append(ctype).append("\r\n");
        if (len >= 0) h.append("Content-Length: ").append(len).append("\r\n");
        if (cors) {
            h.append("Access-Control-Allow-Origin: *\r\n");
            h.append("Access-Control-Allow-Headers: Range, Origin, Accept, Content-Type\r\n");
            h.append("Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n");
            h.append("Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n");
        }
        if (cache != null) h.append("Cache-Control: ").append(cache).append("\r\n");
        if (extra != null) {
            for (int i = 0; i + 1 < extra.length; i += 2) {
                if (extra[i + 1] != null) h.append(extra[i]).append(": ").append(extra[i + 1]).append("\r\n");
            }
        }
        if (len < 0) h.append("Connection: close\r\n");
        h.append("\r\n");
        out.write(h.toString().getBytes("UTF-8"));
    }

    private void writeHead(OutputStream out, int code, String ctype, int len, boolean cors,
                           String cache, String contentRange, String acceptRanges) throws IOException {
        writeHead(out, code, ctype, len, cors, cache,
                  "Content-Range", contentRange, "Accept-Ranges", acceptRanges);
    }

    private boolean writeError(OutputStream out, int code, String msg) throws IOException {
        byte[] b = msg.getBytes("UTF-8");
        writeHead(out, code, "text/plain; charset=utf-8", b.length, true, null);
        out.write(b);
        return true;   /* uzunluğu belli, bağlantı açık kalabilir */
    }

    private static String reason(int code) {
        switch (code) {
            case 200: return "OK";
            case 204: return "No Content";
            case 206: return "Partial Content";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 502: return "Bad Gateway";
            case 508: return "Loop Detected";
            default: return "OK";
        }
    }
}
