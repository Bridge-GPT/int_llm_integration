'use strict';

/**
 * LLM Client Module
 * 
 * Main entry point for making LLM requests. This module provides a unified interface
 * for consumers (controllers, scripts, jobs) to call different LLM providers without
 * needing to know provider-specific details.
 * 
 * @module helpers/llmClient
 * 
 * @example
 * var LLMClient = require('*\/cartridge/scripts/helpers/llmClient');
 * 
 * var response = LLMClient.generateText({
 *     provider: 'openai',
 *     model: 'gpt-4o',
 *     messages: [
 *         { role: 'system', content: 'You are a helpful assistant.' },
 *         { role: 'user', content: 'What is the capital of France?' }
 *     ],
 *     params: {
 *         temperature: 0.7,
 *         max_tokens: 150
 *     }
 * });
 * 
 * // response.content contains the LLM response text
 */

var Logger = require('dw/system/Logger');

var validationHelper = require('*/cartridge/scripts/helpers/llmValidationHelper');
var configHelper = require('*/cartridge/scripts/helpers/llmConfigHelper');
var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');

var logger = Logger.getLogger('LLMIntegration', 'client');

/**
 * Generates text using the specified LLM provider.
 * 
 * This is the main entry point for LLM integration. It handles:
 * - Request validation
 * - Provider routing
 * - Error handling and normalization
 * - Timing and logging
 * 
 * @param {Object} options - The request options
 * @param {string} options.provider - The LLM provider ('openai', 'anthropic', 'gemini')
 * @param {string} options.model - The model identifier (must be configured in llmAvailableModelsJson)
 * @param {Array<Object>} options.messages - Array of message objects with 'role' and 'content' properties
 *   - role: 'system' | 'user' | 'assistant'
 *   - content: The message text
 * @param {Object} [options.params] - Optional provider-specific parameters
 *   - temperature: Controls randomness (0-2 for most providers)
 *   - max_tokens: Maximum tokens in the response
 *   - Additional provider-specific params are passed through
 * 
 * @returns {Object} Normalized response object:
 *   - provider: The provider name
 *   - model: The model used (may differ from requested if provider returns actual model version)
 *   - content: The generated text content
 *   - usage: Object with promptTokens, completionTokens, totalTokens
 *   - finishReason: Why generation stopped (e.g., 'stop', 'length', 'end_turn')
 *   - rawResponse: (Only in debug mode) The raw provider response
 * 
 * @throws {Error} With isLLMError=true and errorType property for:
 *   - ValidationError: Invalid request parameters
 *   - AuthenticationError: Invalid or missing API key
 *   - RateLimitError: Provider rate limit exceeded
 *   - TimeoutError: Request timed out
 *   - ProviderError: Provider-side error (5xx, etc.)
 *   - ConfigurationError: Missing or invalid configuration
 * 
 * @example
 * try {
 *     var response = LLMClient.generateText({
 *         provider: 'anthropic',
 *         model: 'claude-3-sonnet-20240229',
 *         messages: [
 *             { role: 'user', content: 'Explain quantum computing in simple terms.' }
 *         ],
 *         params: { max_tokens: 500 }
 *     });
 *     
 *     // Use response.content
 * } catch (e) {
 *     if (e.isLLMError) {
 *         if (e.errorType === 'RateLimitError') {
 *             // Handle rate limiting
 *         } else if (e.errorType === 'AuthenticationError') {
 *             // Handle auth error
 *         }
 *     }
 *     // Log and handle error
 * }
 */
function generateText(options) {
    var provider = options && options.provider;
    var model = options && options.model;
    var startTime = Date.now();
    var elapsed;
    
    // Log request start (provider and model only, not message content)
    logger.info('LLM request started - provider: ' + provider + ', model: ' + model);
    
    try {
        // Validate the request
        var validation = validationHelper.validateRequest(options);
        
        if (!validation.valid) {
            throw errorHelper.createLLMError(
                validation.error,
                errorHelper.ERROR_TYPES.ValidationError,
                400,
                null
            );
        }
        
        // Build the normalized request object
        var normalizedRequest = {
            provider: options.provider,
            model: options.model,
            messages: options.messages,
            params: options.params || {}
        };
        
        // Route to the appropriate provider service
        var response;
        
        switch (options.provider) {
            case 'openai':
                var openAIService = require('*/cartridge/scripts/services/llmOpenAIService');
                response = openAIService.callOpenAI(normalizedRequest);
                break;
            
            case 'anthropic':
                var anthropicService = require('*/cartridge/scripts/services/llmAnthropicService');
                response = anthropicService.callAnthropic(normalizedRequest);
                break;
            
            case 'gemini':
                var geminiService = require('*/cartridge/scripts/services/llmGeminiService');
                response = geminiService.callGemini(normalizedRequest);
                break;
            
            default:
                // This should never happen due to validation, but just in case
                throw errorHelper.createLLMError(
                    'Unknown provider: ' + options.provider,
                    errorHelper.ERROR_TYPES.ValidationError,
                    400,
                    null
                );
        }
        
        // Calculate elapsed time
        elapsed = Date.now() - startTime;
        
        // Log success
        logger.info('LLM request completed - provider: ' + provider + ', model: ' + model + ', elapsed: ' + elapsed + 'ms');
        
        // Remove raw response unless debug mode is enabled
        if (!configHelper.isDebugMode() && response.rawResponse) {
            delete response.rawResponse;
        }
        
        return response;
        
    } catch (e) {
        // Calculate elapsed time for error case
        elapsed = Date.now() - startTime;
        
        // Log error with sanitized message
        logger.error('LLM request failed - provider: ' + provider + ', model: ' + model + ', elapsed: ' + elapsed + 'ms, error: ' + errorHelper.sanitizeForLogging(e.message));
        
        // If it's already an LLM error, re-throw it
        if (e.isLLMError) {
            throw e;
        }
        
        // Wrap unknown errors in a ProviderError
        throw errorHelper.createLLMError(
            'LLM request failed: ' + e.message,
            errorHelper.ERROR_TYPES.ProviderError,
            500,
            null
        );
    }
}

module.exports = {
    generateText: generateText
};
