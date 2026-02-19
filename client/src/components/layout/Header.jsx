import { useState } from 'react';
import {
  Menu,
  FileText,
  Save,
  FolderOpen,
  Download,
  Upload,
  Settings,
  Shield,
  Search,
  Play,
  Package,
  AlertTriangle,
  HelpCircle,
  ChevronDown,
  GraduationCap,
  Database,
  RefreshCw,
  Coffee
} from 'lucide-react';
import './Header.css';

export default function Header({ onOpenSettings, onOpenTraining, onMenuAction, breakActive, connectionStatus, logoUrl }) {
  const [activeMenu, setActiveMenu] = useState(null);

  const menuItems = {
    file: [
      { label: 'New File', icon: FileText, action: 'newFile', shortcut: 'Ctrl+N' },
      { label: 'Open File', icon: FolderOpen, action: 'openFile', shortcut: 'Ctrl+O' },
      { label: 'Save', icon: Save, action: 'save', shortcut: 'Ctrl+S' },
      { label: 'Save All', icon: Save, action: 'saveAll', shortcut: 'Ctrl+Shift+S' },
      { type: 'divider' },
      { label: 'Import Settings...', icon: Upload, action: 'import' },
      { label: 'Export Settings...', icon: Download, action: 'export' },
    ],
    tools: [
      { label: 'Syntax Check', icon: AlertTriangle, action: 'syntaxCheck', shortcut: 'F7' },
      { label: 'Security Check', icon: Shield, action: 'securityCheck' },
      { label: 'Code Review', icon: Search, action: 'codeReview' },
      { type: 'divider' },
      { label: 'Run Script', icon: Play, action: 'runScript', shortcut: 'F5' },
    ]
  };

  const handleMenuClick = (menuName) => {
    setActiveMenu(activeMenu === menuName ? null : menuName);
  };

  const handleItemClick = (action) => {
    setActiveMenu(null);
    onMenuAction?.(action);
  };

  const handleClickOutside = () => {
    setActiveMenu(null);
  };

  return (
    <header className="ide-header">
      <div className="header-left">
        <div className="logo">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="header-logo-img" />
          ) : (
            <span className="logo-text">OMNIPOTENT</span>
          )}
        </div>

        <nav className="menu-bar">
          {Object.entries(menuItems).map(([menuName, items]) => (
            <div key={menuName} className="menu-item-container">
              <button
                className={`menu-button ${activeMenu === menuName ? 'active' : ''}`}
                onClick={() => handleMenuClick(menuName)}
              >
                {menuName.charAt(0).toUpperCase() + menuName.slice(1)}
                <ChevronDown size={14} />
              </button>

              {activeMenu === menuName && (
                <>
                  <div className="menu-backdrop" onClick={handleClickOutside} />
                  <div className="menu-dropdown">
                    {items.map((item, index) => (
                      item.type === 'divider' ? (
                        <div key={index} className="menu-divider" />
                      ) : (
                        <button
                          key={item.action}
                          className="menu-dropdown-item"
                          onClick={() => handleItemClick(item.action)}
                        >
                          <item.icon size={16} />
                          <span>{item.label}</span>
                          {item.shortcut && (
                            <span className="menu-shortcut">{item.shortcut}</span>
                          )}
                        </button>
                      )
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
          <div className="menu-item-container">
            <button
              className="menu-button train-button"
              onClick={onOpenTraining}
            >
              <GraduationCap size={16} />
              Train
            </button>
          </div>
          {breakActive && (
            <div className="menu-item-container">
              <span className="break-badge">
                <Coffee size={16} />
                BREAK
              </span>
            </div>
          )}
        </nav>
      </div>

      <div className="header-right">
        <div className="header-status-icons">
          <span
            className={`db-status-dot ${connectionStatus === 'connected' ? 'online' : 'offline'}`}
            title={connectionStatus === 'connected' ? 'Database: Connected' : 'Database: Disconnected'}
          >
            <Database size={14} />
          </span>
          <button
            className="header-action-btn reconnect-btn"
            onClick={() => onMenuAction?.('reconnect')}
            title="Reconnect"
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <button className="header-action-btn" onClick={onOpenSettings} title="Settings">
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}
