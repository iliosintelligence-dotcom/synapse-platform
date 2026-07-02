/**
 * useLottie — imperative control over a LottiePlayer: play a segment,
 * trigger on an event, or run once and hold.
 */
import { useRef, useCallback } from 'react';
import type { LottiePlayerHandle } from './LottiePlayer';

export function useLottie() {
  const ref = useRef<LottiePlayerHandle>(null);

  const play = useCallback((start?: number, end?: number) => {
    ref.current?.play(start, end);
  }, []);

  const pause = useCallback(() => {
    ref.current?.pause();
  }, []);

  const reset = useCallback(() => {
    ref.current?.reset();
  }, []);

  const playOnce = useCallback(() => {
    ref.current?.reset();
    ref.current?.play();
  }, []);

  return { ref, play, pause, reset, playOnce };
}
