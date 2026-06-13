/**
 * Typography — component wrappers for the five type style tokens.
 * Use these instead of raw <Text> so styles never drift.
 */
import React from 'react';
import { Text, type TextProps, type TextStyle, type StyleProp } from 'react-native';
import { type as typeTokens } from './tokens';

type WrapperProps = TextProps & { style?: StyleProp<TextStyle> };

function make(styleKey: keyof typeof typeTokens) {
  return function Typo({ style, ...props }: WrapperProps) {
    return <Text {...props} style={[typeTokens[styleKey], style]} />;
  };
}

/** Bebas Neue — prices, hero statements, big numbers */
export const Display = make('display');
/** DM Sans semibold — card titles, section headers */
export const Title = make('title');
/** DM Sans light — descriptions, reasoning text */
export const Body = make('body');
/** DM Sans medium, small — metadata, specs */
export const Label = make('label');
/** DM Sans light, smallest, muted — timestamps */
export const Caption = make('caption');
