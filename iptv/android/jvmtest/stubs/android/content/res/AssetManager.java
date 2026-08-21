package android.content.res;

import java.io.IOException;
import java.io.InputStream;

/**
 * JVM testi için sahte AssetManager.
 *
 * LocalServer'ın Android'e bağlı olduğu tek iki sınıftan biri bu. Gerçek
 * cihaza kurmadan sunucuyu masaüstünde koşturabilmek için burada bir dizini
 * varlık klasörü gibi gösteriyoruz. Üretim kodu değişmiyor.
 */
public abstract class AssetManager {
    public abstract InputStream open(String name) throws IOException;
}
