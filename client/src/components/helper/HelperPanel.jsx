import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Bug,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Wrench,
  Loader2,
  Search,
  FileCode,
  Lightbulb,
  Sparkles,
  Key,
  FileText,
  X,
  Mail,
  Phone,
  Building2,
  Users
} from 'lucide-react';
import { getHiveConnection, fetchWorkspaces, fetchProjects } from '../../services/hiveService';
import { fetchContactDirectory } from '../../services/emailService';
import { useSettings } from '../../contexts/SettingsContext';
import './HelperPanel.css';

// ═══════════════════════════════════════════════════════════════════════════════
// FAQ DATA
// ═══════════════════════════════════════════════════════════════════════════════

const FAQ_ITEMS = [
  {
    question: "Why isn't my page loading correctly?",
    answer: "Check your network connection and ensure all resources are accessible. Clear your browser cache and try refreshing. If the issue persists, inspect the console for any error messages that might indicate missing files or failed requests."
  },
  {
    question: "How do I fix styling issues?",
    answer: "Review your CSS for conflicting rules or specificity problems. Use your browser's developer tools to inspect elements and see which styles are being applied or overridden. Check for typos in class names and ensure stylesheets are properly linked."
  },
  {
    question: "What should I do when scripts aren't working?",
    answer: "Open the browser console to check for JavaScript errors. Verify that scripts are loaded in the correct order and that dependencies are available. Look for syntax errors, undefined variables, or issues with asynchronous operations."
  },
  {
    question: "How can I improve performance?",
    answer: "Optimize images and assets, minimize HTTP requests, and leverage caching. Consider lazy loading for content below the fold. Profile your code to identify bottlenecks and reduce unnecessary re-renders or computations."
  },
  {
    question: "Why are my forms not submitting?",
    answer: "Ensure form elements have proper attributes and event handlers are attached correctly. Check for validation errors that might be preventing submission. Verify that the server endpoint is accessible and handling requests properly."
  },
  {
    question: "How do I debug API connections?",
    answer: "Use the network tab in developer tools to monitor requests and responses. Check for CORS issues, authentication problems, or incorrect endpoints. Log request payloads and responses to identify where communication is failing."
  }
];

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR ANALYZER COMPONENT (exported for use in RightPanel)
// ═══════════════════════════════════════════════════════════════════════════════

export function ErrorAnalyzer({ activeFile, fileContent, onFixApplied }) {
  const [errors, setErrors] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isFixing, setIsFixing] = useState(null);
  const [isFixingAll, setIsFixingAll] = useState(false);
  const [lastAnalyzedContent, setLastAnalyzedContent] = useState('');
  const [lastAnalyzedFile, setLastAnalyzedFile] = useState('');
  const analyzeTimeoutRef = useRef(null);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  const formatTimestamp = (date) => {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const analyzeCode = useCallback(async (force = false) => {
    if (!fileContent || !activeFile) return;
    if (!force && fileContent === lastAnalyzedContent && activeFile === lastAnalyzedFile) return;

    setIsAnalyzing(true);

    try {
      const response = await fetch(`${API_URL}/api/analyze-errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: fileContent,
          filename: activeFile,
          language: activeFile?.split('.').pop() || 'lua'
        })
      });

      if (response.ok) {
        const data = await response.json();
        const timestamp = new Date();
        const errorsWithTimestamp = (data.errors || []).map(err => ({
          ...err,
          timestamp: timestamp,
          file: activeFile
        }));
        setErrors(errorsWithTimestamp);
        setLastAnalyzedContent(fileContent);
        setLastAnalyzedFile(activeFile);
      }
    } catch (error) {
      console.error('Error analyzing code:', error);
    } finally {
      setIsAnalyzing(false);
    }
  }, [fileContent, activeFile, lastAnalyzedContent, lastAnalyzedFile, API_URL]);

  useEffect(() => {
    if (!fileContent || !activeFile) return;

    if (analyzeTimeoutRef.current) {
      clearTimeout(analyzeTimeoutRef.current);
    }

    analyzeTimeoutRef.current = setTimeout(() => {
      analyzeCode();
    }, 1500);

    return () => {
      if (analyzeTimeoutRef.current) {
        clearTimeout(analyzeTimeoutRef.current);
      }
    };
  }, [fileContent, activeFile, analyzeCode]);

  useEffect(() => {
    if (activeFile && activeFile !== lastAnalyzedFile) {
      analyzeCode(true);
    }
  }, [activeFile, lastAnalyzedFile, analyzeCode]);

  const fixError = useCallback(async (error, index) => {
    setIsFixing(index);

    try {
      const response = await fetch(`${API_URL}/api/fix-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: fileContent,
          filename: activeFile,
          error: error,
          language: activeFile?.split('.').pop() || 'lua'
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.fixedCode) {
          onFixApplied?.(data.fixedCode, error);
          setErrors(prev => prev.filter((_, i) => i !== index));
        }
      }
    } catch (error) {
      console.error('Error fixing code:', error);
    } finally {
      setIsFixing(null);
    }
  }, [fileContent, activeFile, onFixApplied, API_URL]);

  const fixAllErrors = useCallback(async () => {
    if (errors.length === 0) return;

    setIsFixingAll(true);

    try {
      const response = await fetch(`${API_URL}/api/fix-all-errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: fileContent,
          filename: activeFile,
          errors: errors,
          language: activeFile?.split('.').pop() || 'lua'
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.fixedCode) {
          onFixApplied?.(data.fixedCode, { type: 'all', count: errors.length });
          setErrors([]);
        }
      }
    } catch (error) {
      console.error('Error fixing all:', error);
    } finally {
      setIsFixingAll(false);
    }
  }, [errors, fileContent, activeFile, onFixApplied, API_URL]);

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'error':
        return <AlertCircle size={14} className="error-severity error" />;
      case 'warning':
        return <AlertTriangle size={14} className="error-severity warning" />;
      default:
        return <Bug size={14} className="error-severity info" />;
    }
  };

  return (
    <div className="error-analyzer">
      <div className="error-analyzer-header">
        <div className="error-analyzer-title">
          <Bug size={14} />
          <span>Error Analyzer</span>
          {errors.length > 0 && (
            <span className="error-badge">{errors.length}</span>
          )}
          {isAnalyzing && (
            <Loader2 size={14} className="spinning" style={{ marginLeft: '8px' }} />
          )}
        </div>
        <div className="error-analyzer-actions">
          {errors.length > 0 && (
            <button
              className="fix-all-btn-header"
              onClick={fixAllErrors}
              disabled={isFixing !== null || isFixingAll}
              title="Fix all issues"
            >
              {isFixingAll ? (
                <>
                  <Loader2 size={14} className="spinning" />
                  <span>Fixing...</span>
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  <span>Fix All</span>
                </>
              )}
            </button>
          )}
          <button
            className="analyze-btn"
            onClick={() => analyzeCode(true)}
            disabled={isAnalyzing || !fileContent}
            title="Re-analyze code"
          >
            {isAnalyzing ? (
              <Loader2 size={14} className="spinning" />
            ) : (
              <Search size={14} />
            )}
          </button>
        </div>
      </div>

      <div className="error-analyzer-content">
        {!activeFile ? (
          <div className="error-analyzer-empty">
            <FileCode size={32} />
            <p>Open a file to analyze</p>
            <span>Errors will be detected automatically</span>
          </div>
        ) : errors.length === 0 && !isAnalyzing ? (
          <div className="error-analyzer-empty success">
            <CheckCircle size={32} />
            <p>No issues detected</p>
            <span>Your code looks good!</span>
          </div>
        ) : isAnalyzing && errors.length === 0 ? (
          <div className="error-analyzer-empty">
            <Loader2 size={32} className="spinning" />
            <p>Analyzing code...</p>
            <span>Scanning for potential issues</span>
          </div>
        ) : (
          <div className="error-list">
            {errors.map((error, index) => (
              <div key={index} className={`error-item ${error.severity || 'error'}`}>
                <div className="error-item-header">
                  {getSeverityIcon(error.severity)}
                  <span className="error-severity-label">{error.severity || 'error'}</span>
                  <span className="error-line">Line {error.line}</span>
                  <button
                    className="fix-btn"
                    onClick={() => fixError(error, index)}
                    disabled={isFixing !== null || isFixingAll}
                  >
                    {isFixing === index ? (
                      <Loader2 size={12} className="spinning" />
                    ) : (
                      <Wrench size={12} />
                    )}
                    <span>Fix</span>
                  </button>
                </div>

                <div className="error-item-timestamp">
                  <span>{error.timestamp ? formatTimestamp(error.timestamp) : 'Just now'}</span>
                  {error.file && <span className="error-item-file">{error.file.split(/[/\\]/).pop()}</span>}
                </div>

                <div className="error-item-message">{error.message}</div>

                {error.suggestion && (
                  <div className="error-item-suggestion">
                    <Lightbulb size={12} />
                    <span>{error.suggestion}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FAQ ACCORDION COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

function FAQAccordion() {
  const [openIndex, setOpenIndex] = useState(null);

  const toggleItem = (index) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="faq-accordion">
      {FAQ_ITEMS.map((item, index) => (
        <div
          key={index}
          className={`faq-item ${openIndex === index ? 'open' : ''}`}
        >
          <button
            className="faq-question"
            onClick={() => toggleItem(index)}
          >
            <span>{item.question}</span>
            <ChevronDown
              size={16}
              className={`faq-chevron ${openIndex === index ? 'rotated' : ''}`}
            />
          </button>
          <div className={`faq-answer ${openIndex === index ? 'expanded' : ''}`}>
            <p>{item.answer}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACCESS MODAL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

function AccessModal({ onClose }) {
  const { settings } = useSettings();
  const [projects, setProjects] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedProject, setExpandedProject] = useState(null);
  const [accessRequest, setAccessRequest] = useState('');

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        // Load Hive projects
        const conn = getHiveConnection();
        if (conn) {
          const workspaces = await fetchWorkspaces(conn.apiKey, conn.userId);
          if (workspaces.length > 0) {
            const hiveProjects = await fetchProjects(conn.apiKey, conn.userId, workspaces[0].id);
            setProjects(Array.isArray(hiveProjects) ? hiveProjects : []);
          }
        }
        // Load contacts from Google Sheets
        if (settings.contactSheetId) {
          const contactList = await fetchContactDirectory(settings.contactSheetId);
          setContacts(contactList);
        }
      } catch (e) {
        console.error('Failed to load access data:', e);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [settings.contactSheetId]);

  const getContactForProject = (projectName) => {
    if (!contacts.length || !projectName) return null;
    const name = projectName.toLowerCase();
    return contacts.find(c =>
      c.company && name.includes(c.company.toLowerCase()) ||
      c.name && name.includes(c.name.toLowerCase())
    );
  };

  return (
    <div className="access-modal-overlay" onClick={onClose}>
      <div className="access-modal" onClick={e => e.stopPropagation()}>
        <div className="access-modal-header">
          <h4><Key size={16} /> Request Access</h4>
          <button className="access-modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="access-modal-content">
          <div className="access-request-field">
            <label>What website or service do you need access to?</label>
            <input
              type="text"
              value={accessRequest}
              onChange={e => setAccessRequest(e.target.value)}
              placeholder="e.g., WordPress admin, Google Analytics, hosting panel..."
            />
          </div>

          <div className="access-projects-title">
            <Building2 size={14} />
            <span>Client Projects</span>
          </div>

          {isLoading ? (
            <div className="access-loading">
              <Loader2 size={24} className="spinning" />
              <span>Loading projects...</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="access-empty">
              <Building2 size={32} style={{ opacity: 0.3 }} />
              <p>No Hive projects found. Connect Hive in Settings to view client projects.</p>
            </div>
          ) : (
            <div className="access-projects-list">
              {projects.map((project, idx) => {
                const contact = getContactForProject(project.name || project.title);
                const isOpen = expandedProject === idx;
                return (
                  <div key={project.id || idx} className={`access-project-item ${isOpen ? 'open' : ''}`}>
                    <div
                      className="access-project-header"
                      onClick={() => setExpandedProject(isOpen ? null : idx)}
                    >
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="access-project-name">{project.name || project.title}</span>
                    </div>
                    {isOpen && (
                      <div className="access-project-details">
                        {contact ? (
                          <>
                            <div className="access-contact-row">
                              <Users size={12} />
                              <span className="access-contact-label">Contact:</span>
                              <span>{contact.name}</span>
                            </div>
                            <div className="access-contact-row">
                              <Mail size={12} />
                              <span className="access-contact-label">Email:</span>
                              <span>{contact.email}</span>
                            </div>
                            {contact.phone && (
                              <div className="access-contact-row">
                                <Phone size={12} />
                                <span className="access-contact-label">Phone:</span>
                                <span>{contact.phone}</span>
                              </div>
                            )}
                            {contact.cc && (
                              <div className="access-contact-row">
                                <Mail size={12} />
                                <span className="access-contact-label">CC:</span>
                                <span>{contact.cc}</span>
                              </div>
                            )}
                            {contact.bcc && (
                              <div className="access-contact-row">
                                <Mail size={12} />
                                <span className="access-contact-label">BCC:</span>
                                <span>{contact.bcc}</span>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="access-no-contact">No contact info found for this project. Add contacts via the Google Sheets contact directory in Settings.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HELPER PANEL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function HelperPanel() {
  const [showAccessModal, setShowAccessModal] = useState(false);

  return (
    <div className="helper-panel">
      <div className="helper-content-wrapper">
        <h1 className="helper-main-title">OMNIPOTENT v. 1</h1>
        <p className="helper-description">
          Welcome to the help center. Here you'll find guidance for resolving common issues
          and getting the most out of your development workflow. Browse the frequently asked
          questions below for quick solutions to typical problems.
        </p>

        {/* Action Buttons */}
        <div className="helper-action-buttons">
          <button className="helper-action-btn" onClick={() => setShowAccessModal(true)}>
            <Key size={16} />
            <span>ACCESS</span>
          </button>
          <button className="helper-action-btn" onClick={() => window.open('https://drive.google.com/drive/u/1/folders/1-iz06_6kvHQ_5BRE1VIGqYJKk2kdMsVW?ths=true', '_blank')}>
            <FileText size={16} />
            <span>S.O.Ps</span>
          </button>
        </div>

        <div className="faq-section">
          <h2 className="faq-header">Frequently Asked Questions</h2>
          <FAQAccordion />
        </div>
      </div>

      {/* Access Modal */}
      {showAccessModal && (
        <AccessModal onClose={() => setShowAccessModal(false)} />
      )}
    </div>
  );
}
