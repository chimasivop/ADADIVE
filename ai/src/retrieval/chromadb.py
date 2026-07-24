"""ChromaDB-based RAG retrieval for ADADIVE AI v2.

This module provides production-ready retrieval with:
- ChromaDB vector store
- Sentence-transformers embeddings
- Configurable embedding provider
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from ..config import get_settings
from ..llm.factory import get_llm_provider


@dataclass
class Document:
    """Represents a document for retrieval."""
    id: str
    content: str
    metadata: dict[str, Any] = field(default_factory=dict)
    embedding: np.ndarray | None = None


@dataclass
class RetrievalResult:
    """Result from a retrieval query."""
    content: str
    metadata: dict[str, Any]
    score: float
    document_id: str


class ChromaRetrieval:
    """
    ChromaDB-based retrieval system with embedding support.
    
    Features:
    - Persistent ChromaDB storage
    - Configurable embedding provider (OpenAI, sentence-transformers)
    - Metadata filtering
    - Hybrid search support
    """

    def __init__(
        self,
        persist_directory: Path | None = None,
        collection_name: str = "adadive_knowledge",
        embedding_provider: str = "openai",
    ):
        settings = get_settings()
        self.persist_directory = persist_directory or settings.chroma_persist_dir
        self.collection_name = collection_name
        self.embedding_provider = embedding_provider
        self._client = None
        self._collection = None
        self._initialized = False

    async def initialize(self) -> None:
        """Initialize the ChromaDB client and collection."""
        if self._initialized:
            return

        try:
            import chromadb
            from chromadb.config import Settings
        except ImportError:
            raise ImportError(
                "ChromaDB is required. Install with: pip install chromadb"
            )

        self._client = chromadb.PersistentClient(
            path=str(self.persist_directory),
            settings=Settings(anonymized_telemetry=False),
        )

        # Get or create collection with embedding function
        self._collection = self._client.get_or_create_collection(
            name=self.collection_name,
            metadata={"description": "ADADIVE knowledge base"},
        )

        self._initialized = True

    async def add_documents(
        self,
        documents: list[Document],
        embeddings: list[list[float]] | None = None,
    ) -> None:
        """
        Add documents to the vector store.
        
        Args:
            documents: List of Document objects
            embeddings: Optional pre-computed embeddings
        """
        if not self._initialized:
            await self.initialize()

        if not documents:
            return

        # Generate embeddings if not provided
        if embeddings is None:
            embeddings = await self._generate_embeddings(
                [doc.content for doc in documents]
            )

        # Prepare for ChromaDB
        ids = [doc.id for doc in documents]
        contents = [doc.content for doc in documents]
        metadatas = [doc.metadata for doc in documents]

        # Add to collection
        self._collection.add(
            ids=ids,
            documents=contents,
            embeddings=embeddings,
            metadatas=metadatas,
        )

    async def search(
        self,
        query: str,
        top_k: int = 5,
        filter_metadata: dict[str, Any] | None = None,
        min_score: float = 0.0,
    ) -> list[RetrievalResult]:
        """
        Search for relevant documents.
        
        Args:
            query: Search query
            top_k: Number of results to return
            filter_metadata: Filter by metadata
            min_score: Minimum similarity score threshold
            
        Returns:
            List of RetrievalResult objects
        """
        if not self._initialized:
            await self.initialize()

        # Generate query embedding
        query_embedding = await self._generate_embeddings([query])
        query_embedding = query_embedding[0]

        # Search in ChromaDB
        results = self._collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            where=filter_metadata,
            include=["documents", "metadatas", "distances"],
        )

        retrieval_results = []
        if results["documents"] and results["documents"][0]:
            for i, doc in enumerate(results["documents"][0]):
                distance = results["distances"][0][i] if results["distances"] else 1.0
                # Convert distance to similarity score (lower distance = higher score)
                score = max(0.0, 1.0 - distance / 2.0)

                if score >= min_score:
                    retrieval_results.append(
                        RetrievalResult(
                            content=doc,
                            metadata=results["metadatas"][0][i] if results["metadatas"] else {},
                            score=score,
                            document_id=results["ids"][0][i] if results["ids"] else f"doc_{i}",
                        )
                    )

        return retrieval_results

    async def _generate_embeddings(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings using the configured provider."""
        if self.embedding_provider == "openai":
            llm_provider = get_llm_provider()
            return await llm_provider.embed(texts)
        else:
            # Fallback to sentence-transformers
            return await self._sentence_transformers_embed(texts)

    async def _sentence_transformers_embed(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings using sentence-transformers."""
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError:
            raise ImportError(
                "sentence-transformers is required for local embeddings. "
                "Install with: pip install sentence-transformers"
            )

        # Use a cached model
        if not hasattr(self, "_st_model"):
            self._st_model = SentenceTransformer("all-MiniLM-L6-v2")

        embeddings = self._st_model.encode(texts, show_progress_bar=False)
        return embeddings.tolist()

    async def delete_collection(self) -> None:
        """Delete the collection and all documents."""
        if self._client is not None:
            try:
                self._client.delete_collection(self.collection_name)
            except Exception:
                pass
            self._initialized = False

    async def get_document_count(self) -> int:
        """Get the number of documents in the collection."""
        if not self._initialized:
            await self.initialize()
        return self._collection.count()
