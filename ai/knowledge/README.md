# ADADIVE Knowledge Base

This directory contains documentation used for retrieval-augmented generation (RAG).

## Structure

```
knowledge/
├── faqs/           # Frequently asked questions
├── docs/           # Platform documentation
└── contracts/      # Smart contract documentation
```

## Adding Documents

### FAQs
Add `.md` or `.txt` files to `faqs/` for user-facing Q&A content.

### Documentation
Add guides and tutorials to `docs/` for platform documentation.

### Smart Contracts
Add contract explanations to `contracts/` for technical details.

## Format Guidelines

- Use Markdown format for best rendering
- Include clear section headers
- Add code examples where relevant
- Keep documents focused on a single topic

## Auto-Loading

All `.md` and `.txt` files in these directories are automatically loaded
into the knowledge base at service startup.
