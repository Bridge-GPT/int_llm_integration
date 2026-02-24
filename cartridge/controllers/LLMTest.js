'use strict';

/**
 * LLM Test Controller
 * 
 * Simple controller for testing LLM integration.
 * Accepts provider and model as query parameters, sends a test message,
 * and returns the response.
 * 
 * Usage:
 *   https://<sandbox>/on/demandware.store/<site>/default/LLMTest-Test?provider=openai&model=gpt-4o
 *   https://<sandbox>/on/demandware.store/<site>/default/LLMTest-Test?provider=anthropic&model=claude-sonnet-4-20250514
 *   https://<sandbox>/on/demandware.store/<site>/default/LLMTest-Test?provider=gemini&model=gemini-2.0-flash
 * 
 * @namespace LLMTest
 */

/* global request, response */

var Logger = require('dw/system/Logger');
var logger = Logger.getLogger('LLMIntegration', 'LLMTest');

/**
 * LLMTest-Ping : Simple health check
 * Returns plain text "pong" to verify controller is accessible.
 */
function ping() {
    response.setContentType('text/plain');
    response.getWriter().print('pong - LLM Integration cartridge is loaded');
}

/**
 * LLMTest-Test : Sends a test message to the specified LLM provider
 * 
 * Query Parameters:
 *   - provider: (required) openai, anthropic, or gemini
 *   - model: (required) the model to use (e.g., gpt-4o, claude-sonnet-4-20250514, gemini-2.0-flash)
 * 
 * Returns JSON response with the LLM's reply or error details.
 */
function test() {
    response.setContentType('application/json');
    
    var startTime = Date.now();
    
    try {
        // Get query parameters
        var provider = request.httpParameterMap.provider.stringValue;
        var model = request.httpParameterMap.model.stringValue;
        
        // Validate required parameters
        if (!provider) {
            response.setStatus(400);
            response.getWriter().print(JSON.stringify({
                success: false,
                error: 'Missing required parameter: provider',
                hint: 'Add ?provider=openai or ?provider=anthropic or ?provider=gemini'
            }, null, 2));
            return;
        }
        
        if (!model) {
            response.setStatus(400);
            response.getWriter().print(JSON.stringify({
                success: false,
                error: 'Missing required parameter: model',
                hint: 'Add &model=gpt-4o or &model=claude-sonnet-4-20250514 or &model=gemini-2.0-flash'
            }, null, 2));
            return;
        }
        
        logger.info('LLMTest: Testing provider=' + provider + ', model=' + model);
        
        // Load the LLM client
        var LLMClient = require('*/cartridge/scripts/helpers/llmClient');
        
        // Build the test request
        var llmRequest = {
            provider: provider,
            model: model,
            messages: [
                {
                    role: 'user',
                    content: 'This is a connectivity test. If you can read this, the connection to the LLM provider is working. Please respond with a short, affirmative message confirming you received this message. Keep your response under 20 words.'
                }
            ],
            params: {}
        };
        
        // Call the LLM
        var result = LLMClient.generateText(llmRequest);
        
        var endTime = Date.now();
        var duration = endTime - startTime;
        
        logger.info('LLMTest: Success - received response in ' + duration + 'ms');
        
        // Return success response
        response.getWriter().print(JSON.stringify({
            success: true,
            provider: result.provider,
            model: result.model,
            response: result.content,
            finishReason: result.finishReason,
            usage: result.usage,
            durationMs: duration
        }, null, 2));
        
    } catch (e) {
        var endTime = Date.now();
        var duration = endTime - startTime;
        
        logger.error('LLMTest: Error - ' + e.message);
        
        // Determine error details
        var errorResponse = {
            success: false,
            error: e.message,
            errorType: e.type || 'Unknown',
            provider: e.provider || 'unknown',
            durationMs: duration
        };
        
        // Add status code hint based on error type
        if (e.type === 'AuthenticationError') {
            response.setStatus(401);
            errorResponse.hint = 'Check that your API key is correctly configured in Business Manager Service Credentials';
        } else if (e.type === 'ConfigurationError') {
            response.setStatus(500);
            errorResponse.hint = 'Check Site Preferences (llmAvailableModelsJson) and Service configuration in Business Manager';
        } else if (e.type === 'ValidationError') {
            response.setStatus(400);
            errorResponse.hint = 'Check that provider and model parameters are valid';
        } else if (e.type === 'RateLimitError') {
            response.setStatus(429);
            errorResponse.hint = 'Rate limit exceeded - wait and try again';
        } else {
            response.setStatus(500);
        }
        
        response.getWriter().print(JSON.stringify(errorResponse, null, 2));
    }
}

/**
 * LLMTest-Config : Shows current LLM configuration (without sensitive data)
 * Useful for debugging configuration issues.
 */
function config() {
    response.setContentType('application/json');
    
    try {
        var configHelper = require('*/cartridge/scripts/helpers/llmConfigHelper');
        
        var llmConfig = configHelper.loadLLMConfiguration();
        var availableModels;
        
        try {
            availableModels = configHelper.parseAvailableModels(llmConfig.availableModelsJson);
        } catch (parseError) {
            availableModels = { error: parseError.message };
        }
        
        response.getWriter().print(JSON.stringify({
            success: true,
            configuration: {
                validProviders: configHelper.VALID_PROVIDERS,
                anthropicApiVersion: llmConfig.anthropicApiVersion || '(not set)',
                debugMode: llmConfig.debugMode,
                availableModels: availableModels
            },
            hint: 'API keys are stored in Business Manager > Administration > Operations > Services > Credentials'
        }, null, 2));
        
    } catch (e) {
        response.setStatus(500);
        response.getWriter().print(JSON.stringify({
            success: false,
            error: e.message,
            hint: 'Check Site Preferences configuration in Business Manager'
        }, null, 2));
    }
}

/*
 * Export controller endpoints
 */
exports.Ping = ping;
exports.Ping.public = true;

exports.Test = test;
exports.Test.public = true;

exports.Config = config;
exports.Config.public = true;
