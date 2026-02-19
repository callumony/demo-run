// ═══════════════════════════════════════════════════════════════════════════════
// COMPANY CHATBOT - EMBEDDABLE WIDGET LOADER
// Include this script on any website to add the chatbot
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';
  
  // Configuration - update these values
  const CONFIG = {
    apiUrl: 'http://localhost:3001', // Change to your production URL
    position: 'bottom-right',         // bottom-right, bottom-left
    zIndex: 9999
  };
  
  // Create container
  const container = document.createElement('div');
  container.id = 'company-chatbot-widget';
  container.style.cssText = `
    position: fixed;
    ${CONFIG.position.includes('right') ? 'right: 24px' : 'left: 24px'};
    bottom: 24px;
    z-index: ${CONFIG.zIndex};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  // Widget HTML
  container.innerHTML = `
    <style>
      #ccb-button {
        width: 60px;
        height: 60px;
        border-radius: 16px;
        background: linear-gradient(135deg, #8B5CF6, #6366F1);
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 8px 32px rgba(99, 102, 241, 0.4);
        transition: transform 0.2s, box-shadow 0.2s;
      }
      #ccb-button:hover {
        transform: scale(1.05);
        box-shadow: 0 12px 40px rgba(99, 102, 241, 0.5);
      }
      #ccb-button svg {
        width: 28px;
        height: 28px;
        fill: white;
      }
      #ccb-window {
        display: none;
        width: 380px;
        height: 560px;
        background: #0A0A0B;
        border-radius: 20px;
        box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
        overflow: hidden;
        flex-direction: column;
        border: 1px solid rgba(255,255,255,0.1);
      }
      #ccb-window.open {
        display: flex;
      }
      #ccb-header {
        padding: 16px 20px;
        background: #18181B;
        border-bottom: 1px solid rgba(255,255,255,0.1);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      #ccb-header-info {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      #ccb-avatar {
        width: 40px;
        height: 40px;
        border-radius: 12px;
        background: linear-gradient(135deg, #8B5CF6, #6366F1);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #ccb-avatar svg {
        width: 20px;
        height: 20px;
        fill: white;
      }
      #ccb-title {
        font-weight: 600;
        color: white;
        font-size: 14px;
      }
      #ccb-subtitle {
        font-size: 12px;
        color: #71717A;
      }
      #ccb-close {
        background: none;
        border: none;
        color: #71717A;
        cursor: pointer;
        padding: 8px;
        border-radius: 8px;
        transition: background 0.2s;
      }
      #ccb-close:hover {
        background: rgba(255,255,255,0.1);
        color: white;
      }
      #ccb-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .ccb-message {
        max-width: 85%;
        padding: 12px 16px;
        border-radius: 16px;
        font-size: 14px;
        line-height: 1.5;
        animation: ccb-fade-in 0.3s ease;
      }
      @keyframes ccb-fade-in {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .ccb-message.bot {
        background: #27272A;
        color: #FAFAFA;
        border-bottom-left-radius: 4px;
        align-self: flex-start;
      }
      .ccb-message.user {
        background: linear-gradient(135deg, #8B5CF6, #6366F1);
        color: white;
        border-bottom-right-radius: 4px;
        align-self: flex-end;
      }
      #ccb-typing {
        display: none;
        align-self: flex-start;
        background: #27272A;
        padding: 12px 16px;
        border-radius: 16px;
        border-bottom-left-radius: 4px;
      }
      #ccb-typing.show {
        display: flex;
        gap: 4px;
      }
      .ccb-dot {
        width: 8px;
        height: 8px;
        background: #8B5CF6;
        border-radius: 50%;
        animation: ccb-bounce 1s infinite;
      }
      .ccb-dot:nth-child(2) { animation-delay: 0.1s; }
      .ccb-dot:nth-child(3) { animation-delay: 0.2s; }
      @keyframes ccb-bounce {
        0%, 60%, 100% { transform: translateY(0); }
        30% { transform: translateY(-6px); }
      }
      #ccb-input-area {
        padding: 16px;
        background: #18181B;
        border-top: 1px solid rgba(255,255,255,0.1);
        display: flex;
        gap: 8px;
      }
      #ccb-input {
        flex: 1;
        background: #27272A;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        padding: 12px 16px;
        color: white;
        font-size: 14px;
        outline: none;
        transition: border-color 0.2s;
      }
      #ccb-input:focus {
        border-color: #8B5CF6;
      }
      #ccb-input::placeholder {
        color: #52525B;
      }
      #ccb-send {
        width: 48px;
        height: 48px;
        border-radius: 12px;
        background: linear-gradient(135deg, #8B5CF6, #6366F1);
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.2s;
      }
      #ccb-send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      #ccb-send svg {
        width: 20px;
        height: 20px;
        fill: white;
      }
    </style>
    
    <button id="ccb-button">
      <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
    </button>
    
    <div id="ccb-window">
      <div id="ccb-header">
        <div id="ccb-header-info">
          <div id="ccb-avatar">
            <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
          </div>
          <div>
            <div id="ccb-title">AI Assistant</div>
            <div id="ccb-subtitle">Ask me anything</div>
          </div>
        </div>
        <button id="ccb-close">✕</button>
      </div>
      
      <div id="ccb-messages">
        <div class="ccb-message bot">Hello! How can I help you today?</div>
      </div>
      
      <div id="ccb-typing">
        <div class="ccb-dot"></div>
        <div class="ccb-dot"></div>
        <div class="ccb-dot"></div>
      </div>
      
      <div id="ccb-input-area">
        <input id="ccb-input" type="text" placeholder="Type your message...">
        <button id="ccb-send">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(container);
  
  // Get elements
  const button = document.getElementById('ccb-button');
  const window = document.getElementById('ccb-window');
  const closeBtn = document.getElementById('ccb-close');
  const messages = document.getElementById('ccb-messages');
  const input = document.getElementById('ccb-input');
  const sendBtn = document.getElementById('ccb-send');
  const typing = document.getElementById('ccb-typing');
  
  let history = [];
  
  // Toggle window
  button.addEventListener('click', () => {
    window.classList.add('open');
    button.style.display = 'none';
    input.focus();
  });
  
  closeBtn.addEventListener('click', () => {
    window.classList.remove('open');
    button.style.display = 'flex';
  });
  
  // Send message
  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    
    // Add user message
    addMessage(text, 'user');
    input.value = '';
    sendBtn.disabled = true;
    typing.classList.add('show');
    
    try {
      const response = await fetch(`${CONFIG.apiUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationHistory: history.slice(-10)
        })
      });
      
      const data = await response.json();
      typing.classList.remove('show');
      
      if (data.message) {
        addMessage(data.message, 'bot');
        history.push({ role: 'user', content: text });
        history.push({ role: 'assistant', content: data.message });
      }
    } catch (error) {
      typing.classList.remove('show');
      addMessage('Sorry, I encountered an error. Please try again.', 'bot');
    }
    
    sendBtn.disabled = false;
  }
  
  function addMessage(text, type) {
    const msg = document.createElement('div');
    msg.className = `ccb-message ${type}`;
    msg.textContent = text;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
  }
  
  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  
  // Load config from API
  fetch(`${CONFIG.apiUrl}/api/config`)
    .then(res => res.json())
    .then(config => {
      document.getElementById('ccb-title').textContent = config.botName || 'AI Assistant';
      document.getElementById('ccb-subtitle').textContent = config.companyName || 'Ask me anything';
    })
    .catch(() => {});
    
})();
