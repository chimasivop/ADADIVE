# ADADIVE AI Service

An intelligent AI assistant for the ADADIVE decentralized storage platform, powered by retrieval-augmented generation (RAG).

## Overview

The ADADIVE AI service provides a conversational interface for users to:
- Learn about the ADADIVE platform and how it works
- Get answers about storage deals, providers, and pricing
- Understand smart contract mechanics (deal escrow)
- Query their own storage deal history (with authentication)
- Get help with platform features and troubleshooting

## Features

### Core Capabilities
- **Chat Interface**: Natural language conversations about ADADIVE
- **RAG-Powered Responses**: Knowledge-augmented answers from platform documentation
- **User Context**: Authenticated access to personal deal information
- **Conversation History**: Session-based context for multi-turn conversations

### Security Design
- **No Database Access**: AI is isolated from direct PostgreSQL queries
- **Backend API Integration**: All user data retrieved through secure API endpoints
- **No Transaction Signing**: AI cannot move funds or execute blockchain transactions
- **JWT Authentication**: User context only available with valid tokens

### Architecture Principles
```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Client   │────▶│  ADADIVE AI  │────▶│  Backend API    │
│   (Web)    │◀────│   Service    │◀────│   (Deals/Stats) │
└─────────────┘     └──────────────┘     └─────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Knowledge    │
                    │ Base (RAG)   │
                    └──────────────┘
```

## Quick Start

### Prerequisites
- Python 3.11+
- pip or uv package manager

### Installation

1. Clone the repository and navigate to the AI service:

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

3. Create a `.env` file with your configuration:

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

Create a `.env` file or set environment variables:

```bash
# API Settings
AI_API_HOST=0.0.0.0
AI_API_PORT=8000
AI_API_DEBUG=true

# CORS (comma-separated)
AI_ALLOWED_ORIGINS=http://localhost:3000,https://adadive.xyz

# LLM Provider (choose one)
AI_LLM_PROVIDER=openai  # openai, anthropic, ollama

# OpenAI
AI_OPENAI_API_KEY=sk-...
AI_OPENAI_MODEL=gpt-4o-mini

# Anthropic
AI_ANTHROPIC_API_KEY=sk-ant-...
AI_ANTHROPIC_MODEL=claude-3-haiku-20240307

# Ollama (local)
AI_OLLAMA_BASE_URL=http://localhost:11434
AI_OLLAMA_MODEL=llama3.2

# Backend API (ADADIVE Platform)
AI_BACKEND_API_BASE_URL=http://localhost:3001
AI_BACKEND_API_TIMEOUT=30

# Retrieval
AI_RETRIEVAL_TOP_K=5
AI_RETRIEVAL_SCORE_THRESHOLD=0.5

# Authentication
AI_AUTH_ENABLED=false
AI_JWT_SECRET=your-secret-key
```

### LLM Provider Setup

#### OpenAI (Recommended)
1. Get an API key from https://platform.openai.com
2. Set `AI_LLM_PROVIDER=openai`
3. Set `AI_OPENAI_API_KEY=sk-...`

#### Anthropic
1. Get an API key from https://console.anthropic.com
2. Set `AI_LLM_PROVIDER=anthropic`
3. Set `AI_ANTHROPIC_API_KEY=sk-ant-...`

#### Ollama (Local)
1. Install Ollama from https://ollama.ai
2. Pull a model: `ollama pull llama3.2`
3. Set `AI_LLM_PROVIDER=ollama`
4. Ensure Ollama is running: `ollama serve`

## API Endpoints

### Chat

#### `POST /api/ai/chat`
Send a message and receive an AI response.

**Request:**
```json
{
  "message": "How do storage deals work?",
  "token": "optional-jwt-token",
  "anonymous_id": "optional-session-id",
  "conversation_id": "optional-existing-conversation-id",
  "enable_rag": true
}
```

**Response:**
```json
{
  "message": "Storage deals on ADADIVE work by...",
  "conversation_id": "uuid-of-conversation",
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

#### `GET /api/ai/chat/history/{conversation_id}`
Get conversation history.

#### `DELETE /api/ai/chat/history/{conversation_id}`
Delete a conversation.

### Knowledge

#### `GET /api/ai/sources`
Query the knowledge base.

**Query Parameters:**
- `query`: Search query
- `top_k`: Number of results (default: 5)

### System

#### `GET /health`
Health check endpoint.

#### `GET /api/ai/config`
Get public service configuration.

## Integration with ADADIVE

### Frontend Integration

The AI service is designed to work with the ADADIVE frontend:

```typescript
// Example: Integrating with ADADIVE frontend
const response = await fetch('https://ai.adadive.xyz/api/ai/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    message: userMessage,
    token: authToken, // From OIDC login
  }),
});

const { message, sources } = await response.json();
```

### Backend API Integration

The AI service retrieves data from the ADADIVE backend API:

| Endpoint | Data Retrieved |
|----------|---------------|
| `GET /api/deals` | User's storage deals |
| `GET /api/providers` | Storage provider info |
| `GET /api/stats` | Platform statistics |

Configure the backend URL with `AI_BACKEND_API_BASE_URL`.

### Authentication Flow

1. User logs into ADADIVE (OIDC)
2. Frontend receives JWT token
3. Frontend passes token to AI service
4. AI service validates token and extracts user context
5. User-specific data (deals) is fetched via backend API

## Project Structure

```
ai/
├── pyproject.toml           # Python package configuration
├── README.md                # This file
├── .env.example             # Example environment configuration
├── src/
│   ├── __init__.py          # Package init
│   ├── main.py              # FastAPI application entry point
│   ├── routes.py            # API route definitions
│   ├── chat/                # Chat module
│   │   └── __init__.py      # Chat logic and conversation management
│   ├── prompts/             # Prompt templates
│   │   └── __init__.py      # System prompts and templates
│   ├── retrieval/           # RAG retrieval
│   │   └── __init__.py      # Vector store and knowledge base
│   ├── auth/                # Authentication
│   │   └── __init__.py      # JWT validation and user context
│   ├── config/              # Configuration
│   │   └── __init__.py      # Settings management
│   └── integrations/         # Backend integrations
│       └── __init__.py      # Backend API client
├── knowledge/               # RAG knowledge base
│   ├── faqs/                # FAQ documents
│   │   ├── general.md
│   │   └── pricing.md
│   ├── docs/                # Platform documentation
│   │   ├── getting-started.md
│   │   └── providers.md
│   └── contracts/           # Smart contract docs
│       └── escrow.md
└── tests/                  # Unit tests (future)
```

## Knowledge Base

The AI uses a retrieval-augmented approach:

1. **FAQs**: Common questions about the platform
2. **Documentation**: Getting started, platform features
3. **Contracts**: Smart contract mechanics

### Adding New Knowledge

Add `.md` or `.txt` files to the appropriate `knowledge/` subdirectory:

```
knowledge/
├── faqs/          # User-facing FAQs
├── docs/          # Platform documentation
└── contracts/     # Smart contract docs
```

The knowledge base auto-loads on startup.

## Development

### Running Tests
```bash
uv run pytest
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

### Adding New Features

1. **New chat capability**: Add to `src/chat/`
2. **New prompt template**: Add to `src/prompts/`
3. **New knowledge**: Add to `knowledge/`
4. **New API endpoint**: Add to `src/routes.py`

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
| Development | `AI_API_DEBUG=true`, local Ollama |
| Staging | `AI_API_DEBUG=false`, testnet API |
| Production | `AI_API_DEBUG=false`, mainnet API, auth enabled |

## Security Considerations

### What the AI CAN Do
- Answer questions about ADADIVE
- Retrieve public documentation
- Access user-specific data (with authentication) via backend API
- Provide deal summaries and statistics

### What the AI CANNOT Do
- Sign transactions or move funds
- Access private keys
- Query databases directly
- Execute blockchain transactions
- Modify user accounts

### Rate Limiting
Configure rate limits via environment variables:
- `AI_RATE_LIMIT_REQUESTS`: Max requests per window (default: 30)
- `AI_RATE_LIMIT_WINDOW_SECONDS`: Time window (default: 60)

## Future Enhancements

- [ ] Streaming responses (SSE)
- [ ] Multi-language support
- [ ] Image/File upload support
- [ ] Web search for current information
- [ ] Advanced analytics
- [ ] Provider recommendations
- [ ] Automated deal management suggestions

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
