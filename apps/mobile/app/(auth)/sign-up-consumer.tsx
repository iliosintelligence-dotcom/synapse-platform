import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Title, Body, Button, Input, color, space } from '@synapse/ui';
import { useAuth } from '@synapse/auth';

export default function SignUpConsumer() {
  const { signUpConsumer, verifyOtp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'form' | 'otp'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signUpConsumer({ email: email.trim(), full_name: name.trim() });
      setStage('otp');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign up failed');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(email.trim(), code.trim());
      // Consumer onboarding routes to consumer home (Toju chat lands Layer 2).
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Title style={{ fontSize: 24 }}>Find your home</Title>
      <Body>Create a free account. Toju takes it from there.</Body>

      {stage === 'form' ? (
        <>
          <Input label="Full name" icon="person" value={name} onChangeText={setName} />
          <Input
            label="Email"
            icon="message"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            error={error}
          />
          <Button label="Continue" loading={busy} onPress={() => void submit()} />
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
          <Button label="Create account" loading={busy} onPress={() => void confirm()} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas, padding: space.xl, paddingTop: 90, gap: space.md },
});
