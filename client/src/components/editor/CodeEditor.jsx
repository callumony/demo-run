import { useRef, useEffect, useState, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { X, Circle, Code, Eye, Columns, Maximize2, RefreshCw, HardDrive } from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useSettings } from '../../contexts/SettingsContext';
import DriveFileViewer from './DriveFileViewer';
import omLogo from '../../assets/om.logo.png';
import './CodeEditor.css';

// Editor tab component
function EditorTab({ file, isActive, onSelect, onClose }) {
  return (
    <div
      className={`editor-tab ${isActive ? 'active' : ''} ${file.isDriveFile ? 'drive-tab' : ''}`}
      onClick={onSelect}
    >
      <span className="tab-name">
        {file.isDriveFile && <HardDrive size={10} className="drive-tab-icon" />}
        {file.isDirty && <Circle size={8} className="dirty-indicator" />}
        {file.name}
      </span>
      <button
        className="tab-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

// Check if file is previewable
function isPreviewable(fileName) {
  if (!fileName) return false;
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ['html', 'htm', 'svg', 'md', 'markdown'].includes(ext);
}

// Preview Panel Component
function PreviewPanel({ content, fileName, onRefresh }) {
  const iframeRef = useRef(null);
  const ext = fileName?.split('.').pop()?.toLowerCase();
  const isMarkdown = ['md', 'markdown'].includes(ext);
  const isSVG = ext === 'svg';

  // Generate preview content
  const previewContent = useMemo(() => {
    if (!content) return '';

    if (isMarkdown) {
      // Simple markdown to HTML conversion
      let html = content
        // Headers
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        // Bold and italic
        .replace(/\*\*\*(.*?)\*\*\*/gim, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/gim, '<em>$1</em>')
        // Code blocks
        .replace(/```(\w*)\n([\s\S]*?)```/gim, '<pre><code class="language-$1">$2</code></pre>')
        .replace(/`([^`]+)`/gim, '<code>$1</code>')
        // Links and images
        .replace(/!\[(.*?)\]\((.*?)\)/gim, '<img alt="$1" src="$2" style="max-width:100%"/>')
        .replace(/\[(.*?)\]\((.*?)\)/gim, '<a href="$2" target="_blank">$1</a>')
        // Lists
        .replace(/^\s*[-*+] (.*$)/gim, '<li>$1</li>')
        .replace(/(<li>.*<\/li>)\n(?=<li>)/gim, '$1')
        // Blockquotes
        .replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>')
        // Horizontal rules
        .replace(/^---$/gim, '<hr/>')
        // Line breaks
        .replace(/\n\n/gim, '</p><p>')
        .replace(/\n/gim, '<br/>');

      return `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            * { box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              line-height: 1.6;
              color: #e2e8f0;
              background: #13161d;
              padding: 24px;
              margin: 0;
            }
            h1, h2, h3, h4, h5, h6 { color: #f59e0b; margin-top: 24px; margin-bottom: 16px; }
            h1 { font-size: 2em; border-bottom: 1px solid #333; padding-bottom: 8px; }
            h2 { font-size: 1.5em; }
            h3 { font-size: 1.25em; }
            a { color: #818cf8; text-decoration: none; }
            a:hover { text-decoration: underline; }
            code {
              background: rgba(99, 102, 241, 0.15);
              padding: 2px 6px;
              border-radius: 4px;
              font-family: 'Fira Code', Consolas, monospace;
              font-size: 0.9em;
            }
            pre {
              background: rgba(0, 0, 0, 0.4);
              padding: 16px;
              border-radius: 8px;
              overflow-x: auto;
            }
            pre code { background: none; padding: 0; }
            blockquote {
              border-left: 4px solid #f59e0b;
              margin: 16px 0;
              padding: 8px 16px;
              background: rgba(245, 158, 11, 0.1);
              color: #94a3b8;
            }
            li { margin: 4px 0; }
            hr { border: none; border-top: 1px solid #333; margin: 24px 0; }
            img { border-radius: 8px; }
            p { margin: 16px 0; }
          </style>
        </head>
        <body><p>${html}</p></body>
        </html>
      `;
    }

    if (isSVG) {
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background: #13161d;
              background-image:
                linear-gradient(45deg, #1a1d27 25%, transparent 25%),
                linear-gradient(-45deg, #1a1d27 25%, transparent 25%),
                linear-gradient(45deg, transparent 75%, #1a1d27 75%),
                linear-gradient(-45deg, transparent 75%, #1a1d27 75%);
              background-size: 20px 20px;
              background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
            }
            svg { max-width: 90%; max-height: 90vh; }
          </style>
        </head>
        <body>${content}</body>
        </html>
      `;
    }

    // HTML - inject base styling for better preview
    return content.includes('<html') ? content : `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 16px;
          }
        </style>
      </head>
      <body>${content}</body>
      </html>
    `;
  }, [content, isMarkdown, isSVG]);

  // Update iframe content
  useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(previewContent);
        doc.close();
      }
    }
  }, [previewContent]);

  return (
    <div className="preview-panel">
      <div className="preview-header">
        <div className="preview-header-left">
          <Eye size={14} />
          <span>Preview</span>
          {isMarkdown && <span className="preview-badge">Markdown</span>}
          {isSVG && <span className="preview-badge">SVG</span>}
        </div>
        <button className="preview-refresh-btn" onClick={onRefresh} title="Refresh Preview">
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="preview-content">
        <iframe
          ref={iframeRef}
          title="Preview"
          sandbox="allow-scripts allow-same-origin"
          className="preview-iframe"
        />
      </div>
    </div>
  );
}

// View mode toggle component
function ViewModeToggle({ mode, onChange, isPreviewable }) {
  return (
    <div className="view-mode-toggle">
      <button
        className={`view-mode-btn ${mode === 'editor' ? 'active' : ''}`}
        onClick={() => onChange('editor')}
        title="Editor Only"
      >
        <Code size={14} />
      </button>
      <button
        className={`view-mode-btn ${mode === 'split' ? 'active' : ''}`}
        onClick={() => onChange('split')}
        title="Split View"
        disabled={!isPreviewable}
      >
        <Columns size={14} />
      </button>
      <button
        className={`view-mode-btn ${mode === 'preview' ? 'active' : ''}`}
        onClick={() => onChange('preview')}
        title="Preview Only"
        disabled={!isPreviewable}
      >
        <Eye size={14} />
      </button>
    </div>
  );
}

export default function CodeEditor() {
  const editorRef = useRef(null);
  const { openFiles, activeFile, setActiveFile, closeFile, updateFileContent, saveFile } = useWorkspace();
  const { settings } = useSettings();
  const [viewMode, setViewMode] = useState('editor'); // 'editor', 'split', 'preview'
  const [previewKey, setPreviewKey] = useState(0); // For forcing preview refresh

  const activeFileData = openFiles.find(f => f.path === activeFile);
  const canPreview = isPreviewable(activeFileData?.name);

  // Reset to editor mode if file is not previewable
  useEffect(() => {
    if (!canPreview && viewMode !== 'editor') {
      setViewMode('editor');
    }
  }, [canPreview, activeFile]);

  // Refresh preview
  const handleRefreshPreview = () => {
    setPreviewKey(prev => prev + 1);
  };

  // Handle editor mount
  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;

    // Define custom dark theme with enhanced syntax highlighting
    monaco.editor.defineTheme('omnipotent-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        // Default text - brighter for readability
        { token: '', foreground: 'E2E8F0' },

        // Comments
        { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
        { token: 'comment.block', foreground: '6A9955', fontStyle: 'italic' },

        // Keywords
        { token: 'keyword', foreground: 'C586C0', fontStyle: 'bold' },
        { token: 'keyword.control', foreground: 'C586C0' },
        { token: 'keyword.operator', foreground: 'C586C0' },

        // Strings
        { token: 'string', foreground: 'CE9178' },
        { token: 'string.escape', foreground: 'D7BA7D' },

        // Numbers
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'number.float', foreground: 'B5CEA8' },
        { token: 'number.hex', foreground: 'B5CEA8' },

        // Functions
        { token: 'function', foreground: 'DCDCAA' },
        { token: 'function.call', foreground: 'DCDCAA' },

        // Variables
        { token: 'variable', foreground: '9CDCFE' },
        { token: 'variable.parameter', foreground: '9CDCFE' },
        { token: 'variable.predefined', foreground: '4FC1FF' },
        { token: 'identifier', foreground: '9CDCFE' },

        // Types & Classes
        { token: 'type', foreground: '4EC9B0' },
        { token: 'class', foreground: '4EC9B0' },
        { token: 'interface', foreground: '4EC9B0' },
        { token: 'struct', foreground: '4EC9B0' },
        { token: 'enum', foreground: '4EC9B0' },

        // Operators - brighter
        { token: 'operator', foreground: 'E2E8F0' },
        { token: 'delimiter', foreground: 'E2E8F0' },

        // Tags (HTML/XML)
        { token: 'tag', foreground: '569CD6' },
        { token: 'tag.attribute', foreground: '9CDCFE' },
        { token: 'attribute.name', foreground: '9CDCFE' },
        { token: 'attribute.value', foreground: 'CE9178' },

        // Regex
        { token: 'regexp', foreground: 'D16969' },

        // Decorators/Annotations
        { token: 'annotation', foreground: 'DCDCAA' },
        { token: 'decorator', foreground: 'DCDCAA' },

        // Constants
        { token: 'constant', foreground: '4FC1FF' },
        { token: 'constant.language', foreground: '569CD6' },

        // Lua specific
        { token: 'keyword.function', foreground: 'C586C0', fontStyle: 'bold' },
        { token: 'keyword.local', foreground: '569CD6' },
        { token: 'keyword.return', foreground: 'C586C0' },
        { token: 'keyword.if', foreground: 'C586C0' },
        { token: 'keyword.then', foreground: 'C586C0' },
        { token: 'keyword.else', foreground: 'C586C0' },
        { token: 'keyword.elseif', foreground: 'C586C0' },
        { token: 'keyword.end', foreground: 'C586C0' },
        { token: 'keyword.for', foreground: 'C586C0' },
        { token: 'keyword.while', foreground: 'C586C0' },
        { token: 'keyword.do', foreground: 'C586C0' },
        { token: 'keyword.repeat', foreground: 'C586C0' },
        { token: 'keyword.until', foreground: 'C586C0' },
        { token: 'keyword.and', foreground: 'C586C0' },
        { token: 'keyword.or', foreground: 'C586C0' },
        { token: 'keyword.not', foreground: 'C586C0' },
        { token: 'keyword.nil', foreground: '569CD6' },
        { token: 'keyword.true', foreground: '569CD6' },
        { token: 'keyword.false', foreground: '569CD6' },
      ],
      colors: {
        'editor.background': '#13161d',
        'editor.foreground': '#E2E8F0',
        'editor.lineHighlightBackground': '#1e2130',
        'editor.selectionBackground': '#264F78',
        'editor.inactiveSelectionBackground': '#3A3D41',
        'editorLineNumber.foreground': '#4e5366',
        'editorLineNumber.activeForeground': '#C6C6C6',
        'editorCursor.foreground': '#f59e0b',
        'editor.findMatchBackground': '#515C6A',
        'editor.findMatchHighlightBackground': '#EA5C0055',
        'editorBracketMatch.background': '#0064001a',
        'editorBracketMatch.border': '#888888',
        'editorIndentGuide.background': '#404040',
        'editorIndentGuide.activeBackground': '#707070',
        'editorWhitespace.foreground': '#3B4048',
        'editorRuler.foreground': '#333333',
        'scrollbarSlider.background': '#f59e0b33',
        'scrollbarSlider.hoverBackground': '#f59e0b55',
        'scrollbarSlider.activeBackground': '#f59e0b77',
      }
    });

    // Define custom light theme
    monaco.editor.defineTheme('omnipotent-light', {
      base: 'vs',
      inherit: true,
      rules: [
        // Comments
        { token: 'comment', foreground: '008000', fontStyle: 'italic' },
        { token: 'comment.block', foreground: '008000', fontStyle: 'italic' },

        // Keywords
        { token: 'keyword', foreground: 'AF00DB', fontStyle: 'bold' },
        { token: 'keyword.control', foreground: 'AF00DB' },
        { token: 'keyword.operator', foreground: 'AF00DB' },

        // Strings
        { token: 'string', foreground: 'A31515' },
        { token: 'string.escape', foreground: 'FF0000' },

        // Numbers
        { token: 'number', foreground: '098658' },
        { token: 'number.float', foreground: '098658' },
        { token: 'number.hex', foreground: '098658' },

        // Functions
        { token: 'function', foreground: '795E26' },
        { token: 'function.call', foreground: '795E26' },

        // Variables
        { token: 'variable', foreground: '001080' },
        { token: 'variable.parameter', foreground: '001080' },
        { token: 'variable.predefined', foreground: '0070C1' },
        { token: 'identifier', foreground: '001080' },

        // Types & Classes
        { token: 'type', foreground: '267F99' },
        { token: 'class', foreground: '267F99' },
        { token: 'interface', foreground: '267F99' },

        // Tags
        { token: 'tag', foreground: '800000' },
        { token: 'attribute.name', foreground: 'FF0000' },
        { token: 'attribute.value', foreground: '0000FF' },

        // Lua specific
        { token: 'keyword.function', foreground: 'AF00DB', fontStyle: 'bold' },
        { token: 'keyword.local', foreground: '0000FF' },
        { token: 'keyword.nil', foreground: '0000FF' },
        { token: 'keyword.true', foreground: '0000FF' },
        { token: 'keyword.false', foreground: '0000FF' },
      ],
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#000000',
        'editor.lineHighlightBackground': '#f5f5f5',
        'editorCursor.foreground': '#d97706',
        'scrollbarSlider.background': '#d9770633',
        'scrollbarSlider.hoverBackground': '#d9770655',
        'scrollbarSlider.activeBackground': '#d9770677',
      }
    });

    // Register Lua language with enhanced tokenizer if not already registered
    if (!monaco.languages.getLanguages().some(l => l.id === 'lua')) {
      monaco.languages.register({ id: 'lua' });
      monaco.languages.setMonarchTokensProvider('lua', {
        defaultToken: '',
        tokenPostfix: '.lua',
        keywords: [
          'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for',
          'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or',
          'repeat', 'return', 'then', 'true', 'until', 'while'
        ],
        builtins: [
          // Lua standard library
          'print', 'tostring', 'tonumber', 'type', 'pairs', 'ipairs', 'next',
          'select', 'unpack', 'pack', 'rawget', 'rawset', 'rawequal', 'rawlen',
          'setmetatable', 'getmetatable', 'error', 'assert', 'pcall', 'xpcall',
          'load', 'loadfile', 'dofile', 'require', 'collectgarbage',
          // String functions
          'string', 'byte', 'char', 'dump', 'find', 'format', 'gmatch', 'gsub',
          'len', 'lower', 'match', 'rep', 'reverse', 'sub', 'upper',
          // Table functions
          'table', 'concat', 'insert', 'move', 'remove', 'sort',
          // Math functions
          'math', 'abs', 'acos', 'asin', 'atan', 'ceil', 'cos', 'deg', 'exp',
          'floor', 'fmod', 'huge', 'log', 'max', 'min', 'modf', 'pi', 'rad',
          'random', 'randomseed', 'sin', 'sqrt', 'tan',
          // FiveM/RedM natives & functions
          'Citizen', 'CreateThread', 'Wait', 'SetTimeout', 'RegisterCommand',
          'RegisterNetEvent', 'AddEventHandler', 'TriggerEvent', 'TriggerServerEvent',
          'TriggerClientEvent', 'RegisterServerEvent', 'RegisterNUICallback',
          'SendNUIMessage', 'SetNuiFocus', 'GetPlayerServerId', 'GetPlayerPed',
          'GetEntityCoords', 'GetEntityHeading', 'GetHashKey', 'LoadModel',
          'RequestModel', 'HasModelLoaded', 'CreatePed', 'CreateVehicle', 'CreateObject',
          'DeleteEntity', 'SetEntityCoords', 'SetEntityHeading', 'SetPedComponentVariation',
          'TaskWarpPedIntoVehicle', 'TaskEnterVehicle', 'TaskLeaveVehicle',
          'NetworkGetEntityOwner', 'NetworkGetNetworkIdFromEntity', 'NetworkGetEntityFromNetworkId',
          'DoesEntityExist', 'IsEntityDead', 'IsPedInAnyVehicle', 'GetVehiclePedIsIn',
          'ESX', 'QBCore', 'ox_lib', 'ox_inventory', 'exports', 'json'
        ],
        brackets: [
          { open: '{', close: '}', token: 'delimiter.curly' },
          { open: '[', close: ']', token: 'delimiter.bracket' },
          { open: '(', close: ')', token: 'delimiter.parenthesis' }
        ],
        operators: ['+', '-', '*', '/', '%', '^', '#', '==', '~=', '<=', '>=', '<', '>', '=', ';', ':', ',', '.', '..', '...'],
        tokenizer: {
          root: [
            // Function calls (identifier followed by parenthesis)
            [/([a-zA-Z_]\w*)(\s*)(\()/, ['function.call', '', 'delimiter.parenthesis']],
            // Identifiers and keywords
            [/[a-zA-Z_]\w*/, {
              cases: {
                '@keywords': { token: 'keyword.$0' },
                '@builtins': { token: 'variable.predefined' },
                '@default': 'identifier'
              }
            }],
            { include: '@whitespace' },
            [/[{}()\[\]]/, '@brackets'],
            [/[<>](?!@symbols)/, '@brackets'],
            // Numbers
            [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
            [/0[xX][0-9a-fA-F]+/, 'number.hex'],
            [/\d+/, 'number'],
            // Strings
            [/"([^"\\]|\\.)*$/, 'string.invalid'],
            [/'([^'\\]|\\.)*$/, 'string.invalid'],
            [/\[\[/, 'string', '@string_block'],
            [/"/, 'string', '@string_double'],
            [/'/, 'string', '@string_single'],
          ],
          whitespace: [
            [/[ \t\r\n]+/, ''],
            [/--\[([=]*)\[/, 'comment', '@comment.$1'],
            [/--.*$/, 'comment'],
          ],
          comment: [
            [/[^\]]+/, 'comment'],
            [/\]([=]*)\]/, {
              cases: {
                '$1==$S2': { token: 'comment', next: '@pop' },
                '@default': 'comment'
              }
            }],
            [/./, 'comment']
          ],
          string_double: [
            [/[^\\"]+/, 'string'],
            [/\\./, 'string.escape'],
            [/"/, 'string', '@pop']
          ],
          string_single: [
            [/[^\\']+/, 'string'],
            [/\\./, 'string.escape'],
            [/'/, 'string', '@pop']
          ],
          string_block: [
            [/[^\]]+/, 'string'],
            [/\]\]/, 'string', '@pop'],
            [/./, 'string']
          ],
        }
      });

      // Register Lua completion provider for FiveM/RedM
      monaco.languages.registerCompletionItemProvider('lua', {
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn
          };

          const fivemSuggestions = [
            // Core FiveM functions
            { label: 'CreateThread', kind: monaco.languages.CompletionItemKind.Function, insertText: 'CreateThread(function()\n\t${1}\nend)', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: 'Creates a new Citizen thread' },
            { label: 'Wait', kind: monaco.languages.CompletionItemKind.Function, insertText: 'Wait(${1:0})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: 'Pauses the current thread for specified milliseconds' },
            { label: 'RegisterCommand', kind: monaco.languages.CompletionItemKind.Function, insertText: 'RegisterCommand("${1:command}", function(source, args, rawCommand)\n\t${2}\nend, ${3:false})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: 'Registers a chat command' },
            { label: 'RegisterNetEvent', kind: monaco.languages.CompletionItemKind.Function, insertText: 'RegisterNetEvent("${1:eventName}", function(${2})\n\t${3}\nend)', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: 'Registers a network event' },
            { label: 'TriggerServerEvent', kind: monaco.languages.CompletionItemKind.Function, insertText: 'TriggerServerEvent("${1:eventName}"${2})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: 'Triggers an event on the server' },
            { label: 'TriggerClientEvent', kind: monaco.languages.CompletionItemKind.Function, insertText: 'TriggerClientEvent("${1:eventName}", ${2:source}${3})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: 'Triggers an event on a client' },
            { label: 'TriggerEvent', kind: monaco.languages.CompletionItemKind.Function, insertText: 'TriggerEvent("${1:eventName}"${2})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: 'Triggers a local event' },
            { label: 'GetPlayerPed', kind: monaco.languages.CompletionItemKind.Function, insertText: 'GetPlayerPed(${1:-1})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: 'Gets the ped for a player' },
            { label: 'GetEntityCoords', kind: monaco.languages.CompletionItemKind.Function, insertText: 'GetEntityCoords(${1:entity})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: 'Gets entity coordinates' },
            { label: 'SendNUIMessage', kind: monaco.languages.CompletionItemKind.Function, insertText: 'SendNUIMessage({\n\t${1}\n})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: 'Sends a message to the NUI frame' },
            { label: 'SetNuiFocus', kind: monaco.languages.CompletionItemKind.Function, insertText: 'SetNuiFocus(${1:true}, ${2:true})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: 'Sets NUI focus and cursor' },
            { label: 'RegisterNUICallback', kind: monaco.languages.CompletionItemKind.Function, insertText: 'RegisterNUICallback("${1:type}", function(data, cb)\n\t${2}\n\tcb("ok")\nend)', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: 'Registers a NUI callback' },
            { label: 'exports', kind: monaco.languages.CompletionItemKind.Variable, insertText: 'exports["${1:resourceName}"]:${2:functionName}(${3})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: 'Calls an exported function from another resource' },
          ];

          return {
            suggestions: fivemSuggestions.map(s => ({ ...s, range }))
          };
        }
      });
    }

    // Add keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (activeFile) {
        saveFile(activeFile);
      }
    });
  };

  // Get language from file extension - supports all major programming languages
  const getLanguage = (fileName) => {
    if (!fileName) return 'plaintext';
    const ext = fileName.split('.').pop()?.toLowerCase();
    const languageMap = {
      // Lua (FiveM/RedM)
      'lua': 'lua',

      // JavaScript ecosystem
      'js': 'javascript',
      'jsx': 'javascript',
      'mjs': 'javascript',
      'cjs': 'javascript',

      // TypeScript ecosystem
      'ts': 'typescript',
      'tsx': 'typescript',
      'mts': 'typescript',
      'cts': 'typescript',

      // Web technologies
      'html': 'html',
      'htm': 'html',
      'xhtml': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'scss',
      'less': 'less',

      // Data formats
      'json': 'json',
      'jsonc': 'json',
      'xml': 'xml',
      'svg': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'ini',
      'ini': 'ini',
      'cfg': 'ini',
      'conf': 'ini',

      // Markdown & Documentation
      'md': 'markdown',
      'mdx': 'markdown',
      'rst': 'restructuredtext',

      // Python
      'py': 'python',
      'pyw': 'python',
      'pyx': 'python',
      'pyi': 'python',

      // C/C++
      'c': 'c',
      'h': 'c',
      'cpp': 'cpp',
      'cc': 'cpp',
      'cxx': 'cpp',
      'hpp': 'cpp',
      'hxx': 'cpp',
      'hh': 'cpp',

      // C#
      'cs': 'csharp',
      'csx': 'csharp',

      // Java
      'java': 'java',

      // Kotlin
      'kt': 'kotlin',
      'kts': 'kotlin',

      // Swift
      'swift': 'swift',

      // Go
      'go': 'go',

      // Rust
      'rs': 'rust',

      // Ruby
      'rb': 'ruby',
      'erb': 'ruby',
      'rake': 'ruby',
      'gemspec': 'ruby',

      // PHP
      'php': 'php',
      'phtml': 'php',
      'php3': 'php',
      'php4': 'php',
      'php5': 'php',
      'phps': 'php',

      // Shell/Bash
      'sh': 'shell',
      'bash': 'shell',
      'zsh': 'shell',
      'fish': 'shell',

      // PowerShell
      'ps1': 'powershell',
      'psm1': 'powershell',
      'psd1': 'powershell',

      // Batch
      'bat': 'bat',
      'cmd': 'bat',

      // SQL
      'sql': 'sql',
      'mysql': 'sql',
      'pgsql': 'sql',

      // GraphQL
      'graphql': 'graphql',
      'gql': 'graphql',

      // Dockerfile
      'dockerfile': 'dockerfile',

      // Perl
      'pl': 'perl',
      'pm': 'perl',

      // R
      'r': 'r',
      'R': 'r',

      // Scala
      'scala': 'scala',
      'sc': 'scala',

      // Clojure
      'clj': 'clojure',
      'cljs': 'clojure',
      'cljc': 'clojure',
      'edn': 'clojure',

      // F#
      'fs': 'fsharp',
      'fsi': 'fsharp',
      'fsx': 'fsharp',

      // Haskell
      'hs': 'haskell',
      'lhs': 'haskell',

      // Elixir
      'ex': 'elixir',
      'exs': 'elixir',

      // Objective-C
      'm': 'objective-c',
      'mm': 'objective-c',

      // Assembly
      'asm': 'asm',
      's': 'asm',

      // Dart
      'dart': 'dart',

      // Vue
      'vue': 'vue',

      // Svelte
      'svelte': 'svelte',

      // Handlebars
      'hbs': 'handlebars',
      'handlebars': 'handlebars',

      // Pug/Jade
      'pug': 'pug',
      'jade': 'pug',

      // Diff/Patch
      'diff': 'diff',
      'patch': 'diff',

      // Log files
      'log': 'log',

      // Plain text
      'txt': 'plaintext',
      'text': 'plaintext'
    };

    return languageMap[ext] || 'plaintext';
  };

  return (
    <div className={`code-editor-container ${activeFileData ? 'has-file-open' : ''}`}>
      {/* Editor Tabs Bar */}
      {openFiles.length > 0 && (
        <div className="editor-tabs-bar">
          <div className="editor-tabs">
            {openFiles.map(file => (
              <EditorTab
                key={file.path}
                file={file}
                isActive={file.path === activeFile}
                onSelect={() => setActiveFile(file.path)}
                onClose={() => closeFile(file.path)}
              />
            ))}
          </div>
          {activeFileData && (
            <ViewModeToggle
              mode={viewMode}
              onChange={setViewMode}
              isPreviewable={canPreview}
            />
          )}
        </div>
      )}

      {/* Editor Content */}
      <div className={`editor-content-wrapper view-${viewMode}`}>
        {activeFileData ? (
          activeFileData.isDriveFile ? (
            /* Drive File Viewer — renders documents, spreadsheets, PDFs, etc. */
            <DriveFileViewer file={activeFileData} />
          ) : (
          <>
            {/* Editor Pane */}
            {(viewMode === 'editor' || viewMode === 'split') && (
              <div className="editor-pane">
                <Editor
                  height="100%"
                  language={getLanguage(activeFileData.name)}
                  value={activeFileData.content}
                  theme={settings.theme === 'light' ? 'omnipotent-light' : 'omnipotent-dark'}
                  onChange={(value) => updateFileContent(activeFile, value || '')}
                  onMount={handleEditorMount}
                  options={{
                    fontSize: settings.fontSize || 14,
                    tabSize: settings.tabSize || 4,
                    minimap: { enabled: false },
                    wordWrap: settings.wordWrap || 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    lineNumbers: 'on',
                    renderLineHighlight: 'all',
                    cursorBlinking: 'smooth',
                    cursorSmoothCaretAnimation: 'on',
                    smoothScrolling: true,
                    padding: { top: 16 },
                    fontFamily: "'Fira Code', Consolas, 'Courier New', monospace",
                    fontLigatures: true
                  }}
                />
              </div>
            )}

            {/* Preview Pane */}
            {(viewMode === 'preview' || viewMode === 'split') && canPreview && (
              <PreviewPanel
                key={previewKey}
                content={activeFileData.content}
                fileName={activeFileData.name}
                onRefresh={handleRefreshPreview}
              />
            )}

            {/* Not Previewable Message */}
            {(viewMode === 'preview' || viewMode === 'split') && !canPreview && (
              <div className="preview-not-available">
                <Eye size={32} />
                <p>Preview not available for this file type</p>
                <span>Preview supports: HTML, SVG, Markdown</span>
              </div>
            )}
          </>
          )
        ) : (
          <div className="editor-empty">
            <div className="editor-empty-content">
              <img src={omLogo} alt="OMNIPOTENT" className="welcome-logo" />
              <p className="powered-by-text">
                DEVELOPED BY <a href="https://www.om.agency" target="_blank" rel="noopener noreferrer"><strong>ONYMOUS MEDIA MARKETING</strong></a>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
