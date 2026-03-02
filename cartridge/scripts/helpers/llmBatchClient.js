'use strict';

/**
 * LLM Batch Client Module
 *
 * Main entry point for making batch LLM requests. This module provides a unified
 * interface for consumers to submit, poll, retrieve results from, and cancel
 * batch requests across different LLM providers.
 *
 * Each function validates inputs, routes to the appropriate provider-specific
 * batch service, and returns normalized results.
 *
 * @module helpers/llmBatchClient
 *
 * @example
 * var LLMBatchClient = require('*\/cartridge/scripts/helpers/llmBatchClient');
 *
 * // Submit a batch
 * var submission = LLMBatchClient.submitBatch({
 *     provider: 'openai',
 *     model: 'gpt-4o',
 *     requests: [
 *         { customId: 'req-1', messages: [{ role: 'user', content: 'Hello' }] },
 *         { customId: 'req-2', messages: [{ role: 'user', content: 'World' }] }
 *     ]
 * });
 * // submission.batchId -- persist immediately, batch creation is NOT idempotent
 *
 * // Poll status
 * var status = LLMBatchClient.getBatchStatus({
 *     provider: 'openai',
 *     batchId: submission.batchId
 * });
 * // status.status is one of BATCH_STATUSES values
 *
 * // Retrieve results (only when status is 'completed' or 'failed')
 * var results = LLMBatchClient.getBatchResults({
 *     provider: 'openai',
 *     batchId: submission.batchId
 * });
 * // results.results[].response matches generateText return shape
 *
 * // Cancel
 * var cancel = LLMBatchClient.cancelBatch({
 *     provider: 'openai',
 *     batchId: submission.batchId
 * });
 *
 * @description
 * **Unified Status Enum:**
 * | Unified Status | OpenAI Native              | Anthropic Native | Gemini Native          |
 * |----------------|----------------------------|------------------|------------------------|
 * | pending        | validating                 | -                | JOB_STATE_PENDING      |
 * | processing     | in_progress, finalizing    | in_progress      | JOB_STATE_RUNNING      |
 * | completed      | completed                  | ended (any ok)   | JOB_STATE_SUCCEEDED    |
 * | failed         | failed                     | ended (all err)  | JOB_STATE_FAILED       |
 * | expired        | expired                    | -                | JOB_STATE_EXPIRED      |
 * | cancelling     | cancelling                 | canceling        | -                      |
 * | cancelled      | cancelled                  | -                | JOB_STATE_CANCELLED    |
 *
 * **Important Caveats:**
 * - Batch creation is NOT idempotent. Persist batchId immediately after submitBatch.
 * - Anthropic request_counts remain zero until status reaches 'ended'.
 * - Gemini batches expire after 48h with no partial results on timeout.
 * - Practical SFCC memory constraints may impose lower effective batch sizes
 *   than provider API limits. Recommend batch sizes under a few thousand items.
 *
 * @throws {Error} With isLLMError=true and errorType property for:
 *   - ValidationError: Invalid request parameters
 *   - BatchSubmissionError: Failure during batch creation or file upload
 *   - BatchExpiredError: Batch hit the provider's expiry window
 *   - AuthenticationError: Invalid or missing API key
 *   - RateLimitError: Provider rate limit exceeded
 *   - ProviderError: Provider-side error
 *   - ConfigurationError: Missing or invalid configuration
 */

var Logger = require('dw/system/Logger');

var validationHelper = require('*/cartridge/scripts/helpers/llmValidationHelper');
var configHelper = require('*/cartridge/scripts/helpers/llmConfigHelper');
var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');

var logger = Logger.getLogger('LLMIntegration', 'batch-client');

/**
 * Unified batch status values.
 * Consumers should compare against these values rather than using string literals.
 *
 * @constant {Object}
 */
var BATCH_STATUSES = {
    pending: 'pending',
    processing: 'processing',
    completed: 'completed',
    failed: 'failed',
    expired: 'expired',
    cancelling: 'cancelling',
    cancelled: 'cancelled'
};

/**
 * Submits a batch of LLM requests.
 *
 * @param {Object} options - The batch request options
 * @param {string} [options.provider] - The LLM provider. If omitted, resolved from model.
 * @param {string} options.model - The model identifier (all items use the same model)
 * @param {Array<Object>} options.requests - Array of request items
 * @param {string} options.requests[].customId - Unique ID for correlation
 * @param {Array<Object>} options.requests[].messages - Messages array
 * @param {Object} [options.requests[].params] - Optional per-item params
 * @returns {Object} Result: { batchId, provider, status, totalRequests, createdAt }
 */
function submitBatch(options) {
    var startTime = Date.now();
    var provider;
    var model = options && options.model;

    try {
        // Resolve provider if not supplied
        if (options && !options.provider && options.model) {
            options.provider = configHelper.resolveProviderForModel(options.model);
        }

        provider = options && options.provider;

        logger.info('Batch submit started - provider: ' + provider + ', model: ' + model);

        // Validate
        var validation = validationHelper.validateBatchRequest(options);
        if (!validation.valid) {
            throw errorHelper.createLLMError(
                validation.error,
                errorHelper.ERROR_TYPES.ValidationError,
                400,
                null
            );
        }

        // Build per-item payloads using existing payload builders
        var normalizationHelper = require('*/cartridge/scripts/helpers/llmNormalizationHelper');
        var items = [];
        for (var i = 0; i < options.requests.length; i++) {
            var req = options.requests[i];
            var normalizedRequest = {
                provider: options.provider,
                model: options.model,
                messages: req.messages,
                params: req.params || {}
            };

            var payload;
            switch (options.provider) {
                case 'openai':
                    payload = normalizationHelper.buildOpenAIPayload(normalizedRequest);
                    break;
                case 'anthropic':
                    payload = normalizationHelper.buildAnthropicPayload(normalizedRequest);
                    break;
                case 'gemini':
                    payload = normalizationHelper.buildGeminiPayload(normalizedRequest);
                    break;
                default:
                    throw errorHelper.createLLMError(
                        'Unknown provider: ' + options.provider,
                        errorHelper.ERROR_TYPES.ValidationError,
                        400,
                        null
                    );
            }

            items.push({ customId: req.customId, payload: payload });
        }

        // Route to provider batch service
        var result;
        switch (options.provider) {
            case 'openai':
                var openAIBatchService = require('*/cartridge/scripts/services/llmOpenAIBatchService');
                result = openAIBatchService.submitBatch(options.model, items);
                break;
            case 'anthropic':
                var anthropicBatchService = require('*/cartridge/scripts/services/llmAnthropicBatchService');
                result = anthropicBatchService.submitBatch(options.model, items);
                break;
            case 'gemini':
                var geminiBatchService = require('*/cartridge/scripts/services/llmGeminiBatchService');
                result = geminiBatchService.submitBatch(options.model, items);
                break;
            default:
                throw errorHelper.createLLMError(
                    'Unknown provider: ' + options.provider,
                    errorHelper.ERROR_TYPES.ValidationError,
                    400,
                    null
                );
        }

        var elapsed = Date.now() - startTime;
        logger.info('Batch submit completed - provider: ' + provider + ', batchId: ' + result.batchId + ', elapsed: ' + elapsed + 'ms');

        return {
            batchId: result.batchId,
            provider: options.provider,
            status: result.status,
            totalRequests: options.requests.length,
            createdAt: result.createdAt
        };

    } catch (e) {
        var elapsed2 = Date.now() - startTime;
        logger.error('Batch submit failed - provider: ' + provider + ', model: ' + model + ', elapsed: ' + elapsed2 + 'ms, error: ' + errorHelper.sanitizeForLogging(e.message));

        if (e.isLLMError) {
            throw e;
        }

        throw errorHelper.createLLMError(
            'Batch submit failed: ' + e.message,
            errorHelper.ERROR_TYPES.ProviderError,
            500,
            null
        );
    }
}

/**
 * Gets the status of a batch.
 *
 * @param {Object} options - Status request options
 * @param {string} options.provider - The LLM provider
 * @param {string} options.batchId - The batch identifier
 * @returns {Object} Result: { batchId, provider, status, requestCounts, createdAt, expiresAt }
 */
function getBatchStatus(options) {
    var provider = options && options.provider;
    var batchId = options && options.batchId;

    try {
        if (!provider || typeof provider !== 'string') {
            throw errorHelper.createLLMError(
                'provider is required',
                errorHelper.ERROR_TYPES.ValidationError,
                400,
                null
            );
        }

        if (!batchId || typeof batchId !== 'string') {
            throw errorHelper.createLLMError(
                'batchId is required',
                errorHelper.ERROR_TYPES.ValidationError,
                400,
                null
            );
        }

        var result;
        switch (provider) {
            case 'openai':
                var openAIBatchService = require('*/cartridge/scripts/services/llmOpenAIBatchService');
                result = openAIBatchService.getBatchStatus(batchId);
                break;
            case 'anthropic':
                var anthropicBatchService = require('*/cartridge/scripts/services/llmAnthropicBatchService');
                result = anthropicBatchService.getBatchStatus(batchId);
                break;
            case 'gemini':
                var geminiBatchService = require('*/cartridge/scripts/services/llmGeminiBatchService');
                result = geminiBatchService.getBatchStatus(batchId);
                break;
            default:
                throw errorHelper.createLLMError(
                    'Unknown provider: ' + provider,
                    errorHelper.ERROR_TYPES.ValidationError,
                    400,
                    null
                );
        }

        return {
            batchId: result.batchId,
            provider: provider,
            status: result.status,
            requestCounts: result.requestCounts,
            createdAt: result.createdAt,
            expiresAt: result.expiresAt || null
        };

    } catch (e) {
        logger.error('Batch status check failed - provider: ' + provider + ', batchId: ' + batchId + ', error: ' + errorHelper.sanitizeForLogging(e.message));

        if (e.isLLMError) {
            throw e;
        }

        throw errorHelper.createLLMError(
            'Batch status check failed: ' + e.message,
            errorHelper.ERROR_TYPES.ProviderError,
            500,
            null
        );
    }
}

/**
 * Retrieves the results of a completed batch.
 *
 * @param {Object} options - Results request options
 * @param {string} options.provider - The LLM provider
 * @param {string} options.batchId - The batch identifier
 * @param {string} [options.model] - Model for normalization (falls back to provider default)
 * @returns {Object} Result: { batchId, provider, results: [{ customId, success, response, error }] }
 */
function getBatchResults(options) {
    var provider = options && options.provider;
    var batchId = options && options.batchId;
    var model = options && options.model;

    try {
        if (!provider || typeof provider !== 'string') {
            throw errorHelper.createLLMError(
                'provider is required',
                errorHelper.ERROR_TYPES.ValidationError,
                400,
                null
            );
        }

        if (!batchId || typeof batchId !== 'string') {
            throw errorHelper.createLLMError(
                'batchId is required',
                errorHelper.ERROR_TYPES.ValidationError,
                400,
                null
            );
        }

        var results;
        switch (provider) {
            case 'openai':
                var openAIBatchService = require('*/cartridge/scripts/services/llmOpenAIBatchService');
                results = openAIBatchService.getBatchResults(batchId, model);
                break;
            case 'anthropic':
                var anthropicBatchService = require('*/cartridge/scripts/services/llmAnthropicBatchService');
                results = anthropicBatchService.getBatchResults(batchId, model);
                break;
            case 'gemini':
                var geminiBatchService = require('*/cartridge/scripts/services/llmGeminiBatchService');
                results = geminiBatchService.getBatchResults(batchId, model);
                break;
            default:
                throw errorHelper.createLLMError(
                    'Unknown provider: ' + provider,
                    errorHelper.ERROR_TYPES.ValidationError,
                    400,
                    null
                );
        }

        // Strip rawResponse when debug mode is off
        if (!configHelper.isDebugMode()) {
            for (var i = 0; i < results.length; i++) {
                if (results[i].response && results[i].response.rawResponse) {
                    delete results[i].response.rawResponse;
                }
            }
        }

        return {
            batchId: batchId,
            provider: provider,
            results: results
        };

    } catch (e) {
        logger.error('Batch results retrieval failed - provider: ' + provider + ', batchId: ' + batchId + ', error: ' + errorHelper.sanitizeForLogging(e.message));

        if (e.isLLMError) {
            throw e;
        }

        throw errorHelper.createLLMError(
            'Batch results retrieval failed: ' + e.message,
            errorHelper.ERROR_TYPES.ProviderError,
            500,
            null
        );
    }
}

/**
 * Cancels a batch.
 *
 * @param {Object} options - Cancel request options
 * @param {string} options.provider - The LLM provider
 * @param {string} options.batchId - The batch identifier
 * @returns {Object} Result: { batchId, provider, status }
 */
function cancelBatch(options) {
    var provider = options && options.provider;
    var batchId = options && options.batchId;

    try {
        if (!provider || typeof provider !== 'string') {
            throw errorHelper.createLLMError(
                'provider is required',
                errorHelper.ERROR_TYPES.ValidationError,
                400,
                null
            );
        }

        if (!batchId || typeof batchId !== 'string') {
            throw errorHelper.createLLMError(
                'batchId is required',
                errorHelper.ERROR_TYPES.ValidationError,
                400,
                null
            );
        }

        var result;
        switch (provider) {
            case 'openai':
                var openAIBatchService = require('*/cartridge/scripts/services/llmOpenAIBatchService');
                result = openAIBatchService.cancelBatch(batchId);
                break;
            case 'anthropic':
                var anthropicBatchService = require('*/cartridge/scripts/services/llmAnthropicBatchService');
                result = anthropicBatchService.cancelBatch(batchId);
                break;
            case 'gemini':
                var geminiBatchService = require('*/cartridge/scripts/services/llmGeminiBatchService');
                result = geminiBatchService.cancelBatch(batchId);
                break;
            default:
                throw errorHelper.createLLMError(
                    'Unknown provider: ' + provider,
                    errorHelper.ERROR_TYPES.ValidationError,
                    400,
                    null
                );
        }

        return {
            batchId: batchId,
            provider: provider,
            status: result.status
        };

    } catch (e) {
        logger.error('Batch cancellation failed - provider: ' + provider + ', batchId: ' + batchId + ', error: ' + errorHelper.sanitizeForLogging(e.message));

        if (e.isLLMError) {
            throw e;
        }

        throw errorHelper.createLLMError(
            'Batch cancellation failed: ' + e.message,
            errorHelper.ERROR_TYPES.ProviderError,
            500,
            null
        );
    }
}

module.exports = {
    submitBatch: submitBatch,
    getBatchStatus: getBatchStatus,
    getBatchResults: getBatchResults,
    cancelBatch: cancelBatch,
    BATCH_STATUSES: BATCH_STATUSES
};
