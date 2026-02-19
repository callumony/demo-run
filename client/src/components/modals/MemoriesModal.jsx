import { useState, useEffect, useMemo } from 'react';
import {
  X, Brain, Trash2, Edit2, Check, Download, Search,
  Calendar, Sparkles, MessageSquare, AlertCircle, Tag,
  ChevronDown, ChevronUp, Filter, ArrowUpDown, Clock,
  Lightbulb, Settings, BookOpen, Zap, XCircle
} from 'lucide-react';
import {
  getMemories,
  deleteMemory,
  updateMemory,
  clearMemories
} from '../../services/localDatabase';
import './MemoriesModal.css';

const MEMORY_TYPE_CONFIG = {
  fact: { label: 'Fact', icon: Lightbulb, color: '#22c55e' },
  preference: { label: 'Preference', icon: Settings, color: '#6366f1' },
  correction: { label: 'Correction', icon: AlertCircle, color: '#f59e0b' },
  context: { label: 'Context', icon: BookOpen, color: '#06b6d4' }
};

const SORT_OPTIONS = [
  { value: 'importance-desc', label: 'Importance (High to Low)' },
  { value: 'importance-asc', label: 'Importance (Low to High)' },
  { value: 'date-desc', label: 'Newest First' },
  { value: 'date-asc', label: 'Oldest First' },
  { value: 'type', label: 'Type' }
];

export default function MemoriesModal({ onClose, onMemoryCountChange }) {
  const [memories, setMemories] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('importance-desc');
  const [filterType, setFilterType] = useState('all');
  const [selectedMemory, setSelectedMemory] = useState(null);
  const [editingMemory, setEditingMemory] = useState(null);
  const [editForm, setEditForm] = useState({ content: '', importance: 5 });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Prevent background page scroll while this modal is open
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  // Load memories on mount
  useEffect(() => {
    loadMemories();
  }, []);

  const loadMemories = async () => {
    setIsLoading(true);
    try {
      const data = await getMemories(500); // Get more for filtering
      setMemories(data);
    } catch (error) {
      console.error('Failed to load memories:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Filter and sort memories
  const filteredMemories = useMemo(() => {
    let result = [...memories];

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(m =>
        m.content?.toLowerCase().includes(query) ||
        m.summary?.toLowerCase().includes(query) ||
        m.context?.toLowerCase().includes(query)
      );
    }

    // Filter by type
    if (filterType !== 'all') {
      result = result.filter(m => m.type === filterType);
    }

    // Sort
    switch (sortBy) {
      case 'importance-desc':
        result.sort((a, b) => (b.importance || 5) - (a.importance || 5));
        break;
      case 'importance-asc':
        result.sort((a, b) => (a.importance || 5) - (b.importance || 5));
        break;
      case 'date-desc':
        result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        break;
      case 'date-asc':
        result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        break;
      case 'type':
        result.sort((a, b) => (a.type || 'fact').localeCompare(b.type || 'fact'));
        break;
    }

    return result;
  }, [memories, searchQuery, filterType, sortBy]);

  // Get type counts for filter badges
  const typeCounts = useMemo(() => {
    const counts = { all: memories.length };
    memories.forEach(m => {
      const type = m.type || 'fact';
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, [memories]);

  // Handle delete
  const handleDelete = async (id) => {
    try {
      await deleteMemory(id);
      setMemories(prev => prev.filter(m => m.id !== id));
      setShowDeleteConfirm(null);
      setSelectedMemory(null);
      onMemoryCountChange?.(memories.length - 1);
    } catch (error) {
      console.error('Failed to delete memory:', error);
    }
  };

  // Handle clear all
  const handleClearAll = async () => {
    try {
      await clearMemories();
      setMemories([]);
      setShowClearConfirm(false);
      onMemoryCountChange?.(0);
    } catch (error) {
      console.error('Failed to clear memories:', error);
    }
  };

  // Handle edit
  const startEdit = (memory) => {
    setEditingMemory(memory.id);
    setEditForm({
      content: memory.content || '',
      importance: memory.importance || 5,
      summary: memory.summary || '',
      context: memory.context || ''
    });
  };

  const saveEdit = async () => {
    if (!editingMemory) return;

    try {
      const memory = memories.find(m => m.id === editingMemory);
      const updated = {
        ...memory,
        content: editForm.content,
        importance: editForm.importance,
        summary: editForm.summary,
        context: editForm.context,
        updatedAt: new Date().toISOString()
      };

      await updateMemory(updated);
      setMemories(prev => prev.map(m => m.id === editingMemory ? updated : m));
      setEditingMemory(null);

      // Update selected memory if viewing
      if (selectedMemory?.id === editingMemory) {
        setSelectedMemory(updated);
      }
    } catch (error) {
      console.error('Failed to update memory:', error);
    }
  };

  // Export to JSON
  const exportMemories = () => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      totalMemories: memories.length,
      memories: memories.map(m => ({
        id: m.id,
        type: m.type || 'fact',
        content: m.content,
        summary: m.summary || generateSummary(m.content),
        context: m.context || m.source || 'conversation',
        importance: m.importance || 5,
        learnedAt: m.createdAt,
        lastUsed: m.lastUsed,
        useCount: m.useCount || 0
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `memories-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Generate summary from content
  const generateSummary = (content) => {
    if (!content) return 'No summary available';
    const words = content.split(' ').slice(0, 10).join(' ');
    return words.length < content.length ? words + '...' : words;
  };

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Get relative time
  const getRelativeTime = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor(diff / (1000 * 60));

    if (days > 30) return `${Math.floor(days / 30)} months ago`;
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'Just now';
  };

  // Render type badge
  const renderTypeBadge = (type) => {
    const config = MEMORY_TYPE_CONFIG[type] || MEMORY_TYPE_CONFIG.fact;
    const Icon = config.icon;
    return (
      <span className="memory-type-badge" style={{ '--type-color': config.color }}>
        <Icon size={12} />
        {config.label}
      </span>
    );
  };

  // Render importance stars
  const renderImportance = (importance) => {
    const level = Math.min(10, Math.max(1, importance || 5));
    return (
      <div className="importance-display" title={`Importance: ${level}/10`}>
        <Zap size={12} style={{ color: level >= 7 ? '#f59e0b' : '#6b7280' }} />
        <span className="importance-value">{level}</span>
        <div className="importance-bar">
          <div className="importance-fill" style={{ width: `${level * 10}%` }} />
        </div>
      </div>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="memories-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-section">
            <Brain size={24} />
            <div>
              <h2>Memory Database</h2>
              <span className="memory-count">{memories.length} learned items</span>
            </div>
          </div>
          <div className="header-actions">
            <button
              className="header-btn export-btn"
              onClick={exportMemories}
              disabled={memories.length === 0}
              title="Export as JSON"
            >
              <Download size={16} />
              Export
            </button>
            <button
              className="header-btn danger-btn"
              onClick={() => setShowClearConfirm(true)}
              disabled={memories.length === 0}
              title="Clear all memories"
            >
              <Trash2 size={16} />
            </button>
            <button className="modal-close-btn" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="memories-toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search memories..."
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
              Filters
              {filterType !== 'all' && <span className="filter-badge">1</span>}
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

        {/* Filter Panel */}
        {showFilters && (
          <div className="filter-panel">
            <div className="filter-group">
              <label>Type</label>
              <div className="filter-chips">
                <button
                  className={`filter-chip ${filterType === 'all' ? 'active' : ''}`}
                  onClick={() => setFilterType('all')}
                >
                  All <span className="chip-count">{typeCounts.all || 0}</span>
                </button>
                {Object.entries(MEMORY_TYPE_CONFIG).map(([type, config]) => (
                  <button
                    key={type}
                    className={`filter-chip ${filterType === type ? 'active' : ''}`}
                    onClick={() => setFilterType(type)}
                    style={{ '--chip-color': config.color }}
                  >
                    {config.label} <span className="chip-count">{typeCounts[type] || 0}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="modal-body">
          {isLoading ? (
            <div className="loading-state">
              <div className="spinner" />
              <span>Loading memories...</span>
            </div>
          ) : memories.length === 0 ? (
            <div className="empty-state">
              <Brain size={48} />
              <h3>No memories yet</h3>
              <p>Memories are automatically learned from your conversations when you teach the AI new information.</p>
            </div>
          ) : filteredMemories.length === 0 ? (
            <div className="empty-state">
              <Search size={48} />
              <h3>No matches found</h3>
              <p>Try adjusting your search or filters.</p>
            </div>
          ) : (
            <div className="memories-list">
              {filteredMemories.map(memory => (
                <div
                  key={memory.id}
                  className={`memory-card ${selectedMemory?.id === memory.id ? 'selected' : ''}`}
                  onClick={() => setSelectedMemory(memory)}
                >
                  <div className="memory-card-header">
                    {renderTypeBadge(memory.type)}
                    {renderImportance(memory.importance)}
                  </div>

                  <div className="memory-content">
                    {editingMemory === memory.id ? (
                      <textarea
                        className="edit-textarea"
                        value={editForm.content}
                        onChange={(e) => setEditForm(prev => ({ ...prev, content: e.target.value }))}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <p>{memory.content}</p>
                    )}
                  </div>

                  <div className="memory-meta">
                    <span className="meta-item" title={formatDate(memory.createdAt)}>
                      <Calendar size={12} />
                      {getRelativeTime(memory.createdAt)}
                    </span>
                    <span className="meta-item">
                      <MessageSquare size={12} />
                      {memory.source || 'conversation'}
                    </span>
                    {memory.useCount > 0 && (
                      <span className="meta-item">
                        <Sparkles size={12} />
                        Used {memory.useCount}x
                      </span>
                    )}
                  </div>

                  <div className="memory-actions" onClick={(e) => e.stopPropagation()}>
                    {editingMemory === memory.id ? (
                      <>
                        <button className="action-btn save" onClick={saveEdit} title="Save">
                          <Check size={14} />
                        </button>
                        <button className="action-btn cancel" onClick={() => setEditingMemory(null)} title="Cancel">
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="action-btn" onClick={() => startEdit(memory)} title="Edit">
                          <Edit2 size={14} />
                        </button>
                        <button
                          className="action-btn danger"
                          onClick={() => setShowDeleteConfirm(memory.id)}
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail Modal */}
        {selectedMemory && (
          <div className="memory-detail-overlay" onClick={() => setSelectedMemory(null)}>
            <div className="memory-detail-modal" onClick={e => e.stopPropagation()}>
              <div className="detail-header">
                <div className="detail-title">
                  {renderTypeBadge(selectedMemory.type)}
                  <h3>Memory Details</h3>
                </div>
                <button className="modal-close-btn" onClick={() => setSelectedMemory(null)}>
                  <X size={18} />
                </button>
              </div>

              <div className="detail-body">
                <div className="detail-section">
                  <label>Knowledge Content</label>
                  <div className="detail-content-box">
                    {selectedMemory.content}
                  </div>
                </div>

                <div className="detail-section">
                  <label>Summary</label>
                  <p className="detail-text">
                    {selectedMemory.summary || generateSummary(selectedMemory.content)}
                  </p>
                </div>

                <div className="detail-section">
                  <label>Learning Context</label>
                  <p className="detail-text">
                    {selectedMemory.context || `Learned from ${selectedMemory.source || 'conversation'} interaction`}
                  </p>
                </div>

                <div className="detail-grid">
                  <div className="detail-item">
                    <label>Importance</label>
                    {renderImportance(selectedMemory.importance)}
                  </div>
                  <div className="detail-item">
                    <label>Type</label>
                    <span>{MEMORY_TYPE_CONFIG[selectedMemory.type]?.label || 'Fact'}</span>
                  </div>
                  <div className="detail-item">
                    <label>Learned On</label>
                    <span>{formatDate(selectedMemory.createdAt)}</span>
                  </div>
                  <div className="detail-item">
                    <label>Last Used</label>
                    <span>{selectedMemory.lastUsed ? formatDate(selectedMemory.lastUsed) : 'Never'}</span>
                  </div>
                  <div className="detail-item">
                    <label>Times Used</label>
                    <span>{selectedMemory.useCount || 0} times</span>
                  </div>
                  <div className="detail-item">
                    <label>Source</label>
                    <span>{selectedMemory.source || 'conversation'}</span>
                  </div>
                </div>

                {selectedMemory.examples && selectedMemory.examples.length > 0 && (
                  <div className="detail-section">
                    <label>Examples</label>
                    <ul className="examples-list">
                      {selectedMemory.examples.map((ex, i) => (
                        <li key={i}>{ex}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedMemory.relatedTopics && selectedMemory.relatedTopics.length > 0 && (
                  <div className="detail-section">
                    <label>Related Topics</label>
                    <div className="tags-list">
                      {selectedMemory.relatedTopics.map((topic, i) => (
                        <span key={i} className="topic-tag">
                          <Tag size={10} />
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="detail-footer">
                <button
                  className="detail-action-btn"
                  onClick={() => {
                    startEdit(selectedMemory);
                    setSelectedMemory(null);
                  }}
                >
                  <Edit2 size={14} />
                  Edit Memory
                </button>
                <button
                  className="detail-action-btn danger"
                  onClick={() => {
                    setShowDeleteConfirm(selectedMemory.id);
                  }}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation */}
        {showDeleteConfirm && (
          <div className="confirm-overlay">
            <div className="confirm-dialog">
              <AlertCircle size={32} className="confirm-icon" />
              <h3>Delete Memory?</h3>
              <p>This memory will be permanently removed. The AI will no longer recall this information.</p>
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
              <h3>Clear All Memories?</h3>
              <p>This will permanently delete all {memories.length} learned items. The AI will lose all knowledge gained from conversations.</p>
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
