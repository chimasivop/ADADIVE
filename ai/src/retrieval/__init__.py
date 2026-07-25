"""Retrieval module for ADADIVE AI service - RAG functionality."""

import os
import hashlib
import json
from pathlib import Path
from typing import Any
from dataclasses import dataclass

import numpy as np

from ..config import get_settings


@dataclass
class Document:
    """Represents a document for retrieval."""

    id: str
    content: str
    metadata: dict[str, Any]
    embedding: np.ndarray | None = None

    def __post_init__(self):
        if self.embedding is not None and not isinstance(self.embedding, np.ndarray):
            self.embedding = np.array(self.embedding)


@dataclass
class RetrievalResult:
    """Result from a retrieval query."""

    content: str
    metadata: dict[str, Any]
    score: float
    document_id: str


class SimpleEmbeddingModel:
    """
    Simple embedding model using TF-IDF-like approach.
    
    In production, replace with sentence-transformers or OpenAI embeddings.
    This implementation provides a working fallback for development.
    """

    def __init__(self, dimension: int = 384):
        self.dimension = dimension
        self._vocabulary: dict[str, int] = {}
        self._idf: dict[str, float] = {}

    def _tokenize(self, text: str) -> list[str]:
        """Simple word tokenization."""
        import re
        text = text.lower()
        text = re.sub(r"[^\w\s]", " ", text)
        return text.split()

    def _compute_tfidf(self, tokens: list[str], doc_freq: dict[str, int], n_docs: int) -> np.ndarray:
        """Compute TF-IDF vector for a document."""
        tf = {}
        for token in tokens:
            tf[token] = tf.get(token, 0) + 1
        
        # Normalize term frequency
        if tokens:
            for token in tf:
                tf[token] /= len(tokens)
        
        # Compute TF-IDF
        vector = np.zeros(self.dimension)
        for token, freq in tf.items():
            if token in self._vocabulary:
                idx = self._vocabulary[token]
                idf = self._idf.get(token, 1.0)
                vector[idx] = freq * idf
        
        # Normalize
        norm = np.linalg.norm(vector)
        if norm > 0:
            vector /= norm
        
        return vector

    def fit(self, documents: list[str]) -> "SimpleEmbeddingModel":
        """Build vocabulary from documents."""
        # Collect all unique tokens
        all_tokens = set()
        for doc in documents:
            tokens = self._tokenize(doc)
            all_tokens.update(tokens)
        
        # Build vocabulary (limited size)
        self._vocabulary = {}
        for i, token in enumerate(sorted(all_tokens)):
            if i >= self.dimension:
                break
            self._vocabulary[token] = i
        
        # Compute document frequencies for IDF
        doc_freq = {}
        for doc in documents:
            tokens = set(self._tokenize(doc))
            for token in tokens:
                doc_freq[token] = doc_freq.get(token, 0) + 1
        
        n_docs = len(documents) if documents else 1
        for token, freq in doc_freq.items():
            self._idf[token] = np.log(n_docs / (freq + 1)) + 1
        
        return self

    def embed(self, text: str) -> np.ndarray:
        """Embed a single text."""
        tokens = self._tokenize(text)
        # Build temporary doc_freq for single doc
        doc_freq = {token: 1 for token in tokens}
        return self._compute_tfidf(tokens, doc_freq, 1)


class VectorStore:
    """Simple in-memory vector store for document retrieval."""

    def __init__(self, embedding_model: SimpleEmbeddingModel):
        self.embedding_model = embedding_model
        self.documents: list[Document] = []
        self.embeddings: list[np.ndarray] = []

    def add_document(self, document: Document) -> None:
        """Add a document to the store."""
        if document.embedding is None:
            document.embedding = self.embedding_model.embed(document.content)
        
        self.documents.append(document)
        self.embeddings.append(document.embedding)

    def search(
        self,
        query: str,
        top_k: int = 5,
        threshold: float = 0.0,
    ) -> list[RetrievalResult]:
        """Search for similar documents."""
        query_embedding = self.embedding_model.embed(query)
        
        results = []
        for doc, embedding in zip(self.documents, self.embeddings):
            # Cosine similarity
            similarity = float(np.dot(query_embedding, embedding))
            
            if similarity >= threshold:
                results.append(
                    RetrievalResult(
                        content=doc.content,
                        metadata=doc.metadata,
                        score=similarity,
                        document_id=doc.id,
                    )
                )
        
        # Sort by score and return top_k
        results.sort(key=lambda x: x.score, reverse=True)
        return results[:top_k]


class KnowledgeBase:
    """
    Knowledge base for ADADIVE documentation.
    
    Loads documents from the knowledge/ directory and provides
    retrieval functionality for RAG.
    """

    def __init__(self, base_path: Path | None = None):
        settings = get_settings()
        self.base_path = base_path or settings.knowledge_base_path
        self.embedding_model = SimpleEmbeddingModel(
            dimension=settings.embedding_dimension
        )
        self.vector_store: VectorStore | None = None
        self._initialized = False

    def _load_document(self, file_path: Path) -> Document | None:
        """Load a document from a file."""
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            # Generate stable ID from file path
            doc_id = hashlib.md5(str(file_path).encode()).hexdigest()[:12]
            
            return Document(
                id=doc_id,
                content=content,
                metadata={
                    "source": str(file_path.relative_to(self.base_path)),
                    "category": file_path.parent.name,
                    "filename": file_path.name,
                },
            )
        except Exception:
            return None

    def _load_directory(self, directory: Path, category: str = "") -> list[Document]:
        """Recursively load all text files from a directory."""
        documents = []
        
        if not directory.exists():
            return documents
        
        for item in directory.iterdir():
            if item.is_file() and item.suffix in [".txt", ".md", ".html"]:
                doc = self._load_document(item)
                if doc:
                    doc.metadata["category"] = category or item.parent.name
                    documents.append(doc)
            elif item.is_dir():
                documents.extend(self._load_directory(item, category or item.name))
        
        return documents

    def initialize(self) -> None:
        """Initialize the knowledge base by loading all documents."""
        if self._initialized:
            return
        
        # Load documents from subdirectories
        documents = []
        
        # Load FAQs
        faqs_dir = self.base_path / "faqs"
        documents.extend(self._load_directory(faqs_dir, "faqs"))
        
        # Load documentation
        docs_dir = self.base_path / "docs"
        documents.extend(self._load_directory(docs_dir, "documentation"))
        
        # Load contract documentation
        contracts_dir = self.base_path / "contracts"
        documents.extend(self._load_directory(contracts_dir, "smart_contracts"))
        
        # Train embedding model
        if documents:
            self.embedding_model.fit([doc.content for doc in documents])
            
            # Create vector store
            self.vector_store = VectorStore(self.embedding_model)
            
            # Add all documents
            for doc in documents:
                self.vector_store.add_document(doc)
        
        self._initialized = True

    def retrieve(
        self,
        query: str,
        top_k: int | None = None,
        threshold: float | None = None,
        category: str | None = None,
    ) -> list[RetrievalResult]:
        """
        Retrieve relevant documents for a query.
        
        Args:
            query: The search query
            top_k: Maximum number of results (default from settings)
            threshold: Minimum similarity score
            category: Filter by document category
        
        Returns:
            List of retrieval results
        """
        if not self._initialized:
            self.initialize()
        
        if self.vector_store is None:
            return []
        
        settings = get_settings()
        top_k = top_k or settings.retrieval_top_k
        threshold = threshold or settings.retrieval_score_threshold
        
        results = self.vector_store.search(
            query=query,
            top_k=top_k * 2,  # Get extra results for filtering
            threshold=threshold,
        )
        
        # Filter by category if specified
        if category:
            results = [r for r in results if r.metadata.get("category") == category]
        
        return results[:top_k]

    def get_relevant_context(self, query: str, max_length: int = 3000) -> str:
        """
        Get formatted context string for prompt augmentation.
        
        Args:
            query: The search query
            max_length: Maximum total length of context
        
        Returns:
            Formatted context string
        """
        results = self.retrieve(query)
        
        if not results:
            return "No relevant knowledge found."
        
        context_parts = []
        current_length = 0
        
        for result in results:
            part = f"[Source: {result.metadata.get('source', 'unknown')}]\n{result.content}\n"
            
            if current_length + len(part) > max_length:
                break
            
            context_parts.append(part)
            current_length += len(part)
        
        return "\n---\n".join(context_parts)


# Global knowledge base instance
_knowledge_base: KnowledgeBase | None = None


def get_knowledge_base() -> KnowledgeBase:
    """Get or create the global knowledge base instance."""
    global _knowledge_base
    if _knowledge_base is None:
        _knowledge_base = KnowledgeBase()
    return _knowledge_base
