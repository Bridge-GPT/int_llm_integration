'use strict';

/**
 * LLM Test Controller
 *
 * Provides a storefront test page and JSON endpoints for verifying LLM connectivity.
 * All endpoints are gated behind the llmTestModeEnabled site preference.
 *
 * @namespace LLMTest
 */

/* global request, response */

var ISML = require('dw/template/ISML');
var CSRFProtection = require('dw/web/CSRFProtection');
var Logger = require('dw/system/Logger');
var System = require('dw/system/System');
var logger = Logger.getLogger('LLMIntegration', 'LLMTest');

var configHelper = require('*/cartridge/scripts/helpers/llmConfigHelper');

/**
 * Wraps a controller function to block execution on production instances.
 * Returns a 403 JSON response if the current instance is production.
 *
 * @param {Function} fn - The controller function to wrap
 * @returns {Function} Guarded function that blocks on production
 */
function nonProduction(fn) {
    return function () {
        if (System.getInstanceType() === System.PRODUCTION_SYSTEM) {
            response.setStatus(403);
            response.setContentType('application/json');
            response.getWriter().print(JSON.stringify({
                success: false,
                error: 'LLM test endpoints are not available in production environments.'
            }));
            return;
        }
        fn();
    };
}

/**
 * Returns a 403 JSON response when test mode is disabled.
 */
function respondTestModeDisabled() {
    response.setStatus(403);
    response.setContentType('application/json');
    response.getWriter().print(JSON.stringify({
        success: false,
        error: 'LLM test mode is not enabled. Set llmTestModeEnabled to true in Site Preferences.'
    }, null, 2));
}

/**
 * Returns a 403 JSON response when CSRF validation fails.
 */
function respondCSRFInvalid() {
    response.setStatus(403);
    response.setContentType('application/json');
    response.getWriter().print(JSON.stringify({
        success: false,
        error: 'CSRF token validation failed'
    }, null, 2));
}

/**
 * Builds the providers list and models-per-provider map for the UI.
 * @returns {Object} { providers: string[], modelsMap: Object }
 */
function buildProviderModelData() {
    var providers = configHelper.VALID_PROVIDERS;
    var modelsMap = {};

    try {
        var llmConfig = configHelper.loadLLMConfiguration();
        var allModels = configHelper.parseAvailableModels(llmConfig.llmAvailableModelsJson);

        for (var i = 0; i < providers.length; i++) {
            var p = providers[i];
            var tiers = allModels[p] || {};
            var modelList = [];
            for (var tier in tiers) {
                if (Object.prototype.hasOwnProperty.call(tiers, tier)) {
                    modelList.push(tiers[tier]);
                }
            }
            modelsMap[p] = modelList;
        }
    } catch (e) {
        logger.warn('Could not load model configuration for test page: ' + e.message);
    }

    return { providers: providers, modelsMap: modelsMap };
}

/**
 * LLMTest-Show : Renders the connection test page.
 */
function show() {
    var testModeEnabled = configHelper.isTestModeEnabled();

    var data = buildProviderModelData();

    ISML.renderTemplate('llmTest/connectionTest', {
        testModeEnabled: testModeEnabled,
        csrfToken: CSRFProtection.generateToken(),
        csrfTokenName: CSRFProtection.getTokenName(),
        providers: data.providers,
        modelsMapJson: JSON.stringify(data.modelsMap)
    });
}

/**
 * LLMTest-Ping : Simple health check.
 */
function ping() {
    if (!configHelper.isTestModeEnabled()) {
        respondTestModeDisabled();
        return;
    }

    response.setContentType('text/plain');
    response.getWriter().print('pong - LLM Integration cartridge is loaded');
}

/**
 * LLMTest-Test : Sends a test message to the specified LLM provider.
 */
function test() {
    response.setContentType('application/json');

    if (!configHelper.isTestModeEnabled()) {
        respondTestModeDisabled();
        return;
    }

    if (!CSRFProtection.validateRequest()) {
        respondCSRFInvalid();
        return;
    }

    var startTime = Date.now();

    try {
        var provider = request.httpParameterMap.provider.stringValue;
        var model = request.httpParameterMap.model.stringValue;

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

        var LLMClient = require('*/cartridge/scripts/helpers/llmClient');

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

        var result = LLMClient.generateText(llmRequest);

        var endTime = Date.now();
        var duration = endTime - startTime;

        logger.info('LLMTest: Success - received response in ' + duration + 'ms');

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
        var errorEndTime = Date.now();
        var errorDuration = errorEndTime - startTime;

        logger.error('LLMTest: Error - ' + e.message);

        var errorResponse = {
            success: false,
            error: e.message,
            errorType: e.errorType || 'Unknown',
            provider: e.provider || 'unknown',
            durationMs: errorDuration
        };

        if (e.errorType === 'AuthenticationError') {
            response.setStatus(401);
            errorResponse.hint = 'Check that your API key is correctly configured in Business Manager Service Credentials';
        } else if (e.errorType === 'ConfigurationError') {
            response.setStatus(500);
            errorResponse.hint = 'Check Site Preferences (llmAvailableModelsJson) and Service configuration in Business Manager';
        } else if (e.errorType === 'ValidationError') {
            response.setStatus(400);
            errorResponse.hint = 'Check that provider and model parameters are valid';
        } else if (e.errorType === 'RateLimitError') {
            response.setStatus(429);
            errorResponse.hint = 'Rate limit exceeded - wait and try again';
        } else {
            response.setStatus(500);
        }

        response.getWriter().print(JSON.stringify(errorResponse, null, 2));
    }
}

/**
 * LLMTest-BatchTest : Submits a minimal batch to verify batch connectivity.
 * Returns immediately with the batchId. The frontend polls BatchStatus for results.
 */
function batchTest() {
    response.setContentType('application/json');

    if (!configHelper.isTestModeEnabled()) {
        respondTestModeDisabled();
        return;
    }

    if (!CSRFProtection.validateRequest()) {
        respondCSRFInvalid();
        return;
    }

    var startTime = Date.now();

    try {
        var provider = request.httpParameterMap.provider.stringValue;
        var model = request.httpParameterMap.model.stringValue;

        if (!provider) {
            response.setStatus(400);
            response.getWriter().print(JSON.stringify({
                success: false,
                error: 'Missing required parameter: provider'
            }, null, 2));
            return;
        }

        if (!model) {
            response.setStatus(400);
            response.getWriter().print(JSON.stringify({
                success: false,
                error: 'Missing required parameter: model'
            }, null, 2));
            return;
        }

        logger.info('LLMTest: Batch testing provider=' + provider + ', model=' + model);

        var LLMBatchClient = require('*/cartridge/scripts/helpers/llmBatchClient');

        var result = LLMBatchClient.submitBatch({
            provider: provider,
            model: model,
            requests: [
                {
                    customId: 'connectivity-test-1',
                    messages: [
                        {
                            role: 'user',
                            content: 'This is a batch connectivity test. Respond with OK.'
                        }
                    ]
                }
            ]
        });

        var duration = Date.now() - startTime;

        logger.info('LLMTest: Batch submit success - batchId=' + result.batchId + ' in ' + duration + 'ms');

        response.getWriter().print(JSON.stringify({
            success: true,
            batchId: result.batchId,
            provider: result.provider,
            status: result.status,
            totalRequests: result.totalRequests,
            durationMs: duration
        }, null, 2));

    } catch (e) {
        var errorDuration = Date.now() - startTime;

        logger.error('LLMTest: Batch error - ' + e.message);

        var errorResponse = {
            success: false,
            error: e.message,
            errorType: e.errorType || 'Unknown',
            durationMs: errorDuration
        };

        if (e.errorType === 'AuthenticationError') {
            response.setStatus(401);
        } else if (e.errorType === 'RateLimitError') {
            response.setStatus(429);
        } else if (e.errorType === 'ValidationError') {
            response.setStatus(400);
        } else {
            response.setStatus(500);
        }

        response.getWriter().print(JSON.stringify(errorResponse, null, 2));
    }
}

/**
 * LLMTest-BatchStatus : Checks batch status and returns results if completed.
 * Called by frontend polling. No CSRF required (read-only, gated by test mode).
 */
function batchStatus() {
    response.setContentType('application/json');

    if (!configHelper.isTestModeEnabled()) {
        respondTestModeDisabled();
        return;
    }

    try {
        var provider = request.httpParameterMap.provider.stringValue;
        var batchId = request.httpParameterMap.batchId.stringValue;
        var model = request.httpParameterMap.model.stringValue;

        if (!provider || !batchId) {
            response.setStatus(400);
            response.getWriter().print(JSON.stringify({
                success: false,
                error: 'Missing required parameters: provider, batchId'
            }, null, 2));
            return;
        }

        var LLMBatchClient = require('*/cartridge/scripts/helpers/llmBatchClient');

        var statusResult = LLMBatchClient.getBatchStatus({
            provider: provider,
            batchId: batchId
        });

        var statusResponse = {
            success: true,
            batchId: batchId,
            provider: provider,
            status: statusResult.status
        };

        // If completed, fetch and include the actual result
        if (statusResult.status === 'completed') {
            try {
                var batchResults = LLMBatchClient.getBatchResults({
                    provider: provider,
                    batchId: batchId,
                    model: model || undefined
                });

                var firstResult = batchResults.results && batchResults.results[0];
                if (firstResult && firstResult.success) {
                    statusResponse.response = firstResult.response.content;
                    statusResponse.model = firstResult.response.model;
                    statusResponse.usage = firstResult.response.usage;
                    statusResponse.finishReason = firstResult.response.finishReason;
                } else if (firstResult) {
                    statusResponse.resultError = firstResult.error;
                }
            } catch (resultErr) {
                logger.warn('LLMTest: Could not retrieve batch results: ' + resultErr.message);
                statusResponse.resultError = resultErr.message;
            }
        } else if (statusResult.status === 'failed' || statusResult.status === 'expired' || statusResult.status === 'cancelled') {
            statusResponse.success = false;
            statusResponse.error = 'Batch ended with status: ' + statusResult.status;
        }

        response.getWriter().print(JSON.stringify(statusResponse, null, 2));

    } catch (e) {
        logger.error('LLMTest: BatchStatus error - ' + e.message);

        response.setStatus(500);
        response.getWriter().print(JSON.stringify({
            success: false,
            error: e.message,
            errorType: e.errorType || 'Unknown'
        }, null, 2));
    }
}

/**
 * LLMTest-Config : Shows current LLM configuration (without sensitive data).
 */
function config() {
    response.setContentType('application/json');

    if (!configHelper.isTestModeEnabled()) {
        respondTestModeDisabled();
        return;
    }

    try {
        var llmConfig = configHelper.loadLLMConfiguration();
        var availableModels;

        try {
            availableModels = configHelper.parseAvailableModels(llmConfig.llmAvailableModelsJson);
        } catch (parseError) {
            availableModels = { error: parseError.message };
        }

        response.getWriter().print(JSON.stringify({
            success: true,
            configuration: {
                validProviders: configHelper.VALID_PROVIDERS,
                anthropicApiVersion: llmConfig.llmAnthropicApiVersion || '(not set)',
                debugMode: llmConfig.llmDebugMode,
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
exports.Show = nonProduction(show);
exports.Show.public = true;

exports.Ping = nonProduction(ping);
exports.Ping.public = true;

exports.Test = nonProduction(test);
exports.Test.public = true;

exports.BatchTest = nonProduction(batchTest);
exports.BatchTest.public = true;

exports.BatchStatus = nonProduction(batchStatus);
exports.BatchStatus.public = true;

exports.Config = nonProduction(config);
exports.Config.public = true;
