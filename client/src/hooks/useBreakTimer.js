import { useState, useEffect, useRef, useCallback } from 'react';
import { useSettings } from '../contexts/SettingsContext';

/**
 * Custom hook that manages break time alerts.
 * Reads settings from SettingsContext and fires alerts at the configured interval
 * within working hours.
 */
export default function useBreakTimer() {
  const { settings } = useSettings();
  const [isBreakTime, setIsBreakTime] = useState(false);
  const timerRef = useRef(null);

  const {
    breakTimeEnabled = false,
    breakTimeInterval = 60,
    breakTimeWorkStart = '09:00',
    breakTimeWorkEnd = '17:00'
  } = settings;

  // Check if current time is within working hours
  const isWithinWorkingHours = useCallback(() => {
    const now = new Date();
    const [startH, startM] = breakTimeWorkStart.split(':').map(Number);
    const [endH, endM] = breakTimeWorkEnd.split(':').map(Number);

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }, [breakTimeWorkStart, breakTimeWorkEnd]);

  // Dismiss break (restarts timer)
  const dismissBreak = useCallback(() => {
    setIsBreakTime(false);
  }, []);

  // Set up the interval timer
  useEffect(() => {
    if (!breakTimeEnabled) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const intervalMs = breakTimeInterval * 60 * 1000;

    timerRef.current = setInterval(() => {
      if (isWithinWorkingHours()) {
        setIsBreakTime(true);
      }
    }, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [breakTimeEnabled, breakTimeInterval, isWithinWorkingHours]);

  return { isBreakTime, dismissBreak, breakTimeEnabled };
}
