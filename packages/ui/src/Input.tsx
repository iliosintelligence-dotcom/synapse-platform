/**
 * Input — glass surface, depth-consistent. States: default, focused, error.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, type TextInputProps } from 'react-native';
import Icon, { type IconName } from './Icon';
import { color, fontFamily, radius, space, type } from './tokens';

export type InputProps = Omit<TextInputProps, 'style'> & {
  label?: string;
  error?: string | null;
  icon?: IconName;
};

export default function Input({ label, error, icon, ...textInputProps }: InputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrap}>
      {label && <Text style={[type.label, styles.label]}>{label}</Text>}
      <View
        style={[
          styles.field,
          focused && styles.focused,
          error != null && error !== '' && styles.error,
        ]}
      >
        {icon && <Icon name={icon} size="sm" color={focused ? color.accent : color.inkDim} />}
        <TextInput
          {...textInputProps}
          style={styles.input}
          placeholderTextColor={color.inkDim}
          onFocus={(e) => {
            setFocused(true);
            textInputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            textInputProps.onBlur?.(e);
          }}
        />
      </View>
      {error != null && error !== '' && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  label: { paddingLeft: space.xs },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1,
    borderColor: color.glassBorder,
    borderTopColor: color.glassHighlight,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
  },
  focused: { borderColor: color.accentBorder, backgroundColor: color.surface },
  error: { borderColor: 'rgba(179,84,30,0.5)' },
  input: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: 14.5,
    color: color.ink,
    padding: 0,
  },
  errorText: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    color: color.warning,
    paddingLeft: space.xs,
  },
});
