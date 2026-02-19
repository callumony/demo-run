import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import {
  X, Upload, FileText, Trash2, Edit2, Check, AlertCircle,
  CheckCircle, XCircle, RefreshCw, BookOpen, Database, Plus, Files,
  Code, FileCode, FileJson, FileType, Braces, Hash, Layers, ChevronDown, ChevronUp,
  FileOutput, MessageSquare, Brain, Download, Archive, ArrowLeft
} from 'lucide-react';
import {
  getTrainingItems,
  addTrainingItem,
  updateTrainingItem,
  deleteTrainingItem,
  clearTrainingItems,
  markItemTrained,
  getTrainingStats,
  analyzeTrainingContent,
  getMemories,
  getChatHistory,
  getChatLearningsStats
} from '../../services/localDatabase';
import ChatLearningsModal from './ChatLearningsModal';
import './TrainingModal.css';

// Memoized single training item component to prevent unnecessary re-renders
const TrainingItem = memo(function TrainingItem({
  item,
  isTrained,
  isSelected,
  isExpanded,
  isTraining,
  onToggleSelection,
  onToggleExpansion,
  onEdit,
  onDelete,
  onRetrain,
  getContentTypeIcon
}) {
  const analysis = item.analysis || {};

  return (
    <div
      className={`training-item ${isTrained ? 'trained' : ''} ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`}
    >
      <div className="item-checkbox">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelection}
          disabled={isTrained && !isSelected}
        />
      </div>
      <div className="item-content">
        <div className="item-header">
          <div className="item-title-row">
            {getContentTypeIcon(analysis.contentType)}
            <h4>{item.title}</h4>
            {analysis.language && (
              <span className="language-badge">{analysis.language}</span>
            )}
            {analysis.framework && (
              <span className="framework-badge">{analysis.framework}</span>
            )}
          </div>
          <div className="item-badges">
            {isTrained && (
              <span className="trained-badge">
                <CheckCircle size={12} />
                Trained
              </span>
            )}
          </div>
        </div>
        <p className="item-description">{item.description}</p>

        {/* Analysis Summary - always visible */}
        {analysis.learningHighlights && analysis.learningHighlights.length > 0 && (
          <div className="item-analysis-summary">
            <span className="analysis-label">What was learned:</span>
            <span className="analysis-highlights">
              {analysis.learningHighlights.slice(0, 2).join(' • ')}
            </span>
          </div>
        )}

        {/* Expandable details */}
        {isExpanded && (
          <div className="item-analysis-details">
            {/* Stats row */}
            <div className="analysis-stats">
              <span className="stat">
                <Hash size={12} />
                {analysis.stats?.lines || 0} lines
              </span>
              {analysis.stats?.functions > 0 && (
                <span className="stat">
                  <Braces size={12} />
                  {analysis.stats.functions} functions
                </span>
              )}
              {analysis.stats?.classes > 0 && (
                <span className="stat">
                  <Layers size={12} />
                  {analysis.stats.classes} classes
                </span>
              )}
              {analysis.stats?.codeBlocks > 0 && (
                <span className="stat">
                  <Code size={12} />
                  {analysis.stats.codeBlocks} code blocks
                </span>
              )}
            </div>

            {/* Concepts */}
            {analysis.concepts && analysis.concepts.length > 0 && (
              <div className="analysis-section">
                <span className="section-label">Concepts learned:</span>
                <div className="tag-list">
                  {analysis.concepts.map((concept, i) => (
                    <span key={i} className="concept-tag">{concept}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Code Patterns */}
            {analysis.codePatterns && analysis.codePatterns.length > 0 && (
              <div className="analysis-section">
                <span className="section-label">Code patterns:</span>
                <div className="tag-list">
                  {analysis.codePatterns.map((pattern, i) => (
                    <span key={i} className="pattern-tag">{pattern}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Features (for docs/tutorials) */}
            {analysis.features && analysis.features.length > 0 && (
              <div className="analysis-section">
                <span className="section-label">Topics covered:</span>
                <div className="tag-list features">
                  {analysis.features.slice(0, 6).map((feature, i) => (
                    <span key={i} className="feature-tag">{feature}</span>
                  ))}
                </div>
              </div>
            )}

            {/* All learning highlights */}
            {analysis.learningHighlights && analysis.learningHighlights.length > 2 && (
              <div className="analysis-section">
                <span className="section-label">Full analysis:</span>
                <ul className="highlights-list">
                  {analysis.learningHighlights.map((highlight, i) => (
                    <li key={i}>{highlight}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="item-meta">
          <span>{item.contentLength || item.content?.length || 0} characters</span>
          {item.fileName && <span>• {item.fileName}</span>}
          {item.createdAt && <span>• {new Date(item.createdAt).toLocaleDateString()}</span>}
          <button
            className="expand-toggle"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpansion();
            }}
          >
            {isExpanded ? (
              <><ChevronUp size={14} /> Less</>
            ) : (
              <><ChevronDown size={14} /> Details</>
            )}
          </button>
        </div>
      </div>
      <div className="item-actions">
        {isTrained ? (
          <button
            className="btn-icon retrain"
            onClick={onRetrain}
            title="Retrain"
            disabled={isTraining}
          >
            <RefreshCw size={16} />
          </button>
        ) : (
          <button
            className="btn-icon edit"
            onClick={onEdit}
            title="Edit"
          >
            <Edit2 size={16} />
          </button>
        )}
        <button
          className="btn-icon delete"
          onClick={onDelete}
          title="Delete"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
});

export default function TrainingModal({ onClose }) {
  const [activeTab, setActiveTab] = useState('add');
  const [trainingItems, setTrainingItems] = useState([]);
  const [trainedItems, setTrainedItems] = useState(new Set());
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState([]);
  const [trainedCount, setTrainedCount] = useState(0);

  // Form state for adding new training data
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    content: '',
    file: null
  });
  const [formErrors, setFormErrors] = useState({});
  const [editingItem, setEditingItem] = useState(null);

  // Bulk upload state
  const [bulkFiles, setBulkFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState([]);

  // Confirmation dialogs
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);

  // Expanded items for showing analysis details
  const [expandedItems, setExpandedItems] = useState(new Set());

  // Track if analysis is still processing
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Import from context state
  const [memories, setMemories] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [selectedMemories, setSelectedMemories] = useState(new Set());
  const [selectedChats, setSelectedChats] = useState(new Set());
  const [importProgress, setImportProgress] = useState([]);
  const [isImporting, setIsImporting] = useState(false);

  // Library sub-tab filter
  const [libraryFilter, setLibraryFilter] = useState('all'); // 'all', 'dataset', 'email', 'chat'

  // Shelf sub-tab filter (same categories as library)
  const [shelfFilter, setShelfFilter] = useState('all'); // 'all', 'dataset', 'email', 'chat'

  // Brain Knowledge (chat learnings) state
  const [brainKnowledgeCount, setBrainKnowledgeCount] = useState(0);
  const [showChatLearningsModal, setShowChatLearningsModal] = useState(false);

  // Track previous tab for Back navigation (e.g. Library → Edit → Back to Library)
  const [previousTab, setPreviousTab] = useState(null);

  // Categorize a training item into dataset/email/chat
  const getItemCategory = (item) => {
    const title = (item.title || '').toLowerCase();
    const desc = (item.description || '').toLowerCase();
    const fileName = (item.fileName || '').toLowerCase();
    const source = (item.source || '').toLowerCase();

    // Email items
    if (title.startsWith('email request:') || title.startsWith('email:') ||
        desc.includes('email') || source === 'email' ||
        fileName.includes('email')) {
      return 'email';
    }

    // Chat/memory items
    if (source === 'chat' || source === 'chat-learning' || source === 'memory' ||
        desc.includes('imported memory') || desc.includes('imported chat') ||
        desc.includes('from conversation') || desc.includes('chat session') ||
        fileName.startsWith('memory-') || fileName.startsWith('chat-')) {
      return 'chat';
    }

    // Everything else is dataset
    return 'dataset';
  };

  const fileInputRef = useRef(null);
  const bulkFileInputRef = useRef(null);

  // Toggle item expansion
  const toggleItemExpansion = (itemId) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  // Get icon for content type - memoized to prevent recreation
  const getContentTypeIcon = useCallback((type) => {
    switch (type) {
      case 'code': return <Code size={14} className="content-type-icon code" />;
      case 'documentation': return <FileText size={14} className="content-type-icon docs" />;
      case 'tutorial': return <BookOpen size={14} className="content-type-icon tutorial" />;
      case 'configuration': return <FileJson size={14} className="content-type-icon config" />;
      default: return <FileType size={14} className="content-type-icon text" />;
    }
  }, []);

  // Memoize analyzed items - only re-analyze when trainingItems changes
  // Use a state to store analyzed items and process in batches
  const [analyzedItems, setAnalyzedItems] = useState([]);

  // Process analysis in batches to avoid blocking UI
  useEffect(() => {
    if (trainingItems.length === 0) {
      setAnalyzedItems([]);
      setIsAnalyzing(false);
      return;
    }

    // Only analyze when library or shelf tab is active to save CPU
    if (activeTab !== 'library' && activeTab !== 'shelf') {
      return;
    }

    setIsAnalyzing(true);

    // Process items in chunks to avoid blocking
    const BATCH_SIZE = 5;
    let currentIndex = 0;
    const results = [];

    const processBatch = () => {
      const endIndex = Math.min(currentIndex + BATCH_SIZE, trainingItems.length);

      for (let i = currentIndex; i < endIndex; i++) {
        const item = trainingItems[i];
        if (!item.analysis && item.content) {
          results.push({
            ...item,
            analysis: analyzeTrainingContent(item.content, item.fileName)
          });
        } else {
          results.push(item);
        }
      }

      currentIndex = endIndex;

      if (currentIndex < trainingItems.length) {
        // Process next batch on next frame
        requestAnimationFrame(processBatch);
      } else {
        setAnalyzedItems(results);
        setIsAnalyzing(false);
      }
    };

    // Start processing
    requestAnimationFrame(processBatch);
  }, [trainingItems, activeTab]);

  // Prevent background page scroll while this modal is open
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  // Load training items on mount and clear form
  useEffect(() => {
    loadTrainingItemsFromDB();
    loadBrainKnowledgeCount();
    // Clear form data when modal opens
    setFormData({ title: '', description: '', content: '', file: null });
    setFormErrors({});
    setEditingItem(null);
  }, []);

  // Load brain knowledge (chat learnings) count
  const loadBrainKnowledgeCount = async () => {
    try {
      const stats = await getChatLearningsStats();
      setBrainKnowledgeCount(stats.totalLearnings || 0);
    } catch (error) {
      console.error('Failed to load brain knowledge count:', error);
    }
  };

  // Clear form when switching to "add" tab (unless editing)
  useEffect(() => {
    if (activeTab === 'add' && !editingItem) {
      setFormData({ title: '', description: '', content: '', file: null });
      setFormErrors({});
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [activeTab]);

  // Load memories and chat history when import tab is selected
  useEffect(() => {
    if (activeTab === 'import') {
      loadContextData();
    }
  }, [activeTab]);

  const loadContextData = async () => {
    setIsLoadingContext(true);
    try {
      const [memoriesData, chatData] = await Promise.all([
        getMemories(100),
        getChatHistory(200)
      ]);
      setMemories(memoriesData);
      setChatHistory(chatData);
    } catch (error) {
      console.error('Failed to load context data:', error);
    } finally {
      setIsLoadingContext(false);
    }
  };

  // Group chat messages into conversations (by time gaps)
  const groupedChats = useMemo(() => {
    if (chatHistory.length === 0) return [];

    const groups = [];
    let currentGroup = [];
    let lastTime = null;
    const GAP_THRESHOLD = 30 * 60 * 1000; // 30 minutes

    chatHistory.forEach((msg, index) => {
      const msgTime = new Date(msg.timestamp).getTime();

      if (lastTime && msgTime - lastTime > GAP_THRESHOLD) {
        if (currentGroup.length > 0) {
          groups.push({
            id: `chat-group-${groups.length}`,
            messages: currentGroup,
            startTime: currentGroup[0].timestamp,
            endTime: currentGroup[currentGroup.length - 1].timestamp,
            messageCount: currentGroup.length
          });
        }
        currentGroup = [];
      }

      currentGroup.push(msg);
      lastTime = msgTime;
    });

    // Push last group
    if (currentGroup.length > 0) {
      groups.push({
        id: `chat-group-${groups.length}`,
        messages: currentGroup,
        startTime: currentGroup[0].timestamp,
        endTime: currentGroup[currentGroup.length - 1].timestamp,
        messageCount: currentGroup.length
      });
    }

    return groups.reverse(); // Most recent first
  }, [chatHistory]);

  // Build a set of already-imported item identifiers (to filter Import Context tab)
  const importedItemKeys = useMemo(() => {
    const keys = new Set();
    trainingItems.forEach(item => {
      const fn = item.fileName || '';
      // Match memory imports: "memory-{id}.json"
      if (fn.startsWith('memory-') && fn.endsWith('.json')) {
        keys.add(fn);
      }
      // Match chat imports: "chat-{groupId}.json"
      if (fn.startsWith('chat-') && fn.endsWith('.json')) {
        keys.add(fn);
      }
    });
    return keys;
  }, [trainingItems]);

  // Filtered memories: exclude already-imported ones
  const availableMemories = useMemo(() => {
    return memories.filter(m => !importedItemKeys.has(`memory-${m.id}.json`));
  }, [memories, importedItemKeys]);

  // Filtered chat groups: exclude already-imported ones
  const availableChats = useMemo(() => {
    return groupedChats.filter(g => !importedItemKeys.has(`chat-${g.id}.json`));
  }, [groupedChats, importedItemKeys]);

  // Toggle memory selection
  const toggleMemorySelection = (memoryId) => {
    setSelectedMemories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(memoryId)) {
        newSet.delete(memoryId);
      } else {
        newSet.add(memoryId);
      }
      return newSet;
    });
  };

  // Toggle chat group selection
  const toggleChatSelection = (groupId) => {
    setSelectedChats(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  };

  // Select all memories (only available/non-imported ones)
  const selectAllMemories = () => {
    setSelectedMemories(new Set(availableMemories.map(m => m.id)));
  };

  // Deselect all memories
  const deselectAllMemories = () => {
    setSelectedMemories(new Set());
  };

  // Select all chat groups
  const selectAllChats = () => {
    setSelectedChats(new Set(availableChats.map(g => g.id)));
  };

  // Deselect all chat groups
  const deselectAllChats = () => {
    setSelectedChats(new Set());
  };

  // Import selected items as training data
  const handleImportContext = async () => {
    const totalItems = selectedMemories.size + selectedChats.size;
    if (totalItems === 0) return;

    setIsImporting(true);
    setImportProgress([{ type: 'info', message: `Importing ${totalItems} items...` }]);

    let successCount = 0;
    let errorCount = 0;

    // Import selected memories
    for (const memoryId of selectedMemories) {
      const memory = memories.find(m => m.id === memoryId);
      if (!memory) continue;

      try {
        const content = JSON.stringify({
          type: 'memory',
          memoryType: memory.type,
          content: memory.content,
          summary: memory.summary,
          context: memory.context,
          importance: memory.importance,
          source: memory.source,
          createdAt: memory.createdAt
        }, null, 2);

        await addTrainingItem({
          title: memory.summary || `Memory: ${memory.content.slice(0, 50)}...`,
          description: `Imported memory (${memory.type}) - ${memory.context || 'from conversation'}`,
          content: content,
          fileName: `memory-${memory.id}.json`
        });

        setImportProgress(prev => [...prev, {
          type: 'success',
          message: `Imported memory: ${memory.summary || memory.content.slice(0, 30)}...`
        }]);
        successCount++;
      } catch (error) {
        setImportProgress(prev => [...prev, {
          type: 'error',
          message: `Failed to import memory: ${error.message}`
        }]);
        errorCount++;
      }
    }

    // Import selected chat groups
    for (const groupId of selectedChats) {
      const group = groupedChats.find(g => g.id === groupId);
      if (!group) continue;

      try {
        const content = JSON.stringify({
          type: 'conversation',
          startTime: group.startTime,
          endTime: group.endTime,
          messageCount: group.messageCount,
          messages: group.messages.map(msg => ({
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp
          }))
        }, null, 2);

        const startDate = new Date(group.startTime).toLocaleDateString();
        const startTime = new Date(group.startTime).toLocaleTimeString();

        await addTrainingItem({
          title: `Chat Session - ${startDate} ${startTime}`,
          description: `Conversation with ${group.messageCount} messages`,
          content: content,
          fileName: `chat-${groupId}.json`
        });

        setImportProgress(prev => [...prev, {
          type: 'success',
          message: `Imported chat session: ${startDate} (${group.messageCount} messages)`
        }]);
        successCount++;
      } catch (error) {
        setImportProgress(prev => [...prev, {
          type: 'error',
          message: `Failed to import chat: ${error.message}`
        }]);
        errorCount++;
      }
    }

    setImportProgress(prev => [...prev, {
      type: 'complete',
      message: `Import complete: ${successCount} successful, ${errorCount} errors`
    }]);

    // Reload training items
    await loadTrainingItemsFromDB();

    setIsImporting(false);
    setSelectedMemories(new Set());
    setSelectedChats(new Set());

    // Switch to library tab after successful import
    if (successCount > 0) {
      setTimeout(() => {
        setActiveTab('library');
        setImportProgress([]);
      }, 1500);
    }
  };

  const loadTrainingItemsFromDB = async () => {
    setIsLoading(true);
    try {
      const items = await getTrainingItems();
      setTrainingItems(items);
      // Build trained set from items that have isTrained = true
      const trainedIds = new Set(items.filter(item => item.isTrained).map(item => item.id));
      setTrainedItems(trainedIds);
      setTrainedCount(trainedIds.size);
    } catch (error) {
      console.error('Failed to load training items:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Convert TXT content to structured JSON for AI training
  const convertTxtToTrainingJson = async (content, fileName) => {
    try {
      const response = await fetch('/api/training/convert-txt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, fileName })
      });

      if (!response.ok) {
        throw new Error('Failed to convert TXT to JSON');
      }

      const result = await response.json();
      return result.trainingData;
    } catch (error) {
      console.error('Error converting TXT:', error);
      // Fallback: return basic structured format
      return {
        metadata: {
          title: fileName.replace(/\.txt$/i, ''),
          description: `Training data from ${fileName}`,
          sourceFile: fileName,
          createdAt: new Date().toISOString()
        },
        content: { raw: content },
        training: { embedReady: true }
      };
    }
  };

  // Binary file extensions that must be processed server-side
  const BINARY_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.xls', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'];

  const isBinaryFile = (fileName) => {
    const ext = '.' + fileName.split('.').pop().toLowerCase();
    return BINARY_EXTENSIONS.includes(ext);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (isBinaryFile(file.name)) {
      // Binary file → upload to server for processing
      setFormData(prev => ({ ...prev, file: file, content: '' }));
      setFormErrors({});

      try {
        const apiUrl = import.meta.env?.VITE_API_URL || 'http://localhost:3001';
        const formDataUpload = new FormData();
        formDataUpload.append('file', file);

        setUploadProgress([{ fileName: file.name, status: 'uploading', message: `Processing ${file.name}...` }]);

        const response = await fetch(`${apiUrl}/api/training/upload-file`, {
          method: 'POST',
          body: formDataUpload
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Upload failed' }));
          throw new Error(err.error || 'Upload failed');
        }

        const result = await response.json();

        // If ZIP produced multiple items, add them directly to library
        if (result.items && result.items.length > 1) {
          setTrainingItems(prev => [...result.items, ...prev]);
          setFormData({ title: '', description: '', content: '', file: null });
          if (fileInputRef.current) fileInputRef.current.value = '';
          setUploadProgress([{ fileName: file.name, status: 'success', message: `Added ${result.items.length} items to library` }]);
          setTimeout(() => { setActiveTab('library'); setUploadProgress([]); }, 1500);
        } else {
          // Single item → populate the form for review
          setFormData(prev => ({
            ...prev,
            title: result.title || '',
            description: result.description || '',
            content: result.content || '',
            file: file
          }));
          setUploadProgress([{ fileName: file.name, status: 'success', message: 'Content extracted successfully' }]);
          setTimeout(() => setUploadProgress([]), 2000);
        }
      } catch (error) {
        console.error('Error processing binary file:', error);
        setUploadProgress([{ fileName: file.name, status: 'error', message: error.message }]);
        setFormData(prev => ({ ...prev, file: null, content: '' }));
      }
    } else {
      // Text-based file → read client-side (existing flow)
      const reader = new FileReader();
      reader.onload = async (event) => {
        let content = event.target.result;
        let processedFile = file;

        // If TXT file, convert to structured JSON format
        if (file.name.toLowerCase().endsWith('.txt')) {
          try {
            const trainingData = await convertTxtToTrainingJson(content, file.name);
            content = JSON.stringify(trainingData, null, 2);
            const newFileName = file.name.replace(/\.txt$/i, '.json');
            processedFile = new File([content], newFileName, { type: 'application/json' });
          } catch (error) {
            console.error('Error converting TXT file:', error);
          }
        }

        setFormData(prev => ({
          ...prev,
          file: processedFile,
          content: content
        }));
      };
      reader.readAsText(file);
    }
  };

  // Bulk file upload handlers
  const handleBulkFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setBulkFiles(files);
      setUploadProgress([]);
    }
  };

  const handleBulkUpload = async () => {
    if (bulkFiles.length === 0) return;

    setIsUploading(true);
    setUploadProgress([]);

    const results = [];

    for (let i = 0; i < bulkFiles.length; i++) {
      const file = bulkFiles[i];
      const fileName = file.name;
      const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
      const isTxtFile = fileName.toLowerCase().endsWith('.txt');

      // Check if binary file needs server-side processing
      if (isBinaryFile(fileName)) {
        setUploadProgress(prev => [
          ...prev,
          { fileName, status: 'uploading', message: `Processing ${fileName}...` }
        ]);

        try {
          const apiUrl = import.meta.env?.VITE_API_URL || 'http://localhost:3001';
          const formDataUpload = new FormData();
          formDataUpload.append('file', file);

          const response = await fetch(`${apiUrl}/api/training/upload-file`, {
            method: 'POST',
            body: formDataUpload
          });

          if (!response.ok) {
            const err = await response.json().catch(() => ({ error: 'Upload failed' }));
            throw new Error(err.error || 'Upload failed');
          }

          const result = await response.json();

          // Server already created training items in SQLite, but we also need them in IndexedDB
          if (result.items) {
            for (const item of result.items) {
              const newItem = await addTrainingItem({
                title: item.title,
                description: item.description,
                content: item.content,
                fileName: item.sourceFile || fileName
              });
              results.push(newItem);
            }
          }

          setUploadProgress(prev => prev.map(p =>
            p.fileName === fileName
              ? { ...p, status: 'success', message: result.items?.length > 1 ? `${result.items.length} items extracted` : 'Added to library' }
              : p
          ));
        } catch (error) {
          setUploadProgress(prev => prev.map(p =>
            p.fileName === fileName
              ? { ...p, status: 'error', message: error.message }
              : p
          ));
        }
        continue; // Skip the text-based processing below
      }

      setUploadProgress(prev => [
        ...prev,
        { fileName, status: 'uploading', message: isTxtFile ? 'Converting TXT to JSON...' : 'Reading file...' }
      ]);

      try {
        // Read file content (text-based files only)
        const content = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsText(file);
        });

        let finalContent = content;
        let finalFileName = fileName;
        let description = `Imported from ${fileName}`;

        // If TXT file, convert to structured JSON format
        if (isTxtFile) {
          setUploadProgress(prev => prev.map(p =>
            p.fileName === fileName
              ? { ...p, message: 'Converting to training format...' }
              : p
          ));

          const trainingData = await convertTxtToTrainingJson(content, fileName);
          finalContent = JSON.stringify(trainingData, null, 2);
          finalFileName = fileName.replace(/\.txt$/i, '.json');
          description = trainingData.metadata?.description || `Converted from ${fileName} to JSON training format`;
        }

        // Create training item in local database
        const newItem = await addTrainingItem({
          title: fileNameWithoutExt,
          description: description,
          content: finalContent,
          fileName: finalFileName
        });

        results.push(newItem);
        setUploadProgress(prev => prev.map(p =>
          p.fileName === fileName
            ? {
                ...p,
                status: 'success',
                message: isTxtFile ? `Converted to ${finalFileName}` : 'Added to library'
              }
            : p
        ));
      } catch (error) {
        setUploadProgress(prev => prev.map(p =>
          p.fileName === fileName
            ? { ...p, status: 'error', message: error.message }
            : p
        ));
      }
    }

    // Update training items list with all successful uploads
    if (results.length > 0) {
      setTrainingItems(prev => [...results, ...prev]);
    }

    setIsUploading(false);
    setBulkFiles([]);
    if (bulkFileInputRef.current) bulkFileInputRef.current.value = '';

    // Show success message if all uploaded
    if (results.length === bulkFiles.length) {
      setTimeout(() => {
        setActiveTab('library');
      }, 1500);
    }
  };

  const removeBulkFile = (index) => {
    setBulkFiles(prev => prev.filter((_, i) => i !== index));
  };

  const clearBulkFiles = () => {
    setBulkFiles([]);
    setUploadProgress([]);
    if (bulkFileInputRef.current) bulkFileInputRef.current.value = '';
  };

  // Auto-generate title from content
  const generateTitle = (content, fileName) => {
    if (fileName) {
      return fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    if (!content) return 'Untitled Training Data';
    // Try to find a meaningful first line or heading
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    const firstLine = lines[0]?.trim() || '';
    // Check for JSON title
    try {
      const parsed = JSON.parse(content);
      if (parsed.metadata?.title) return parsed.metadata.title;
      if (parsed.title) return parsed.title;
      if (parsed.name) return parsed.name;
    } catch { /* not JSON */ }
    // Check for markdown heading
    const headingMatch = firstLine.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) return headingMatch[1].substring(0, 80);
    // Use first meaningful line, truncated
    if (firstLine.length > 80) return firstLine.substring(0, 77) + '...';
    if (firstLine.length > 5) return firstLine;
    return 'Training Dataset';
  };

  // Auto-generate description from content
  const generateDescription = (content, fileName) => {
    if (!content) return fileName ? `Imported from ${fileName}` : 'Training data';
    const contentLower = content.toLowerCase();
    const lineCount = content.split('\n').length;
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
    const parts = [];

    // Detect content type
    try {
      const parsed = JSON.parse(content);
      if (parsed.metadata?.description) return parsed.metadata.description;
      if (Array.isArray(parsed)) parts.push(`JSON array with ${parsed.length} entries`);
      else parts.push('JSON document');
    } catch {
      if (contentLower.includes('function ') || contentLower.includes('const ') || contentLower.includes('class ')) {
        parts.push('Code/script content');
      } else if (contentLower.includes('<html') || contentLower.includes('<!doctype')) {
        parts.push('HTML content');
      } else if (content.includes('---\n') && content.includes('title:')) {
        parts.push('Markdown document with frontmatter');
      } else {
        parts.push('Text content');
      }
    }

    parts.push(`${wordCount} words, ${lineCount} lines`);
    if (fileName) parts.push(`from ${fileName}`);
    return parts.join(' | ');
  };

  const validateForm = () => {
    const errors = {};
    if (!formData.content.trim() && !formData.file) errors.content = 'Content or file is required';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAddItem = async () => {
    if (!validateForm()) return;

    try {
      const title = formData.title.trim() || generateTitle(formData.content, formData.file?.name);
      const description = formData.description.trim() || generateDescription(formData.content, formData.file?.name);

      const newItem = await addTrainingItem({
        title,
        description,
        content: formData.content,
        fileName: formData.file?.name
      });

      setTrainingItems(prev => [newItem, ...prev]);
      setFormData({ title: '', description: '', content: '', file: null });
      if (fileInputRef.current) fileInputRef.current.value = '';
      setActiveTab('library');
    } catch (error) {
      console.error('Failed to add training item:', error);
    }
  };

  const handleUpdateItem = async () => {
    if (!validateForm() || !editingItem) return;

    try {
      const title = formData.title.trim() || generateTitle(formData.content, formData.file?.name);
      const description = formData.description.trim() || generateDescription(formData.content, formData.file?.name);

      const updatedItem = await updateTrainingItem(editingItem.id, {
        title,
        description,
        content: formData.content
      });

      setTrainingItems(prev => prev.map(item =>
        item.id === editingItem.id ? updatedItem : item
      ));
      // Remove from trained if content changed
      setTrainedItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(editingItem.id);
        return newSet;
      });
      setEditingItem(null);
      setFormData({ title: '', description: '', content: '', file: null });
    } catch (error) {
      console.error('Failed to update training item:', error);
    }
  };

  const handleDeleteItem = async (itemId) => {
    try {
      await deleteTrainingItem(itemId);

      setTrainingItems(prev => prev.filter(item => item.id !== itemId));
      setSelectedItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemId);
        return newSet;
      });
      setTrainedItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemId);
        return newSet;
      });
    } catch (error) {
      console.error('Failed to delete training item:', error);
    }
    setShowDeleteConfirm(null);
  };

  const handleClearAll = async () => {
    try {
      await clearTrainingItems();

      setTrainingItems([]);
      setTrainedItems(new Set());
      setSelectedItems(new Set());
      setTrainedCount(0);
    } catch (error) {
      console.error('Failed to clear training data:', error);
    }
    setShowClearConfirm(false);
  };

  const handleEditItem = (item) => {
    setPreviousTab(activeTab); // Remember where we came from
    setEditingItem(item);
    setFormData({
      title: item.title,
      description: item.description,
      content: item.content,
      file: null
    });
    setActiveTab('add');
  };

  const toggleItemSelection = (itemId) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    const allIds = trainingItems.map(item => item.id);
    setSelectedItems(new Set(allIds));
  };

  const deselectAll = () => {
    setSelectedItems(new Set());
  };

  const handleTrain = async () => {
    if (selectedItems.size === 0) return;

    setIsTraining(true);
    setTrainingProgress([]);

    const itemIds = Array.from(selectedItems);
    const itemsToTrain = trainingItems.filter(item => itemIds.includes(item.id));

    setTrainingProgress([{ type: 'info', message: `Training ${itemsToTrain.length} items...` }]);

    let successCount = 0;
    let errorCount = 0;

    for (const item of itemsToTrain) {
      setTrainingProgress(prev => [
        ...prev.filter(p => p.itemId !== item.id),
        { itemId: item.id, title: item.title, status: 'training', message: 'Processing...' }
      ]);

      try {
        // Mark item as trained in local database
        await markItemTrained(item.id);

        setTrainingProgress(prev => prev.map(p =>
          p.itemId === item.id
            ? { ...p, status: 'success', message: 'Trained successfully' }
            : p
        ));
        setTrainedItems(prev => new Set([...prev, item.id]));
        successCount++;

        // Small delay for visual feedback
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        setTrainingProgress(prev => prev.map(p =>
          p.itemId === item.id
            ? { ...p, status: 'error', message: error.message }
            : p
        ));
        errorCount++;
      }
    }

    // Get updated stats
    const stats = await getTrainingStats();
    setTrainedCount(stats.trainedItems);

    setTrainingProgress(prev => [
      ...prev,
      { type: 'complete', message: `Training complete: ${successCount} successful, ${errorCount} errors`, trained: successCount, errors: errorCount }
    ]);

    setIsTraining(false);
    setSelectedItems(new Set());
    // Reload items to get updated trained status
    loadTrainingItemsFromDB();
  };

  const handleRetrain = async (itemId) => {
    setIsTraining(true);
    const item = trainingItems.find(i => i.id === itemId);

    setTrainingProgress([{
      itemId: item.id,
      title: item.title,
      status: 'training',
      message: 'Removing old data & relearning...'
    }]);

    try {
      // Call server-side relearn endpoint which:
      // 1. Removes old vectors from LanceDB
      // 2. Resets trained status in SQLite
      // 3. Re-generates embeddings and adds new vectors
      // 4. Marks as trained again
      const response = await fetch(`/api/training/relearn/${itemId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok && !response.headers.get('content-type')?.includes('text/event-stream')) {
        throw new Error('Server relearn request failed');
      }

      // Process SSE stream for progress updates
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastStatus = 'training';
      let lastMessage = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'error') {
                lastStatus = 'error';
                lastMessage = data.message;
              } else if (data.type === 'complete') {
                lastStatus = data.trained > 0 ? 'success' : 'error';
                lastMessage = data.message;
              } else if (data.type === 'success') {
                lastStatus = 'success';
                lastMessage = data.message;
              } else if (data.type === 'progress' || data.type === 'warning') {
                lastMessage = data.message;
              }

              setTrainingProgress([{
                itemId: item.id,
                title: item.title,
                status: lastStatus === 'error' ? 'error' : (lastStatus === 'success' ? 'success' : 'training'),
                message: lastMessage
              }]);
            } catch (e) { /* skip malformed SSE */ }
          }
        }
      }

      // Also update local IndexedDB to match
      if (lastStatus === 'success') {
        await markItemTrained(itemId);
        setTrainedItems(prev => new Set([...prev, itemId]));
      }

      // Update stats
      const stats = await getTrainingStats();
      setTrainedCount(stats.trainedItems);
    } catch (error) {
      setTrainingProgress([{
        itemId: item.id,
        title: item.title,
        status: 'error',
        message: error.message || 'Relearn failed'
      }]);
    }

    setIsTraining(false);
    loadTrainingItemsFromDB();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="training-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-section">
            <BookOpen size={24} />
            <h2>Training Center</h2>
          </div>
          <div className="training-stats-row">
            <button
              className="brain-knowledge-btn"
              onClick={() => setShowChatLearningsModal(true)}
              title="Brain Knowledge — items learned from conversations. Click to manage."
            >
              <Brain size={16} />
              <span>{brainKnowledgeCount} brain knowledge</span>
            </button>
            <div className="training-stats">
              <Database size={16} />
              <span>{trainedCount} items trained</span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="training-tabs">
          <button
            className={`training-tab ${activeTab === 'add' ? 'active' : ''}`}
            onClick={() => setActiveTab('add')}
          >
            <Plus size={16} />
            {editingItem ? 'Edit Item' : 'Add New'}
          </button>
          <button
            className={`training-tab ${activeTab === 'bulk' ? 'active' : ''}`}
            onClick={() => setActiveTab('bulk')}
          >
            <Files size={16} />
            Bulk Upload
          </button>
          <button
            className={`training-tab ${activeTab === 'import' ? 'active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            <Download size={16} />
            Import Context
          </button>
          <button
            className={`training-tab ${activeTab === 'library' ? 'active' : ''}`}
            onClick={() => setActiveTab('library')}
          >
            <FileText size={16} />
            Library ({trainingItems.filter(i => !trainedItems.has(i.id)).length})
          </button>
          <button
            className={`training-tab shelf-tab ${activeTab === 'shelf' ? 'active' : ''}`}
            onClick={() => setActiveTab('shelf')}
          >
            <Archive size={16} />
            Shelf ({trainedItems.size})
          </button>
        </div>

        <div className="modal-body">
          {activeTab === 'add' && (
            <div className="training-add-section">
              {/* Back button — returns to previous tab (Library/Shelf) when editing */}
              {(editingItem || previousTab) && (
                <button
                  className="btn-back"
                  onClick={() => {
                    if (editingItem) {
                      setEditingItem(null);
                      setFormData({ title: '', description: '', content: '', file: null });
                    }
                    setActiveTab(previousTab || 'library');
                    setPreviousTab(null);
                  }}
                >
                  <ArrowLeft size={14} />
                  Back to {previousTab === 'shelf' ? 'Shelf' : 'Library'}
                </button>
              )}
              <div className="form-group">
                <label>Title <span className="form-hint">(auto-generated if left blank)</span></label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Leave blank to auto-generate from content"
                  autoComplete="off"
                />
              </div>

              <div className="form-group">
                <label>Description <span className="form-hint">(auto-generated if left blank)</span></label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Leave blank to auto-generate from content"
                  autoComplete="off"
                />
              </div>

              <div className="form-group">
                <label>Upload File</label>
                <div className="file-upload-area">
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileChange}
                    accept=".txt,.md,.json,.lua,.js,.html,.xml,.csv,.log,.yaml,.yml,.pdf,.docx,.xlsx,.xls,.zip,.png,.jpg,.jpeg,.gif,.bmp,.tiff,.webp"
                  />
                  <Upload size={24} />
                  <span>Click to upload or drag and drop</span>
                  <span className="file-types">PDF, DOCX, XLSX, ZIP, Images, Code, Text, and more</span>
                </div>
                {formData.file && (
                  <div className="selected-file">
                    <FileText size={16} />
                    <span>{formData.file.name}</span>
                    <button onClick={() => {
                      setFormData(prev => ({ ...prev, file: null, content: '' }));
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}>
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>

              <div className="form-divider">
                <span>OR</span>
              </div>

              <div className="form-group">
                <label>Paste Content *</label>
                <textarea
                  value={formData.content}
                  onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                  placeholder="Paste your training content here..."
                  rows={8}
                  className={formErrors.content ? 'error' : ''}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                />
                {formErrors.content && <span className="error-text">{formErrors.content}</span>}
              </div>

              <div className="form-actions">
                {editingItem ? (
                  <>
                    <button className="btn-secondary" onClick={() => {
                      setEditingItem(null);
                      setFormData({ title: '', description: '', content: '', file: null });
                    }}>
                      Cancel
                    </button>
                    <button className="btn-primary" onClick={handleUpdateItem}>
                      <Check size={16} />
                      Update Item
                    </button>
                  </>
                ) : (
                  <button className="btn-primary" onClick={handleAddItem}>
                    <Plus size={16} />
                    Add to Library
                  </button>
                )}
              </div>
            </div>
          )}

          {activeTab === 'bulk' && (
            <div className="training-bulk-section">
              <div className="bulk-upload-area">
                <input
                  ref={bulkFileInputRef}
                  type="file"
                  multiple
                  onChange={handleBulkFileSelect}
                  accept=".txt,.md,.json,.lua,.js,.html,.xml,.csv,.log,.yaml,.yml,.pdf,.docx,.xlsx,.xls,.zip,.png,.jpg,.jpeg,.gif,.bmp,.tiff,.webp,.ts,.py,.sh,.bat,.ps1,.cfg,.ini,.toml"
                />
                <Upload size={32} />
                <h3>Drop files here or click to browse</h3>
                <p>Select multiple files to upload at once</p>
                <span className="file-types">PDF, DOCX, XLSX, ZIP, Images, Code, Text, and more</span>
              </div>

              <div className="conversion-info">
                <FileOutput size={16} />
                <span><strong>All files</strong> are automatically processed and converted to structured format for optimal AI training</span>
              </div>

              {bulkFiles.length > 0 && (
                <div className="bulk-files-list">
                  <div className="bulk-files-header">
                    <h4>{bulkFiles.length} file(s) selected</h4>
                    <button className="btn-text" onClick={clearBulkFiles}>
                      Clear All
                    </button>
                  </div>

                  <div className="bulk-files-items">
                    {bulkFiles.map((file, index) => {
                      const progress = uploadProgress.find(p => p.fileName === file.name);
                      const isTxtFile = file.name.toLowerCase().endsWith('.txt');
                      return (
                        <div key={index} className={`bulk-file-item ${progress?.status || ''} ${isTxtFile ? 'will-convert' : ''}`}>
                          {isTxtFile ? <FileOutput size={16} className="convert-icon" /> : <FileText size={16} />}
                          <span className="bulk-file-name">
                            {file.name}
                            {isTxtFile && !progress && (
                              <span className="convert-badge">→ JSON</span>
                            )}
                          </span>
                          <span className="bulk-file-size">
                            {(file.size / 1024).toFixed(1)} KB
                          </span>
                          {progress ? (
                            <span className={`bulk-file-status ${progress.status}`}>
                              {progress.status === 'uploading' && <RefreshCw size={14} className="spinning" />}
                              {progress.status === 'success' && <CheckCircle size={14} />}
                              {progress.status === 'error' && <XCircle size={14} />}
                              {progress.message}
                            </span>
                          ) : (
                            <button
                              className="btn-icon-small"
                              onClick={() => removeBulkFile(index)}
                              title="Remove"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="bulk-upload-actions">
                    <button
                      className="btn-primary"
                      onClick={handleBulkUpload}
                      disabled={isUploading || bulkFiles.length === 0}
                    >
                      {isUploading ? (
                        <>
                          <RefreshCw size={16} className="spinning" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload size={16} />
                          Upload {bulkFiles.length} File(s)
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {uploadProgress.length > 0 && !isUploading && (
                <div className="bulk-upload-summary">
                  <CheckCircle size={20} />
                  <span>
                    {uploadProgress.filter(p => p.status === 'success').length} of {uploadProgress.length} files uploaded successfully
                  </span>
                </div>
              )}
            </div>
          )}

          {activeTab === 'import' && (
            <div className="training-import-section">
              {isLoadingContext ? (
                <div className="loading-state">
                  <RefreshCw size={20} className="spinning" />
                  <span>Loading memories and chat history...</span>
                </div>
              ) : (
                <>
                  {/* Memories Section */}
                  <div className="import-section">
                    <div className="import-section-header">
                      <div className="section-title">
                        <Brain size={18} />
                        <h3>Memories ({availableMemories.length})</h3>
                        {memories.length > availableMemories.length && (
                          <span className="imported-note">({memories.length - availableMemories.length} already imported)</span>
                        )}
                      </div>
                      <div className="section-actions">
                        <button onClick={selectAllMemories}>Select All</button>
                        <button onClick={deselectAllMemories}>Deselect All</button>
                        <span className="selection-count">{selectedMemories.size} selected</span>
                      </div>
                    </div>

                    {availableMemories.length === 0 ? (
                      <div className="import-empty">
                        <p>{memories.length > 0
                          ? 'All memories have been imported. Check the Library or Shelf tabs.'
                          : 'No memories found. Memories are created during conversations.'
                        }</p>
                      </div>
                    ) : (
                      <div className="import-items-list">
                        {availableMemories.map(memory => (
                          <div
                            key={memory.id}
                            className={`import-item memory-item ${selectedMemories.has(memory.id) ? 'selected' : ''}`}
                            onClick={() => toggleMemorySelection(memory.id)}
                          >
                            <div className="import-item-checkbox">
                              <input
                                type="checkbox"
                                checked={selectedMemories.has(memory.id)}
                                onChange={() => toggleMemorySelection(memory.id)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                            <div className="import-item-content">
                              <div className="import-item-header">
                                <span className={`memory-type-badge ${memory.type}`}>{memory.type}</span>
                                <span className="memory-importance">★ {memory.importance}</span>
                              </div>
                              <p className="import-item-text">{memory.content}</p>
                              {memory.summary && (
                                <p className="import-item-summary">{memory.summary}</p>
                              )}
                              <div className="import-item-meta">
                                <span>{new Date(memory.createdAt).toLocaleDateString()}</span>
                                {memory.context && <span>• {memory.context}</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Chat History Section */}
                  <div className="import-section">
                    <div className="import-section-header">
                      <div className="section-title">
                        <MessageSquare size={18} />
                        <h3>Chat Sessions ({availableChats.length})</h3>
                        {groupedChats.length > availableChats.length && (
                          <span className="imported-note">({groupedChats.length - availableChats.length} already imported)</span>
                        )}
                      </div>
                      <div className="section-actions">
                        <button onClick={selectAllChats}>Select All</button>
                        <button onClick={deselectAllChats}>Deselect All</button>
                        <span className="selection-count">{selectedChats.size} selected</span>
                      </div>
                    </div>

                    {availableChats.length === 0 ? (
                      <div className="import-empty">
                        <p>{groupedChats.length > 0
                          ? 'All chat sessions have been imported. Check the Library or Shelf tabs.'
                          : 'No chat history found. Start a conversation to build history.'
                        }</p>
                      </div>
                    ) : (
                      <div className="import-items-list">
                        {availableChats.map(group => (
                          <div
                            key={group.id}
                            className={`import-item chat-item ${selectedChats.has(group.id) ? 'selected' : ''}`}
                            onClick={() => toggleChatSelection(group.id)}
                          >
                            <div className="import-item-checkbox">
                              <input
                                type="checkbox"
                                checked={selectedChats.has(group.id)}
                                onChange={() => toggleChatSelection(group.id)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                            <div className="import-item-content">
                              <div className="import-item-header">
                                <span className="chat-date">
                                  {new Date(group.startTime).toLocaleDateString()}
                                </span>
                                <span className="chat-time">
                                  {new Date(group.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span className="chat-count">{group.messageCount} messages</span>
                              </div>
                              <div className="chat-preview">
                                {group.messages.slice(0, 2).map((msg, i) => (
                                  <p key={i} className={`preview-message ${msg.role}`}>
                                    <strong>{msg.role === 'user' ? 'You' : 'AI'}:</strong> {msg.content?.slice(0, 80)}...
                                  </p>
                                ))}
                                {group.messages.length > 2 && (
                                  <p className="preview-more">+{group.messages.length - 2} more messages</p>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Import Progress */}
                  {importProgress.length > 0 && (
                    <div className="import-progress">
                      <h4>Import Progress</h4>
                      {importProgress.map((progress, index) => (
                        <div key={index} className={`progress-item ${progress.type}`}>
                          {progress.type === 'info' && <AlertCircle size={14} />}
                          {progress.type === 'success' && <CheckCircle size={14} />}
                          {progress.type === 'error' && <XCircle size={14} />}
                          {progress.type === 'complete' && <CheckCircle size={14} />}
                          <span className="progress-message">{progress.message}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Import Actions */}
                  <div className="import-actions">
                    <button
                      className="btn-primary"
                      onClick={handleImportContext}
                      disabled={isImporting || (selectedMemories.size === 0 && selectedChats.size === 0)}
                    >
                      {isImporting ? (
                        <>
                          <RefreshCw size={16} className="spinning" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <Download size={16} />
                          Import {selectedMemories.size + selectedChats.size} Item(s)
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'library' && (
            <div className="training-library-section">
              {/* Library Sub-Tabs */}
              <div className="library-sub-tabs">
                {[
                  { id: 'all', label: 'ALL' },
                  { id: 'dataset', label: 'DATASET' },
                  { id: 'email', label: 'EMAIL' },
                  { id: 'chat', label: 'CHAT' }
                ].map(tab => {
                  const untrainedItems = trainingItems.filter(i => !trainedItems.has(i.id));
                  const count = tab.id === 'all'
                    ? untrainedItems.length
                    : untrainedItems.filter(i => getItemCategory(i) === tab.id).length;
                  return (
                    <button
                      key={tab.id}
                      className={`library-sub-tab ${libraryFilter === tab.id ? 'active' : ''}`}
                      onClick={() => setLibraryFilter(tab.id)}
                    >
                      {tab.label}
                      {count > 0 && <span className="library-sub-tab-count">{count}</span>}
                    </button>
                  );
                })}
              </div>

              {isLoading || (isAnalyzing && analyzedItems.length === 0) ? (
                <div className="loading-state">
                  <RefreshCw size={20} className="spinning" />
                  <span>Loading training library...</span>
                </div>
              ) : trainingItems.filter(i => !trainedItems.has(i.id)).length === 0 ? (
                <div className="empty-state">
                  <BookOpen size={48} />
                  <h3>{trainingItems.length === 0 ? 'No Training Data' : 'All Items Learned'}</h3>
                  <p>{trainingItems.length === 0
                    ? 'Add some training content to get started'
                    : 'All items have been trained and moved to the Shelf'}</p>
                  {trainingItems.length === 0 ? (
                    <button className="btn-primary" onClick={() => setActiveTab('add')}>
                      <Plus size={16} />
                      Add Training Data
                    </button>
                  ) : (
                    <button className="btn-secondary" onClick={() => setActiveTab('shelf')}>
                      <Archive size={16} />
                      View Shelf ({trainedItems.size})
                    </button>
                  )}
                </div>
              ) : (() => {
                // Filter out trained items — they live on the Shelf now
                const untrainedAnalyzed = analyzedItems.filter(item => !trainedItems.has(item.id));
                const filteredItems = libraryFilter === 'all'
                  ? untrainedAnalyzed
                  : untrainedAnalyzed.filter(item => getItemCategory(item) === libraryFilter);
                return (
                  <>
                    <div className="library-toolbar">
                      <div className="selection-actions">
                        <button onClick={() => {
                          const untrainedIds = trainingItems.filter(i => !trainedItems.has(i.id)).map(i => i.id);
                          setSelectedItems(new Set(untrainedIds));
                        }}>Select All</button>
                        <button onClick={deselectAll}>Deselect All</button>
                        <span className="selection-count">
                          {selectedItems.size} selected
                        </span>
                      </div>
                      <div className="library-toolbar-right">
                        {trainedItems.size > 0 && (
                          <button
                            className="btn-shelf-link"
                            onClick={() => setActiveTab('shelf')}
                          >
                            <Archive size={14} />
                            Shelf ({trainedItems.size})
                          </button>
                        )}
                        <button
                          className="btn-danger-outline"
                          onClick={() => setShowClearConfirm(true)}
                        >
                          <Trash2 size={14} />
                          Clear All
                        </button>
                      </div>
                    </div>

                    {filteredItems.length === 0 ? (
                      <div className="empty-state" style={{ padding: '40px 20px' }}>
                        <BookOpen size={32} />
                        <p>No untrained items in this category</p>
                      </div>
                    ) : (
                      <div className="training-items-list">
                        {filteredItems.map(item => (
                          <TrainingItem
                            key={item.id}
                            item={item}
                            isTrained={trainedItems.has(item.id)}
                            isSelected={selectedItems.has(item.id)}
                            isExpanded={expandedItems.has(item.id)}
                            isTraining={isTraining}
                            onToggleSelection={() => toggleItemSelection(item.id)}
                            onToggleExpansion={() => toggleItemExpansion(item.id)}
                            onEdit={() => handleEditItem(item)}
                            onDelete={() => setShowDeleteConfirm(item.id)}
                            onRetrain={() => handleRetrain(item.id)}
                            getContentTypeIcon={getContentTypeIcon}
                          />
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Training Progress */}
              {trainingProgress.length > 0 && (
                <div className="training-progress">
                  <h4>Training Progress</h4>
                  {trainingProgress.map((progress, index) => (
                    <div key={progress.itemId || index} className={`progress-item ${progress.status || progress.type}`}>
                      {progress.status === 'training' && <RefreshCw size={14} className="spinning" />}
                      {progress.status === 'success' && <CheckCircle size={14} />}
                      {progress.status === 'error' && <XCircle size={14} />}
                      {progress.status === 'warning' && <AlertCircle size={14} />}
                      {progress.type === 'info' && <AlertCircle size={14} />}
                      {progress.type === 'complete' && <CheckCircle size={14} />}
                      {progress.title && <span className="progress-title">{progress.title}</span>}
                      <span className="progress-message">{progress.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'shelf' && (
            <div className="training-shelf-section">
              {/* Back to Library */}
              <button
                className="btn-back"
                onClick={() => setActiveTab('library')}
              >
                <ArrowLeft size={14} />
                Back to Library
              </button>
              {/* Shelf Sub-Tabs */}
              <div className="library-sub-tabs shelf-sub-tabs">
                {[
                  { id: 'all', label: 'ALL' },
                  { id: 'dataset', label: 'DATASET' },
                  { id: 'email', label: 'EMAIL' },
                  { id: 'chat', label: 'CHAT' }
                ].map(tab => {
                  const shelfItems = trainingItems.filter(i => trainedItems.has(i.id));
                  const count = tab.id === 'all'
                    ? shelfItems.length
                    : shelfItems.filter(i => getItemCategory(i) === tab.id).length;
                  return (
                    <button
                      key={tab.id}
                      className={`library-sub-tab ${shelfFilter === tab.id ? 'active' : ''}`}
                      onClick={() => setShelfFilter(tab.id)}
                    >
                      {tab.label}
                      {count > 0 && <span className="library-sub-tab-count">{count}</span>}
                    </button>
                  );
                })}
              </div>

              {isLoading || (isAnalyzing && analyzedItems.length === 0) ? (
                <div className="loading-state">
                  <RefreshCw size={20} className="spinning" />
                  <span>Loading shelf...</span>
                </div>
              ) : trainedItems.size === 0 ? (
                <div className="empty-state">
                  <Archive size={48} />
                  <h3>Shelf is Empty</h3>
                  <p>Items move here automatically once they've been trained. Train items from the Library tab to see them here.</p>
                  <button className="btn-secondary" onClick={() => setActiveTab('library')}>
                    <FileText size={16} />
                    Go to Library
                  </button>
                </div>
              ) : (() => {
                const shelfAnalyzed = analyzedItems.filter(item => trainedItems.has(item.id));
                const filteredShelfItems = shelfFilter === 'all'
                  ? shelfAnalyzed
                  : shelfAnalyzed.filter(item => getItemCategory(item) === shelfFilter);
                return (
                  <>
                    <div className="shelf-info-bar">
                      <Archive size={14} />
                      <span>These items have been learned. They are greyed out and archived here for reference.</span>
                    </div>

                    {filteredShelfItems.length === 0 ? (
                      <div className="empty-state" style={{ padding: '40px 20px' }}>
                        <Archive size={32} />
                        <p>No learned items in this category</p>
                      </div>
                    ) : (
                      <div className="training-items-list shelf-items-list">
                        {filteredShelfItems.map(item => {
                          const analysis = item.analysis || {};
                          const isExpanded = expandedItems.has(item.id);
                          return (
                            <div
                              key={item.id}
                              className={`training-item shelf-item ${isExpanded ? 'expanded' : ''}`}
                            >
                              <div className="shelf-item-indicator">
                                <CheckCircle size={16} />
                              </div>
                              <div className="item-content">
                                <div className="item-header">
                                  <div className="item-title-row">
                                    {getContentTypeIcon(analysis.contentType)}
                                    <h4>{item.title}</h4>
                                    {analysis.language && (
                                      <span className="language-badge">{analysis.language}</span>
                                    )}
                                    {analysis.framework && (
                                      <span className="framework-badge">{analysis.framework}</span>
                                    )}
                                  </div>
                                  <div className="item-badges">
                                    <span className="trained-badge shelf-badge">
                                      <CheckCircle size={12} />
                                      Learned
                                    </span>
                                    <span className="shelf-category-badge">
                                      {getItemCategory(item).toUpperCase()}
                                    </span>
                                  </div>
                                </div>
                                <p className="item-description">{item.description}</p>

                                {analysis.learningHighlights && analysis.learningHighlights.length > 0 && (
                                  <div className="item-analysis-summary">
                                    <span className="analysis-label">What was learned:</span>
                                    <span className="analysis-highlights">
                                      {analysis.learningHighlights.slice(0, 2).join(' • ')}
                                    </span>
                                  </div>
                                )}

                                {/* Expandable details — same as Library */}
                                {isExpanded && (
                                  <div className="item-analysis-details">
                                    <div className="analysis-stats">
                                      <span className="stat">
                                        <Hash size={12} />
                                        {analysis.stats?.lines || 0} lines
                                      </span>
                                      {analysis.stats?.functions > 0 && (
                                        <span className="stat">
                                          <Braces size={12} />
                                          {analysis.stats.functions} functions
                                        </span>
                                      )}
                                      {analysis.stats?.classes > 0 && (
                                        <span className="stat">
                                          <Layers size={12} />
                                          {analysis.stats.classes} classes
                                        </span>
                                      )}
                                      {analysis.stats?.codeBlocks > 0 && (
                                        <span className="stat">
                                          <Code size={12} />
                                          {analysis.stats.codeBlocks} code blocks
                                        </span>
                                      )}
                                    </div>

                                    {analysis.concepts && analysis.concepts.length > 0 && (
                                      <div className="analysis-section">
                                        <span className="section-label">Concepts learned:</span>
                                        <div className="tag-list">
                                          {analysis.concepts.map((concept, i) => (
                                            <span key={i} className="concept-tag">{concept}</span>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {analysis.codePatterns && analysis.codePatterns.length > 0 && (
                                      <div className="analysis-section">
                                        <span className="section-label">Code patterns:</span>
                                        <div className="tag-list">
                                          {analysis.codePatterns.map((pattern, i) => (
                                            <span key={i} className="pattern-tag">{pattern}</span>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {analysis.features && analysis.features.length > 0 && (
                                      <div className="analysis-section">
                                        <span className="section-label">Topics covered:</span>
                                        <div className="tag-list features">
                                          {analysis.features.slice(0, 6).map((feature, i) => (
                                            <span key={i} className="feature-tag">{feature}</span>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {analysis.learningHighlights && analysis.learningHighlights.length > 2 && (
                                      <div className="analysis-section">
                                        <span className="section-label">Full analysis:</span>
                                        <ul className="highlights-list">
                                          {analysis.learningHighlights.map((highlight, i) => (
                                            <li key={i}>{highlight}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                )}

                                <div className="item-meta">
                                  <span>{item.contentLength || item.content?.length || 0} characters</span>
                                  {item.fileName && <span>• {item.fileName}</span>}
                                  {item.trainedAt && <span>• Trained {new Date(item.trainedAt).toLocaleDateString()}</span>}
                                  <button
                                    className="expand-toggle"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleItemExpansion(item.id);
                                    }}
                                  >
                                    {isExpanded ? (
                                      <><ChevronUp size={14} /> Less</>
                                    ) : (
                                      <><ChevronDown size={14} /> Details</>
                                    )}
                                  </button>
                                </div>
                              </div>
                              <div className="item-actions">
                                <button
                                  className="btn-icon retrain"
                                  onClick={() => handleRetrain(item.id)}
                                  title="Relearn"
                                  disabled={isTraining}
                                >
                                  <RefreshCw size={16} />
                                </button>
                                <button
                                  className="btn-icon delete"
                                  onClick={() => setShowDeleteConfirm(item.id)}
                                  title="Delete from memory"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Retraining Progress on Shelf */}
              {trainingProgress.length > 0 && (
                <div className="training-progress">
                  <h4>Retraining Progress</h4>
                  {trainingProgress.map((progress, index) => (
                    <div key={progress.itemId || index} className={`progress-item ${progress.status || progress.type}`}>
                      {progress.status === 'training' && <RefreshCw size={14} className="spinning" />}
                      {progress.status === 'success' && <CheckCircle size={14} />}
                      {progress.status === 'error' && <XCircle size={14} />}
                      {progress.type === 'info' && <AlertCircle size={14} />}
                      {progress.type === 'complete' && <CheckCircle size={14} />}
                      {progress.title && <span className="progress-title">{progress.title}</span>}
                      <span className="progress-message">{progress.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
          {activeTab === 'library' && trainingItems.length > 0 && (
            <button
              className="btn-primary"
              onClick={handleTrain}
              disabled={selectedItems.size === 0 || isTraining}
            >
              {isTraining ? (
                <>
                  <RefreshCw size={16} className="spinning" />
                  Training...
                </>
              ) : (
                <>
                  <BookOpen size={16} />
                  Train Selected ({selectedItems.size})
                </>
              )}
            </button>
          )}
        </div>

        {/* Clear All Confirmation */}
        {showClearConfirm && (
          <div className="confirm-overlay">
            <div className="confirm-dialog">
              <AlertCircle size={48} className="warning-icon" />
              <h3>Clear All Training Data?</h3>
              <p>This will permanently delete all training items and wipe the agent's learned information. This action cannot be undone.</p>
              <div className="confirm-actions">
                <button className="btn-secondary" onClick={() => setShowClearConfirm(false)}>
                  Cancel
                </button>
                <button className="btn-danger" onClick={handleClearAll}>
                  Yes, Clear Everything
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Item Confirmation */}
        {showDeleteConfirm && (
          <div className="confirm-overlay">
            <div className="confirm-dialog">
              <AlertCircle size={48} className="warning-icon" />
              <h3>Delete Training Item?</h3>
              <p>This will permanently delete this training item. If it was trained, the learned data will be removed.</p>
              <div className="confirm-actions">
                <button className="btn-secondary" onClick={() => setShowDeleteConfirm(null)}>
                  Cancel
                </button>
                <button className="btn-danger" onClick={() => handleDeleteItem(showDeleteConfirm)}>
                  Yes, Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Chat Learnings Modal (Brain Knowledge) */}
        {showChatLearningsModal && (
          <ChatLearningsModal
            onClose={() => setShowChatLearningsModal(false)}
            onBrainCountChange={async () => {
              await loadBrainKnowledgeCount();
              await loadTrainingItemsFromDB();
            }}
          />
        )}
      </div>
    </div>
  );
}
