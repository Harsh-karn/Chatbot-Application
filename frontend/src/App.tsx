import React, { useState, useEffect } from 'react';
import { Sidebar, Conversation } from './components/Sidebar.tsx';
import { ChatWindow, Message } from './components/ChatWindow.tsx';
import { Dashboard } from './components/Dashboard.tsx';
import { MessageSquare, BarChart2, Radio, Server } from 'lucide-react';
import { API_BASE } from './config';

function App() {
  const [view, setView] = useState<'chat' | 'stats'>('chat');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  // Telemetry Configuration Options
  const [provider, setProvider] = useState('google');
  const [model, setModel] = useState('gemini-2.5-flash');

  const fetchConversations = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/conversations`);
      const data = await res.json();
      setConversations(data);
      
      // Auto-select the first conversation if no thread is active
      if (data.length > 0 && !activeConversationId) {
        handleSelectConversation(data[0].id);
      }
    } catch (e) {
      console.error('Failed to sync conversations list:', e);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, []);

  const handleSelectConversation = async (id: string) => {
    setActiveConversationId(id);
    try {
      const res = await fetch(`${API_BASE}/api/chat/conversations/${id}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch (e) {
      console.error('Failed to download conversation history:', e);
    }
  };

  const handleCreateConversation = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Session #${conversations.length + 1}` }),
      });
      const newConvo = await res.json();
      
      setConversations((prev) => [newConvo, ...prev]);
      setActiveConversationId(newConvo.id);
      setMessages([]);
      setView('chat');
    } catch (e) {
      console.error('Failed to create new conversation session:', e);
    }
  };

  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`${API_BASE}/api/chat/conversations/${id}`, {
        method: 'DELETE',
      });
      
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
      }
    } catch (e) {
      console.error('Failed to delete conversation:', e);
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar Navigation Panel */}
      <Sidebar
        conversations={conversations}
        activeId={activeConversationId}
        onSelect={handleSelectConversation}
        onCreate={handleCreateConversation}
        onDelete={handleDeleteConversation}
        provider={provider}
        setProvider={setProvider}
        model={model}
        setModel={setModel}
        view={view}
      />

      {/* Main Console Viewport */}
      <main className="main-content">
        <header className="app-header">
          <div className="header-brand">
            <Radio size={20} color="#8b5cf6" style={{ animation: 'pulse 2s infinite' }} />
            <h1>InferenceTelemetry</h1>
            <span style={{ fontSize: '0.65rem', backgroundColor: 'rgba(6, 182, 212, 0.12)', color: 'var(--accent-cyan)', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
              Live
            </span>
          </div>

          {/* Navigation View selection tabs */}
          <div className="nav-tabs">
            <button
              className={`nav-tab ${view === 'chat' ? 'active' : ''}`}
              onClick={() => setView('chat')}
            >
              <MessageSquare size={15} />
              Chat Room
            </button>
            <button
              className={`nav-tab ${view === 'stats' ? 'active' : ''}`}
              onClick={() => setView('stats')}
            >
              <BarChart2 size={15} />
              Analytics Dashboard
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <Server size={14} color={API_BASE ? "#a78bfa" : "#10b981"} />
            <span>{API_BASE ? `Remote API: ${API_BASE}` : 'Local API Active'}</span>
          </div>
        </header>

        {/* Dynamic Panel Loading */}
        {view === 'chat' ? (
          <ChatWindow
            activeConversationId={activeConversationId}
            messages={messages}
            setMessages={setMessages}
            provider={provider}
            model={model}
            onRefreshConversations={fetchConversations}
          />
        ) : (
          <Dashboard />
        )}
      </main>
    </div>
  );
}

export default App;
