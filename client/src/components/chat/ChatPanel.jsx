import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Smile,
  Paperclip,
  Brain,
  Trash2,
  X,
  FileText,
  Image,
  FileSpreadsheet,
  File,
  Library,
  Zap,
  Bot,
  ArrowRight,
  MessageCircle
} from 'lucide-react';
import ChatMessage from './ChatMessage';
import TypingIndicator from './TypingIndicator';
import MemoriesModal from '../modals/MemoriesModal';
import ChatLearningsModal from '../modals/ChatLearningsModal';
import TrainingModal from '../modals/TrainingModal';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import {
  getTrainingItems,
  addTrainingItem,
  getChatHistory,
  addChatMessage,
  clearChatHistory,
  buildAgentContext,
  addMemory,
  getMemories,
  addChatLearning,
  getChatLearningsStats,
  addUsageRecord,
  getUsageStats
} from '../../services/localDatabase';
import './ChatPanel.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Welcome message for chat panel
const WELCOME_MESSAGE = "Hello! I'm Omni. What can I help you with today?";

export default function ChatPanel({ config, connectionStatus, setConnectionStatus, selectedSession, onSessionSelect }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messageFeedback, setMessageFeedback] = useState({}); // { [messageId]: { rating: 'up'|'neutral'|'down', correctionText?: string } }
  const [showAgentPhoto, setShowAgentPhoto] = useState(true);
  const [trainingContext, setTrainingContext] = useState('');
  const [memoryCount, setMemoryCount] = useState(0);
  const [showMemoriesModal, setShowMemoriesModal] = useState(false);
  const [chatLearningsCount, setChatLearningsCount] = useState(0);
  const [showChatLearningsModal, setShowChatLearningsModal] = useState(false);
  const [trainedItemsCount, setTrainedItemsCount] = useState(0);
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [sessionTokens, setSessionTokens] = useState(0);
  const [viewingArchivedSession, setViewingArchivedSession] = useState(null); // session object if viewing archived
  const [isLoadingSession, setIsLoadingSession] = useState(false);

  const { workspacePath, refreshFileTree } = useWorkspace();

  const [attachedFiles, setAttachedFiles] = useState([]);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastApiCallRef = useRef(0);
  const API_THROTTLE_MS = 1000;

  // Get file icon based on type
  const getFileIcon = (file) => {
    const type = file.type || '';
    const name = file.name || '';

    if (type.startsWith('image/')) return <Image size={16} />;
    if (type.includes('spreadsheet') || name.endsWith('.xlsx') || name.endsWith('.csv')) return <FileSpreadsheet size={16} />;
    if (type.includes('pdf') || type.includes('document') || name.endsWith('.doc') || name.endsWith('.docx')) return <FileText size={16} />;
    return <File size={16} />;
  };

  // Handle file selection
  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const processedFiles = await Promise.all(files.map(async (file) => {
      const isImage = file.type.startsWith('image/');
      const isText = file.type.startsWith('text/') ||
                     file.name.endsWith('.txt') ||
                     file.name.endsWith('.md') ||
                     file.name.endsWith('.lua') ||
                     file.name.endsWith('.js') ||
                     file.name.endsWith('.json') ||
                     file.name.endsWith('.csv');

      let content = null;
      let preview = null;

      if (isImage) {
        preview = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.readAsDataURL(file);
        });
        content = preview;
      } else if (isText) {
        content = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.readAsText(file);
        });
      } else {
        content = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.readAsDataURL(file);
        });
      }

      return {
        id: Date.now() + Math.random(),
        name: file.name,
        type: file.type,
        size: file.size,
        content,
        preview,
        isImage
      };
    }));

    setAttachedFiles(prev => [...prev, ...processedFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Remove attached file
  const removeFile = (fileId) => {
    setAttachedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  // Load chat history and training context from local database
  useEffect(() => {
    const loadLocalData = async () => {
      try {
        const history = await getChatHistory(50);
        if (history.length > 0) {
          setMessages(history.map(m => ({
            id: m.id?.toString() || Date.now().toString(),
            role: m.role,
            content: m.content
          })));
        } else {
          const welcomeMsg = {
            id: 'welcome',
            role: 'assistant',
            content: WELCOME_MESSAGE
          };
          setMessages([welcomeMsg]);
        }

        const trainedItems = await getTrainingItems();
        const trained = trainedItems.filter(item => item.isTrained);
        if (trained.length > 0) {
          const context = trained.map(item =>
            `### ${item.title}\n${item.description}\n\n${item.content}`
          ).join('\n\n---\n\n');
          setTrainingContext(context);
        }

        const memories = await getMemories();
        setMemoryCount(memories.length);

        const learningsStats = await getChatLearningsStats();
        setChatLearningsCount(learningsStats.untrainedLearnings || 0);

        const allTrainingItems = await getTrainingItems();
        const trainedCount = allTrainingItems.filter(item => item.isTrained).length;
        setTrainedItemsCount(trainedCount);
      } catch (error) {
        console.error('Failed to load local data:', error);
        setMessages([{
          id: 'welcome',
          role: 'assistant',
          content: WELCOME_MESSAGE
        }]);
      }
    };

    loadLocalData();
  }, [config]);

  // ─── Load Session from Sidebar Selection ────────────────────────────────
  useEffect(() => {
    if (!selectedSession) return;

    const loadSession = async () => {
      setIsLoadingSession(true);
      try {
        const response = await fetch(`${API_URL}/api/chat-sessions/sessions/${selectedSession.id}`);
        if (!response.ok) {
          console.error('[ChatPanel] Failed to load session:', response.status);
          setIsLoadingSession(false);
          return;
        }

        const data = await response.json();
        const session = data.session;
        const serverMessages = data.messages || [];

        if (session.status === 'archived') {
          // Show archived session in read-only mode with "Continue Discussion" banner
          setViewingArchivedSession(session);
        } else {
          // Active session — load it normally
          setViewingArchivedSession(null);
        }

        // Load messages from server into chat view
        if (serverMessages.length > 0) {
          setMessages(serverMessages.map(m => ({
            id: m.id || Date.now().toString(),
            role: m.role,
            content: m.content
          })));
        } else {
          setMessages([{
            id: 'welcome',
            role: 'assistant',
            content: `Session "${session.name}" — no messages yet.`
          }]);
        }

        setMessageFeedback({});
      } catch (error) {
        console.error('[ChatPanel] Error loading session:', error);
      } finally {
        setIsLoadingSession(false);
      }
    };

    loadSession();
  }, [selectedSession]);

  // ─── Continue the Discussion (unarchive and activate) ────────────────────
  const handleContinueDiscussion = useCallback(async () => {
    if (!viewingArchivedSession) return;

    setIsLoadingSession(true);
    try {
      // First: archive any currently active sessions (auto-archive before switching)
      try {
        const activeRes = await fetch(`${API_URL}/api/chat-sessions/sessions/active`);
        if (activeRes.ok) {
          const activeData = await activeRes.json();
          for (const activeSess of (activeData.sessions || [])) {
            await fetch(`${API_URL}/api/chat-sessions/sessions/${activeSess.id}/archive`, {
              method: 'PUT'
            });
          }
        }
      } catch (archiveErr) {
        console.warn('[ChatPanel] Failed to auto-archive active sessions:', archiveErr);
      }

      // Save current chat to IndexedDB before switching (preserve local conversation)
      // (The IndexedDB chat history is the "live" conversation buffer)

      // Unarchive the selected session
      const unarchiveRes = await fetch(`${API_URL}/api/chat-sessions/sessions/${viewingArchivedSession.id}/unarchive`, {
        method: 'PUT'
      });

      if (!unarchiveRes.ok) {
        console.error('[ChatPanel] Failed to unarchive session');
        setIsLoadingSession(false);
        return;
      }

      // Reload the session as active
      setViewingArchivedSession(null);

      // Notify parent so sidebar refreshes
      if (onSessionSelect) {
        onSessionSelect({ ...viewingArchivedSession, status: 'active' });
      }
    } catch (error) {
      console.error('[ChatPanel] Error continuing discussion:', error);
    } finally {
      setIsLoadingSession(false);
    }
  }, [viewingArchivedSession, onSessionSelect]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  const executeActions = useCallback(async (responseText) => {
    const actionRegex = /```action\s*([\s\S]*?)```/g;
    const actions = [];
    let match;

    while ((match = actionRegex.exec(responseText)) !== null) {
      try {
        const action = JSON.parse(match[1].trim());
        actions.push(action);
      } catch (e) {
        console.error('Failed to parse action:', e);
      }
    }

    if (actions.length === 0) return null;

    try {
      const response = await fetch(`${API_URL}/api/execute-actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.results?.some(r => r.success)) {
          refreshFileTree?.();
        }
        return data.results;
      }
    } catch (error) {
      console.error('Failed to execute actions:', error);
    }
    return null;
  }, [refreshFileTree]);

  const extractLearnings = useCallback(async (userMsg, assistantMsg, sessionId = null, sessionName = null) => {
    try {
      const response = await fetch(`${API_URL}/api/extract-learning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: userMsg,
          assistantResponse: assistantMsg
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.learnings && data.learnings.length > 0) {
          for (const learning of data.learnings) {
            await addMemory({
              type: learning.type,
              content: learning.content,
              summary: learning.summary || '',
              context: learning.context || 'Learned from conversation',
              importance: learning.importance,
              source: 'conversation',
              relatedTopics: learning.relatedTopics || [],
              examples: learning.examples || []
            });

            await addChatLearning({
              title: learning.summary || `Learned: ${learning.type}`,
              description: learning.context || 'Extracted from chat conversation',
              content: learning.content,
              category: learning.type || 'general',
              appliesTo: learning.relatedTopics || [],
              relatedTopics: learning.relatedTopics || [],
              sessionId: sessionId,
              sessionName: sessionName || 'Chat Session',
              userMessage: userMsg?.slice(0, 500),
              assistantResponse: assistantMsg?.slice(0, 500),
              importance: learning.importance || 5
            });

            // Also add to Library (training items) so it appears in the Library tab
            await addTrainingItem({
              title: `💬 ${learning.summary || `Learned: ${learning.type}`}`,
              description: `Organically learned from chat conversation${sessionName ? ` (${sessionName})` : ''}`,
              content: learning.content,
              fileName: null,
              source: 'chat-organic'
            });
          }
          console.log(`Learned ${data.learnings.length} new fact(s) - added to brain queue & library`);
          setMemoryCount(prev => prev + data.learnings.length);
          setChatLearningsCount(prev => prev + data.learnings.length);
          // Refresh the library trained count
          const allItems = await getTrainingItems();
          setTrainedItemsCount(allItems.filter(item => item.isTrained).length);
        }
      }
    } catch (error) {
      console.log('Learning extraction skipped:', error.message);
    }
  }, []);

  const sendMessage = useCallback(async () => {
    if ((!input.trim() && attachedFiles.length === 0) || isLoading) return;

    const now = Date.now();
    const timeSinceLastCall = now - lastApiCallRef.current;
    if (timeSinceLastCall < API_THROTTLE_MS) {
      const waitTime = API_THROTTLE_MS - timeSinceLastCall;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    lastApiCallRef.current = Date.now();

    let messageText = input.trim();
    const currentFiles = [...attachedFiles];

    if (currentFiles.length > 0) {
      const fileDescriptions = currentFiles.map(f => {
        if (f.isImage) {
          return `[Image: ${f.name}]`;
        } else if (f.type?.includes('text') || f.name.match(/\.(txt|md|lua|js|json|csv)$/)) {
          return `[File: ${f.name}]\n\`\`\`\n${f.content?.slice(0, 5000)}${f.content?.length > 5000 ? '\n...(truncated)' : ''}\n\`\`\``;
        } else {
          return `[Attached: ${f.name} (${(f.size / 1024).toFixed(1)}KB)]`;
        }
      }).join('\n\n');

      messageText = messageText
        ? `${messageText}\n\n---\nAttached files:\n${fileDescriptions}`
        : `Attached files:\n${fileDescriptions}`;
    }

    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim() || 'Attached files',
      files: currentFiles.map(f => ({ name: f.name, type: f.type, isImage: f.isImage, preview: f.preview }))
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setAttachedFiles([]);
    setIsLoading(true);

    try {
      await addChatMessage({ role: 'user', content: messageText });
    } catch (error) {
      console.error('Failed to save user message:', error);
    }

    try {
      if (connectionStatus === 'disconnected') {
        throw new Error('Server is offline');
      }

      let currentContext = trainingContext;
      try {
        currentContext = await buildAgentContext(50000);
        setTrainingContext(currentContext);
      } catch (error) {
        console.error('Failed to build agent context:', error);
      }

      const fileAttachments = currentFiles.map(f => ({
        name: f.name,
        type: f.type,
        content: f.content,
        isImage: f.isImage
      }));

      const response = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageText,
          files: fileAttachments,
          conversationHistory: messages.slice(-10).map(m => ({
            role: m.role,
            content: m.content
          })),
          trainingContext: currentContext,
          workspacePath: workspacePath || ''
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();

      if (data.error) throw new Error(data.error);

      setConnectionStatus('connected');

      const actionResults = await executeActions(data.message);

      const assistantMessage = {
        id: data.id,
        role: 'assistant',
        content: data.message,
        sources: data.sources,
        actionResults: actionResults && actionResults.length > 0 ? actionResults : null
      };

      setMessages(prev => [...prev, assistantMessage]);

      try {
        await addChatMessage({ role: 'assistant', content: data.message });
      } catch (error) {
        console.error('Failed to save assistant message:', error);
      }

      const tokensUsed = data.usage?.total_tokens ||
        Math.ceil((messageText.length + data.message.length) / 4);
      setSessionTokens(prev => prev + tokensUsed);

      try {
        await addUsageRecord({
          tokensUsed,
          promptTokens: data.usage?.prompt_tokens || Math.ceil(messageText.length / 4),
          completionTokens: data.usage?.completion_tokens || Math.ceil(data.message.length / 4),
          messagesCount: 1,
          type: 'chat'
        });
      } catch (error) {
        console.error('Failed to record usage:', error);
      }

      extractLearnings(userMessage.content, data.message);
    } catch (error) {
      console.error('Chat error:', error);
      const isConnectionError = error.message.includes('Failed to fetch') ||
                                error.message.includes('Server is offline') ||
                                error.message.includes('NetworkError');

      if (isConnectionError) {
        setConnectionStatus('disconnected');
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: "**Cannot reach server**\n\nThe backend server appears to be offline. Please ensure the server is running:\n\n```\nnpm run server\n```"
        }]);
      } else {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `I'm sorry, I encountered an error: ${error.message}. Please try again or contact support if the issue persists.`
        }]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, connectionStatus, setConnectionStatus, trainingContext, workspacePath, executeActions, extractLearnings, attachedFiles]);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ─── Per-Message Feedback Handlers ───────────────────────────────────────

  // Handle thumbs up / neutral / thumbs down on a specific message
  const handleMessageFeedback = useCallback((messageId, rating) => {
    setMessageFeedback(prev => {
      const current = prev[messageId]?.rating;
      // Toggle off if same rating clicked again
      if (current === rating) {
        const updated = { ...prev };
        delete updated[messageId];
        return updated;
      }
      return { ...prev, [messageId]: { ...prev[messageId], rating } };
    });
  }, []);

  // Handle correction submission (user provides the correct answer after thumbs down)
  const handleMessageCorrection = useCallback(async (messageId, correctionText) => {
    if (!correctionText?.trim()) return;

    // Find the assistant message and the preceding user message
    const msgIndex = messages.findIndex(m => m.id === messageId);
    const assistantMsg = messages[msgIndex];
    const userMsg = msgIndex > 0 ? messages[msgIndex - 1] : null;

    const originalQuestion = userMsg?.content || '(unknown question)';
    const originalAnswer = assistantMsg?.content || '';

    // Store the correction
    setMessageFeedback(prev => ({
      ...prev,
      [messageId]: { ...prev[messageId], rating: 'down', correctionText }
    }));

    // Create a correction memory
    const correctionContent = `CORRECTION:\nOriginal Question: ${originalQuestion.slice(0, 500)}\nOriginal Answer (INCORRECT): ${originalAnswer.slice(0, 500)}\nCorrect Answer: ${correctionText}`;

    try {
      await addMemory({
        type: 'correction',
        content: correctionContent,
        summary: `Correction: ${originalQuestion.slice(0, 80)}`,
        context: 'User corrected an incorrect response',
        importance: 9,
        source: 'manual',
        relatedTopics: [],
        examples: [correctionText.slice(0, 300)]
      });

      await addChatLearning({
        title: `Correction: ${originalQuestion.slice(0, 80)}`,
        description: 'User provided a correction for an incorrect response',
        content: correctionContent,
        category: 'correction',
        appliesTo: [],
        relatedTopics: [],
        sessionId: null,
        sessionName: 'Feedback Correction',
        userMessage: originalQuestion.slice(0, 500),
        assistantResponse: correctionText.slice(0, 500),
        importance: 9
      });

      await addTrainingItem({
        title: `Correction: ${originalQuestion.slice(0, 80)}`,
        description: 'User corrected an incorrect AI response',
        content: correctionContent,
        fileName: null,
        source: 'correction'
      });

      setMemoryCount(prev => prev + 1);
      setChatLearningsCount(prev => prev + 1);

      // Add confirmation message from Omni
      setMessages(prev => [...prev, {
        id: `correction-${Date.now()}`,
        role: 'assistant',
        content: `Got it! I've learned the correct answer and stored it in my memory. I'll remember this for future reference.`
      }]);

      console.log('[Feedback] Correction saved for message:', messageId);
    } catch (err) {
      console.error('[Feedback] Failed to save correction:', err);
    }
  }, [messages]);

  // Handle neutral/question mark action (Omni researches more or asks for details)
  const handleNeutralAction = useCallback(async (messageId) => {
    const msgIndex = messages.findIndex(m => m.id === messageId);
    const assistantMsg = messages[msgIndex];
    const userMsg = msgIndex > 0 ? messages[msgIndex - 1] : null;

    const originalQuestion = userMsg?.content || '';
    const originalAnswer = assistantMsg?.content || '';

    // Mark as neutral
    setMessageFeedback(prev => ({
      ...prev,
      [messageId]: { ...prev[messageId], rating: 'neutral' }
    }));

    // Send a follow-up request to Omni for more detail
    const followUpMsg = originalQuestion
      ? `My previous answer about "${originalQuestion.slice(0, 150)}" wasn't detailed enough. Please either:\n1. Research this more thoroughly and provide a better, more complete answer\n2. Ask me specific questions so you can learn the correct details\n\nOriginal question: ${originalQuestion}\nMy previous response that needs improvement: ${originalAnswer.slice(0, 300)}`
      : 'My previous answer needs more detail. Can you research this more thoroughly or ask me for specific details to learn from?';

    // Inject the follow-up as a new user message and trigger send
    setInput(followUpMsg);
    // Use a small delay to allow state update before sending
    setTimeout(() => {
      const syntheticEvent = { preventDefault: () => {} };
      // Trigger send manually
      setInput('');
      setIsLoading(true);

      (async () => {
        try {
          const now = Date.now();
          const timeSinceLastCall = now - lastApiCallRef.current;
          if (timeSinceLastCall < API_THROTTLE_MS) {
            await new Promise(resolve => setTimeout(resolve, API_THROTTLE_MS - timeSinceLastCall));
          }
          lastApiCallRef.current = Date.now();

          const contextStr = await buildAgentContext();

          const response = await fetch(`${API_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: followUpMsg,
              conversationHistory: messages.slice(-10).map(m => ({
                role: m.role,
                content: m.content
              })),
              trainingContext: contextStr || trainingContext,
              workspacePath
            })
          });

          if (!response.ok) throw new Error(`Server returned ${response.status}`);
          const data = await response.json();
          if (data.error) throw new Error(data.error);

          setMessages(prev => [...prev, {
            id: data.id || `neutral-${Date.now()}`,
            role: 'assistant',
            content: data.message
          }]);

          extractLearnings(followUpMsg, data.message);
        } catch (error) {
          console.error('[Feedback] Neutral follow-up error:', error);
          setMessages(prev => [...prev, {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: 'I had trouble researching further. Could you provide more specific details about what you need to know?'
          }]);
        } finally {
          setIsLoading(false);
        }
      })();
    }, 100);
  }, [messages, trainingContext, workspacePath, extractLearnings]);

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-panel-header">
        {showAgentPhoto && (
          <div className="agent-avatar">
            <Bot size={24} className="agent-icon" />
            <div className="agent-status" />
          </div>
        )}

        <div className="agent-info">
          <div className="agent-name">{config?.botName || 'OMNIPOTENT'}</div>
          <div className="agent-role">
            {connectionStatus === 'disconnected' ? (
              <span style={{ color: '#f87171' }}>Server Offline</span>
            ) : connectionStatus === 'connecting' ? (
              <span style={{ color: '#fbbf24' }}>Connecting...</span>
            ) : (
              <span style={{ color: '#4ade80' }}>Online</span>
            )}
          </div>
        </div>

        <div className="header-actions">
          {sessionTokens > 0 && (
            <div className="token-counter" title={`${sessionTokens.toLocaleString()} tokens used this session`}>
              <Zap size={12} />
              <span>{sessionTokens >= 1000 ? `${(sessionTokens / 1000).toFixed(1)}k` : sessionTokens}</span>
            </div>
          )}
          {chatLearningsCount > 0 && (
            <button
              className="chat-learnings-badge"
              onClick={() => setShowChatLearningsModal(true)}
              title={`${chatLearningsCount} new learnings ready for brain training - Click to manage`}
            >
              <span className="learnings-count">{chatLearningsCount}</span>
            </button>
          )}
          <button
            className="library-indicator-btn"
            onClick={() => setShowTrainingModal(true)}
            title={`${trainedItemsCount} items trained - Click to manage library`}
          >
            <Library size={14} />
            <span>{trainedItemsCount}</span>
          </button>
          <button
            className="memory-indicator-btn"
            onClick={() => setShowMemoriesModal(true)}
            title={`${memoryCount} memories stored - Click to manage`}
          >
            <Brain size={14} />
            <span>{memoryCount}</span>
          </button>
          <button
            className="header-action-btn"
            onClick={async () => {
              if (confirm('Clear chat and start fresh? Current conversation will be archived.')) {
                try {
                  const response = await fetch(`${API_URL}/api/chat-sessions/fresh-start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                  });

                  if (response.ok) {
                    await clearChatHistory();
                    setMessages([{
                      id: 'welcome',
                      role: 'assistant',
                      content: WELCOME_MESSAGE
                    }]);
                  }
                } catch (error) {
                  console.error('Failed to clear chat:', error);
                  await clearChatHistory();
                  setMessages([{
                    id: 'welcome',
                    role: 'assistant',
                    content: WELCOME_MESSAGE
                  }]);
                }
              }
            }}
            title="Clear chat"
          >
            <Trash2 size={14} />
          </button>
          {/* Per-message feedback buttons are now on each ChatMessage */}
        </div>
      </div>

      {/* Session loading overlay */}
      {isLoadingSession && (
        <div className="chat-session-loading">
          <div className="chat-session-loading-spinner" />
          <span>Loading session...</span>
        </div>
      )}

      {/* Archived session banner */}
      {viewingArchivedSession && (
        <div className="chat-archived-banner">
          <MessageCircle size={14} />
          <span>Viewing archived session: <strong>{viewingArchivedSession.name}</strong></span>
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages">
        {messages.map((message, index) => (
          <ChatMessage
            key={message.id}
            message={message}
            config={config}
            showAvatar={showAgentPhoto && index === messages.length - 1}
            feedback={messageFeedback[message.id] || null}
            onFeedback={(rating) => handleMessageFeedback(message.id, rating)}
            onCorrection={(text) => handleMessageCorrection(message.id, text)}
            onNeutralAction={() => handleNeutralAction(message.id)}
          />
        ))}
        {isLoading && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Continue Discussion button (for archived sessions) */}
      {viewingArchivedSession ? (
        <div className="chat-continue-banner">
          <button
            className="chat-continue-btn"
            onClick={handleContinueDiscussion}
            disabled={isLoadingSession}
          >
            <ArrowRight size={16} />
            Continue the Discussion
          </button>
          <span className="chat-continue-hint">This will restore this chat as active and archive any current active chat</span>
        </div>
      ) : (
      /* Input */
      <div className="chat-input-container">
        {attachedFiles.length > 0 && (
          <div className="attached-files-preview">
            {attachedFiles.map(file => (
              <div key={file.id} className="attached-file-item">
                {file.isImage && file.preview ? (
                  <img src={file.preview} alt={file.name} className="attached-file-thumb" />
                ) : (
                  <div className="attached-file-icon">
                    {getFileIcon(file)}
                  </div>
                )}
                <span className="attached-file-name">{file.name}</span>
                <button
                  className="attached-file-remove"
                  onClick={() => removeFile(file.id)}
                  title="Remove"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="chat-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={attachedFiles.length > 0 ? "Add a message or send files..." : "Type a message..."}
          />
          <div className="chat-input-actions">
            <button className="chat-action-btn" title="Emoji">
              <Smile size={18} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.lua,.js,.json,.xml,.html"
              style={{ display: 'none' }}
            />
            <button
              className="chat-action-btn"
              title="Attach files"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={18} />
            </button>
          </div>
          <button
            className="chat-send-btn"
            onClick={sendMessage}
            disabled={(!input.trim() && attachedFiles.length === 0) || isLoading}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
      )}

      {/* Memories Modal */}
      {showMemoriesModal && (
        <MemoriesModal
          onClose={() => setShowMemoriesModal(false)}
          onMemoryCountChange={(count) => setMemoryCount(count)}
        />
      )}

      {/* Chat Learnings Modal */}
      {showChatLearningsModal && (
        <ChatLearningsModal
          onClose={() => setShowChatLearningsModal(false)}
          onBrainCountChange={async () => {
            const stats = await getChatLearningsStats();
            setChatLearningsCount(stats.untrainedLearnings || 0);
          }}
        />
      )}

      {/* Training Modal */}
      {showTrainingModal && (
        <TrainingModal
          onClose={async () => {
            setShowTrainingModal(false);
            const allTrainingItems = await getTrainingItems();
            const trainedCount = allTrainingItems.filter(item => item.isTrained).length;
            setTrainedItemsCount(trainedCount);
          }}
        />
      )}
    </div>
  );
}
