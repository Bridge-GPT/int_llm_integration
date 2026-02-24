'use strict';

/**
 * LLM Normalization Helper Module
 * 
 * Provides utilities for transforming normalized requests into provider-specific
 * payloads and transforming provider responses into the normalized response format.
 * 
 * @module helpers/llmNormalizationHelper
 */

/**
 * Builds an OpenAI-specific payload from a normalized request.
 * OpenAI uses the most common format, so minimal transformation is needed.
 * 
 * @param {Object} normalizedRequest - The normalized request object
 * @param {string} normalizedRequest.model - The model identifier
 * @param {Array} normalizedRequest.messages - The messages array
 * @param {Object} [normalizedRequest.params] - Optional parameters
 * @returns {Object} The OpenAI API payload
 */
function buildOpenAIPayload(normalizedRequest) {
    var payload = {
        model: normalizedRequest.model,
        messages: normalizedRequest.messages
    };
    
    // Spread params into payload if provided
    if (normalizedRequest.params) {
        for (var key in normalizedRequest.params) {
            if (Object.prototype.hasOwnProperty.call(normalizedRequest.params, key)) {
                payload[key] = normalizedRequest.params[key];
            }
        }
    }
    
    return payload;
}

/**
 * Builds an Anthropic-specific payload from a normalized request.
 * Anthropic requires:
 * - System messages to be in a separate 'system' field
 * - max_tokens to be specified (default 16384)
 * 
 * @param {Object} normalizedRequest - The normalized request object
 * @param {string} normalizedRequest.model - The model identifier
 * @param {Array} normalizedRequest.messages - The messages array
 * @param {Object} [normalizedRequest.params] - Optional parameters
 * @returns {Object} The Anthropic API payload
 */
function buildAnthropicPayload(normalizedRequest) {
    var payload = {
        model: normalizedRequest.model
    };
    
    var systemContent = null;
    var filteredMessages = [];
    
    // Separate system messages from user/assistant messages
    for (var i = 0; i < normalizedRequest.messages.length; i++) {
        var message = normalizedRequest.messages[i];
        
        if (message.role === 'system') {
            // Concatenate multiple system messages if present
            if (systemContent) {
                systemContent += '\n' + message.content;
            } else {
                systemContent = message.content;
            }
        } else {
            // Keep user and assistant messages
            filteredMessages.push({
                role: message.role,
                content: message.content
            });
        }
    }
    
    // Add system content if present
    if (systemContent) {
        payload.system = systemContent;
    }
    
    payload.messages = filteredMessages;
    
    // Set max_tokens (required by Anthropic)
    var maxTokens = 16384; // Default value
    if (normalizedRequest.params && normalizedRequest.params.max_tokens) {
        maxTokens = normalizedRequest.params.max_tokens;
    }
    payload.max_tokens = maxTokens;
    
    // Spread remaining params into payload
    if (normalizedRequest.params) {
        for (var key in normalizedRequest.params) {
            if (Object.prototype.hasOwnProperty.call(normalizedRequest.params, key)) {
                // Skip max_tokens as we've already handled it
                if (key !== 'max_tokens') {
                    payload[key] = normalizedRequest.params[key];
                }
            }
        }
    }
    
    return payload;
}

/**
 * Builds a Gemini-specific payload from a normalized request.
 * Gemini uses a different structure:
 * - Messages are in 'contents' array
 * - 'assistant' role maps to 'model' role
 * - Parts structure: [{ text: '...' }]
 * - System messages go in 'systemInstruction' field
 * 
 * @param {Object} normalizedRequest - The normalized request object
 * @param {string} normalizedRequest.model - The model identifier
 * @param {Array} normalizedRequest.messages - The messages array
 * @param {Object} [normalizedRequest.params] - Optional parameters
 * @returns {Object} The Gemini API payload
 */
function buildGeminiPayload(normalizedRequest) {
    var payload = {};
    var contents = [];
    var systemInstruction = null;
    
    // Transform messages to Gemini format
    for (var i = 0; i < normalizedRequest.messages.length; i++) {
        var message = normalizedRequest.messages[i];
        
        if (message.role === 'system') {
            // Collect system messages for systemInstruction
            if (systemInstruction) {
                systemInstruction += '\n' + message.content;
            } else {
                systemInstruction = message.content;
            }
        } else {
            // Map roles: 'assistant' -> 'model', 'user' -> 'user'
            var geminiRole = message.role === 'assistant' ? 'model' : 'user';
            
            contents.push({
                role: geminiRole,
                parts: [{ text: message.content }]
            });
        }
    }
    
    // Add system instruction if present
    if (systemInstruction) {
        payload.systemInstruction = {
            parts: [{ text: systemInstruction }]
        };
    }
    
    payload.contents = contents;
    
    // Build generationConfig from params
    if (normalizedRequest.params) {
        var generationConfig = {};
        var hasGenerationConfig = false;
        
        // Map common params to Gemini's generationConfig
        if (normalizedRequest.params.temperature !== undefined) {
            generationConfig.temperature = normalizedRequest.params.temperature;
            hasGenerationConfig = true;
        }
        if (normalizedRequest.params.maxOutputTokens !== undefined) {
            generationConfig.maxOutputTokens = normalizedRequest.params.maxOutputTokens;
            hasGenerationConfig = true;
        }
        if (normalizedRequest.params.max_tokens !== undefined) {
            // Map max_tokens to maxOutputTokens
            generationConfig.maxOutputTokens = normalizedRequest.params.max_tokens;
            hasGenerationConfig = true;
        }
        if (normalizedRequest.params.topP !== undefined) {
            generationConfig.topP = normalizedRequest.params.topP;
            hasGenerationConfig = true;
        }
        if (normalizedRequest.params.topK !== undefined) {
            generationConfig.topK = normalizedRequest.params.topK;
            hasGenerationConfig = true;
        }
        if (normalizedRequest.params.stopSequences !== undefined) {
            generationConfig.stopSequences = normalizedRequest.params.stopSequences;
            hasGenerationConfig = true;
        }
        
        if (hasGenerationConfig) {
            payload.generationConfig = generationConfig;
        }
    }
    
    return payload;
}

/**
 * Normalizes an OpenAI response to the standard format.
 * 
 * @param {Object} rawResponse - The raw OpenAI API response
 * @param {string} requestedModel - The model that was requested
 * @returns {Object} The normalized response
 */
function normalizeOpenAIResponse(rawResponse, requestedModel) {
    var content = '';
    var finishReason = null;
    
    // Extract content from choices array
    if (rawResponse.choices && rawResponse.choices.length > 0) {
        var choice = rawResponse.choices[0];
        if (choice.message && choice.message.content) {
            content = choice.message.content;
        }
        finishReason = choice.finish_reason || null;
    }
    
    // Build usage object
    var usage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
    };
    
    if (rawResponse.usage) {
        usage.promptTokens = rawResponse.usage.prompt_tokens || 0;
        usage.completionTokens = rawResponse.usage.completion_tokens || 0;
        usage.totalTokens = rawResponse.usage.total_tokens || 0;
    }
    
    return {
        provider: 'openai',
        model: rawResponse.model || requestedModel,
        content: content,
        usage: usage,
        finishReason: finishReason
    };
}

/**
 * Normalizes an Anthropic response to the standard format.
 * 
 * @param {Object} rawResponse - The raw Anthropic API response
 * @param {string} requestedModel - The model that was requested
 * @returns {Object} The normalized response
 */
function normalizeAnthropicResponse(rawResponse, requestedModel) {
    var content = '';
    
    // Extract content from content array (Anthropic returns array of content blocks)
    if (rawResponse.content && rawResponse.content.length > 0) {
        // Find text content block
        for (var i = 0; i < rawResponse.content.length; i++) {
            var block = rawResponse.content[i];
            if (block.type === 'text' && block.text) {
                content = block.text;
                break;
            }
        }
    }
    
    // Build usage object
    var usage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
    };
    
    if (rawResponse.usage) {
        usage.promptTokens = rawResponse.usage.input_tokens || 0;
        usage.completionTokens = rawResponse.usage.output_tokens || 0;
        usage.totalTokens = usage.promptTokens + usage.completionTokens;
    }
    
    return {
        provider: 'anthropic',
        model: rawResponse.model || requestedModel,
        content: content,
        usage: usage,
        finishReason: rawResponse.stop_reason || null
    };
}

/**
 * Normalizes a Gemini response to the standard format.
 * 
 * @param {Object} rawResponse - The raw Gemini API response
 * @param {string} requestedModel - The model that was requested
 * @returns {Object} The normalized response
 */
function normalizeGeminiResponse(rawResponse, requestedModel) {
    var content = '';
    var finishReason = null;
    
    // Extract content from candidates array
    if (rawResponse.candidates && rawResponse.candidates.length > 0) {
        var candidate = rawResponse.candidates[0];
        
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
            content = candidate.content.parts[0].text || '';
        }
        
        finishReason = candidate.finishReason || null;
    }
    
    // Build usage object
    var usage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
    };
    
    if (rawResponse.usageMetadata) {
        usage.promptTokens = rawResponse.usageMetadata.promptTokenCount || 0;
        usage.completionTokens = rawResponse.usageMetadata.candidatesTokenCount || 0;
        usage.totalTokens = rawResponse.usageMetadata.totalTokenCount || (usage.promptTokens + usage.completionTokens);
    }
    
    return {
        provider: 'gemini',
        model: requestedModel,
        content: content,
        usage: usage,
        finishReason: finishReason
    };
}

module.exports = {
    buildOpenAIPayload: buildOpenAIPayload,
    buildAnthropicPayload: buildAnthropicPayload,
    buildGeminiPayload: buildGeminiPayload,
    normalizeOpenAIResponse: normalizeOpenAIResponse,
    normalizeAnthropicResponse: normalizeAnthropicResponse,
    normalizeGeminiResponse: normalizeGeminiResponse
};
