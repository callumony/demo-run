import { useState, useEffect, useRef, useCallback } from 'react';
import { Coffee } from 'lucide-react';
import './BreakTimeAlert.css';

const BREAK_DURATION = 15 * 60; // 15 minutes in seconds

export default function BreakTimeAlert({ onDismiss }) {
  const [secondsLeft, setSecondsLeft] = useState(BREAK_DURATION);
  const timerRef = useRef(null);

  // Start countdown
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Auto-dismiss when timer reaches zero
  useEffect(() => {
    if (secondsLeft === 0 && onDismiss) {
      // Small delay so user can see 0:00
      const timeout = setTimeout(onDismiss, 1500);
      return () => clearTimeout(timeout);
    }
  }, [secondsLeft, onDismiss]);

  // Format seconds to MM:SS
  const formatTime = useCallback((totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Calculate progress percentage (for ring)
  const progress = ((BREAK_DURATION - secondsLeft) / BREAK_DURATION) * 100;

  // Allow dismiss on click/key
  const handleDismiss = useCallback(() => {
    if (onDismiss) onDismiss();
  }, [onDismiss]);

  // ESC key to dismiss
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') handleDismiss();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleDismiss]);

  return (
    <div className="break-fullscreen" onClick={handleDismiss}>
      <div className="break-content" onClick={(e) => e.stopPropagation()}>
        {/* Blinking TAKE A BREAK text */}
        <div className="break-main-text">
          <Coffee size={56} className="break-coffee-icon" />
          <h1 className="break-blink-text">TAKE A BREAK</h1>
        </div>

        {/* Countdown timer */}
        <div className="break-timer-section">
          <div className="break-timer-ring">
            <svg viewBox="0 0 200 200" className="break-ring-svg">
              {/* Background ring */}
              <circle
                cx="100" cy="100" r="88"
                fill="none"
                stroke="rgba(245, 158, 11, 0.1)"
                strokeWidth="6"
              />
              {/* Progress ring */}
              <circle
                cx="100" cy="100" r="88"
                fill="none"
                stroke="#f59e0b"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 88}
                strokeDashoffset={2 * Math.PI * 88 * (1 - progress / 100)}
                className="break-progress-ring"
              />
            </svg>
            <div className="break-timer-display">
              <span className={`break-timer-digits ${secondsLeft <= 60 ? 'break-timer-warning' : ''}`}>
                {formatTime(secondsLeft)}
              </span>
              <span className="break-timer-label">remaining</span>
            </div>
          </div>
        </div>

        {/* Subtle hint */}
        <p className="break-hint">
          {secondsLeft > 0 ? 'Press ESC or click anywhere to return early' : 'Break complete! Great job.'}
        </p>
      </div>

      {/* Ambient floating particles */}
      <div className="break-particles">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="break-particle" style={{ '--i': i }} />
        ))}
      </div>
    </div>
  );
}
