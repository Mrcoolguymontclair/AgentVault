import React, { useEffect, useRef, useState } from "react";
import { Text, type TextStyle } from "react-native";

interface Props {
  value: number;
  formatter: (n: number) => string;
  style?: TextStyle;
  duration?: number;
}

export function AnimatedNumber({ value, formatter, style, duration = 700 }: Props) {
  const [displayed, setDisplayed] = useState(formatter(value));
  const fromRef = useRef<number>(value);
  const frameRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;

    startTimeRef.current = 0;

    const tick = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;
      setDisplayed(formatter(current));

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        setDisplayed(formatter(to));
      }
    };

    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [value, duration]);

  return <Text style={style}>{displayed}</Text>;
}
