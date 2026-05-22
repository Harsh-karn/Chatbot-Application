import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Clock, 
  Terminal, 
  AlertTriangle, 
  Search, 
  X, 
  RefreshCw, 
  FileText, 
  Cpu, 
  Sliders, 
  Percent, 
  Flame 
} from 'lucide-react';

interface MetricStats {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  cancelledCount: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgThroughputTokensSec: number;
  modelBreakdown: { name: string; provider: string; count: number; avgLatencyMs: number }[];
  providerBreakdown: { name: string; count: number; avgLatencyMs: number }[];
  timelinePoints: {
    id: string;
    timestamp: string;
    latencyMs: number;
    tokensPerSecond: number;
    status: string;
    model: string;
    provider: string;
  }[];
  errorRate: number;
}

export interface IngestedLog {
  id: string;
  conversationId: string;
  model: string;
  provider: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  tokensPerSecond: number;
  status: 'success' | 'error' | 'cancelled';
  errorMessage: string | null;
  inputPreview: string;
  outputPreview: string | null;
  timestamp: string;
  metadata: string | null;
}

export const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<MetricStats | null>(null);
  const [logs, setLogs] = useState<IngestedLog[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Log Explorer Filters
  const [search, setSearch] = useState('');
  const [filterProvider, setFilterProvider] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  
  // Selected Log Inspector Drawer state
  const [selectedLog, setSelectedLog] = useState<IngestedLog | null>(null);

  const fetchTelemetry = async () => {
    try {
      setLoading(true);
      // Fetch aggregations
      const statsRes = await fetch('/api/stats/dashboard');
      const statsData = await statsRes.json();
      setStats(statsData);

      // Fetch raw logs based on parameters
      const urlParams = new URLSearchParams();
      if (search) urlParams.append('search', search);
      if (filterProvider !== 'all') urlParams.append('provider', filterProvider);
      if (filterStatus !== 'all') urlParams.append('status', filterStatus);
      
      const logsRes = await fetch(`/api/stats/logs?${urlParams.toString()}`);
      const logsData = await logsRes.json();
      setLogs(logsData);
    } catch (e) {
      console.error('Failed to retrieve telemetry metrics:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    // Poll stats every 10 seconds for real-time live charting updates
    const timer = setInterval(fetchTelemetry, 10000);
    return () => clearInterval(timer);
  }, [search, filterProvider, filterStatus]);

  // Helper to colorfully render PII tokens in previews
  const highlightRedactedPII = (text: string | null) => {
    if (!text) return 'N/A';
    
    // Split by our redaction flags
    const tokens = text.split(/(\[REDACTED_EMAIL\]|\[REDACTED_CARD\]|\[REDACTED_SSN\]|\[REDACTED_SECRET\])/g);
    
    return tokens.map((token, i) => {
      if (token.startsWith('[REDACTED_')) {
        return (
          <span key={i} className="redacted-tag" title="PII Redacted by backend worker pipeline">
            {token}
          </span>
        );
      }
      return token;
    });
  };

  if (!stats) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#09090e', color: '#9ca3af' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
          <RefreshCw className="animate-spin" size={32} color="#8b5cf6" />
          <span>Synchronizing telemetry nodes...</span>
        </div>
      </div>
    );
  }

  // Draw custom premium SVG charts
  const renderSVGChart = (data: { val: number; label: string }[]) => {
    if (data.length === 0) return <div style={{ color: '#6b7280', fontSize: '0.88rem' }}>No telemetry data.</div>;
    
    const maxVal = Math.max(...data.map(d => d.val), 1);
    
    return (
      <div className="svg-chart-container">
        {data.map((item, idx) => {
          // Normalize height to maximum 160px
          const barHeight = Math.round((item.val / maxVal) * 160);
          return (
            <div key={idx} className="svg-bar-col">
              <div className="svg-tooltip">
                <strong style={{ color: '#8b5cf6' }}>{item.label}</strong>
                <div>{item.val.toLocaleString()} ms</div>
              </div>
              <div className="svg-bar-fill" style={{ height: `${barHeight}px` }}></div>
              <span className="svg-bar-label" title={item.label}>{item.label}</span>
            </div>
          );
        })}
      </div>
    );
  };

  // Timeline SVG line path charts for P95 latency trend
  const timelinePoints = stats.timelinePoints || [];
  const maxTimelineLatency = Math.max(...timelinePoints.map(p => p.latencyMs), 1);
  const chartWidth = 500;
  const chartHeight = 150;

  let pointsString = '';
  if (timelinePoints.length > 1) {
    pointsString = timelinePoints.map((point, index) => {
      const x = (index / (timelinePoints.length - 1)) * (chartWidth - 40) + 20;
      const y = chartHeight - ((point.latencyMs / maxTimelineLatency) * (chartHeight - 40) + 20);
      return `${x},${y}`;
    }).join(' ');
  }

  return (
    <div className="dashboard-container">
      {/* Dashboard Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Telemetry Console</h2>
          <p style={{ fontSize: '0.88rem', color: '#6b7280', marginTop: '4px' }}>
            Near real-time inference capture logs and aggregate performance distributions
          </p>
        </div>
        <button className="btn-new-chat" onClick={fetchTelemetry} disabled={loading} style={{ padding: '8px 16px' }}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Sync
        </button>
      </div>

      {/* Aggregate Metric Widget Cards */}
      <div className="dashboard-summary-grid">
        <div className="metric-card">
          <div className="metric-header">
            <span>Total Requests</span>
            <Activity size={16} color="#8b5cf6" />
          </div>
          <div className="metric-value">{stats.totalRequests}</div>
          <div className="metric-sub">
            <span style={{ color: '#10b981' }}>{stats.successCount} OK</span> · <span style={{ color: '#ef4444' }}>{stats.errorCount} ERR</span> · <span style={{ color: '#a8a29e' }}>{stats.cancelledCount} CANC</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>Avg Latency</span>
            <Clock size={16} color="#06b6d4" />
          </div>
          <div className="metric-value">{stats.avgLatencyMs} ms</div>
          <div className="metric-sub">
            P95 Peak Latency: <strong style={{ color: '#e5e7eb' }}>{stats.p95LatencyMs} ms</strong>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>Avg Throughput</span>
            <Flame size={16} color="#f59e0b" />
          </div>
          <div className="metric-value">{stats.avgThroughputTokensSec} <span style={{ fontSize: '0.9rem', color: '#9ca3af' }}>t/s</span></div>
          <div className="metric-sub">
            Speed metric calculated at worker level
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>Error Rate</span>
            <AlertTriangle size={16} color="#ef4444" />
          </div>
          <div className="metric-value" style={{ color: stats.errorRate > 10 ? '#ef4444' : 'var(--text-primary)' }}>
            {stats.errorRate}%
          </div>
          <div className="metric-sub">
            Failures out of total logged sessions
          </div>
        </div>
      </div>

      {/* Analytics Charts and Grouping Tables */}
      <div className="charts-row">
        {/* Latency Charts card */}
        <div className="chart-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Average Latency by LLM Model</h3>
            <span style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', fontWeight: 600 }}>Histogram</span>
          </div>
          
          {stats.modelBreakdown.length === 0 ? (
            <div style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: '0.88rem' }}>
              No latency distribution logged.
            </div>
          ) : (
            renderSVGChart(stats.modelBreakdown.map(m => ({ val: m.avgLatencyMs, label: m.name })))
          )}
        </div>

        {/* Breakdown Panel */}
        <div className="chart-card">
          <h3>Load Breakdown</h3>
          <div className="pie-breakdown-list">
            {stats.providerBreakdown.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#6b7280', fontSize: '0.88rem' }}>
                No active traffic logs.
              </div>
            ) : (
              stats.providerBreakdown.map((p, idx) => (
                <div key={idx} className="breakdown-row">
                  <div className="breakdown-label-group">
                    <span className={`breakdown-dot ${idx === 0 ? 'purple' : idx === 1 ? 'cyan' : idx === 2 ? 'green' : 'yellow'}`}></span>
                    <span style={{ fontWeight: 500 }}>{p.name === 'google' ? 'Google Gemini' : p.name === 'openai' ? 'OpenAI GPT' : p.name === 'anthropic' ? 'Anthropic' : p.name}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="breakdown-count">{p.count} calls</span>
                    <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>({p.avgLatencyMs}ms)</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Real-time Log Explorer Table */}
      <div className="log-explorer-card">
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '15px' }}>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600 }}>Raw Telemetry Log Explorer</h3>
            <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '2px' }}>
              Click on any logging event row below to inspect deep telemetry and active PII scrub outcomes
            </p>
          </div>
          
          {/* Logs Filtration Inputs */}
          <div className="log-filters">
            <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }} className="filter-search">
              <Search size={14} style={{ position: 'absolute', left: '12px', color: '#6b7280' }} />
              <input
                className="filter-input"
                style={{ paddingLeft: '34px', width: '100%' }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search prompt, output previews..."
              />
            </div>

            <select className="filter-input" value={filterProvider} onChange={(e) => setFilterProvider(e.target.value)}>
              <option value="all">All Providers</option>
              <option value="google">Google</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="deepseek">DeepSeek</option>
            </select>

            <select className="filter-input" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">All Statuses</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {/* Logs Table grid */}
        <div className="logs-table-container">
          {logs.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: '#6b7280', fontSize: '0.88rem' }}>
              No log entry matched your search query rules.
            </div>
          ) : (
            <table className="logs-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Model / Provider</th>
                  <th>Latency</th>
                  <th>Tokens (Throughput)</th>
                  <th>Status</th>
                  <th>Prompt Preview</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} onClick={() => setSelectedLog(log)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 500 }}>{log.model}</span>
                        <span style={{ fontSize: '0.74rem', color: '#6b7280', textTransform: 'capitalize' }}>{log.provider}</span>
                      </div>
                    </td>
                    <td>
                      <strong style={{ color: '#e5e7eb' }}>{log.latencyMs} ms</strong>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span>{log.totalTokens} total</span>
                        {log.tokensPerSecond > 0 && (
                          <span style={{ fontSize: '0.74rem', color: '#06b6d4' }}>{log.tokensPerSecond} t/s</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`table-status ${log.status}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="preview-cell">
                      {highlightRedactedPII(log.inputPreview)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal / Slide-Out Drawer Inspector */}
      {selectedLog && (
        <div className="inspector-backdrop" onClick={() => setSelectedLog(null)}>
          <div className="inspector-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="inspector-header">
              <div>
                <h2>Inference Log Detail</h2>
                <span style={{ fontSize: '0.72rem', color: '#6b7280', fontFamily: 'var(--font-mono)' }}>UUID: {selectedLog.id}</span>
              </div>
              <button className="btn-close-inspector" onClick={() => setSelectedLog(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="inspector-body">
              {/* Timing Metadata Row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <div className="inspector-section">
                  <label>Model</label>
                  <div className="inspector-data-box" style={{ fontWeight: 600 }}>{selectedLog.model}</div>
                </div>
                <div className="inspector-section">
                  <label>Provider</label>
                  <div className="inspector-data-box" style={{ textTransform: 'capitalize' }}>{selectedLog.provider}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <div className="inspector-section">
                  <label>Latency Time</label>
                  <div className="inspector-data-box" style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{selectedLog.latencyMs} ms</div>
                </div>
                <div className="inspector-section">
                  <label>Log Timestamp</label>
                  <div className="inspector-data-box">{new Date(selectedLog.timestamp).toLocaleString()}</div>
                </div>
              </div>

              {/* Token breakdown */}
              <div className="inspector-section">
                <label>Token Metrics & Throughput</label>
                <div className="inspector-data-box" style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.15)' }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase' }}>Prompt</div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: '4px' }}>{selectedLog.promptTokens}</div>
                  </div>
                  <div style={{ borderLeft: '1px solid var(--border-normal)' }}></div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase' }}>Generated</div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: '4px' }}>{selectedLog.completionTokens}</div>
                  </div>
                  <div style={{ borderLeft: '1px solid var(--border-normal)' }}></div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase' }}>Total</div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: '4px' }}>{selectedLog.totalTokens}</div>
                  </div>
                </div>
              </div>

              {/* Status Section */}
              <div className="inspector-section">
                <label>Execution Status</label>
                <div className="inspector-data-box" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span className={`table-status ${selectedLog.status}`}>
                    {selectedLog.status}
                  </span>
                  {selectedLog.errorMessage && (
                    <span style={{ color: 'var(--color-error)', fontSize: '0.84rem' }}>{selectedLog.errorMessage}</span>
                  )}
                </div>
              </div>

              {/* Input prompt preview */}
              <div className="inspector-section">
                <label>PII Masked Prompt (Input)</label>
                <div className="inspector-preview-box">
                  {highlightRedactedPII(selectedLog.inputPreview)}
                </div>
              </div>

              {/* Output reply preview */}
              <div className="inspector-section">
                <label>PII Masked Response (Output)</label>
                <div className="inspector-preview-box" style={{ borderColor: 'rgba(6, 182, 212, 0.15)' }}>
                  {selectedLog.outputPreview ? highlightRedactedPII(selectedLog.outputPreview) : (
                    <span style={{ color: '#6b7280', fontStyle: 'italic' }}>No output generated (e.g. error event / prompt only).</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default Dashboard;
