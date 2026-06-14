import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bot, LoaderCircle, Send, Trash2, Square } from "lucide-react";
import {
  chatWithLlm,
  getDownloadProgress,
  getLlmStatus,
  listLlmModels,
  startLlm,
  stopLlm,
} from "../services/api";

function TextChat({ specs, showAlert, showConfirm, textSettings, setTextSettings, setActiveModel, setServerRunning }) {
  const [models, setModels] = useState([]);
  const [status, setStatus] = useState({ ready: false, running: false, settings: {} });
  const [selectedModel, setSelectedModel] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [loadingModel, setLoadingModel] = useState(null);
  const [tokenUsage, setTokenUsage] = useState({
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0
  });
  
  const bottomRef = useRef(null);
  const completedDownloadRef = useRef("");
  const loadingModelRef = useRef(null);

  useEffect(() => {
    loadingModelRef.current = loadingModel;
  }, [loadingModel]);

  const refresh = useCallback(async () => {
    const [nextModels, nextStatus] = await Promise.all([listLlmModels(), getLlmStatus()]);
    setModels(nextModels);
    setStatus(nextStatus);
    const active = nextStatus.settings?.model;
    setSelectedModel((current) => {
      const saved = localStorage.getItem("selectedLlmModel");
      const savedExists = nextModels.some((m) => m.filename === saved);
      return active || current || (savedExists ? saved : "") || nextModels[0]?.filename || "";
    });
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    const timer = setInterval(() => {
      getLlmStatus().then((nextStatus) => {
        setStatus(nextStatus);
        // If it suddenly loaded or became ready externally, update selection and reset loading states
        if (nextStatus.ready && nextStatus.settings?.model) {
          setSelectedModel(nextStatus.settings.model);
          setLoadingModel(null);
        }
      }).catch(() => {});
      getDownloadProgress().then((state) => {
        if (state.kind === "text" && (state.active || state.error || state.progress === 100)) {
          const completionKey = `${state.filename || ""}:${state.downloadedBytes || 0}`;
          if (!state.active && !state.error && completedDownloadRef.current !== completionKey) {
            completedDownloadRef.current = completionKey;
            refresh().catch(() => {});
          }
        }
      }).catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isBusy, loadingModel]);

  const handleModelChange = async (filename) => {
    if (!filename) {
      if (status.ready) {
        setIsBusy(true);
        try {
          await stopLlm();
          setStatus((prev) => ({ ...prev, ready: false, running: false }));
          setSelectedModel("");
          setMessages([]);
          setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
        } catch (err) {
          showAlert({ title: "Unload Failed", message: err.message || String(err), danger: true });
        } finally {
          setIsBusy(false);
        }
      }
      return;
    }

    setSelectedModel(filename);
    localStorage.setItem("selectedLlmModel", filename);
    setIsBusy(true);
    setLoadingModel(filename);
    try {
      // Unload active image engine if running
      if (setActiveModel) setActiveModel(null);
      if (setServerRunning) setServerRunning(false);

      const result = await startLlm(filename, {
        threads: textSettings?.threads || specs?.cpu_cores_physical || 4,
        contextSize: textSettings?.contextSize || 4096,
        gpuLayers: -1,
      });
      setStatus({ ...status, ...result, ready: true, running: true, settings: result.settings });
      setMessages([]);
      setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    } catch (err) {
      if (loadingModelRef.current === filename) {
        showAlert({ title: "Text Model Load Failed", message: err.message, danger: true });
      }
    } finally {
      setLoadingModel(null);
      setIsBusy(false);
    }
  };

  const handleCancelLlmLoad = async () => {
    try {
      await stopLlm();
    } catch (_) {}
    setLoadingModel(null);
    setIsBusy(false);
    setSelectedModel("");
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isBusy || !status.ready) return;
    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setIsBusy(true);
    try {
      const systemPrompt = textSettings?.systemPrompt || "You are a helpful local AI assistant.";
      const requestMessages = [
        ...(systemPrompt.trim() ? [{ role: "system", content: systemPrompt.trim() }] : []),
        ...nextMessages,
      ];
      const response = await chatWithLlm(requestMessages, { 
        temperature: textSettings?.temperature || 0.7, 
        maxTokens: 768 
      });
      setMessages([...nextMessages, { role: "assistant", content: response.content }]);
      if (response.usage) {
        setTokenUsage(response.usage);
      }
    } catch (err) {
      setMessages([...nextMessages, { role: "assistant", content: `Error: ${err.message}`, error: true }]);
    } finally {
      setIsBusy(false);
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  };

  return (
    <div className="text-chat-layout">
      <section className="text-chat-main">
        <div className="text-chat-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <select
              value={selectedModel}
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={isBusy}
              style={{
                fontSize: "0.95rem",
                fontWeight: "600",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--md-shape-corner-medium)",
                background: "var(--md-sys-color-surface-variant)",
                color: "var(--md-sys-color-on-surface)",
                padding: "8px 16px",
                outline: "none",
                cursor: "pointer",
                minWidth: "220px"
              }}
            >
              <option value="">No model loaded (Select GGUF)</option>
              {models.map((m) => (
                <option key={m.filename} value={m.filename}>
                  {m.filename} {m.filename === status.settings?.model && status.ready ? "• Active" : ""}
                </option>
              ))}
            </select>
            {isBusy && !loadingModel && <LoaderCircle className="progress-spinner" size={16} />}
            {selectedModel && (!status.ready || status.settings?.model !== selectedModel) && !loadingModel && (
              <button
                className="m3-btn m3-btn-filled"
                onClick={() => handleModelChange(selectedModel)}
                disabled={isBusy}
                style={{
                  height: "38px",
                  padding: "0 16px",
                  fontSize: "0.85rem",
                  borderRadius: "var(--md-shape-corner-medium)",
                  background: "var(--md-sys-color-primary)",
                  color: "var(--md-sys-color-on-primary)",
                  cursor: "pointer",
                  border: "none",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px"
                }}
              >
                Load Model
              </button>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
            {/* Active Backend status info */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ 
                display: "inline-block", 
                width: "8px", 
                height: "8px", 
                borderRadius: "50%", 
                background: status.ready ? "var(--md-sys-color-success)" : "var(--md-sys-color-outline-variant)",
                flexShrink: 0
              }}></span>
              <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
                <span style={{ fontSize: "0.68rem", color: "var(--md-sys-color-outline)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Active Backend
                </span>
                <span style={{ fontSize: "0.85rem", fontWeight: "700", color: status.ready ? "var(--md-sys-color-on-surface)" : "var(--md-sys-color-outline)" }}>
                  {status.ready ? (status.settings?.backendMode || "llama.cpp") : "Offline"}
                  {status.ready && ` (${status.settings?.threads || 4}T)`}
                </span>
              </div>
            </div>

            {/* Small circular gauge for context */}
            {(() => {
              const maxTokens = status.settings?.contextSize || 4096;
              const used = tokenUsage.total_tokens || 0;
              const percent = Math.min(100, Math.round((used / maxTokens) * 100));
              
              return (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }} title={`Context Used: ${used} / ${maxTokens} tokens`}>
                  <div style={{ position: "relative", width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="40" height="40" viewBox="0 0 40 40">
                      <circle cx="20" cy="20" r="16" stroke="var(--border-color)" strokeWidth="3" fill="transparent" />
                      <circle 
                        cx="20" 
                        cy="20" 
                        r="16" 
                        stroke="var(--md-sys-color-primary)" 
                        strokeWidth="3" 
                        fill="transparent" 
                        strokeDasharray={2 * Math.PI * 16}
                        strokeDashoffset={2 * Math.PI * 16 * (1 - percent / 100)}
                        strokeLinecap="round"
                        transform="rotate(-90 20 20)"
                        style={{ transition: "stroke-dashoffset 0.35s" }}
                      />
                    </svg>
                    <div style={{ position: "absolute", textAlign: "center" }}>
                      <span style={{ fontSize: "0.65rem", fontWeight: "700" }}>{percent}%</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                    <span style={{ fontSize: "0.65rem", color: "var(--md-sys-color-outline)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Context Used
                    </span>
                    <span style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--md-sys-color-on-surface)" }}>
                      {used} / {maxTokens}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Clear Conversation button */}
            <button 
              className="m3-btn m3-btn-outlined" 
              style={{ 
                height: "36px", 
                padding: "0 12px", 
                display: "flex", 
                alignItems: "center", 
                gap: "6px", 
                fontSize: "0.82rem",
                borderRadius: "var(--md-shape-corner-medium)"
              }}
              onClick={handleClearChat}
              disabled={messages.length === 0}
            >
              <Trash2 size={15} />
              <span>Clear</span>
            </button>
          </div>
        </div>

        <div className="chat-messages">
          {loadingModel ? (
            <div className="chat-empty" style={{ maxWidth: "480px", margin: "auto", textAlign: "center", padding: "60px 20px" }}>
              <LoaderCircle className="progress-spinner" size={48} style={{ color: "var(--md-sys-color-primary)", marginBottom: "16px" }} />
              <h3 style={{ fontWeight: 600, fontSize: "1.25rem", marginBottom: "8px", color: "var(--md-sys-color-on-surface)" }}>Loading Text Model</h3>
              <code style={{ 
                display: "block", 
                background: "var(--md-sys-color-surface-variant)", 
                color: "var(--md-sys-color-on-surface-variant)",
                padding: "8px 12px", 
                borderRadius: "6px", 
                fontSize: "0.85rem",
                marginBottom: "20px",
                wordBreak: "break-all",
                fontFamily: "monospace"
              }}>
                {loadingModel}
              </code>
              <p style={{ fontSize: "0.9rem", color: "var(--md-sys-color-outline)", lineHeight: 1.5, marginBottom: "24px" }}>
                Initializing llama.cpp server and loading the model weights into memory. This can take up to 30 seconds depending on model size and hardware speed.
              </p>
              <button 
                className="m3-btn m3-btn-error" 
                onClick={handleCancelLlmLoad}
                style={{ 
                  display: "inline-flex", 
                  alignItems: "center", 
                  gap: "8px",
                  height: "38px",
                  padding: "0 16px",
                  fontSize: "0.85rem",
                  borderRadius: "var(--md-shape-corner-medium)"
                }}
              >
                <Square size={14} fill="currentColor" />
                <span>Cancel Load</span>
              </button>
            </div>
          ) : (
            <>
              {messages.length === 0 && (
                <div className="chat-empty">
                  <Bot size={42} />
                  <h3>Local ChatGPT-style Interface</h3>
                  <p>Choose a GGUF text model above to load it. Your conversation history stays completely private on this machine.</p>
                </div>
              )}
              {messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`chat-message ${message.role} ${message.error ? "error" : ""}`}>
                  <strong>{message.role === "user" ? "You" : "Local AI"}</strong>
                  <div>{message.content}</div>
                </div>
              ))}
              {isBusy && status.ready && <div className="chat-thinking"><LoaderCircle className="progress-spinner" size={16} /> Generating...</div>}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="chat-composer">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
            placeholder={status.ready ? "Message your local model..." : "Select and load a GGUF model above to begin"}
            disabled={!status.ready || isBusy}
          />
          <button className="m3-btn m3-btn-filled" onClick={sendMessage} disabled={!input.trim() || !status.ready || isBusy}>
            <Send size={17} /> Send
          </button>
        </div>
      </section>
    </div>
  );
}

export default TextChat;
