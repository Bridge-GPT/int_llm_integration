'use strict';

/**
 * LLM Gemini Service Module
 * 
 * Implements the SFCC service definition for Google Gemini using LocalServiceRegistry.
 * Handles communication with Gemini's generateContent API.
 * 
 * @module services/llmGeminiService
 */

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Logger = require('dw/system/Logger');

var logger = Logger.getLogger('LLMIntegration', 'gemini');

/**
 * Service ID constant matching the service-id in services.xml.
 * @constant {string}
 */
var SERVICE_ID = 'llm.gemini';

/**
 * Calls the Gemini generateContent API with the given normalized request.
 * Note: Gemini's endpoint includes the model name in the URL path.
 * 
 * @param {Object} normalizedRequest - The normalized request object
 * @param {string} normalizedRequest.model - The model identifier (e.g., 'gemini-1.5-pro')
 * @param {Array} normalizedRequest.messages - Array of message objects
 * @param {Object} [normalizedRequest.params] - Optional parameters (temperature, maxOutputTokens, etc.)
 * @returns {Object} The normalized response
 * @throws {Error} If the service call fails
 */
function callGemini(normalizedRequest) {
    // Require helpers inside function to avoid circular dependencies
    var normalizationHelper = require('*/cartridge/scripts/helpers/llmNormalizationHelper');
    var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');
    
    // Store model in closure for access in parseResponse callback
    var requestedModel = normalizedRequest.model;
    
    // Build the provider-specific payload
    var payload = normalizationHelper.buildGeminiPayload(normalizedRequest);
    
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
                    'Gemini API key not configured in service credential',
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }
            
            // Build the full URL with model name in path
            // Format: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
            var baseUrl = credential.getURL() || 'https://generativelanguage.googleapis.com/v1beta/models';
            var fullUrl = baseUrl + '/' + params.model + ':generateContent';
            
            svc.setURL(fullUrl);
            svc.setRequestMethod('POST');
            
            // Set required headers
            svc.addHeader('X-Goog-Api-Key', apiKey);
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
                
                throw errorHelper.mapProviderError('gemini', statusCode, errorBody);
            }
            
            // Parse successful response
            var rawResponse;
            try {
                rawResponse = JSON.parse(responseText);
            } catch (e) {
                throw errorHelper.createLLMError(
                    'Failed to parse Gemini response: ' + e.message,
                    errorHelper.ERROR_TYPES.ProviderError,
                    500,
                    null
                );
            }
            
            // Store raw response for potential debug mode inclusion
            var normalizedResponse = normalizationHelper.normalizeGeminiResponse(rawResponse, requestedModel);
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
                    candidates: [{
                        content: {
                            parts: [{
                                text: 'This is a mock response from Gemini. Model: ' + params.model
                            }],
                            role: 'model'
                        },
                        finishReason: 'STOP',
                        index: 0
                    }],
                    usageMetadata: {
                        promptTokenCount: 12,
                        candidatesTokenCount: 18,
                        totalTokenCount: 30
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
        var errorMessage = 'Gemini service call failed';
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
    callGemini: callGemini,
    SERVICE_ID: SERVICE_ID
};
