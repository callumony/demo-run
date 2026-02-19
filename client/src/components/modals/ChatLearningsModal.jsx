// ═══════════════════════════════════════════════════════════════════════════════
// CHAT LEARNINGS MODAL
// View and manage knowledge learned from conversations (contributes to Brain)
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import {
  X, Brain, Trash2, Edit2, Check, Download, Search,
  Calendar, Clock, MessageSquare, AlertCircle, Tag,
  Filter, ArrowUpDown, Zap, BookOpen, Code, Lightbulb,
  Settings, RefreshCw, Play, CheckCircle, XCircle, ArrowLeft
} from 'lucide-react';
import {
  getChatLearnings,
  deleteChatLearning,
  updateChatLearning,
  markChatLearningTrained,
  clearChatLearnings,
  getChatLearningsStats,
  addTrainingItem,
  markItemTrained,
  getTrainingItems
} from '../../services/localDatabase';
import './ChatLearningsModal.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const CATEGORY_CONFIG = {
  general: { label: 'General', icon: Lightbulb, color: '#22c55e' },
  code: { label: 'Code', icon: Code, color: '#6366f1' },
  concept: { label: 'Concept', icon: BookOpen, color: '#06b6d4' },
  preference: { label: 'Preference', icon: Settings, color: '#f59e0b' },
  correction: { label: 'Correction', icon: AlertCircle, color: '#ef4444' },
  context: { label: 'Context', icon: MessageSquare, color: '#8b5cf6' }
};

const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Newest First' },
  { value: 'date-asc', label: 'Oldest First' },
  { value: 'importance-desc', label: 'Importance (High)' },
  { value: 'importance-asc', label: 'Importance (Low)' },
  { value: 'trained', label: 'Training Status' },
  { value: 'category', label: 'Category' }
];

export default function ChatLearningsModal({ onClose, onBrainCountChange }) {
  const [learnings, setLearnings] = useState([]);
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date-desc');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterTrained, setFilterTrained] = useState('all');
  const [selectedLearning, setSelectedLearning] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(null);

  // Prevent background page scroll while this modal is open
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  // Load learnings on mount
  useEffect(() => {
    loadLearnings();
  }, []);

  const loadLearnings = async () => {
    setIsLoading(true);
    try {
      const [data, statsData, shelfItems] = await Promise.all([
        getChatLearnings(500),
        getChatLearningsStats(),
        getTrainingItems()
      ]);

      // Build a set of learning IDs that are already on the Shelf
      const shelvedFileNames = new Set(
        shelfItems
          .filter(i => i.isTrained && i.fileName?.startsWith('brain-learning-'))
          .map(i => i.fileName)
      );

      // Separate: items already trained AND on the Shelf should be cleaned out
      const toRemove = [];
      const toKeep = [];

      for (const learning of data) {
        const shelfFileName = `brain-learning-${learning.id}.json`;
        if (learning.isTrained && shelvedFileNames.has(shelfFileName)) {
          // Already learned and archived — remove from Brain Knowledge list
          // (knowledge stays intact in LanceDB + Shelf)
          toRemove.push(learning.id);
        } else {
          toKeep.push(learning);
        }
      }

      // Silently clean out the shelved items from the chatLearnings store
      if (toRemove.length > 0) {
        for (const id of toRemove) {
          try {
            await deleteChatLearning(id);
          } catch (e) {
            // Non-critical — just skip
          }
        }
        // Refresh stats after cleanup
        const freshStats = await getChatLearningsStats();
        setStats(freshStats);
        onBrainCountChange?.(freshStats.totalLearnings || toKeep.length);
      } else {
        setStats(statsData);
      }

      setLearnings(toKeep);
    } catch (error) {
      console.error('Failed to load chat learnings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Filter and sort learnings
  const filteredLearnings = useMemo(() => {
    let result = [...learnings];

    // Filter by search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(l =>
        l.title?.toLowerCase().includes(query) ||
        l.content?.toLowerCase().includes(query) ||
        l.description?.toLowerCase().includes(query)
      );
    }

    // Filter by category
    if (filterCategory !== 'all') {
      result = result.filter(l => l.category === filterCategory);
    }

    // Filter by trained status
    if (filterTrained !== 'all') {
      result = result.filter(l => filterTrained === 'trained' ? l.isTrained : !l.isTrained);
    }

    // Sort
    switch (sortBy) {
      case 'date-desc':
        result.sort((a, b) => new Date(b.learnedAt) - new Date(a.learnedAt));
        break;
      case 'date-asc':
        result.sort((a, b) => new Date(a.learnedAt) - new Date(b.learnedAt));
        break;
      case 'importance-desc':
        result.sort((a, b) => (b.importance || 5) - (a.importance || 5));
        break;
      case 'importance-asc':
        result.sort((a, b) => (a.importance || 5) - (b.importance || 5));
        break;
      case 'trained':
        result.sort((a, b) => (b.isTrained ? 1 : 0) - (a.isTrained ? 1 : 0));
        break;
      case 'category':
        result.sort((a, b) => (a.category || 'general').localeCompare(b.category || 'general'));
        break;
    }

    return result;
  }, [learnings, searchQuery, filterCategory, filterTrained, sortBy]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts = { all: learnings.length };
    learnings.forEach(l => {
      const cat = l.category || 'general';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [learnings]);

  // Handle delete
  const handleDelete = async (id) => {
    try {
      await deleteChatLearning(id);
      setLearnings(prev => prev.filter(l => l.id !== id));
      setShowDeleteConfirm(null);
      setSelectedLearning(null);
      loadLearnings(); // Refresh stats
    } catch (error) {
      console.error('Failed to delete learning:', error);
    }
  };

  // Handle clear all
  const handleClearAll = async () => {
    try {
      await clearChatLearnings();
      setLearnings([]);
      setShowClearConfirm(false);
      onBrainCountChange?.(0);
    } catch (error) {
      console.error('Failed to clear learnings:', error);
    }
  };

  // Toggle selection
  const toggleSelection = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select all visible (filtered) learnings
  const selectAllVisible = () => {
    const allIds = filteredLearnings.map(l => l.id);
    setSelectedIds(new Set(allIds));
  };

  // Deselect all
  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  // Sync learnings to server SQLite before training (ensures server has the data)
  const syncLearningsToServer = async (idsArray) => {
    const learningsToSync = learnings.filter(l => idsArray.includes(l.id));
    let synced = 0;

    for (const learning of learningsToSync) {
      try {
        await fetch(`${API_URL}/api/training/chat-learnings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: learning.id,
            title: learning.title,
            description: learning.description,
            content: learning.content,
            category: learning.category,
            appliesTo: learning.appliesTo,
            relatedTopics: learning.relatedTopics,
            sessionId: learning.sessionId,
            sessionName: learning.sessionName,
            userMessage: learning.userMessage,
            assistantResponse: learning.assistantResponse,
            importance: learning.importance
          })
        });
        synced++;
      } catch (e) {
        console.warn(`Failed to sync learning ${learning.id} to server:`, e.message);
      }
    }
    return synced;
  };

  // Train selected learnings (can pass explicit IDs or use selectedIds state)
  const trainSelected = async (explicitIds = null) => {
    const idsToTrain = explicitIds || selectedIds;
    const idsArray = explicitIds ? Array.from(explicitIds) : Array.from(selectedIds);

    if (idsArray.length === 0) return;

    setIsTraining(true);
    setTrainingProgress({ current: 0, total: idsArray.length, message: 'Syncing learnings to server...' });

    try {
      // Ensure all selected learnings exist in server SQLite before training
      await syncLearningsToServer(idsArray);

      setTrainingProgress({ current: 0, total: idsArray.length, message: 'Starting training...' });

      // Check if any of the selected items are already trained (retrain mode)
      const hasTrainedItems = learnings.some(l => idsArray.includes(l.id) && l.isTrained);

      const response = await fetch(`${API_URL}/api/training/train-chat-learnings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ learningIds: idsArray, retrain: hasTrainedItems })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          try {
            const data = JSON.parse(line.replace('data: ', ''));
            setTrainingProgress({
              current: data.current || 0,
              total: data.total || idsArray.length,
              message: data.message,
              type: data.type
            });

            // Mark individual item as trained in IndexedDB when server confirms success
            if (data.type === 'success' && data.learningId) {
              try {
                await markChatLearningTrained(data.learningId, data.chunks || 0);
              } catch (e) {
                console.warn('Failed to update local trained status:', e);
              }
            }

            if (data.type === 'complete') {
              // Refresh data from IndexedDB (now updated with trained status)
              await loadLearnings();
              setSelectedIds(new Set());
              onBrainCountChange?.(data.brainCount);

              // Move successfully trained learnings to the Shelf (Training Library)
              // by creating training items and marking them as already trained,
              // then remove them from Brain Knowledge list (knowledge stays in LanceDB)
              try {
                const existingItems = await getTrainingItems();
                const existingFileNames = new Set(existingItems.map(i => i.fileName).filter(Boolean));
                const trainedLearnings = learnings.filter(l => idsArray.includes(l.id));
                const archivedIds = [];

                for (const learning of trainedLearnings) {
                  const shelfFileName = `brain-learning-${learning.id}.json`;

                  // Create shelf entry if not already there
                  if (!existingFileNames.has(shelfFileName)) {
                    try {
                      const shelfContent = JSON.stringify({
                        type: 'chat-learning',
                        title: learning.title,
                        description: learning.description,
                        content: learning.content,
                        category: learning.category,
                        appliesTo: learning.appliesTo,
                        relatedTopics: learning.relatedTopics,
                        importance: learning.importance,
                        sessionName: learning.sessionName,
                        learnedAt: learning.learnedAt
                      }, null, 2);

                      const newItem = await addTrainingItem({
                        title: learning.title || 'Brain Knowledge',
                        description: `Brain knowledge (${learning.category || 'general'}) — ${learning.description || learning.content?.slice(0, 80)}`,
                        content: shelfContent,
                        fileName: shelfFileName,
                        source: 'chat-learning'
                      });
                      // Mark it as trained immediately so it goes to Shelf
                      await markItemTrained(newItem.id);
                    } catch (e) {
                      console.warn('Failed to archive learning to Shelf:', e);
                      continue; // Don't remove from Brain Knowledge if shelving failed
                    }
                  }

                  // Item is now on the Shelf — remove from Brain Knowledge list
                  // (the learned knowledge in LanceDB + Shelf is untouched)
                  archivedIds.push(learning.id);
                }

                // Remove archived items from Brain Knowledge store
                for (const id of archivedIds) {
                  try {
                    await deleteChatLearning(id);
                  } catch (e) {
                    // Non-critical
                  }
                }

                // Refresh the list to reflect removals
                if (archivedIds.length > 0) {
                  setLearnings(prev => prev.filter(l => !archivedIds.includes(l.id)));
                  const freshStats = await getChatLearningsStats();
                  setStats(freshStats);
                  onBrainCountChange?.(freshStats.totalLearnings || 0);
                }
              } catch (e) {
                console.warn('Failed to check existing shelf items:', e);
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    } catch (error) {
      console.error('Training error:', error);
      setTrainingProgress({ message: `Error: ${error.message}`, type: 'error' });
    } finally {
      setIsTraining(false);
      setTimeout(() => setTrainingProgress(null), 3000);
    }
  };

  // Export learnings
  const exportLearnings = () => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      totalLearnings: learnings.length,
      trainedCount: learnings.filter(l => l.isTrained).length,
      learnings: learnings.map(l => ({
        id: l.id,
        title: l.title,
        description: l.description,
        content: l.content,
        category: l.category,
        appliesTo: l.appliesTo,
        learnedAt: l.learnedAt,
        isTrained: l.isTrained,
        trainedAt: l.trainedAt,
        chunksCreated: l.chunksCreated,
        sessionName: l.sessionName,
        importance: l.importance
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-learnings-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Format date/time
  const formatDateTime = (dateStr) => {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Render category badge
  const renderCategoryBadge = (category) => {
    const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.general;
    const Icon = config.icon;
    return (
      <span className="category-badge" style={{ '--cat-color': config.color }}>
        <Icon size={12} />
        {config.label}
      </span>
    );
  };

  // Render trained status
  const renderTrainedStatus = (learning) => {
    if (learning.isTrained) {
      return (
        <span className="trained-badge trained">
          <CheckCircle size={12} />
          In Brain ({learning.chunksCreated || 0} chunks)
        </span>
      );
    }
    return (
      <span className="trained-badge untrained">
        <XCircle size={12} />
        Not trained
      </span>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="chat-learnings-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <button className="btn-back-modal" onClick={onClose} title="Back to Training Center">
            <ArrowLeft size={16} />
          </button>
          <div className="modal-title-section">
            <Brain size={24} />
            <div>
              <h2>Brain Knowledge</h2>
              <span className="learning-count">
                {stats?.trainedLearnings || 0} trained / {learnings.length} total
                {stats?.totalChunksInBrain > 0 && ` • ${stats.totalChunksInBrain} chunks in brain`}
              </span>
            </div>
          </div>
          <div className="header-actions">
            {selectedIds.size > 0 && (
              <>
                <button
                  className="header-btn train-btn"
                  onClick={() => trainSelected()}
                  disabled={isTraining}
                >
                  <Play size={16} />
                  Train Selected ({selectedIds.size})
                </button>
                <button
                  className="header-btn"
                  onClick={deselectAll}
                  disabled={isTraining}
                >
                  <XCircle size={16} />
                  Deselect
                </button>
              </>
            )}
            <button
              className="header-btn"
              onClick={selectAllVisible}
              disabled={isTraining}
            >
              <CheckCircle size={16} />
              Select All
            </button>
            <button
              className="header-btn export-btn"
              onClick={exportLearnings}
              disabled={learnings.length === 0}
            >
              <Download size={16} />
            </button>
            <button
              className="header-btn danger-btn"
              onClick={() => setShowClearConfirm(true)}
              disabled={learnings.length === 0}
            >
              <Trash2 size={16} />
            </button>
            <button className="modal-close-btn" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Training Progress */}
        {trainingProgress && (
          <div className={`training-progress ${trainingProgress.type || ''}`}>
            {isTraining && <RefreshCw size={16} className="spinning" />}
            <span>{trainingProgress.message}</span>
            {trainingProgress.total > 0 && (
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${(trainingProgress.current / trainingProgress.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Search and Filters */}
        <div className="learnings-toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search learnings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="clear-search" onClick={() => setSearchQuery('')}>
                <X size={14} />
              </button>
            )}
          </div>

          <div className="toolbar-actions">
            <button
              className={`filter-toggle ${showFilters ? 'active' : ''}`}
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter size={16} />
              {(filterCategory !== 'all' || filterTrained !== 'all') && (
                <span className="filter-badge">!</span>
              )}
            </button>

            <div className="sort-select">
              <ArrowUpDown size={14} />
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                {SORT_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="filter-panel">
            <div className="filter-group">
              <label>Category</label>
              <div className="filter-chips">
                <button
                  className={`filter-chip ${filterCategory === 'all' ? 'active' : ''}`}
                  onClick={() => setFilterCategory('all')}
                >
                  All <span className="chip-count">{categoryCounts.all || 0}</span>
                </button>
                {Object.entries(CATEGORY_CONFIG).map(([cat, config]) => (
                  <button
                    key={cat}
                    className={`filter-chip ${filterCategory === cat ? 'active' : ''}`}
                    onClick={() => setFilterCategory(cat)}
                    style={{ '--chip-color': config.color }}
                  >
                    {config.label} <span className="chip-count">{categoryCounts[cat] || 0}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <label>Training Status</label>
              <div className="filter-chips">
                <button
                  className={`filter-chip ${filterTrained === 'all' ? 'active' : ''}`}
                  onClick={() => setFilterTrained('all')}
                >
                  All
                </button>
                <button
                  className={`filter-chip ${filterTrained === 'trained' ? 'active' : ''}`}
                  onClick={() => setFilterTrained('trained')}
                >
                  Trained
                </button>
                <button
                  className={`filter-chip ${filterTrained === 'untrained' ? 'active' : ''}`}
                  onClick={() => setFilterTrained('untrained')}
                >
                  Not Trained
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="modal-body">
          {isLoading ? (
            <div className="loading-state">
              <div className="spinner" />
              <span>Loading learnings...</span>
            </div>
          ) : learnings.length === 0 ? (
            <div className="empty-state">
              <Brain size={48} />
              <h3>No learnings yet</h3>
              <p>Knowledge is automatically extracted when you have conversations with the AI. Train the learnings to add them to the Brain.</p>
            </div>
          ) : filteredLearnings.length === 0 ? (
            <div className="empty-state">
              <Search size={48} />
              <h3>No matches found</h3>
              <p>Try adjusting your search or filters.</p>
            </div>
          ) : (
            <div className="learnings-list">
              {filteredLearnings.map(learning => (
                <div
                  key={learning.id}
                  className={`learning-card ${selectedLearning?.id === learning.id ? 'selected' : ''} ${selectedIds.has(learning.id) ? 'checked' : ''}`}
                >
                  <div className="learning-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(learning.id)}
                      onChange={() => toggleSelection(learning.id)}
                    />
                  </div>

                  <div className="learning-content" onClick={() => setSelectedLearning(learning)}>
                    <div className="learning-header">
                      <h4>{learning.title}</h4>
                      {renderCategoryBadge(learning.category)}
                      {renderTrainedStatus(learning)}
                    </div>

                    <p className="learning-description">
                      {learning.description || learning.content?.slice(0, 150) + '...'}
                    </p>

                    <div className="learning-meta">
                      <span className="meta-item">
                        <Calendar size={12} />
                        {formatDateTime(learning.learnedAt)}
                      </span>
                      {learning.sessionName && (
                        <span className="meta-item">
                          <MessageSquare size={12} />
                          {learning.sessionName}
                        </span>
                      )}
                      {learning.appliesTo?.length > 0 && (
                        <span className="meta-item tags">
                          <Tag size={12} />
                          {learning.appliesTo.slice(0, 3).join(', ')}
                        </span>
                      )}
                      <span className="meta-item importance">
                        <Zap size={12} />
                        {learning.importance || 5}/10
                      </span>
                    </div>
                  </div>

                  <div className="learning-actions">
                    {!learning.isTrained ? (
                      <button
                        className="action-btn train"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await trainSelected(new Set([learning.id]));
                        }}
                        disabled={isTraining}
                        title="Train to Brain"
                      >
                        <Play size={14} />
                      </button>
                    ) : (
                      <button
                        className="action-btn retrain"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await trainSelected(new Set([learning.id]));
                        }}
                        disabled={isTraining}
                        title="Retrain"
                      >
                        <RefreshCw size={14} />
                      </button>
                    )}
                    <button
                      className="action-btn danger"
                      onClick={() => setShowDeleteConfirm(learning.id)}
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail Modal */}
        {selectedLearning && (
          <div className="learning-detail-overlay" onClick={() => setSelectedLearning(null)}>
            <div className="learning-detail-modal" onClick={e => e.stopPropagation()}>
              <div className="detail-header">
                <button className="btn-back-modal" onClick={() => setSelectedLearning(null)} title="Back to list">
                  <ArrowLeft size={16} />
                </button>
                <div className="detail-title">
                  {renderCategoryBadge(selectedLearning.category)}
                  <h3>{selectedLearning.title}</h3>
                </div>
                <button className="modal-close-btn" onClick={() => setSelectedLearning(null)}>
                  <X size={18} />
                </button>
              </div>

              <div className="detail-body">
                <div className="detail-status">
                  {renderTrainedStatus(selectedLearning)}
                  {selectedLearning.trainedAt && (
                    <span className="trained-date">
                      Trained on {formatDateTime(selectedLearning.trainedAt)}
                    </span>
                  )}
                  <button
                    className={`train-single-btn ${selectedLearning.isTrained ? 'retrain' : ''}`}
                    onClick={async () => {
                      const idToTrain = selectedLearning.id;
                      setSelectedLearning(null);
                      // Pass the ID directly to avoid state timing issues
                      await trainSelected(new Set([idToTrain]));
                    }}
                    disabled={isTraining}
                  >
                    {selectedLearning.isTrained ? (
                      <>
                        <RefreshCw size={14} />
                        Retrain This Learning
                      </>
                    ) : (
                      <>
                        <Play size={14} />
                        Train This Learning
                      </>
                    )}
                  </button>
                </div>

                <div className="detail-section">
                  <label>Description</label>
                  <p>{selectedLearning.description || 'No description'}</p>
                </div>

                <div className="detail-section">
                  <label>Content</label>
                  <div className="detail-content-box">
                    {selectedLearning.content}
                  </div>
                </div>

                <div className="detail-grid">
                  <div className="detail-item">
                    <label>Learned At</label>
                    <span>{formatDateTime(selectedLearning.learnedAt)}</span>
                  </div>
                  <div className="detail-item">
                    <label>Importance</label>
                    <span>{selectedLearning.importance || 5}/10</span>
                  </div>
                  <div className="detail-item">
                    <label>Session</label>
                    <span>{selectedLearning.sessionName || 'Unknown'}</span>
                  </div>
                  <div className="detail-item">
                    <label>Chunks in Brain</label>
                    <span>{selectedLearning.chunksCreated || 0}</span>
                  </div>
                </div>

                {selectedLearning.appliesTo?.length > 0 && (
                  <div className="detail-section">
                    <label>Applies To</label>
                    <div className="tags-list">
                      {selectedLearning.appliesTo.map((tag, i) => (
                        <span key={i} className="topic-tag">
                          <Tag size={10} />
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedLearning.userMessage && (
                  <div className="detail-section">
                    <label>Original User Message</label>
                    <div className="quote-box user">
                      {selectedLearning.userMessage}
                    </div>
                  </div>
                )}

                {selectedLearning.assistantResponse && (
                  <div className="detail-section">
                    <label>AI Response</label>
                    <div className="quote-box assistant">
                      {selectedLearning.assistantResponse.slice(0, 500)}
                      {selectedLearning.assistantResponse.length > 500 && '...'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation */}
        {showDeleteConfirm && (
          <div className="confirm-overlay">
            <div className="confirm-dialog">
              <AlertCircle size={32} className="confirm-icon" />
              <h3>Delete Learning?</h3>
              <p>This learning will be permanently removed. If it was trained, it will remain in the Brain until retrained.</p>
              <div className="confirm-actions">
                <button className="confirm-btn cancel" onClick={() => setShowDeleteConfirm(null)}>
                  Cancel
                </button>
                <button className="confirm-btn danger" onClick={() => handleDelete(showDeleteConfirm)}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Clear All Confirmation */}
        {showClearConfirm && (
          <div className="confirm-overlay">
            <div className="confirm-dialog">
              <AlertCircle size={32} className="confirm-icon danger" />
              <h3>Clear All Learnings?</h3>
              <p>This will permanently delete all {learnings.length} chat learnings. Trained knowledge will remain in the Brain.</p>
              <div className="confirm-actions">
                <button className="confirm-btn cancel" onClick={() => setShowClearConfirm(false)}>
                  Cancel
                </button>
                <button className="confirm-btn danger" onClick={handleClearAll}>
                  Clear All
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
