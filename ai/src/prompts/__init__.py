"""Prompts module for ADADIVE AI service."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SystemPrompt:
    """Container for system prompt components."""

    role: str
    content: str
    description: str = ""


@dataclass
class PromptTemplate:
    """Template for constructing prompts with context."""

    name: str
    system_prompt: str
    user_template: str
    context_keys: list[str] = field(default_factory=list)


# Core system prompt for ADADIVE AI assistant
ADADIVE_SYSTEM_PROMPT = """You are ADADIVE AI, an intelligent assistant for the ADADIVE decentralized storage platform on Cardano.

Your capabilities:
- Answer questions about the ADADIVE platform, storage deals, and Cardano blockchain
- Provide information about storage providers and deal statuses
- Explain smart contract functionality (deal escrow mechanics)
- Help users understand storage pricing and duration options
- Guide users through platform features

IMPORTANT RESTRICTIONS:
- You CANNOT sign transactions or move funds
- You CANNOT access private keys or wallet credentials
- You CANNOT make decisions on behalf of users
- You CANNOT execute blockchain transactions
- You should NEVER recommend specific financial actions

When users ask about their personal data (deals, wallet addresses, etc.), you should:
1. Clarify that you need proper authentication
2. Explain that this data is retrieved through secure backend APIs
3. Never query databases directly - all user data comes through authenticated API calls

Be helpful, accurate, and concise. When uncertain, acknowledge limitations.
"""


# Prompt templates for different query types
PROMPT_TEMPLATES: dict[str, PromptTemplate] = {
    "general": PromptTemplate(
        name="general",
        system_prompt=ADADIVE_SYSTEM_PROMPT,
        user_template="Answer the following question about ADADIVE:\n\n{user_message}",
        context_keys=["relevant_knowledge"],
    ),
    "deals": PromptTemplate(
        name="deals",
        system_prompt=ADADIVE_SYSTEM_PROMPT + "\n\nThe user is asking about storage deals.",
        user_template="Based on the following context about storage deals:\n\n{relevant_knowledge}\n\nAnswer this question:\n{user_message}",
        context_keys=["deals_info", "relevant_knowledge"],
    ),
    "providers": PromptTemplate(
        name="providers",
        system_prompt=ADADIVE_SYSTEM_PROMPT + "\n\nThe user is asking about storage providers.",
        user_template="Based on the following context about storage providers:\n\n{relevant_knowledge}\n\nAnswer this question:\n{user_message}",
        context_keys=["providers_info", "relevant_knowledge"],
    ),
    "contracts": PromptTemplate(
        name="contracts",
        system_prompt=ADADIVE_SYSTEM_PROMPT + "\n\nThe user is asking about smart contracts.",
        user_template="Based on the following smart contract documentation:\n\n{relevant_knowledge}\n\nAnswer this question:\n{user_message}",
        context_keys=["contract_docs", "relevant_knowledge"],
    ),
    "user_deals": PromptTemplate(
        name="user_deals",
        system_prompt=ADADIVE_SYSTEM_PROMPT + "\n\nThe user is asking about their personal storage deals. "
        + "This information is retrieved through authenticated backend API calls.",
        user_template="Based on the user's deal information (retrieved via authenticated API):\n\n{user_deals_data}\n\nAnd relevant platform knowledge:\n{relevant_knowledge}\n\nAnswer the user's question:\n{user_message}",
        context_keys=["user_deals_data", "relevant_knowledge"],
    ),
}


def get_prompt_template(query_type: str = "general") -> PromptTemplate:
    """Get a prompt template by type, defaulting to general."""
    return PROMPT_TEMPLATES.get(query_type, PROMPT_TEMPLATES["general"])


def build_augmented_prompt(
    template: PromptTemplate,
    user_message: str,
    context: dict[str, Any],
) -> tuple[str, str]:
    """
    Build a complete prompt with context augmentation.

    Returns:
        Tuple of (system_prompt, user_prompt_with_context)
    """
    # Prepare context strings
    context_values = {}
    for key in template.context_keys:
        if key in context and context[key]:
            context_values[key] = context[key]
        else:
            context_values[key] = "No specific information available."

    # Format user template with context
    user_prompt = template.user_template.format(
        user_message=user_message,
        **context_values,
    )

    return template.system_prompt, user_prompt
