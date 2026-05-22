import React, { useState, useRef, useEffect } from 'react';
import { Send, Square, Sparkles, AlertCircle, Bot, User } from 'lucide-react';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface ChatWindowProps {
  activeConversationId: string | null;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  provider: string;
  model: string;
  onRefreshConversations: () => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  activeConversationId,
  messages,
  setMessages,
  provider,
  model,
  onRefreshConversations,
}) => {
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Auto scroll to message bottom
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Cancel generation
  const handleCancel = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    setIsStreaming(false);

    // Call cancel endpoint on backend to update database and terminate logging gracefully
    if (activeConversationId) {
      try {
        await fetch(`/api/chat/conversations/${activeConversationId}/cancel`, {
          method: 'POST',
        });
        
        // Append cancel message details
        const cancelledReply = streamingText + '\n\n_[Stream cancelled by user]_';
        setMessages((prev) => [
          ...prev,
          {
            id: 'cancelled-msg-' + Date.now(),
            role: 'assistant',
            content: cancelledReply,
            createdAt: new Date().toISOString(),
          },
        ]);
        setStreamingText('');
        onRefreshConversations();
      } catch (err) {
        console.error('Failed to notify cancellation to server:', err);
      }
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !activeConversationId || isStreaming) return;

    const userPrompt = input.trim();
    setInput('');

    // Append user message
    const userMsg: Message = {
      id: 'user-msg-' + Date.now(),
      role: 'user',
      content: userPrompt,
      createdAt: new Date().toISOString(),
    };
    
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);
    setStreamingText('');

    // Instantiate Abort Controller
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/chat/message/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConversationId,
          message: userPrompt,
          provider,
          model,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Server streaming error occurred.');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No stream body reader was available.');

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedReply = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Keep the last incomplete chunk in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine) continue;

          if (cleanLine.startsWith('data: ')) {
            const dataStr = cleanLine.substring(6);
            if (dataStr === '[DONE]') {
              break;
            }
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.text) {
                accumulatedReply += parsed.text;
                setStreamingText(accumulatedReply);
              }
            } catch (e) {
              // Ignore partial parses
            }
          } else if (cleanLine.startsWith('event: error')) {
            throw new Error('LLM stream responded with an error.');
          }
        }
      }

      // Finish streaming successfully
      setIsStreaming(false);
      setMessages((prev) => [
        ...prev,
        {
          id: 'assistant-msg-' + Date.now(),
          role: 'assistant',
          content: accumulatedReply,
          createdAt: new Date().toISOString(),
        },
      ]);
      setStreamingText('');
      abortControllerRef.current = null;
      onRefreshConversations();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Handled inside handleCancel
        console.log('Stream request aborted successfully.');
        return;
      }
      console.error('Streaming session error:', err);
      setIsStreaming(false);
      setMessages((prev) => [
        ...prev,
        {
          id: 'error-msg-' + Date.now(),
          role: 'assistant',
          content: `⚠️ **Inference Streaming Failure**: ${err.message || 'Check logs backend for details.'}`,
          createdAt: new Date().toISOString(),
        },
      ]);
      abortControllerRef.current = null;
    }
  };

  // Basic Markdown Renderer
  const renderMarkdown = (text: string) => {
    if (!text) return '';
    
    // Split into paragraphs/code blocks
    const parts = text.split(/(\`\`\`[a-z]*\n[\s\S]*?\`\`\`)/g);

    return parts.map((part, index) => {
      if (part.startsWith('```')) {
        // Extract language and code
        const lines = part.split('\n');
        const lang = lines[0].replace('```', '') || 'code';
        const code = lines.slice(1, -1).join('\n');
        return (
          <pre key={index}>
            <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: '6px', textTransform: 'uppercase', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>
              {lang}
            </div>
            <code>{code}</code>
          </pre>
        );
      }

      // Format bullets, bold, and headers
      const lines = part.split('\n');
      return lines.map((line, lIdx) => {
        let content: React.ReactNode = line;

        // Headers: ### text
        if (line.startsWith('### ')) {
          return <h3 key={`${index}-${lIdx}`}>{line.substring(4)}</h3>;
        }

        // Bullets: * text
        if (line.startsWith('* ')) {
          content = <li>{parseInlineMarkdown(line.substring(2))}</li>;
          return <ul key={`${index}-${lIdx}`} style={{ margin: '4px 0 4px 12px' }}>{content}</ul>;
        }

        // Ordered list: 1. text
        if (/^\d+\.\s/.test(line)) {
          const listText = line.replace(/^\d+\.\s/, '');
          content = <li>{parseInlineMarkdown(listText)}</li>;
          return <ol key={`${index}-${lIdx}`} style={{ margin: '4px 0 4px 12px' }}>{content}</ol>;
        }

        return <p key={`${index}-${lIdx}`} style={{ marginBottom: '8px' }}>{parseInlineMarkdown(line)}</p>;
      });
    });
  };

  // Helper to render bold **text** and inline `code`
  const parseInlineMarkdown = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*|\`.*?\`)/g);
    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={index}>{part.slice(1, -1)}</code>;
      }
      return part;
    });
  };

  return (
    <div className="chat-window">
      {!activeConversationId ? (
        <div className="chat-empty">
          <div className="chat-empty-icon">📡</div>
          <h3>Inference Terminal Ready</h3>
          <p>
            Create or select a conversation thread in the sidebar to start triggering streaming inference wrapped with real-time logging telemetry!
          </p>
        </div>
      ) : (
        <>
          {/* Chat Messages */}
          <div className="message-area">
            {messages.length === 0 && !streamingText && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280', gap: '8px' }}>
                <Sparkles size={24} color="#8b5cf6" />
                <span style={{ fontSize: '0.88rem' }}>Conversation started. Send your first prompt!</span>
              </div>
            )}
            
            {messages.map((msg) => (
              <div key={msg.id} className={`message-bubble ${msg.role}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', opacity: 0.6, fontSize: '0.74rem', fontWeight: 600, textTransform: 'uppercase' }}>
                  {msg.role === 'user' ? <User size={12} /> : <Bot size={12} />}
                  <span>{msg.role === 'user' ? 'You' : 'Assistant'}</span>
                </div>
                <div>{renderMarkdown(msg.content)}</div>
              </div>
            ))}

            {/* Live Streaming Chunk Output */}
            {streamingText && (
              <div className="message-bubble assistant">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', opacity: 0.6, fontSize: '0.74rem', fontWeight: 600, textTransform: 'uppercase' }}>
                  <Bot size={12} />
                  <span>Assistant</span>
                  <div className="stream-loader">
                    <span className="stream-dot"></span>
                    <span className="stream-dot"></span>
                    <span className="stream-dot"></span>
                  </div>
                </div>
                <div>{renderMarkdown(streamingText)}</div>
              </div>
            )}
            
            <div ref={messageEndRef} />
          </div>

          {/* Chat Input Area */}
          <div className="input-area">
            <form onSubmit={handleSend} className="input-wrapper">
              <input
                className="chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isStreaming ? "Streaming response active..." : `Message ${model}...`}
                disabled={isStreaming}
              />
              {isStreaming ? (
                <button type="button" className="btn-cancel" onClick={handleCancel}>
                  <Square size={14} fill="currentColor" />
                  Cancel
                </button>
              ) : (
                <button type="submit" className="btn-send" disabled={!input.trim()}>
                  <Send size={14} />
                  Send
                </button>
              )}
            </form>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', marginTop: '12px', fontSize: '0.72rem', color: '#6b7280' }}>
              <span>Provider: <strong style={{ color: '#9ca3af' }}>{provider}</strong></span>
              <span>Model: <strong style={{ color: '#9ca3af' }}>{model}</strong></span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
