import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Platform, StatusBar as RNStatusBar, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import WebViewImpl from 'react-native-webview';

// the package's bundled types lag behind React 19; treat it as a plain component
const WebView = WebViewImpl as unknown as React.ElementType;

// Your laptop's WiFi IP (the phone and laptop must be on the same WiFi).
// Change this if your IP changes, or when the site is deployed (use the https URL).
const SITE_URL = 'http://192.168.29.66:5173';

export default function App() {
  return <SafeAreaProvider><Shell /></SafeAreaProvider>;
}

function Shell() {
  const insets = useSafeAreaInsets();
  // Phone status bar (time / WiFi / battery) height; on some Android builds the insets report 0, so fall back to the system value.
  const top = Math.max(insets.top, Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 0) : 0, 40);
  const [tag, setTag] = useState(true);
  useEffect(() => { const t = setTimeout(() => setTag(false), 6000); return () => clearTimeout(t); }, []);
  const bottom = insets.bottom;
  const web = useRef<{ goBack(): void; reload(): void } | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  // Android hardware back goes back inside the site first
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) { web.current?.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

  // The website hands generated files (CSV reports etc.) to the app: save into the app's folder, then open the share sheet
  // so the person can pick "Save to Files / Drive / WhatsApp / open with…".
  const onMessage = useCallback(async (e: { nativeEvent: { data: string } }) => {
    try {
      const m = JSON.parse(e.nativeEvent.data) as { type?: string; filename?: string; mime?: string; data?: string };
      if (m.type !== 'download' || !m.data) return;
      const name = (m.filename ?? 'download').replace(/[^\w.\- ]+/g, '_');
      const uri = (FileSystem.cacheDirectory ?? '') + name;
      await FileSystem.writeAsStringAsync(uri, m.data, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: m.mime, dialogTitle: name });
      else Alert.alert('Saved', `${name} was saved on this phone.`);
    } catch { Alert.alert('Download failed', 'Could not save the file. Please try again.'); }
  }, []);

  const retry = useCallback(() => { setFailed(false); setLoading(true); web.current?.reload(); }, []);

  return (
    <View style={[styles.root, { paddingTop: top, paddingBottom: bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <StatusBar style="light" />
      {tag && <Text style={styles.tag}>shell v3 · top {Math.round(top)}</Text>}
      {failed ? (
        <View style={styles.center}>
          <Text style={styles.title}>Can’t reach PlaynX</Text>
          <Text style={styles.msg}>Check that your phone and laptop are on the same WiFi, and the frontend is running (npm run dev).{'\n'}{SITE_URL}</Text>
          <Pressable style={styles.btn} onPress={retry}><Text style={styles.btnText}>Try again</Text></Pressable>
        </View>
      ) : (
        <WebView
          ref={web}
          source={{ uri: SITE_URL }}
          style={styles.web}
          onMessage={onMessage}
          onNavigationStateChange={(s: { canGoBack: boolean }) => setCanGoBack(s.canGoBack)}
          onLoadEnd={() => setLoading(false)}
          onError={() => { setFailed(true); setLoading(false); }}
          onHttpError={(e: { nativeEvent: { statusCode: number } }) => { if (e.nativeEvent.statusCode >= 500) setFailed(true); }}
          pullToRefreshEnabled
          allowsBackForwardNavigationGestures
          geolocationEnabled
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          allowsInlineMediaPlayback
        />
      )}
      {loading && !failed && <View style={styles.loader} pointerEvents="none"><ActivityIndicator size="large" color="#FF6500" /></View>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0b' },
  web: { flex: 1, backgroundColor: '#0b0b0b' },
  tag: { position: 'absolute', top: 2, left: 8, zIndex: 9, color: '#FF6500', fontSize: 10 },
  loader: { ...StyleSheet.absoluteFill as object, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  msg: { color: '#bbb', textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  btn: { backgroundColor: '#FF6500', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#000', fontWeight: '700' },
});
