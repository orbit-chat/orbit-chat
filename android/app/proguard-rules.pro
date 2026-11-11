# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Capacitor: plugins and bridge are found by reflection.
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep class com.getcapacitor.** { *; }
-keepattributes *Annotation*

# The QR scanner library (io.ionic.libs:ionbarcode-android, via @capacitor/barcode-scanner) tags
# fields with Gson's @SerializedName but never calls Gson, and does not ship it. Annotations whose
# class is absent are ignored at runtime, so only the R8 warning needs silencing.
-dontwarn com.google.gson.annotations.SerializedName
