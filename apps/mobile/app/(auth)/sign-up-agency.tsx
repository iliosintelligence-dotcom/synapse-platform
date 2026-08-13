import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Title, Body, Button, Input, color, space } from '@synapse/ui';
import { useAuth } from '@synapse/auth';

export default function SignUpAgency() {
  const { signUpAgency, verifyOtp } = useAuth();
  const [name, setName] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [city, setCity] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'form' | 'otp'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signUpAgency({
        email: email.trim(),
        full_name: name.trim(),
        agency_name: agencyName.trim(),
        city: city.trim(),
      });
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
      // The agency + owner membership are provisioned by the DB trigger
      // (migration 0039) in the same transaction that created the user —
      // calling agencies.createAgency here would mint a duplicate agency.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Title style={{ fontSize: 24 }}>List with Synapse</Title>
      <Body>Set up your agency. Verification starts after onboarding.</Body>

      {stage === 'form' ? (
        <>
          <Input label="Your name" icon="person" value={name} onChangeText={setName} />
          <Input label="Agency name" icon="building" value={agencyName} onChangeText={setAgencyName} />
          <Input label="City" icon="pin" value={city} onChangeText={setCity} />
          <Input
            label="Work email"
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
          <Button label="Create agency" loading={busy} onPress={() => void confirm()} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas, padding: space.xl, paddingTop: 90, gap: space.md },
});
