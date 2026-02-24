'use strict';

/**
 * LLM Error Helper Module
 * 
 * Provides utilities for creating structured LLM errors, mapping provider-specific
 * errors to normalized error types, and sanitizing sensitive information from log messages.
 * 
 * @module helpers/llmErrorHelper
 */

/**
 * Error type constants for categorizing LLM-related errors.
 * @constant {Object}
 */
var ERROR_TYPES = {
    ValidationError: 'ValidationError',
    AuthenticationError: 'AuthenticationError',
    RateLimitError: 'RateLimitError',
    TimeoutError: 'TimeoutError',
    ProviderError: 'ProviderError',
    ConfigurationError: 'ConfigurationError',
    NetworkError: 'NetworkError'
};

/**
 * Creates a structured LLM error with custom properties.
 * 
 * @param {string} message - The error message
 * @param {string} errorType - The type of error (from ERROR_TYPES)
 * @param {number} status - The HTTP status code (if applicable)
 * @param {Object} [providerError] - The original provider error object
 * @returns {Error} An Error object with additional LLM-specific properties
 */
function createLLMError(message, errorType, status, providerError) {
    var error = new Error(message);
    error.errorType = errorType;
    error.status = status;
    error.providerError = providerError;
    error.isLLMError = true;
    return error;
}

/**
 * Extracts a user-friendly error message from a provider error response.
 * Handles different error formats across providers (OpenAI, Anthropic, Gemini).
 * 
 * @param {Object} errorBody - The parsed error response body
 * @returns {string} The extracted error message
 */
function extractErrorMessage(errorBody) {
    if (!errorBody) {
        return 'Unknown error occurred';
    }
    
    // OpenAI format: { error: { message: '...' } }
    if (errorBody.error && errorBody.error.message) {
        return errorBody.error.message;
    }
    
    // Anthropic format: { message: '...' } or { error: { message: '...' } }
    if (errorBody.message) {
        return errorBody.message;
    }
    
    // Some providers use 'detail'
    if (errorBody.detail) {
        return errorBody.detail;
    }
    
    // Gemini format or fallback
    if (typeof errorBody === 'string') {
        return errorBody;
    }
    
    return 'Unknown error occurred';
}

/**
 * Maps a provider-specific HTTP error to a structured LLM error.
 * 
 * @param {string} provider - The provider name (openai, anthropic, gemini)
 * @param {number} httpStatus - The HTTP status code from the provider response
 * @param {Object} errorBody - The parsed error response body
 * @returns {Error} A structured LLM error
 */
function mapProviderError(provider, httpStatus, errorBody) {
    var message = extractErrorMessage(errorBody);
    var errorType;
    var fullMessage;
    
    switch (httpStatus) {
        case 401:
        case 403:
            errorType = ERROR_TYPES.AuthenticationError;
            fullMessage = provider + ' authentication failed: ' + message;
            break;
        
        case 429:
            errorType = ERROR_TYPES.RateLimitError;
            fullMessage = provider + ' rate limit exceeded: ' + message;
            // Include retry-after if available
            if (errorBody && errorBody.retry_after) {
                fullMessage += ' (retry after ' + errorBody.retry_after + 's)';
            }
            break;
        
        case 408:
            errorType = ERROR_TYPES.TimeoutError;
            fullMessage = provider + ' request timed out: ' + message;
            break;
        
        case 400:
            errorType = ERROR_TYPES.ValidationError;
            fullMessage = provider + ' validation error: ' + message;
            break;
        
        default:
            if (httpStatus >= 500) {
                errorType = ERROR_TYPES.ProviderError;
                fullMessage = provider + ' server error (' + httpStatus + '): ' + message;
            } else {
                errorType = ERROR_TYPES.ProviderError;
                fullMessage = provider + ' error (' + httpStatus + '): ' + message;
            }
    }
    
    return createLLMError(fullMessage, errorType, httpStatus, errorBody);
}

/**
 * Sanitizes a message by redacting sensitive information such as API keys,
 * Bearer tokens, and x-api-key values.
 * 
 * @param {string} message - The message to sanitize
 * @returns {string} The sanitized message with sensitive data redacted
 */
function sanitizeForLogging(message) {
    if (!message || typeof message !== 'string') {
        return message;
    }
    
    var sanitized = message;
    
    // Redact OpenAI-style API keys (sk-...)
    sanitized = sanitized.replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED_KEY]');
    
    // Redact Bearer tokens
    sanitized = sanitized.replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]');
    
    // Redact x-api-key header values
    sanitized = sanitized.replace(/x-api-key[:\s]+[^\s,}]+/gi, 'x-api-key: [REDACTED]');
    
    // Redact X-Goog-Api-Key header values (Gemini)
    sanitized = sanitized.replace(/X-Goog-Api-Key[:\s]+[^\s,}]+/gi, 'X-Goog-Api-Key: [REDACTED]');
    
    // Redact Authorization header values
    sanitized = sanitized.replace(/Authorization[:\s]+[^\s,}]+/gi, 'Authorization: [REDACTED]');
    
    // Redact anthropic-api-key values
    sanitized = sanitized.replace(/anthropic-api-key[:\s]+[^\s,}]+/gi, 'anthropic-api-key: [REDACTED]');
    
    return sanitized;
}

module.exports = {
    ERROR_TYPES: ERROR_TYPES,
    createLLMError: createLLMError,
    mapProviderError: mapProviderError,
    sanitizeForLogging: sanitizeForLogging
};
