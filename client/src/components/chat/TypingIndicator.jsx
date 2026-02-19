import './TypingIndicator.css';

export default function TypingIndicator() {
  return (
    <div className="message-wrapper bot">
      <div className="typing-indicator">
        <div className="typing-dot" />
        <div className="typing-dot" />
        <div className="typing-dot" />
      </div>
    </div>
  );
}
