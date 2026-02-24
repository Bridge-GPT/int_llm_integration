# LLM Integration Cartridge (int_llm_integration)

A Salesforce Commerce Cloud (SFCC) cartridge that enables secure, configurable, server-side calls to external LLM providers (OpenAI, Anthropic, Google Gemini) using SFCC's Service Framework. This is a pure server-side integration with no storefront dependencies — it works with SFRA, SiteGenesis, PWA Kit (headless), and any other SFCC storefront architecture.

## Overview

This cartridge provides a unified interface for making LLM API calls from SFCC backend code. It abstracts away provider-specific details, allowing consumers to focus on their business logic while the cartridge handles:

- **Provider Abstraction**: Single API for OpenAI, Anthropic, and Gemini
- **Secure Credential Management**: API keys stored in Service Credentials (never in code)
- **Configuration Management**: Models and settings managed via Site Preferences
- **Reliability Features**: Timeouts, rate limiting, and circuit breakers via Service Framework
- **Normalized Responses**: Consistent response format across all providers
- **Error Handling**: Structured errors with categorized error types
- **Logging Security**: Automatic redaction of sensitive data in logs

## Installation

### Step 1: Add Cartridge to Cartridge Path

1. In Business Manager, navigate to **Administration → Sites → Manage Sites → [Your Site] → Settings**
2. Add `int_llm_integration` to your cartridge path before any cartridges that will use it

### Step 2: Import Service Configuration

1. In Business Manager, navigate to **Administration → Operations → Import & Export**
2. Under **Import & Export Files**, click **Upload**
3. Click **Choose File**, select `metadata/services.xml` from the cartridge, and click **Upload**
4. Return to **Administration → Operations → Import & Export**
5. Under **Services**, click **Import**
6. Select `services.xml` and click **Next**
7. Select **Merge** as the import mode and click **Import**
8. Confirm the status shows **Success**

This creates three service definitions (`llm.openai`, `llm.anthropic`, `llm.gemini`), their credentials, and their profiles.

### Step 3: Import Site Preferences

1. In Business Manager, navigate to **Administration → Site Development → Import & Export**
2. Under **Import & Export Files**, click **Upload**
3. Click **Choose File**, select `metadata/meta/system-objecttype-extensions.xml` from the cartridge, and click **Upload**
4. Return to **Administration → Site Development → Import & Export**
5. Under **Meta Data**, click **Import**
6. Select `system-objecttype-extensions.xml`, click **Next**, then click **Import**
7. Confirm the status shows **Success**

This creates the LLM Integration custom preference group with five site preference attributes.

### Step 4: Configure Service Credentials

1. Navigate to **Administration → Operations → Services → Credentials**
2. For each provider you want to use, edit the corresponding credential:

| Credential ID | Password Field |
|--------------|----------------|
| `llm.openai.cred` | Your OpenAI API key |
| `llm.anthropic.cred` | Your Anthropic API key |
| `llm.gemini.cred` | Your Google Gemini API key |

### Step 5: Configure Site Preferences

1. Navigate to **Merchant Tools → Site Preferences → Custom Preferences**
2. Select the **LLM Integration** preference group
3. Configure the following preferences:

| Preference | Type | Default | Description |
|------------|------|---------|-------------|
| `llmAvailableModelsJson` | Text | (see below) | JSON object mapping providers to tier/model pairs |
| `llmAnthropicApiVersion` | String | `2023-06-01` | Required `anthropic-version` header for Anthropic API calls |
| `llmDebugMode` | Boolean | `false` | Include raw provider responses in output (disable in production) |
| `llmDefaultModel` | String | `gpt-5.2` | Default model identifier — provider is resolved automatically from the models JSON |
| `llmSystemInstructions` | Text | (empty) | Persistent system-level instructions included with every LLM request |

#### Available Models JSON Format

```json
{
  "openai": {
    "cheap": "gpt-5-nano",
    "basic": "gpt-5-mini",
    "premium": "gpt-5.2"
  },
  "anthropic": {
    "cheap": "claude-haiku-4-5",
    "basic": "claude-sonnet-4-5",
    "premium": "claude-opus-4-5"
  },
  "gemini": {
    "cheap": "gemini-2.5-flash-lite",
    "basic": "gemini-3-flash-preview",
    "premium": "gemini-3-pro-preview"
  }
}
```

### Step 6: Set Service Mode

1. Navigate to **Administration → Operations → Services**
2. For each LLM service (`llm.openai`, `llm.anthropic`, `llm.gemini`):
   - Set to **Live** for production use
   - Set to **Mock** for development/testing without API calls

### Step 7: Verify Installation

The cartridge includes a test controller with three endpoints for verifying your setup. Replace `<sandbox>` with your sandbox hostname and `<site>` with your site ID (e.g., `Sites-SiteGenesis-Site`).

**1. Ping test** — confirms the cartridge is on the cartridge path and loading:
```
https://<sandbox>/on/demandware.store/<site>/default/LLMTest-Ping
```
Expected response: `pong - LLM Integration cartridge is loaded`

**2. Config test** — confirms site preferences are imported and readable:
```
https://<sandbox>/on/demandware.store/<site>/default/LLMTest-Config
```
Expected response: JSON showing your configured providers, models, and Anthropic API version.

**3. Integration test** — full round-trip to a live LLM provider:
```
https://<sandbox>/on/demandware.store/<site>/default/LLMTest-Test?provider=openai&model=gpt-5-mini
```
Expected response: JSON with `"success": true` and the LLM's reply. If this fails, check the `hint` field in the error response for troubleshooting guidance.

## Usage

### Basic Usage

```javascript
'use strict';

var LLMClient = require('*/cartridge/scripts/helpers/llmClient');

// Make a simple request
var response = LLMClient.generateText({
    provider: 'openai',
    model: 'gpt-5-mini',
    messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the capital of France?' }
    ]
});

// Use the response
var answer = response.content; // "The capital of France is Paris."
```

### With Parameters

```javascript
var response = LLMClient.generateText({
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    messages: [
        { role: 'user', content: 'Write a haiku about coding.' }
    ],
    params: {
        temperature: 0.7,
        max_tokens: 100
    }
});
```

### Multi-Turn Conversation

```javascript
var response = LLMClient.generateText({
    provider: 'openai',
    model: 'gpt-5-mini',
    messages: [
        { role: 'system', content: 'You are a helpful shopping assistant.' },
        { role: 'user', content: 'I need a gift for my mom.' },
        { role: 'assistant', content: 'What are her interests?' },
        { role: 'user', content: 'She loves gardening and cooking.' }
    ]
});
```

### Error Handling

```javascript
try {
    var response = LLMClient.generateText({
        provider: 'openai',
        model: 'gpt-5-mini',
        messages: [{ role: 'user', content: 'Hello!' }]
    });
    
    // Use response.content
    
} catch (e) {
    if (e.isLLMError) {
        switch (e.errorType) {
            case 'ValidationError':
                // Invalid request parameters
                break;
            case 'AuthenticationError':
                // Invalid or missing API key
                break;
            case 'RateLimitError':
                // Provider rate limit exceeded
                break;
            case 'TimeoutError':
                // Request timed out
                break;
            case 'ProviderError':
                // Provider-side error
                break;
            case 'ConfigurationError':
                // Missing or invalid configuration
                break;
        }
    }
    
    // Log error (message is already sanitized by the cartridge)
    Logger.error('LLM call failed: ' + e.message);
}
```

## API Reference

### `LLMClient.generateText(options)`

Makes a request to an LLM provider.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | string | Yes | `'openai'`, `'anthropic'`, or `'gemini'` |
| `model` | string | Yes | Model identifier (must be configured in `llmAvailableModelsJson`) |
| `messages` | array | Yes | Array of message objects |
| `params` | object | No | Provider-specific parameters |

#### Message Object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `role` | string | Yes | `'system'`, `'user'`, or `'assistant'` |
| `content` | string | Yes | The message text |

#### Common Parameters

| Parameter | Description |
|-----------|-------------|
| `temperature` | Controls randomness (0-2) |
| `max_tokens` | Maximum tokens in response |

#### Return Value

```javascript
{
    provider: 'openai',           // Provider name
    model: 'gpt-5-mini',          // Actual model used
    content: 'Response text...',  // Generated text
    usage: {
        promptTokens: 25,
        completionTokens: 50,
        totalTokens: 75
    },
    finishReason: 'stop'          // 'stop', 'length', 'end_turn', etc.
}
```

## Configuration Reference

### Site Preferences

| Preference ID | Type | Default | Description |
|---------------|------|---------|-------------|
| `llmAvailableModelsJson` | Text | (see Installation) | JSON object mapping providers to tier/model pairs |
| `llmAnthropicApiVersion` | String | `2023-06-01` | Anthropic API version header (required for Anthropic) |
| `llmDebugMode` | Boolean | `false` | Include raw responses in output (disable in production) |
| `llmDefaultModel` | String | `gpt-5.2` | Default model identifier; provider resolved from models JSON |
| `llmSystemInstructions` | Text | (empty) | Persistent system-level instructions for all requests |

### Service Profile Settings

Each provider service includes these configurable settings:

| Setting | Default | Description |
|---------|---------|-------------|
| Timeout | 120000ms (120s) | Maximum wait time for response |
| Rate Limit Calls | 60 | Max calls per interval |
| Rate Limit Interval | 60000ms | Rate limit window |
| Circuit Breaker Calls | 3 | Failures before tripping |
| Circuit Breaker Interval | 30000ms | Reset interval after trip |

## Provider-Specific Notes

### OpenAI

- **Authentication**: Bearer token in Authorization header
- **Endpoint**: `POST https://api.openai.com/v1/chat/completions`
- **Parameters**: Supports all standard chat completion parameters (temperature, max_tokens, top_p, etc.)

### Anthropic

- **Authentication**: `x-api-key` header
- **Version Header**: Requires `anthropic-version` header (configured via `llmAnthropicApiVersion`)
- **Endpoint**: `POST https://api.anthropic.com/v1/messages`
- **System Messages**: Automatically extracted to separate `system` field
- **Required**: `max_tokens` parameter (defaults to 4096 if not specified)

### Gemini

- **Authentication**: `X-Goog-Api-Key` header
- **Endpoint**: Model name included in URL path
  - `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- **Role Mapping**: `assistant` → `model`
- **System Messages**: Sent via `systemInstruction` field
- **Parameters**: Use `maxOutputTokens` instead of `max_tokens`

## Troubleshooting

### Missing API Key

**Error**: `ConfigurationError: OpenAI API key not configured in service credential`

**Solution**: Navigate to Administration → Operations → Services → Credentials and set the Password field for the provider's credential.

### Invalid Model

**Error**: `ValidationError: Model "unknown-model" is not available for provider "openai"`

**Solution**: Update `llmAvailableModelsJson` to include the model, or use a model that's already configured.

### Rate Limiting

**Error**: `RateLimitError: openai rate limit exceeded`

**Solution**: 
1. Check your provider's rate limits
2. Adjust the Service Profile rate limiter settings
3. Implement retry logic with exponential backoff

### Timeout

**Error**: `TimeoutError` or service call fails

**Solution**:
1. Increase the timeout in the Service Profile (Administration → Operations → Services)
2. Consider using smaller/faster models for time-sensitive operations
3. For job contexts, timeouts can be increased to 30000ms

### Circuit Breaker Tripped

**Symptom**: Calls immediately fail without reaching the provider

**Solution**: The circuit breaker trips after consecutive failures. Wait for the reset interval (default 30 seconds) and the breaker will auto-reset.

## Testing

### Mock Mode

Set services to Mock mode in Business Manager for development:

1. Navigate to Administration → Operations → Services
2. Edit each LLM service
3. Enable **Mock Mode**

Mock responses include the requested model name for verification:

```javascript
// Mock response content: "This is a mock response from OpenAI. Model: gpt-5-mini"
```

### Integration Testing

For integration tests against real APIs:

1. Set services to Live mode
2. Configure valid API keys in credentials
3. Use actual model identifiers

## Security Considerations

- **API Keys**: Never commit API keys to code; always use Service Credentials
- **Logging**: The cartridge automatically redacts API keys and sensitive headers from logs
- **Debug Mode**: Disable `llmDebugMode` in production to avoid exposing raw responses
- **Rate Limiting**: Configure rate limits to prevent unexpected API costs
- **PII**: Avoid sending personally identifiable information in prompts

## File Structure

```
int_llm_integration/
├── cartridge/
│   ├── int_llm_integration.properties
│   ├── controllers/
│   │   └── LLMTest.js                    # Test/verification controller
│   └── scripts/
│       ├── helpers/
│       │   ├── llmClient.js              # Main entry point
│       │   ├── llmConfigHelper.js        # Configuration management
│       │   ├── llmErrorHelper.js         # Error handling
│       │   ├── llmNormalizationHelper.js # Request/response transformation
│       │   └── llmValidationHelper.js    # Request validation
│       └── services/
│           ├── llmOpenAIService.js       # OpenAI service
│           ├── llmAnthropicService.js    # Anthropic service
│           └── llmGeminiService.js       # Gemini service
├── metadata/
│   ├── services.xml                      # Service definitions (3 services, credentials, profiles)
│   └── meta/
│       └── system-objecttype-extensions.xml  # Site preference attributes
├── test/
│   └── unit/
│       └── scripts/helpers/
│           ├── llmConfigHelper.test.js
│           ├── llmErrorHelper.test.js
│           ├── llmNormalizationHelper.test.js
│           └── llmValidationHelper.test.js
├── package.json
└── README.md
```

## Compatibility

This cartridge is a pure server-side integration with **no storefront dependencies**. It does not use SFRA's `server.js`, `module.superModule`, ISML templates, or any `app_storefront_base` modules. It relies only on core SFCC platform APIs (`dw/system/Logger`, `dw/system/Site`, `dw/svc/LocalServiceRegistry`).

It is compatible with:
- **SFRA** (Storefront Reference Architecture)
- **SiteGenesis** (pipeline and controller variants)
- **PWA Kit / Composable Storefront** (headless) — consumed via SCAPI hooks, SCAPI Custom APIs, or job scripts
- **Any custom storefront** built on SFCC

In a headless (PWA Kit) environment, the cartridge runs entirely on the SFCC instance. Frontend code consumes it indirectly through SCAPI Custom API endpoints or SCAPI/OCAPI hooks that `require('*/cartridge/scripts/helpers/llmClient')`.

## License

This project is open source and available under the [MIT License](LICENSE).

Copyright (c) 2026 Bridge GPT.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software.

See the [LICENSE](LICENSE) file for the full text.
