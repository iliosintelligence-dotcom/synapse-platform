/** Entry route — the root layout redirects by session; this never paints. */
import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/(auth)/landing" />;
}
