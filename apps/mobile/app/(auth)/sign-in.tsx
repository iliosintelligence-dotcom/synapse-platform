import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Title, Body, Caption, Button, Input, color, space } from '@synapse/ui';
import { useAuth } from '@synapse/auth';

export default function SignIn() {
  const { signInWithOtp, verifyOtp, signInWithGoogle, signInWithApple } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'otp'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithOtp(email.trim());
      setStage('otp');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send code');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(email.trim(), code.trim());
      // Root layout redirects by role once the session resolves.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Title style={{ fontSize: 24 }}>Sign in</Title>
      <Body>We&apos;ll email you a one-time code. No passwords.</Body>

      {stage === 'email' ? (
        <>
          <Input
            label="Email"
            icon="message"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            error={error}
          />
          <Button label="Send code" loading={busy} onPress={() => void sendCode()} />
        </>
      ) : (
        <>
          <Input
            label={`Code sent to ${email}`}
            icon="shield"
            keyboardType="number-pad"
            value={code}
            onChangeText={setCode}
            error={error}
          />
          <Button label="Verify" loading={busy} onPress={() => void confirm()} />
        </>
      )}

      <Caption style={{ textAlign: 'center', marginTop: space.md }}>or continue with</Caption>
      <View style={styles.oauthRow}>
        <Button label="Google" variant="ghost" onPress={() => void signInWithGoogle()} style={{ flex: 1 }} />
        <Button label="Apple" variant="ghost" onPress={() => void signInWithApple()} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas, padding: space.xl, paddingTop: 90, gap: space.md },
  oauthRow: { flexDirection: 'row', gap: space.sm },
});
