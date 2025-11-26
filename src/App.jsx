import React, { useMemo, useRef, useCallback, useState } from 'react';
import { ChatContainer, BusEventType } from '@carbon/ai-chat';
import './App.css';
import '@carbon/web-components/es/components/button/index.js';
import '@carbon/web-components/es/components/tag/index.js';

const LANGFLOW_URL = import.meta.env.VITE_LANGFLOW_URL || '';
const LANGFLOW_ORG_ID = import.meta.env.VITE_LANGFLOW_ORG_ID || '';
const LANGFLOW_TOKEN = import.meta.env.VITE_LANGFLOW_TOKEN || '';

const ASTRA_DB_API_ENDPOINT = import.meta.env.VITE_ASTRA_API_ENDPOINT || '';
const ASTRA_DB_KEYSPACE = import.meta.env.VITE_ASTRA_DB_KEYSPACE || '';
const ASTRA_DB_COLLECTION = import.meta.env.VITE_ASTRA_DB_COLLECTION || 'raw_esg';
const ASTRA_DB_TOKEN = import.meta.env.VITE_ASTRA_DB_TOKEN || '';

const makeId = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
);

const createSessionId = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
);

const buildTextResponse = (text, requestId) => ({
  id: `response-${makeId()}`,
  request_id: requestId,
  output: {
    generic: [
      {
        id: `item-${makeId()}`,
        response_type: 'text',
        text,
      },
    ],
  },
  history: {
    timestamp: Date.now(),
  },
});

const extractLangflowMessage = (data) => {
  if (!data) return null;

  const outputs =
    data?.outputs?.[0]?.outputs?.[0]?.outputs?.message?.message ??
    data?.outputs?.[0]?.outputs?.[0]?.artifacts?.message ??
    data?.outputs?.[0]?.outputs?.[0]?.messages?.[0]?.message ??
    data?.outputs?.[0]?.outputs?.[0]?.results?.message?.text;

  if (typeof outputs === 'string' && outputs.trim().length > 0) {
    return outputs.trim();
  }

  const text = data?.outputs?.flatMap((entry) => {
    const inner = entry?.outputs ?? [];
    return inner.flatMap((subEntry) => {
      const maybeString = subEntry?.outputs?.message?.message ?? subEntry?.artifacts?.message;
      if (typeof maybeString === 'string') return [maybeString];
      const messages = subEntry?.messages ?? [];
      return messages
        .map((message) => message?.message)
        .filter((value) => typeof value === 'string');
    });
  });

  if (Array.isArray(text) && text.length > 0) {
    return text[0];
  }

  return null;
};

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes)) {
    return '—';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = bytes === 0 ? 0 : Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const formatDateTime = (date) =>
  new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);

const readFileAsBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        const [, base64 = result] = result.split(',');
        resolve(base64);
      } else {
        reject(new Error('Failed to read file as base64.'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Unknown file read error'));
    reader.readAsDataURL(file);
  });

const ingestFileToAstra = async (file) => {
  if (!ASTRA_DB_API_ENDPOINT || !ASTRA_DB_KEYSPACE || !ASTRA_DB_COLLECTION || !ASTRA_DB_TOKEN) {
    const message = 'Astra DB configuration missing. Skipping ingestion.';
    console.warn(message, {
      hasEndpoint: Boolean(ASTRA_DB_API_ENDPOINT),
      hasKeyspace: Boolean(ASTRA_DB_KEYSPACE),
      hasCollection: Boolean(ASTRA_DB_COLLECTION),
      hasToken: Boolean(ASTRA_DB_TOKEN),
    });
    return { success: false, skipped: true, message };
  }

  try {
    const base64 = await readFileAsBase64(file);
    const document = {
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size ?? null,
      uploadedAt: new Date().toISOString(),
      $vectorize: file.name,
      contentBase64: base64,
    };

    const response = await fetch(
      `${ASTRA_DB_API_ENDPOINT}/api/json/v1/${ASTRA_DB_KEYSPACE}/${ASTRA_DB_COLLECTION}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cassandra-Token': ASTRA_DB_TOKEN,
        },
        body: JSON.stringify({
          insertMany: {
            documents: [document],
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Astra insertMany request failed: ${response.status} ${response.statusText} ${errorText}`
      );
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    console.error('Error ingesting file into Astra DB', error);
    return { success: false, error };
  }
};

function App() {
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [astraConnectionStatus, setAstraConnectionStatus] = useState({
    checked: false,
    success: false,
    message: '',
  });
  const sessionRef = useRef(createSessionId());
  const resetRegisteredRef = useRef(false);
  const fileInputRef = useRef(null);

  const regenerateSessionId = useCallback(() => {
    sessionRef.current = createSessionId();
  }, []);

  const handleOpenFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFilesSelected = useCallback((event) => {
    const filesFromEvent = Array.from(event.target.files ?? []);
    if (filesFromEvent.length === 0) {
      return;
    }

    const nextFiles = filesFromEvent.map((file) => ({
      id: makeId(),
      file,
      name: file.name,
      size: file.size ?? NaN,
      createdAt: new Date(),
      status: 'uploading',
    }));

    setUploadedFiles((prev) => [...prev, ...nextFiles]);

    nextFiles.forEach((entry) => {
      setTimeout(async () => {
        const ingestionResult = await ingestFileToAstra(entry.file);
        if (ingestionResult.success || ingestionResult.skipped) {
          handleFileUploaded(entry.file, ingestionResult);
        }
        setUploadedFiles((prev) =>
          prev.map((item) => {
            if (item.id !== entry.id) {
              return item;
            }

            if (ingestionResult.success || ingestionResult.skipped) {
              return {
                ...item,
                status: 'complete',
                completedAt: new Date(),
                astraResponse: ingestionResult.data ?? null,
              };
            }

            return {
              ...item,
              status: 'error',
              errorMessage: ingestionResult.error?.message ?? 'Failed to ingest file.',
            };
          })
        );
      }, 1200 + Math.random() * 1000);
    });

    event.target.value = '';
  }, []);

  const handleRemoveFile = useCallback((fileId) => {
    setUploadedFiles((prev) => prev.filter((file) => file.id !== fileId));
  }, []);

  const handleFileUploaded = useCallback((file, result) => {
    const message = 'file uploaded';
    console.info(message, {
      filename: file?.name ?? '',
      astraResult: result,
    });
    return message;
  }, []);

  const testAstraConnection = useCallback(async () => {
    if (!ASTRA_DB_API_ENDPOINT || !ASTRA_DB_KEYSPACE || !ASTRA_DB_COLLECTION || !ASTRA_DB_TOKEN) {
      setAstraConnectionStatus({
        checked: true,
        success: false,
        message: 'Missing Astra DB configuration. Please check your environment variables.',
      });
      return;
    }

    try {
      const response = await fetch(`${ASTRA_DB_API_ENDPOINT}/api/json/v1/${ASTRA_DB_KEYSPACE}/${ASTRA_DB_COLLECTION}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Cassandra-Token': ASTRA_DB_TOKEN,
        },
        body: JSON.stringify({
          findOne: {
            filter: {},
            options: {
              includeSimilarity: false,
              includeSortVector: false,
            },
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status} ${response.statusText} ${text}`);
      }

      setAstraConnectionStatus({
        checked: true,
        success: true,
        message: 'Successfully connected to Astra DB collection.',
      });
    } catch (error) {
      console.error('Astra connection test failed', error);
      setAstraConnectionStatus({
        checked: true,
        success: false,
        message: error instanceof Error ? error.message : 'Unknown connection error.',
      });
    }
  }, []);

  const messaging = useMemo(
    () => ({
      skipWelcome: true,
      messageLoadingIndicatorTimeoutSecs: 0.5,
      customSendMessage: async (request, requestOptions, instance) => {
        const userText = request?.input?.text?.trim();
        if (!userText) {
          return;
        }

        const payload = {
          output_type: 'chat',
          input_type: 'chat',
          input_value: userText,
          session_id: sessionRef.current,
        };

        try {
          if (!LANGFLOW_URL || !LANGFLOW_ORG_ID || !LANGFLOW_TOKEN) {
            const fallback = 'LangFlow configuration is missing. Please check the environment variables.';
            await instance.messaging.addMessage(buildTextResponse(fallback, request?.id));
            console.error('LangFlow configuration missing.', { LANGFLOW_URL, LANGFLOW_ORG_ID, hasToken: Boolean(LANGFLOW_TOKEN) });
            return;
          }

          const response = await fetch(LANGFLOW_URL, {
            method: 'POST',
            headers: {
              'X-DataStax-Current-Org': LANGFLOW_ORG_ID,
              Authorization: `Bearer ${LANGFLOW_TOKEN}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(payload),
            signal: requestOptions?.signal,
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LangFlow request failed: ${response.status} ${errorText}`);
          }

          const data = await response.json();
          const message = extractLangflowMessage(data);
          const replyText = message ?? 'I was unable to retrieve a response from the LangFlow assistant.';
          await instance.messaging.addMessage(buildTextResponse(replyText, request?.id));
        } catch (error) {
          console.error('Error contacting LangFlow', error);
          const fallback =
            'Sorry, I ran into a problem reaching the LangFlow assistant. Please try again in a moment.';
          await instance.messaging.addMessage(buildTextResponse(fallback, request?.id));
          throw error;
        }
      },
    }),
    []
  );

  const handleBeforeRender = useCallback(
    (instance) => {
      if (resetRegisteredRef.current) {
        return;
      }

      resetRegisteredRef.current = true;
      instance.on({
        type: BusEventType.RESET,
        handler: regenerateSessionId,
      });
    },
    [regenerateSessionId]
  );

  return (
    <div className="app">
      <aside className="sidebar" data-cds-theme="g10">
        <header className="sidebar__header">
          <h2 className="sidebar__title">Upload documents</h2>
          <p className="sidebar__subtitle">
            Files help the assistant ground answers. Supported formats: PDF, DOCX, TXT, and Markdown.
          </p>
        </header>
        <div className="sidebar__actions">
          <cds-button kind="primary" size="lg" onClick={handleOpenFileDialog}>
            Add files
          </cds-button>
          <cds-button
            kind="tertiary"
            size="md"
            onClick={testAstraConnection}
            data-testid="astra-connection-test"
          >
            Test Astra connection
          </cds-button>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFilesSelected}
            multiple
            accept=".pdf,.doc,.docx,.txt,.md"
            className="sidebar__file-input"
          />
          <span className="sidebar__hint">Maximum 5 MB per file • Up to 10 files at a time</span>
        </div>
        {astraConnectionStatus.checked && (
          <div
            className={[
              'sidebar__connection',
              astraConnectionStatus.success ? 'sidebar__connection--success' : 'sidebar__connection--error',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {astraConnectionStatus.message}
          </div>
        )}
        <div className="sidebar__divider" />
        <div className="sidebar__list">
          {uploadedFiles.length === 0 ? (
            <div className="sidebar__empty">
              <p>No documents uploaded yet.</p>
              <p>Use the button above or drag files into the window to add them.</p>
            </div>
          ) : (
            uploadedFiles.map((item) => (
              <article
                key={item.id}
                className={['sidebar__item', `sidebar__item--${item.status}`].filter(Boolean).join(' ')}
              >
                <div className="sidebar__item-details">
                  <span className="sidebar__item-name" title={item.name}>
                    {item.name}
                  </span>
                  <span className="sidebar__item-meta">
                    {formatBytes(item.size)} • Added {formatDateTime(item.createdAt)}
                  </span>
                </div>
                <div className="sidebar__item-controls">
                  {item.status === 'uploading' ? (
                    <span className="sidebar__status sidebar__status--loading">Uploading…</span>
                  ) : item.status === 'error' ? (
                    <cds-tag type="red" size="md">
                      Failed
                    </cds-tag>
                  ) : (
                    <cds-tag type="green" size="md">
                      Uploaded
                    </cds-tag>
                  )}
                  <button
                    type="button"
                    className="sidebar__remove"
                    onClick={() => handleRemoveFile(item.id)}
                    aria-label={`Remove ${item.name}`}
                  >
                    ×
                  </button>
                </div>
                {item.status === 'uploading' && (
                  <div className="sidebar__progress" aria-hidden="true">
                    <span />
                  </div>
                )}
                {item.status === 'error' && (
                  <p className="sidebar__error">{item.errorMessage ?? 'Failed to ingest file.'}</p>
                )}
              </article>
            ))
          )}
        </div>
      </aside>
      <div className="chat-area">
        <div className="chat-area__window">
          <ChatContainer
            debug
            aiEnabled
            header={{ title: 'My AI Assistant', name: 'Carbon', showRestartButton: true }}
            launcher={{
              isOn: true,
              desktop: {
                isOn: true,
                title: 'Chat with AI',
              },
            }}
            homescreen={{
              isOn: true,
              greeting: "Hello, I'm built with Carbon UI, DataStax, and Groq.",
              starters: {
                isOn: true,
                buttons: [
                  { label: 'What can you do?' },
                  { label: 'Tell me a joke' },
                  { label: 'Explain artificial intelligence' },
                ],
              },
            }}
            strings={{
              input_placeholder: 'Type your message here...',
            }}
            layout={{
              corners: 'round',
              showFrame: true,
              hasContentMaxWidth: true,
              customProperties: {
                height: '720px',
                width: '480px',
              },
            }}
            openChatByDefault
            messaging={messaging}
            onBeforeRender={handleBeforeRender}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
