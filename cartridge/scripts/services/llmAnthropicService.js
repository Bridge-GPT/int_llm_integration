'use strict';

/**
 * LLM Anthropic Service Module
 * 
 * Implements the SFCC service definition for Anthropic using LocalServiceRegistry.
 * Handles communication with Anthropic's Messages API.
 * 
 * @module services/llmAnthropicService
 */

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Logger = require('dw/system/Logger');

var logger = Logger.getLogger('LLMIntegration', 'anthropic');

/**
 * Service ID constant matching the service-id in services.xml.
 * @constant {string}
 */
var SERVICE_ID = 'llm.anthropic';

/**
 * Anthropic Messages API endpoint path.
 * @constant {string}
 */
var MESSAGES_PATH = '/v1/messages';

/**
 * Calls the Anthropic Messages API with the given normalized request.
 * 
 * @param {Object} normalizedRequest - The normalized request object
 * @param {string} normalizedRequest.model - The model identifier (e.g., 'claude-3-sonnet-20240229')
 * @param {Array} normalizedRequest.messages - Array of message objects
 * @param {Object} [normalizedRequest.params] - Optional parameters (temperature, max_tokens, etc.)
 * @returns {Object} The normalized response
 * @throws {Error} If the service call fails
 */
function callAnthropic(normalizedRequest) {
    // Require helpers inside function to avoid circular dependencies
    var normalizationHelper = require('*/cartridge/scripts/helpers/llmNormalizationHelper');
    var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');
    var configHelper = require('*/cartridge/scripts/helpers/llmConfigHelper');
    
    // Store model in closure for access in parseResponse callback
    var requestedModel = normalizedRequest.model;
    
    // Build the provider-specific payload
    var payload = normalizationHelper.buildAnthropicPayload(normalizedRequest);
    
    // Get the Anthropic API version
    var anthropicVersion = configHelper.getAnthropicApiVersion();
    
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
                    'Anthropic API key not configured in service credential',
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }
            
            // Build the full URL
            var baseUrl = credential.getURL() || 'https://api.anthropic.com';
            svc.setURL(baseUrl + MESSAGES_PATH);
            svc.setRequestMethod('POST');
            
            // Set required headers
            svc.addHeader('x-api-key', apiKey);
            svc.addHeader('anthropic-version', params.apiVersion);
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
                
                throw errorHelper.mapProviderError('anthropic', statusCode, errorBody);
            }
            
            // Parse successful response
            var rawResponse;
            try {
                rawResponse = JSON.parse(responseText);
            } catch (e) {
                throw errorHelper.createLLMError(
                    'Failed to parse Anthropic response: ' + e.message,
                    errorHelper.ERROR_TYPES.ProviderError,
                    500,
                    null
                );
            }
            
            // Store raw response for potential debug mode inclusion
            var normalizedResponse = normalizationHelper.normalizeAnthropicResponse(rawResponse, requestedModel);
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
                    id: 'msg_mock_' + Date.now(),
                    type: 'message',
                    role: 'assistant',
                    model: params.model,
                    content: [{
                        type: 'text',
                        text: 'This is a mock response from Anthropic. Model: ' + params.model
                    }],
                    stop_reason: 'end_turn',
                    stop_sequence: null,
                    usage: {
                        input_tokens: 15,
                        output_tokens: 25
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
        model: normalizedRequest.model,
        apiVersion: anthropicVersion
    });
    
    // Handle service result
    if (!result.ok) {
        var errorMessage = 'Anthropic service call failed';
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
    callAnthropic: callAnthropic,
    SERVICE_ID: SERVICE_ID
};
