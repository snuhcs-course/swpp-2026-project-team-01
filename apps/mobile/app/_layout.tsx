import 'react-native-url-polyfill/auto';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return <><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false }} /></>;
}
