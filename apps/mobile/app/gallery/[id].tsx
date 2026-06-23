/**
 * Property Gallery — immersive full-screen photo viewer. Swipe between
 * images, glass photo counter, chrome hides on tap. Reached from the
 * Property Experience hero. (Supporting screen.)
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useWindowDimensions } from 'react-native';
import { PropertyImageViewer } from '@synapse/ui';
import { findProperty, galleryImages } from '../../src/mock';

export default function Gallery() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const property = findProperty(id ?? '');

  if (!property) return <View style={styles.screen} />;

  return (
    <View style={styles.screen}>
      <PropertyImageViewer
        images={galleryImages(property)}
        height={height}
        onClose={() => router.back()}
        controls={[
          { icon: 'heart', label: 'Save' },
          { icon: 'message', label: 'Contact' },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
});
