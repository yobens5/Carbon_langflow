# Carbon AI Chat - Simple Demo

A simple implementation of IBM's Carbon AI Chat component.

## Features

- 🤖 AI-enabled chat interface
- 🚀 Floating launcher button
- 🏠 Home screen with starter prompts
- 💬 Real-time messaging interface
- 🔌 LangFlow-powered responses via DataStax & Groq
- 🎨 Modern Carbon Design System styling

## Getting Started

### Installation

Install the dependencies:

```bash
npm install
```

### Development

Run the development server:

```bash
npm run dev
```

The app will open at `http://localhost:3000`

### Build

Build for production:

```bash
npm run build
```

### Preview Production Build

Preview the production build:

```bash
npm run preview
```

## Environment Configuration

Create a `.env` file (or `.env.local`) with your LangFlow credentials before starting the dev server:

```ini
VITE_LANGFLOW_URL=...
VITE_LANGFLOW_ORG_ID=...
VITE_LANGFLOW_TOKEN=...
```

These values power the `customSendMessage` handler in `src/App.jsx`. Never commit production secrets—`.gitignore` already excludes `.env` for you.

## How It Works

This demo uses the `@carbon/ai-chat` React component with:

1. **Launcher Mode**: A floating button in the corner that opens the chat
2. **Home Screen**: Welcome screen with starter prompt buttons
3. **LangFlow Integration**: Requests are proxied to your DataStax-hosted flow for real answers

## Architecture

```mermaid
graph TD
    U[End User<br>Browser] -->|Types message| UI[React App<br>Carbon ChatContainer]
    UI -->|customSendMessage| MSG[Messaging Layer<br>(App.jsx)]
    MSG -->|POST chat payload<br>with session_id| LF[LangFlow HTTP Endpoint]
    LF -->|JSON reply| MSG
    MSG -->|buildTextResponse| UI
    subgraph Vite Runtime
        UI
        MSG
    end
    subgraph Env Config
        ENV[LANGFLOW_URL<br>LANGFLOW_ORG_ID<br>LANGFLOW_TOKEN]
    end
    ENV -->|Injected via Vite env| MSG
    UI -. reset event .->|BusEventType.RESET| SID[Session Manager<br>useRef + regenerateSessionId]
```

## Connecting to a Real AI Backend

To connect to a real AI service, you'll need to:

1. Provide a custom `messaging.customSendMessage` handler in `ChatContainer`
2. Make API calls to your AI backend (OpenAI, watsonx, etc.)
3. Stream or batch responses using `instance.messaging.addMessage` / `addMessageChunk`
4. Add robust error handling and retries

See the [Carbon AI Chat documentation](https://chat.carbondesignsystem.com/tag/latest/docs/documents/Overview.html) for more details on server communication.

## Configuration Options

The chat is highly customizable. Check `src/App.jsx` to see configuration options for:

- Header title and assistant name
- Launcher visibility and desktop call-to-action
- Home screen greeting and starter buttons
- Input placeholder (via language pack overrides)
- Theme, layout, and messaging behavior
- And much more!

## Documentation

- [Carbon AI Chat Overview](https://chat.carbondesignsystem.com/tag/latest/docs/documents/Overview.html)
- [React Documentation](https://chat.carbondesignsystem.com/tag/latest/docs/documents/Using%20with%20React.html)
- [Server Communication](https://chat.carbondesignsystem.com/tag/latest/docs/documents/Server%20communication.html)

## License

MIT

