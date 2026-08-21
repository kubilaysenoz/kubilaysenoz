package industry.nomads.iptv;

import android.content.res.AssetManager;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * LocalServer'ı düz JVM'de başlatır; böylece APK'yı bir TV'ye kurmadan
 * gerçekten HTTP isteği atıp davranışını sınayabiliyoruz.
 *
 *   java ... industry.nomads.iptv.Harness <varlık-dizini> <port>
 */
public final class Harness {

    public static void main(String[] args) throws Exception {
        final File root = new File(args[0]).getCanonicalFile();
        int port = Integer.parseInt(args[1]);

        AssetManager assets = new AssetManager() {
            @Override
            public InputStream open(String name) throws IOException {
                /* LocalServer "web/..." önekiyle istiyor; kökü ona göre çözüyoruz */
                File f = new File(root, name).getCanonicalFile();
                if (!f.getPath().startsWith(root.getPath())) throw new IOException("dizin dışı: " + name);
                if (!f.isFile()) throw new IOException("yok: " + name);
                return new FileInputStream(f);
            }
        };

        LocalServer server = new LocalServer(assets, port);
        Thread t = new Thread(server, "local-server");
        t.setDaemon(false);
        t.start();

        /* MainActivity ile aynı yolu izliyoruz: sayfayı yüklemeden önce
           sunucunun gerçekten dinlediğini bekle. */
        if (!server.awaitReady(8000)) {
            System.out.println("HATA " + (server.startError() == null
                    ? "zaman aşımı" : server.startError().getMessage()));
            System.out.flush();
            System.exit(2);
        }

        System.out.println("HAZIR " + port);
        System.out.flush();

        Runtime.getRuntime().addShutdownHook(new Thread(new Runnable() {
            @Override public void run() { server.stop(); }
        }));
    }
}
