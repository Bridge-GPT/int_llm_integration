'use strict';

/**
 * LLM Validation Helper Module
 * 
 * Provides utilities for validating normalized LLM request structures
 * before making calls to provider services.
 * 
 * @module helpers/llmValidationHelper
 */

var configHelper = require('*/cartridge/scripts/helpers/llmConfigHelper');

/**
 * Valid message roles in the normalized message format.
 * @constant {Array<string>}
 */
var VALID_ROLES = ['system', 'user', 'assistant'];

/**
 * Validates the messages array in a request.
 * 
 * @param {Array} messages - The messages array to validate
 * @returns {Object} Validation result with { valid: boolean, error?: string }
 */
function validateMessages(messages) {
    // Check if messages is an array
    if (!messages || !Array.isArray(messages)) {
        return {
            valid: false,
            error: 'messages must be an array'
        };
    }
    
    // Check if messages array is empty
    if (messages.length === 0) {
        return {
            valid: false,
            error: 'messages array cannot be empty'
        };
    }
    
    // Validate each message
    for (var i = 0; i < messages.length; i++) {
        var message = messages[i];
        
        // Check if message is an object
        if (!message || typeof message !== 'object') {
            return {
                valid: false,
                error: 'Message at index ' + i + ' must be an object'
            };
        }
        
        // Check for role property
        if (!message.role || typeof message.role !== 'string') {
            return {
                valid: false,
                error: 'Message at index ' + i + ' is missing required "role" property'
            };
        }
        
        // Validate role value
        if (VALID_ROLES.indexOf(message.role) === -1) {
            return {
                valid: false,
                error: 'Message at index ' + i + ' has invalid role "' + message.role + '". Valid roles are: ' + VALID_ROLES.join(', ')
            };
        }
        
        // Check for content property
        if (typeof message.content !== 'string') {
            return {
                valid: false,
                error: 'Message at index ' + i + ' is missing required "content" property or content is not a string'
            };
        }
    }
    
    return { valid: true };
}

/**
 * Validates a complete LLM request object.
 * 
 * @param {Object} requestObj - The request object to validate
 * @param {string} requestObj.provider - The LLM provider (openai, anthropic, gemini)
 * @param {string} requestObj.model - The model identifier
 * @param {Array} requestObj.messages - Array of message objects
 * @param {Object} [requestObj.params] - Optional parameters
 * @returns {Object} Validation result with { valid: boolean, error?: string }
 */
function validateRequest(requestObj) {
    // Check if request object exists
    if (!requestObj) {
        return {
            valid: false,
            error: 'Request object is required'
        };
    }
    
    // Validate provider
    if (!requestObj.provider || typeof requestObj.provider !== 'string') {
        return {
            valid: false,
            error: 'provider is required and must be a string'
        };
    }
    
    if (configHelper.VALID_PROVIDERS.indexOf(requestObj.provider) === -1) {
        return {
            valid: false,
            error: 'Invalid provider "' + requestObj.provider + '". Valid providers are: ' + configHelper.VALID_PROVIDERS.join(', ')
        };
    }
    
    // Validate model
    if (!requestObj.model || typeof requestObj.model !== 'string') {
        return {
            valid: false,
            error: 'model is required and must be a non-empty string'
        };
    }
    
    if (requestObj.model.trim() === '') {
        return {
            valid: false,
            error: 'model cannot be an empty string'
        };
    }
    
    // Validate messages
    var messagesValidation = validateMessages(requestObj.messages);
    if (!messagesValidation.valid) {
        return messagesValidation;
    }
    
    // Check if model is allowed
    if (!configHelper.isModelAllowed(requestObj.provider, requestObj.model)) {
        return {
            valid: false,
            error: 'Model "' + requestObj.model + '" is not available for provider "' + requestObj.provider + '"'
        };
    }
    
    // Validate params if provided (must be object or null/undefined)
    if (requestObj.params !== null && requestObj.params !== undefined) {
        if (typeof requestObj.params !== 'object' || Array.isArray(requestObj.params)) {
            return {
                valid: false,
                error: 'params must be an object'
            };
        }
    }
    
    return { valid: true };
}

/**
 * Validates a batch LLM request object.
 *
 * @param {Object} requestObj - The batch request object to validate
 * @param {string} requestObj.provider - The LLM provider (openai, anthropic, gemini)
 * @param {string} requestObj.model - The model identifier
 * @param {Array} requestObj.requests - Array of batch request items
 * @param {string} requestObj.requests[].customId - Unique identifier for each request
 * @param {Array} requestObj.requests[].messages - Array of message objects
 * @param {Object} [requestObj.requests[].params] - Optional parameters per item
 * @returns {Object} Validation result with { valid: boolean, error?: string }
 */
function validateBatchRequest(requestObj) {
    // Check if request object exists
    if (!requestObj) {
        return {
            valid: false,
            error: 'Request object is required'
        };
    }

    // Validate provider
    if (!requestObj.provider || typeof requestObj.provider !== 'string') {
        return {
            valid: false,
            error: 'provider is required and must be a string'
        };
    }

    if (configHelper.VALID_PROVIDERS.indexOf(requestObj.provider) === -1) {
        return {
            valid: false,
            error: 'Invalid provider "' + requestObj.provider + '". Valid providers are: ' + configHelper.VALID_PROVIDERS.join(', ')
        };
    }

    // Validate model
    if (!requestObj.model || typeof requestObj.model !== 'string') {
        return {
            valid: false,
            error: 'model is required and must be a non-empty string'
        };
    }

    if (requestObj.model.trim() === '') {
        return {
            valid: false,
            error: 'model cannot be an empty string'
        };
    }

    if (!configHelper.isModelAllowed(requestObj.provider, requestObj.model)) {
        return {
            valid: false,
            error: 'Model "' + requestObj.model + '" is not available for provider "' + requestObj.provider + '"'
        };
    }

    // Validate requests array
    if (!Array.isArray(requestObj.requests) || requestObj.requests.length === 0) {
        return {
            valid: false,
            error: 'requests must be a non-empty array'
        };
    }

    // Enforce provider-specific batch size limits
    if (requestObj.provider === 'openai' && requestObj.requests.length > 50000) {
        return {
            valid: false,
            error: 'OpenAI batch requests cannot exceed 50000 items'
        };
    }

    if (requestObj.provider === 'anthropic' && requestObj.requests.length > 100000) {
        return {
            valid: false,
            error: 'Anthropic batch requests cannot exceed 100000 items'
        };
    }

    // Validate each request item
    for (var i = 0; i < requestObj.requests.length; i++) {
        var item = requestObj.requests[i];

        // Check item is a truthy object
        if (!item || typeof item !== 'object') {
            return {
                valid: false,
                error: 'Request item at index ' + i + ' must be an object'
            };
        }

        // Validate customId
        if (!item.customId || typeof item.customId !== 'string') {
            return {
                valid: false,
                error: 'Request item at index ' + i + ' must have a string customId'
            };
        }

        // Validate messages
        var messagesValidation = validateMessages(item.messages);
        if (!messagesValidation.valid) {
            return {
                valid: false,
                error: 'Request item at index ' + i + ': ' + messagesValidation.error
            };
        }

        // Validate params if provided
        if (item.params !== null && item.params !== undefined) {
            if (typeof item.params !== 'object' || Array.isArray(item.params)) {
                return {
                    valid: false,
                    error: 'Request item at index ' + i + ' has invalid params: must be an object'
                };
            }
        }
    }

    // Validate uniqueness of customId values
    var seenIds = {};
    for (var j = 0; j < requestObj.requests.length; j++) {
        if (Object.prototype.hasOwnProperty.call(seenIds, requestObj.requests[j].customId)) {
            return {
                valid: false,
                error: 'Duplicate customId: ' + requestObj.requests[j].customId
            };
        }
        seenIds[requestObj.requests[j].customId] = true;
    }

    return { valid: true };
}

module.exports = {
    VALID_ROLES: VALID_ROLES,
    validateMessages: validateMessages,
    validateRequest: validateRequest,
    validateBatchRequest: validateBatchRequest
};
