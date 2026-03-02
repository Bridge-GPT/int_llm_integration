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

This creates the LLM Integration custom preference group with six site preference attributes.

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
| `llmTestModeEnabled` | Boolean | `false` | Enables the connection test page — **never leave enabled in production** |

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

The cartridge includes a built-in connection test page for verifying your setup. See [Connection Testing](#connection-testing) below for full details.

1. In **Site Preferences → Custom Preferences → LLM Integration**, set **LLM Test Mode Enabled** to `true`
2. Open `https://<sandbox>/on/demandware.store/Sites-<site-id>-Site/default/LLMTest-Show` in your browser (replace `<sandbox>` with your sandbox hostname and `<site-id>` with your storefront site ID, e.g., `RefArch` → `Sites-RefArch-Site` — find the exact value in **Administration → Sites → Manage Sites**)
3. Select a provider and model, then click **Test Sync** — you should see `"success": true` and the LLM's reply
4. Click **Test Batch** — you should see `"success": true` and a batch ID
5. Set **LLM Test Mode Enabled** back to `false` when done

If a test fails, the response includes an `errorType` and `hint` to help diagnose the issue.

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
| `llmTestModeEnabled` | Boolean | `false` | Enables the connection test page (never leave enabled in production) |

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

## Connection Testing

The cartridge includes a storefront test page that lets you verify LLM provider connectivity directly from your browser — for both synchronous (single-request) and batch APIs. Use it after installation or whenever you change service credentials, models, or provider configuration.

### Enabling Test Mode

All test endpoints are gated behind the `llmTestModeEnabled` site preference, which defaults to `false`. When disabled, the test page shows a "Test Mode Disabled" message and all endpoints return `403 Forbidden`.

1. Navigate to **Merchant Tools → Site Preferences → Custom Preferences**
2. Select the **LLM Integration** preference group
3. Set **LLM Test Mode Enabled** to `true`
4. Click **Apply**

> **Warning:** Never leave `llmTestModeEnabled` enabled in production. The test page is accessible on the storefront and makes LLM API calls using your configured credentials. Always disable it when you are done testing.

### Opening the Test Page

Open the following URL in your browser, replacing `<sandbox>` with your sandbox hostname and `<site-id>` with your storefront site ID (find it in **Administration → Sites → Manage Sites**, e.g., `RefArch`):

```
https://<sandbox>/on/demandware.store/Sites-<site-id>-Site/default/LLMTest-Show
```

The page displays a **Provider** dropdown (OpenAI, Anthropic, Gemini) and a **Model** dropdown populated from your `llmAvailableModelsJson` configuration. The **Test Sync** and **Test Batch** buttons remain disabled until you select both a provider and a model.

### Testing a Sync Connection

A sync test sends a short prompt to the selected provider and model, waits for the LLM to respond, and displays the result. This validates the full request path: service definition, credentials, model configuration, and provider reachability.

1. Select a **Provider** (e.g., `openai`)
2. Select a **Model** (e.g., `gpt-5-mini`)
3. Click **Test Sync**
4. Wait for the result to appear below the buttons

**On success**, you will see a JSON response:

```json
{
  "success": true,
  "provider": "openai",
  "model": "gpt-5-mini",
  "response": "Connection confirmed! I received your test message successfully.",
  "finishReason": "stop",
  "usage": { "promptTokens": 42, "completionTokens": 12, "totalTokens": 54 },
  "durationMs": 1230
}
```

Key things to verify:
- `success` is `true`
- `provider` and `model` match what you selected
- `response` contains a coherent reply from the LLM
- `durationMs` is reasonable for your network (typically 1–5 seconds)

**On failure**, the response includes `error`, `errorType`, and often a `hint` field explaining what to fix. See [Interpreting Errors](#interpreting-errors) below.

### Testing a Batch Connection

A batch test submits a single-item batch job to the provider's batch API. This validates that batch service definitions, file uploads (OpenAI), and batch creation endpoints are working. The test only verifies that the provider **accepted** the batch — it does not wait for the batch to complete.

1. Select a **Provider**
2. Select a **Model**
3. Click **Test Batch**
4. Wait for the result to appear below the buttons

**On success**, you will see a JSON response:

```json
{
  "success": true,
  "batchId": "batch_abc123",
  "provider": "openai",
  "status": "pending",
  "totalRequests": 1,
  "durationMs": 890
}
```

Key things to verify:
- `success` is `true`
- `batchId` is present — the provider accepted the batch
- `status` is a valid initial state (typically `pending` or `processing`)

A returned `batchId` confirms that the batch API credentials and service configuration are correct. You do not need to poll or wait for the batch to finish — acceptance alone proves connectivity.

**On failure**, the response includes `error` and `errorType`. See [Interpreting Errors](#interpreting-errors) below.

### Interpreting Errors

If either test fails, the JSON response includes an `errorType` that identifies the category of failure:

| Error Type | HTTP Status | Meaning | How to Fix |
|------------|-------------|---------|------------|
| `AuthenticationError` | 401 | API key is missing, invalid, or revoked | Check the **Password** field in **Administration → Operations → Services → Credentials** for the provider's credential (`llm.openai.cred`, `llm.anthropic.cred`, or `llm.gemini.cred`) |
| `ConfigurationError` | 500 | Site preferences or service configuration is missing/invalid | Verify `llmAvailableModelsJson` is valid JSON, the selected model is listed, and the service definition exists |
| `ValidationError` | 400 | The provider or model parameter is invalid | Ensure the model is present in `llmAvailableModelsJson` under the selected provider |
| `RateLimitError` | 429 | Provider rate limit exceeded | Wait and retry, or adjust the Service Profile rate limiter in **Administration → Operations → Services** |
| `TimeoutError` | 500 | Request timed out | Increase the timeout in the Service Profile, or try a faster model (e.g., a `cheap` tier model) |
| `ProviderError` | 500 | Provider returned an unexpected error | Check the error message for details; may indicate a provider outage or unsupported model |

If the test page itself shows "Test Mode Disabled" instead of the form, `llmTestModeEnabled` is set to `false` — enable it in Site Preferences and reload.

### Additional Test Endpoints

The test controller also exposes these JSON endpoints (also gated behind `llmTestModeEnabled`):

| Endpoint | Description |
|----------|-------------|
| `LLMTest-Ping` | Returns `pong - LLM Integration cartridge is loaded` — confirms the cartridge is on the cartridge path |
| `LLMTest-Config` | Returns JSON showing configured providers, models, and Anthropic API version — confirms site preferences are readable |

### Disabling Test Mode

After confirming connectivity, disable test mode:

1. Navigate to **Merchant Tools → Site Preferences → Custom Preferences**
2. Select the **LLM Integration** preference group
3. Set **LLM Test Mode Enabled** to `false`
4. Click **Apply**

### Mock Mode

For development without making real API calls, set services to Mock mode:

1. Navigate to **Administration → Operations → Services**
2. Edit each LLM service (`llm.openai`, `llm.anthropic`, `llm.gemini`)
3. Enable **Mock Mode**

Mock responses include the requested model name for verification:

```javascript
// Mock response content: "This is a mock response from OpenAI. Model: gpt-5-mini"
```

## Security Considerations

- **API Keys**: Never commit API keys to code; always use Service Credentials
- **Logging**: The cartridge automatically redacts API keys and sensitive headers from logs
- **Debug Mode**: Disable `llmDebugMode` in production to avoid exposing raw responses
- **Test Mode**: Disable `llmTestModeEnabled` in production — the test page exposes a storefront endpoint that makes LLM API calls
- **Rate Limiting**: Configure rate limits to prevent unexpected API costs
- **PII**: Avoid sending personally identifiable information in prompts

## File Structure

```
int_llm_integration/
├── cartridge/
│   ├── int_llm_integration.properties
│   ├── controllers/
│   │   └── LLMTest.js                    # Test/verification controller
│   ├── templates/
│   │   └── default/
│   │       └── llmTest/
│   │           └── connectionTest.isml   # Connection test page
│   └── scripts/
│       ├── helpers/
│       │   ├── llmClient.js              # Main entry point (sync)
│       │   ├── llmBatchClient.js         # Main entry point (batch)
│       │   ├── llmConfigHelper.js        # Configuration management
│       │   ├── llmErrorHelper.js         # Error handling
│       │   ├── llmNormalizationHelper.js # Request/response transformation
│       │   └── llmValidationHelper.js    # Request validation
│       └── services/
│           ├── llmOpenAIService.js        # OpenAI sync service
│           ├── llmOpenAIBatchService.js   # OpenAI batch service
│           ├── llmAnthropicService.js     # Anthropic sync service
│           ├── llmAnthropicBatchService.js # Anthropic batch service
│           ├── llmGeminiService.js        # Gemini sync service
│           └── llmGeminiBatchService.js   # Gemini batch service
├── metadata/
│   ├── services.xml                      # Service definitions (6 services, credentials, profiles)
│   └── meta/
│       └── system-objecttype-extensions.xml  # Site preference attributes
├── test/
│   └── unit/
│       ├── controllers/
│       │   └── LLMTest.test.js
│       └── scripts/
│           ├── helpers/
│           │   ├── llmConfigHelper.test.js
│           │   ├── llmBatchClient.test.js
│           │   ├── llmErrorHelper.test.js
│           │   ├── llmNormalizationHelper.test.js
│           │   └── llmValidationHelper.test.js
│           └── services/
│               ├── llmOpenAIBatchService.test.js
│               ├── llmAnthropicBatchService.test.js
│               └── llmGeminiBatchService.test.js
├── package.json
└── README.md
```

## Compatibility

This cartridge is a server-side integration with **no storefront dependencies**. It does not use SFRA's `server.js`, `module.superModule`, or any `app_storefront_base` modules. It relies only on core SFCC platform APIs (`dw/system/Logger`, `dw/system/Site`, `dw/svc/LocalServiceRegistry`). The connection test page uses a single standalone ISML template with no decorator or layout dependency.

It is compatible with:
- **SFRA** (Storefront Reference Architecture)
- **SiteGenesis** (pipeline and controller variants)
- **PWA Kit / Composable Storefront** (headless) — consumed via SCAPI hooks, SCAPI Custom APIs, or job scripts
- **Any custom storefront** built on SFCC

In a headless (PWA Kit) environment, the cartridge runs entirely on the SFCC instance. Frontend code consumes it indirectly through SCAPI Custom API endpoints or SCAPI/OCAPI hooks that `require('*/cartridge/scripts/helpers/llmClient')`.

## License

Copyright (c) 2025. All rights reserved.
