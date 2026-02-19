import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, Hexagon, Mail, Megaphone, CheckSquare } from 'lucide-react';
import { ChatPanel } from '../chat';
import EmailPanel from '../email/EmailPanel';
import HivePanel from '../hive/HivePanel';
import NotificationsPanel from '../notifications/NotificationsPanel';
import TodoPanel from '../todo/TodoPanel';
import './RightPanel.css';

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN RIGHT PANEL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function RightPanel({ config, connectionStatus, setConnectionStatus, selectedSession, onSessionSelect }) {
  const [activeTab, setActiveTab] = useState('chat');
  const [emailBadgeCount, setEmailBadgeCount] = useState(0);

  // Todo data lifted from EmailPanel
  const [todoData, setTodoData] = useState({
    todoEmails: [],
    threadCache: {},
    connectedEmail: null
  });

  // Callbacks for TodoPanel → EmailPanel communication
  const [archiveCallback, setArchiveCallback] = useState(null);
  const [restoreCallback, setRestoreCallback] = useState(null);

  // Receive todo data from EmailPanel
  const handleTodoData = useCallback((data) => {
    setTodoData({
      todoEmails: data.todoEmails || [],
      threadCache: data.threadCache || {},
      connectedEmail: data.connectedEmail || null
    });
    if (data.archiveCallback) setArchiveCallback(() => data.archiveCallback);
    if (data.restoreCallback) setRestoreCallback(() => data.restoreCallback);
  }, []);

  // Auto-switch to chat tab when a session is selected from the sidebar
  useEffect(() => {
    if (selectedSession) {
      setActiveTab('chat');
    }
  }, [selectedSession]);

  // Todo badge count
  const todoBadgeCount = todoData.todoEmails.length;

  return (
    <div className="right-panel">
      {/* Top Section - Chat/Panel Tabs */}
      <div className="right-panel-top">
        <div className="right-panel-tabs">
          <button
            className={`right-panel-tab ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <MessageCircle size={14} />
            <span>OMNI</span>
          </button>
          <button
            className={`right-panel-tab ${activeTab === 'email' ? 'active' : ''}`}
            onClick={() => setActiveTab('email')}
          >
            <Mail size={14} />
            <span>EMAIL</span>
            {emailBadgeCount > 0 && (
              <span className="email-badge">{emailBadgeCount}</span>
            )}
          </button>
          <button
            className={`right-panel-tab ${activeTab === 'todo' ? 'active' : ''}`}
            onClick={() => setActiveTab('todo')}
          >
            <CheckSquare size={14} />
            <span>TODO</span>
            {todoBadgeCount > 0 && (
              <span className="todo-badge">{todoBadgeCount}</span>
            )}
          </button>
          <button
            className={`right-panel-tab ${activeTab === 'hive' ? 'active' : ''}`}
            onClick={() => setActiveTab('hive')}
          >
            <Hexagon size={14} />
            <span>HIVE</span>
          </button>
          <button
            className={`right-panel-tab ${activeTab === 'notif' ? 'active' : ''}`}
            onClick={() => setActiveTab('notif')}
            title="Notifications"
          >
            <Megaphone size={14} />
          </button>
        </div>

        <div className="right-panel-content">
          {activeTab === 'chat' && (
            <ChatPanel
              config={config}
              connectionStatus={connectionStatus}
              setConnectionStatus={setConnectionStatus}
              selectedSession={selectedSession}
              onSessionSelect={onSessionSelect}
            />
          )}
          {activeTab === 'email' && (
            <EmailPanel
              onBadgeCount={setEmailBadgeCount}
              onTodoData={handleTodoData}
            />
          )}
          {activeTab === 'todo' && (
            <TodoPanel
              todoEmails={todoData.todoEmails}
              threadCache={todoData.threadCache}
              connectedEmail={todoData.connectedEmail}
              onArchiveTodoItems={archiveCallback}
              onRestoreFromArchive={restoreCallback}
            />
          )}
          {activeTab === 'notif' && (
            <NotificationsPanel />
          )}
          {activeTab === 'hive' && (
            <HivePanel />
          )}
        </div>
      </div>
    </div>
  );
}
