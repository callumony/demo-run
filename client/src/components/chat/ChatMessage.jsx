import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, CheckCircle, XCircle, ThumbsUp, ThumbsDown, HelpCircle, Send } from 'lucide-react';
import './ChatMessage.css';

// Custom dark theme based on oneDark but matching our app style
const customTheme = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...oneDark['pre[class*="language-"]'],
    background: '#0d0d14',
    margin: '0.5em 0',
    padding: '1em',
    borderRadius: '6px',
    fontSize: '13px',
    lineHeight: '1.5',
  },
  'code[class*="language-"]': {
    ...oneDark['code[class*="language-"]'],
    background: 'transparent',
    fontSize: '13px',
  },
};

export default function ChatMessage({ message, config, showAvatar, feedback, onFeedback, onCorrection, onNeutralAction }) {
  const isBot = message.role === 'assistant';
  const [copied, setCopied] = useState(false);
  const [showCorrectionInput, setShowCorrectionInput] = useState(false);
  const [correctionText, setCorrectionText] = useState('');
  const correctionInputRef = useRef(null);

  // Focus correction input when it appears
  useEffect(() => {
    if (showCorrectionInput && correctionInputRef.current) {
      correctionInputRef.current.focus();
    }
  }, [showCorrectionInput]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Handle feedback button clicks
  const handleFeedbackClick = (rating) => {
    if (!onFeedback) return;

    if (rating === 'down') {
      // Show correction input if not already showing
      if (!showCorrectionInput) {
        setShowCorrectionInput(true);
      }
      onFeedback('down');
    } else if (rating === 'neutral') {
      setShowCorrectionInput(false);
      onFeedback('neutral');
      if (onNeutralAction) {
        onNeutralAction();
      }
    } else {
      setShowCorrectionInput(false);
      onFeedback('up');
    }
  };

  // Submit correction
  const submitCorrection = () => {
    if (!correctionText.trim() || !onCorrection) return;
    onCorrection(correctionText.trim());
    setShowCorrectionInput(false);
    setCorrectionText('');
  };

  // Handle Enter key in correction input
  const handleCorrectionKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitCorrection();
    }
  };

  // Render action results section
  const renderActionResults = () => {
    if (!message.actionResults || message.actionResults.length === 0) return null;

    return (
      <div className="action-results">
        {message.actionResults.map((result, idx) => (
          <div key={idx} className={`action-result-item ${result.success ? 'success' : 'error'}`}>
            {result.success ? (
              <CheckCircle size={12} className="action-result-icon" />
            ) : (
              <XCircle size={12} className="action-result-icon" />
            )}
            <span className="action-result-text">
              {result.success ? result.message : `${result.path}: ${result.error}`}
            </span>
          </div>
        ))}
      </div>
    );
  };

  // Render per-message feedback bar (only for assistant messages)
  const renderFeedbackBar = () => {
    if (!isBot || !onFeedback) return null;

    const currentRating = feedback?.rating || null;

    return (
      <div className={`message-feedback-bar ${currentRating ? 'has-rating' : ''}`}>
        <button
          className={`msg-feedback-btn up ${currentRating === 'up' ? 'active' : ''}`}
          onClick={() => handleFeedbackClick('up')}
          title="Correct answer"
        >
          <ThumbsUp size={12} />
        </button>
        <button
          className={`msg-feedback-btn neutral ${currentRating === 'neutral' ? 'active' : ''}`}
          onClick={() => handleFeedbackClick('neutral')}
          title="Needs more detail - Omni will research more"
        >
          <HelpCircle size={12} />
        </button>
        <button
          className={`msg-feedback-btn down ${currentRating === 'down' ? 'active' : ''}`}
          onClick={() => handleFeedbackClick('down')}
          title="Incorrect - provide the correct answer"
        >
          <ThumbsDown size={12} />
        </button>
      </div>
    );
  };

  // Render correction input (shows when thumbs down is clicked)
  const renderCorrectionInput = () => {
    if (!showCorrectionInput || !isBot) return null;

    return (
      <div className="correction-input-container">
        <div className="correction-label">What's the correct answer?</div>
        <div className="correction-input-row">
          <textarea
            ref={correctionInputRef}
            className="correction-textarea"
            value={correctionText}
            onChange={(e) => setCorrectionText(e.target.value)}
            onKeyDown={handleCorrectionKeyDown}
            placeholder="Type the correct answer so Omni can learn..."
            rows={2}
          />
          <button
            className="correction-submit-btn"
            onClick={submitCorrection}
            disabled={!correctionText.trim()}
            title="Submit correction"
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    );
  };

  // Custom renderer for code blocks with syntax highlighting
  const components = {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';

      // Map common language aliases
      const languageMap = {
        'js': 'javascript',
        'ts': 'typescript',
        'py': 'python',
        'sh': 'bash',
        'shell': 'bash',
        'yml': 'yaml',
      };

      const normalizedLanguage = languageMap[language] || language;

      if (!inline && (match || String(children).includes('\n'))) {
        return (
          <SyntaxHighlighter
            style={customTheme}
            language={normalizedLanguage || 'text'}
            PreTag="div"
            customStyle={{
              margin: '0.5em 0',
              borderRadius: '6px',
              border: '1px solid rgba(139, 0, 0, 0.2)',
            }}
            {...props}
          >
            {String(children).replace(/\n$/, '')}
          </SyntaxHighlighter>
        );
      }

      // Inline code
      return (
        <code className="inline-code" {...props}>
          {children}
        </code>
      );
    },
  };

  return (
    <div className={`message-wrapper ${isBot ? 'bot' : 'user'}`}>
      <button
        className={`message-copy-btn ${copied ? 'copied' : ''}`}
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy message'}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      {!isBot && <div className="message-label">Visitor</div>}

      {isBot && showAvatar ? (
        <div className="message-with-avatar">
          <div className="message-avatar">
            {config?.botAvatarUrl ? (
              <img src={config.botAvatarUrl} alt="Agent" />
            ) : (
              <div className="agent-avatar-placeholder" style={{ width: '36px', height: '36px', fontSize: '14px' }}>
                {config?.botName?.[0] || 'A'}
              </div>
            )}
          </div>
          <div className="message-bubble">
            <div className="prose">
              <ReactMarkdown components={components}>{message.content}</ReactMarkdown>
            </div>
            {renderActionResults()}
            {renderFeedbackBar()}
            {renderCorrectionInput()}
          </div>
        </div>
      ) : (
        <div className="message-bubble">
          {isBot ? (
            <>
              <div className="prose">
                <ReactMarkdown components={components}>{message.content}</ReactMarkdown>
              </div>
              {renderActionResults()}
              {renderFeedbackBar()}
              {renderCorrectionInput()}
            </>
          ) : (
            <>
              {/* Show attached images */}
              {message.files && message.files.length > 0 && (
                <div className="message-attachments">
                  {message.files.map((file, idx) => (
                    file.isImage && file.preview ? (
                      <img
                        key={idx}
                        src={file.preview}
                        alt={file.name}
                        className="message-image"
                      />
                    ) : (
                      <div key={idx} className="message-file">
                        <span className="message-file-icon">📎</span>
                        <span>{file.name}</span>
                      </div>
                    )
                  ))}
                </div>
              )}
              <p>{message.content}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
