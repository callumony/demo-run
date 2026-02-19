import { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info, Loader } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import './ResultModal.css';

export default function ResultModal({ title, content, type = 'info', onClose }) {
  // Prevent background page scroll while this modal is open
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  const icons = {
    success: <CheckCircle size={24} className="result-icon success" />,
    error: <AlertCircle size={24} className="result-icon error" />,
    warning: <AlertTriangle size={24} className="result-icon warning" />,
    info: <Info size={24} className="result-icon info" />,
    loading: <Loader size={24} className="result-icon loading" />
  };

  return (
    <div className="modal-overlay" onClick={type !== 'loading' ? onClose : undefined}>
      <div className={`result-modal ${type}`} onClick={(e) => e.stopPropagation()}>
        <div className="result-modal-header">
          {icons[type]}
          <h3>{title}</h3>
          {type !== 'loading' && (
            <button className="modal-close" onClick={onClose}>
              <X size={20} />
            </button>
          )}
        </div>
        <div className="result-modal-content">
          <div className="prose">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        </div>
        {type !== 'loading' && (
          <div className="result-modal-footer">
            <button className="btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
