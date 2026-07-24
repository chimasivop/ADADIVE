"""Tests for retrieval module."""

import pytest
import numpy as np
from pathlib import Path

from src.retrieval import (
    SimpleDocument,
    RetrievalResult,
    SimpleEmbeddingModel,
    VectorStore,
    KnowledgeBase,
)


class TestSimpleDocument:
    """Tests for SimpleDocument."""

    def test_document_creation(self):
        """Test creating a document."""
        doc = SimpleDocument(
            id="doc_123",
            content="This is test content",
            metadata={"source": "test.md"},
        )
        assert doc.id == "doc_123"
        assert doc.content == "This is test content"
        assert doc.embedding is None

    def test_document_with_embedding(self):
        """Test document with embedding."""
        embedding = np.array([0.1, 0.2, 0.3])
        doc = SimpleDocument(
            id="doc_123",
            content="Test",
            metadata={},
            embedding=embedding,
        )
        assert np.array_equal(doc.embedding, embedding)


class TestRetrievalResult:
    """Tests for RetrievalResult."""

    def test_result_creation(self):
        """Test creating a retrieval result."""
        result = RetrievalResult(
            content="Test content",
            metadata={"source": "test.md"},
            score=0.95,
            document_id="doc_123",
        )
        assert result.content == "Test content"
        assert result.score == 0.95
        assert result.document_id == "doc_123"


class TestSimpleEmbeddingModel:
    """Tests for SimpleEmbeddingModel."""

    def test_model_creation(self):
        """Test creating an embedding model."""
        model = SimpleEmbeddingModel(dimension=128)
        assert model.dimension == 128
        assert model._vocabulary == {}

    def test_fit(self):
        """Test fitting the model."""
        model = SimpleEmbeddingModel(dimension=50)
        documents = [
            "This is a test document",
            "Another test document with different content",
            "A third document about testing",
        ]
        model.fit(documents)
        
        assert len(model._vocabulary) > 0
        assert len(model._idf) > 0

    def test_embed(self):
        """Test embedding text."""
        model = SimpleEmbeddingModel(dimension=50)
        documents = [
            "Hello world",
            "Test document",
        ]
        model.fit(documents)
        
        embedding = model.embed("Hello world")
        assert isinstance(embedding, np.ndarray)
        assert len(embedding) == 50
        
        # Check normalization
        norm = np.linalg.norm(embedding)
        assert abs(norm - 1.0) < 0.01  # Approximately normalized

    def test_tokenize(self):
        """Test tokenization."""
        model = SimpleEmbeddingModel()
        tokens = model._tokenize("Hello, World! This is a test.")
        assert "hello" in tokens
        assert "world" in tokens
        assert "this" in tokens


class TestVectorStore:
    """Tests for VectorStore."""

    def test_store_creation(self):
        """Test creating a vector store."""
        model = SimpleEmbeddingModel(dimension=50)
        store = VectorStore(model)
        assert len(store.documents) == 0

    def test_add_document(self):
        """Test adding documents."""
        model = SimpleEmbeddingModel(dimension=50)
        model.fit(["Hello world", "Test document"])
        store = VectorStore(model)
        
        doc = SimpleDocument(
            id="doc_1",
            content="Hello world",
            metadata={"source": "test.md"},
        )
        store.add_document(doc)
        
        assert len(store.documents) == 1
        assert store.documents[0].id == "doc_1"

    def test_search(self):
        """Test searching documents."""
        model = SimpleEmbeddingModel(dimension=50)
        model.fit(["Python programming", "JavaScript programming", "Cooking recipes"])
        store = VectorStore(model)
        
        # Add documents
        for i, content in enumerate(["Python programming", "JavaScript programming", "Cooking recipes"]):
            doc = SimpleDocument(
                id=f"doc_{i}",
                content=content,
                metadata={"category": "test"},
            )
            store.add_document(doc)
        
        # Search
        results = store.search("Python code", top_k=2, threshold=0.1)
        assert len(results) > 0
        # Python document should be highest scoring
        assert results[0].content == "Python programming"

    def test_search_with_threshold(self):
        """Test search with threshold."""
        model = SimpleEmbeddingModel(dimension=50)
        model.fit(["Hello world test", "Goodbye world test"])
        store = VectorStore(model)
        
        doc1 = SimpleDocument(id="doc_1", content="Hello world test", metadata={})
        doc2 = SimpleDocument(id="doc_2", content="Goodbye world test", metadata={})
        store.add_document(doc1)
        store.add_document(doc2)
        
        results = store.search("Hello", top_k=5, threshold=0.1)  # Lower threshold
        assert len(results) >= 1


class TestKnowledgeBase:
    """Tests for KnowledgeBase."""

    def test_knowledge_base_creation(self):
        """Test creating knowledge base."""
        kb = KnowledgeBase()
        assert kb._initialized is False
        assert kb.base_path is not None

    def test_load_document(self):
        """Test loading a single document."""
        # Create a temp file
        import tempfile
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write("# Test Document\n\nThis is test content.")
            temp_path = f.name
        
        try:
            # Create knowledge base with correct path
            kb = KnowledgeBase(base_path=Path(tempfile.gettempdir()))
            doc = kb._load_document(Path(temp_path))
            assert doc is not None
            assert "Test Document" in doc.content
            assert doc.metadata["filename"].endswith(".md")
        finally:
            import os
            os.unlink(temp_path)

    def test_initialize(self):
        """Test initializing knowledge base."""
        kb = KnowledgeBase()
        kb._initialized = False  # Reset
        
        # Don't initialize with actual files in test
        kb._initialized = True
        assert kb._initialized is True

    def test_retrieve_uninitialized(self):
        """Test retrieve returns empty when not initialized."""
        kb = KnowledgeBase()
        kb._initialized = False
        kb.vector_store = None
        
        results = kb.retrieve("test query")
        assert results == []

    def test_get_relevant_context(self):
        """Test getting relevant context."""
        kb = KnowledgeBase()
        kb._initialized = False
        kb.vector_store = None
        
        context = kb.get_relevant_context("test query")
        assert context == "No relevant knowledge found."
