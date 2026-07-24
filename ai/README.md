# ADADIVE AI Service v2

An intelligent multi-agent AI assistant for the ADADIVE decentralized storage platform, powered by retrieval-augmented generation (RAG) and streaming responses.

## Overview

ADADIVE AI v2 is a production-ready AI service providing:
- **Multi-Agent Architecture**: Specialized agents for support, storage, escrow, providers, and developers
- **RAG-Powered Responses**: Knowledge-augmented answers from platform documentation
- **Streaming Responses**: Real-time SSE streaming for smoother chat experience
- **Secure Tool Framework**: AI can call backend APIs without direct database access
- **Conversation Memory**: Multi-turn chat with persistent context

## Features

### Core Capabilities
- **Chat Interface**: Natural language conversations about ADADIVE
- **Multi-Agent System**: 5 specialized agents for different use cases
- **RAG-Powered Responses**: Knowledge-augmented answers from platform documentation
- **Streaming (SSE)**: Real-time response streaming via Server-Sent Events
- **User Context**: Authenticated access to personal deal information
- **Conversation Memory**: Session-based context for multi-turn conversations

### AI Agents

| Agent | Use Case |
|-------|----------|
| **Support Agent** | General platform support, troubleshooting, getting started |
| **Storage Agent** | Storage deals, file management, upload/download |
| **Escrow Agent** | Smart contracts, payment mechanics, settlement |
| **Provider Agent** | Storage provider info, selection, comparisons |
| **Developer Agent** | API documentation, SDK integration, technical guides |

### Security Design
- **No Database Access**: AI is isolated from direct PostgreSQL queries
- **Backend API Integration**: All user data retrieved through secure API endpoints
- **No Transaction Signing**: AI cannot move funds or execute blockchain transactions
- **No Private Key Handling**: AI never accesses wallet credentials
- **JWT Authentication**: User context only available with valid tokens

### Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                         ADADIVE AI v2                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Support  │  │ Storage  │  │  Escrow  │  │ Provider │       │
│  │  Agent   │  │  Agent   │  │  Agent   │  │  Agent   │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       └─────────────┴─────────────┴─────────────┘              │
│                           │                                    │
│                    ┌──────┴───────┐                          │
│                    │  Tool Layer  │                          │
│                    └──────┬───────┘                          │
│  ┌──────────┐  ┌─────────┴──────────┐  ┌──────────┐          │
│  │  Memory  │──│       LLM         │──│  RAG     │          │
│  │          │  │    (OpenAI/       │  │  Retrieval│          │
│  └──────────┘  │    Anthropic)     │  └──────────┘          │
│                └─────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
    ┌─────┴─────┐     ┌──────┴─────┐     ┌──────┴─────┐
    │ Backend   │     │ Knowledge  │     │  External  │
    │   API     │     │   Base     │     │   LLM      │
    └───────────┘     └────────────┘     └────────────┘
```

## Quick Start

### Prerequisites
- Python 3.11+
- pip or uv package manager

### Installation

1. Navigate to the AI service:

```bash
cd ai
```

2. Install dependencies with uv (recommended):

```bash
uv sync
```

Or with pip:

```bash
pip install -e .
```

3. Create a `.env` file:

```bash
cp .env.example .env
```

4. Configure your LLM provider (see Configuration section below)

5. Run the service:

```bash
# Development mode
uv run uvicorn src.main:app --reload --port 8000

# Or use the built-in runner
uv run python -m src.main
```

6. Open the API documentation at http://localhost:8000/docs

## Configuration

### Environment Variables

```bash
# API Settings
AI_API_HOST=0.0.0.0
AI_API_PORT=8000
AI_API_DEBUG=true

# CORS (comma-separated)
AI_ALLOWED_ORIGINS=http://localhost:3000,https://adadive.xyz

# LLM Provider (choose one)
AI_LLM_PROVIDER=openai  # openai, anthropic

# OpenAI
AI_OPENAI_API_KEY=sk-...
AI_OPENAI_MODEL=gpt-4o-mini

# Anthropic
AI_ANTHROPIC_API_KEY=sk-ant-...
AI_ANTHROPIC_MODEL=claude-sonnet-4-20250514

# Backend API (ADADIVE Platform)
AI_BACKEND_API_BASE_URL=http://localhost:3001
AI_BACKEND_API_TIMEOUT=30

# Retrieval / RAG
AI_USE_CHROMA_VECTORSTORE=false  # Use ChromaDB for production
AI_CHROMA_PERSIST_DIR=.chroma_db
AI_EMBEDDING_PROVIDER=openai
AI_RETRIEVAL_TOP_K=5
AI_RETRIEVAL_SCORE_THRESHOLD=0.5

# Memory
AI_CONVERSATION_MAX_HISTORY=20
AI_CONVERSATION_MAX_AGE_SECONDS=3600
AI_ENABLE_PERSISTENT_MEMORY=false

# Feature Flags
AI_ENABLE_RAG=true
AI_ENABLE_USER_CONTEXT=false
AI_ENABLE_STREAMING=true
```

## API Endpoints

### Chat

#### `POST /api/ai/chat`
Send a message and receive an AI response.

**Request:**
```json
{
  "message": "How do storage deals work?",
  "token": "optional-jwt-token",
  "conversation_id": "optional-existing-id",
  "agent_type": "support",
  "enable_rag": true
}
```

**Response:**
```json
{
  "message": "Storage deals on ADADIVE work by...",
  "conversation_id": "uuid-of-conversation",
  "agent_type": "support",
  "sources": [
    {
      "content": "...",
      "source": "faqs/general.md",
      "score": 0.87
    }
  ],
  "user_context": null,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

#### `POST /api/ai/chat/stream`
Streaming chat with SSE responses.

**Response (SSE events):**
```
event: source
data: {"index": 0, "source": "faqs/general.md", "score": 0.87}

event: token
data: {"token": "Storage", "done": false}

event: token
data: {"token": " deals", "done": false}

event: done
data: {"full_response": "...", "finish_reason": "stop"}
```

### Agents & Tools

#### `GET /api/ai/agents`
List all available agents.

#### `GET /api/ai/tools`
List all available tools.

### Knowledge

#### `GET /api/ai/sources`
Query the knowledge base.

### System

#### `GET /health`
Health check endpoint.

#### `GET /api/ai/config`
Get public service configuration.

## Project Structure

```
ai/
├── pyproject.toml           # Python package configuration
├── README.md                # This file
├── src/
│   ├── main.py              # FastAPI application entry point
│   ├── routes.py            # API route definitions
│   ├── chat/                # Chat module
│   │   └── __init__.py      # Chat logic and conversation management
│   ├── llm/                 # LLM Provider integration
│   │   ├── __init__.py
│   │   ├── base.py          # Base provider interface
│   │   ├── openai.py        # OpenAI provider
│   │   ├── anthropic.py      # Anthropic provider
│   │   ├── factory.py       # Provider factory
│   │   └── registry.py      # Provider registry
│   ├── agents/              # AI Agents
│   │   └── __init__.py      # Agent implementations
│   ├── memory/              # Conversation Memory
│   │   └── __init__.py      # Memory store and management
│   ├── tools/               # Secure Tool Framework
│   │   └── __init__.py      # Tool definitions and registry
│   ├── streaming/           # SSE Streaming
│   │   └── __init__.py      # Streaming utilities
│   ├── retrieval/           # RAG Retrieval
│   │   ├── __init__.py      # Knowledge base
│   │   └── chromadb.py      # ChromaDB integration
│   ├── auth/                # Authentication
│   │   └── __init__.py      # JWT validation and user context
│   ├── config/              # Configuration
│   │   └── __init__.py      # Settings management
│   └── integrations/        # Backend integrations
│       └── __init__.py      # Backend API client
├── knowledge/                # RAG knowledge base
│   ├── faqs/
│   ├── docs/
│   └── contracts/
└── tests/                   # Unit and integration tests
    ├── unit/
    └── integration/
```

## Extending the System

### Adding a New Agent

1. Create a new agent class in `src/agents/__init__.py`:

```python
class NewAgent(BaseAgent):
    def __init__(self):
        super().__init__(AgentConfig(
            agent_type=AgentType.NEW,
            name="New Agent",
            description="A new specialized agent",
            system_prompt="Your system prompt here...",
            tools=["get_platform_info"],
        ))

    def _build_system_prompt(self) -> str:
        return self.config.system_prompt

    async def _process_request(self, message, user_context, history):
        # Implement agent logic
        pass
```

2. Register it in `AgentFactory._create_agent()`.

3. Update `AgentType` enum.

### Adding a New Tool

1. Create a new tool class in `src/tools/__init__.py`:

```python
class NewTool(BaseTool):
    @property
    def name(self) -> str:
        return "new_tool"

    def _build_definition(self) -> ToolDefinition:
        return ToolDefinition(
            name=self.name,
            description="What the tool does",
            category=ToolCategory.INFO,
            permission=ToolPermission.PUBLIC,
            parameters={...},
            returns={...},
        )

    async def execute(self, parameters, user_context) -> ToolResult:
        # Implement tool logic
        pass
```

2. Register it in `get_tool_registry()`.

### Adding a New LLM Provider

1. Create a new provider in `src/llm/`:

```python
class NewProvider(LLMProvider):
    @property
    def provider_name(self) -> str:
        return "new"

    @property
    def default_model(self) -> str:
        return "new-model"

    async def generate(self, messages, options=None):
        # Implement generate
        pass

    async def stream(self, messages, options=None):
        # Implement streaming
        pass

    async def embed(self, texts):
        # Implement embeddings
        pass
```

2. Register it in `src/llm/registry.py`.

## Development

### Running Tests
```bash
# All tests
uv run pytest

# Unit tests only
uv run pytest tests/unit/

# Integration tests only
uv run pytest tests/integration/

# With coverage
uv run pytest --cov=src --cov-report=html
```

### Code Quality
```bash
# Format
uv run ruff format .

# Lint
uv run ruff check .

# Type check
uv run mypy src/
```

## Deployment

### Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml .
RUN pip install uv && uv sync --frozen
COPY src/ ./src/
COPY knowledge/ ./knowledge/
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Environment-Specific Config

| Environment | Variables |
|------------|-----------|
| Development | `AI_API_DEBUG=true` |
| Staging | `AI_API_DEBUG=false`, testnet API |
| Production | `AI_USE_CHROMA_VECTORSTORE=true`, auth enabled |

## Security

### What the AI CAN Do
- Answer questions about ADADIVE
- Retrieve public documentation
- Access user-specific data (with authentication) via backend API
- Provide deal summaries and statistics
- Call authorized tools for live data

### What the AI CANNOT Do
- Sign transactions or move funds
- Access private keys or wallet credentials
- Query databases directly
- Execute blockchain transactions
- Modify user accounts

## Changelog

### v2.0.0 (Current)
- Multi-agent architecture with 5 specialized agents
- SSE streaming for real-time responses
- Secure tool framework for backend API calls
- Conversation memory with auto-cleanup
- ChromaDB support for production RAG
- OpenAI and Anthropic providers with streaming

### v0.1.0 (Previous)
- Basic RAG-powered chat
- Simple conversation history
- OpenAI integration

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push to branch: `git push origin feat/your-feature`
5. Open a Pull Request

## License

See the ADADIVE repository license.

## Support

- Documentation: https://docs.adadive.xyz
- Discord: https://discord.gg/adadive
- Email: support@adadive.xyz
