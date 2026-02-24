'use strict';

/**
 * LLM OpenAI Service Module
 * 
 * Implements the SFCC service definition for OpenAI using LocalServiceRegistry.
 * Handles communication with OpenAI's Chat Completions API.
 * 
 * @module services/llmOpenAIService
 */

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Logger = require('dw/system/Logger');

var logger = Logger.getLogger('LLMIntegration', 'openai');

/**
 * Service ID constant matching the service-id in services.xml.
 * @constant {string}
 */
var SERVICE_ID = 'llm.openai';

/**
 * OpenAI Chat Completions endpoint path.
 * @constant {string}
 */
var CHAT_COMPLETIONS_PATH = '/v1/chat/completions';

/**
 * Calls the OpenAI Chat Completions API with the given normalized request.
 * 
 * @param {Object} normalizedRequest - The normalized request object
 * @param {string} normalizedRequest.model - The model identifier (e.g., 'gpt-4o')
 * @param {Array} normalizedRequest.messages - Array of message objects
 * @param {Object} [normalizedRequest.params] - Optional parameters (temperature, max_tokens, etc.)
 * @returns {Object} The normalized response
 * @throws {Error} If the service call fails
 */
function callOpenAI(normalizedRequest) {
    // Require helpers inside function to avoid circular dependencies
    var normalizationHelper = require('*/cartridge/scripts/helpers/llmNormalizationHelper');
    var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');
    
    // Store model in closure for access in parseResponse callback
    var requestedModel = normalizedRequest.model;
    
    // Build the provider-specific payload
    var payload = normalizationHelper.buildOpenAIPayload(normalizedRequest);
    
    var service = LocalServiceRegistry.createService(SERVICE_ID, {
        /**
         * Creates the service request.
         * 
         * @param {dw.svc.HTTPService} svc - The service instance
         * @param {Object} params - Request parameters
         * @returns {string} The request body
         */
        createRequest: function (svc, params) {
            var credential = svc.getConfiguration().getCredential();
            
            if (!credential) {
                throw errorHelper.createLLMError(
                    'Service credential not configured for ' + SERVICE_ID,
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }
            
            var apiKey = credential.getPassword();
            
            if (!apiKey) {
                throw errorHelper.createLLMError(
                    'OpenAI API key not configured in service credential',
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }
            
            // Build the full URL
            var baseUrl = credential.getURL() || 'https://api.openai.com';
            svc.setURL(baseUrl + CHAT_COMPLETIONS_PATH);
            svc.setRequestMethod('POST');
            
            // Set required headers
            svc.addHeader('Authorization', 'Bearer ' + apiKey);
            svc.addHeader('Content-Type', 'application/json');
            
            return JSON.stringify(params.payload);
        },
        
        /**
         * Parses the service response.
         * 
         * @param {dw.svc.HTTPService} svc - The service instance
         * @param {dw.net.HTTPClient} client - The HTTP client
         * @returns {Object} The normalized response
         */
        parseResponse: function (svc, client) {
            var statusCode = client.statusCode;
            var responseText = client.text;
            
            // Handle non-200 responses
            if (statusCode !== 200) {
                var errorBody = null;
                try {
                    errorBody = JSON.parse(responseText);
                } catch (e) {
                    errorBody = { message: responseText };
                }
                
                throw errorHelper.mapProviderError('openai', statusCode, errorBody);
            }
            
            // Parse successful response
            var rawResponse;
            try {
                rawResponse = JSON.parse(responseText);
            } catch (e) {
                throw errorHelper.createLLMError(
                    'Failed to parse OpenAI response: ' + e.message,
                    errorHelper.ERROR_TYPES.ProviderError,
                    500,
                    null
                );
            }
            
            // Store raw response for potential debug mode inclusion
            var normalizedResponse = normalizationHelper.normalizeOpenAIResponse(rawResponse, requestedModel);
            normalizedResponse.rawResponse = rawResponse;
            
            return normalizedResponse;
        },
        
        /**
         * Provides a mock response for testing.
         * 
         * @param {dw.svc.HTTPService} svc - The service instance
         * @param {Object} params - Request parameters
         * @returns {Object} Mock response object
         */
        mockCall: function (svc, params) {
            return {
                statusCode: 200,
                statusMessage: 'OK',
                text: JSON.stringify({
                    id: 'chatcmpl-mock-' + Date.now(),
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: params.model,
                    choices: [{
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: 'This is a mock response from OpenAI. Model: ' + params.model
                        },
                        finish_reason: 'stop'
                    }],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 20,
                        total_tokens: 30
                    }
                })
            };
        },
        
        /**
         * Filters sensitive information from log messages.
         * 
         * @param {string} msg - The message to filter
         * @returns {string} The filtered message
         */
        filterLogMessage: function (msg) {
            return errorHelper.sanitizeForLogging(msg);
        }
    });
    
    // Make the service call
    var result = service.call({
        payload: payload,
        model: normalizedRequest.model
    });
    
    // Handle service result
    if (!result.ok) {
        var errorMessage = 'OpenAI service call failed';
        if (result.errorMessage) {
            errorMessage += ': ' + result.errorMessage;
        }
        
        logger.error(errorHelper.sanitizeForLogging(errorMessage));
        
        // If it's already an LLM error, re-throw it
        if (result.error && result.error.isLLMError) {
            throw result.error;
        }
        
        throw errorHelper.createLLMError(
            errorMessage,
            errorHelper.ERROR_TYPES.ProviderError,
            result.error || 500,
            null
        );
    }
    
    return result.object;
}

module.exports = {
    callOpenAI: callOpenAI,
    SERVICE_ID: SERVICE_ID
};
