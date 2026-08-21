package android.util;

/** JVM testi için sahte Log; her şeyi stderr'e basar. */
public final class Log {
    private Log() {}

    public static int d(String tag, String msg) { return p("D", tag, msg, null); }
    public static int i(String tag, String msg) { return p("I", tag, msg, null); }
    public static int w(String tag, String msg) { return p("W", tag, msg, null); }
    public static int e(String tag, String msg) { return p("E", tag, msg, null); }
    public static int e(String tag, String msg, Throwable t) { return p("E", tag, msg, t); }

    private static int p(String lvl, String tag, String msg, Throwable t) {
        System.err.println(lvl + "/" + tag + ": " + msg);
        if (t != null) t.printStackTrace();
        return 0;
    }
}
