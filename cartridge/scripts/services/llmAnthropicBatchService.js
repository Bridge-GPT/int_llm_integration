'use strict';

/**
 * LLM Anthropic Batch Service Module
 *
 * Implements the SFCC service definition for Anthropic's Message Batches API.
 * Handles single-POST batch submission, status polling, JSONL result retrieval,
 * and cancellation.
 *
 * @module services/llmAnthropicBatchService
 */

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Logger = require('dw/system/Logger');

var logger = Logger.getLogger('LLMIntegration', 'anthropic-batch');

/**
 * Service ID constant matching the service-id in services.xml.
 * @constant {string}
 */
var SERVICE_ID = 'llm.anthropic.batch';

/**
 * Parses a JSONL response text into an array of objects.
 * Each line is parsed individually; malformed lines produce error entries.
 *
 * @param {string} responseText - The JSONL text
 * @returns {Array} Array of parsed objects or error entries
 * @private
 */
function parseJSONL(responseText) {
    var lines = responseText.split('\n');
    var results = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line) {
            try {
                results.push(JSON.parse(line));
            } catch (e) {
                results.push({ parseError: true, rawLine: line, error: e.message });
            }
        }
    }
    return results;
}

/**
 * Submits a batch of requests to Anthropic via single JSON POST.
 *
 * @param {string} model - The model identifier
 * @param {Array} items - Array of { customId, payload } objects
 * @returns {Object} Batch submission result
 * @throws {Error} BatchSubmissionError or ConfigurationError
 */
function submitBatch(model, items) {
    var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');
    var configHelper = require('*/cartridge/scripts/helpers/llmConfigHelper');

    var anthropicVersion = configHelper.getAnthropicApiVersion();

    // Build request body
    var requestBody = { requests: [] };
    for (var i = 0; i < items.length; i++) {
        requestBody.requests.push({
            custom_id: items[i].customId,
            params: items[i].payload
        });
    }

    var service = LocalServiceRegistry.createService(SERVICE_ID, {
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

            var baseUrl = credential.getURL() || 'https://api.anthropic.com';
            svc.setURL(baseUrl + '/v1/messages/batches');
            svc.setRequestMethod('POST');

            svc.addHeader('x-api-key', apiKey);
            svc.addHeader('anthropic-version', params.apiVersion);
            svc.addHeader('Content-Type', 'application/json');

            return JSON.stringify(params.body);
        },

        parseResponse: function (svc, client) {
            if (client.statusCode !== 200) {
                var errorBody = null;
                try {
                    errorBody = JSON.parse(client.text);
                } catch (e) {
                    errorBody = { message: client.text };
                }
                throw errorHelper.mapProviderError('anthropic', client.statusCode, errorBody);
            }

            return JSON.parse(client.text);
        },

        mockCall: function (svc, params) {
            return {
                statusCode: 200,
                statusMessage: 'OK',
                text: JSON.stringify({
                    id: 'msgbatch_mock_' + Date.now(),
                    type: 'message_batch',
                    processing_status: 'in_progress',
                    request_counts: {
                        processing: params.body.requests.length,
                        succeeded: 0,
                        errored: 0,
                        canceled: 0,
                        expired: 0
                    },
                    created_at: new Date().toISOString(),
                    expires_at: new Date(Date.now() + 86400000).toISOString()
                })
            };
        },

        filterLogMessage: function (msg) {
            return errorHelper.sanitizeForLogging(msg);
        }
    });

    var result = service.call({ body: requestBody, apiVersion: anthropicVersion });

    if (!result.ok) {
        var errorMessage = 'Anthropic batch submission failed';
        if (result.errorMessage) {
            errorMessage += ': ' + result.errorMessage;
        }
        logger.error(errorHelper.sanitizeForLogging(errorMessage));

        if (result.error && result.error.isLLMError) {
            throw result.error;
        }

        throw errorHelper.createLLMError(
            errorMessage,
            errorHelper.ERROR_TYPES.BatchSubmissionError,
            500,
            null
        );
    }

    return {
        batchId: result.object.id,
        status: result.object.processing_status,
        requestCounts: result.object.request_counts,
        createdAt: result.object.created_at,
        expiresAt: result.object.expires_at || null
    };
}

/**
 * Gets the status of an Anthropic batch.
 * Note: Anthropic's request_counts show zeros for all sub-counts until
 * the batch reaches 'ended' status.
 *
 * @param {string} batchId - The batch identifier
 * @returns {Object} Batch status with unified status string
 * @throws {Error} ProviderError on failure
 */
function getBatchStatus(batchId) {
    var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');
    var configHelper = require('*/cartridge/scripts/helpers/llmConfigHelper');

    var anthropicVersion = configHelper.getAnthropicApiVersion();

    var service = LocalServiceRegistry.createService(SERVICE_ID, {
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

            var baseUrl = credential.getURL() || 'https://api.anthropic.com';
            svc.setURL(baseUrl + '/v1/messages/batches/' + params.batchId);
            svc.setRequestMethod('GET');

            svc.addHeader('x-api-key', apiKey);
            svc.addHeader('anthropic-version', params.apiVersion);

            return null;
        },

        parseResponse: function (svc, client) {
            if (client.statusCode !== 200) {
                var errorBody = null;
                try {
                    errorBody = JSON.parse(client.text);
                } catch (e) {
                    errorBody = { message: client.text };
                }
                throw errorHelper.mapProviderError('anthropic', client.statusCode, errorBody);
            }

            return JSON.parse(client.text);
        },

        mockCall: function (svc, params) {
            return {
                statusCode: 200,
                statusMessage: 'OK',
                text: JSON.stringify({
                    id: params.batchId,
                    type: 'message_batch',
                    processing_status: 'ended',
                    request_counts: {
                        processing: 0,
                        succeeded: 5,
                        errored: 0,
                        canceled: 0,
                        expired: 0
                    },
                    created_at: new Date().toISOString(),
                    expires_at: new Date(Date.now() + 86400000).toISOString()
                })
            };
        },

        filterLogMessage: function (msg) {
            return errorHelper.sanitizeForLogging(msg);
        }
    });

    var result = service.call({ batchId: batchId, apiVersion: anthropicVersion });

    if (!result.ok) {
        var errorMessage = 'Anthropic batch status check failed';
        if (result.errorMessage) {
            errorMessage += ': ' + result.errorMessage;
        }
        logger.error(errorHelper.sanitizeForLogging(errorMessage));

        if (result.error && result.error.isLLMError) {
            throw result.error;
        }

        throw errorHelper.createLLMError(
            errorMessage,
            errorHelper.ERROR_TYPES.ProviderError,
            500,
            null
        );
    }

    // Map Anthropic's 3-state model to unified status
    var processingStatus = result.object.processing_status;
    var counts = result.object.request_counts;
    var unifiedStatus;

    if (processingStatus === 'in_progress') {
        unifiedStatus = 'processing';
    } else if (processingStatus === 'canceling') {
        unifiedStatus = 'cancelling';
    } else if (processingStatus === 'ended') {
        if (counts.succeeded === 0 && (counts.errored > 0 || counts.expired > 0)) {
            unifiedStatus = 'failed';
        } else {
            unifiedStatus = 'completed';
        }
    } else {
        unifiedStatus = 'processing';
    }

    return {
        batchId: batchId,
        status: unifiedStatus,
        requestCounts: {
            total: counts.processing + counts.succeeded + counts.errored + counts.canceled + counts.expired,
            completed: counts.succeeded,
            failed: counts.errored
        },
        createdAt: result.object.created_at,
        expiresAt: result.object.expires_at || null
    };
}

/**
 * Retrieves and parses the results of a completed Anthropic batch.
 *
 * @param {string} batchId - The batch identifier
 * @param {string} model - The model used for normalization
 * @returns {Array} Array of { customId, success, response, error } items
 * @throws {Error} BatchSubmissionError if batch not complete, ProviderError on failure
 */
function getBatchResults(batchId, model) {
    var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');
    var normalizationHelper = require('*/cartridge/scripts/helpers/llmNormalizationHelper');
    var configHelper = require('*/cartridge/scripts/helpers/llmConfigHelper');

    var anthropicVersion = configHelper.getAnthropicApiVersion();

    var service = LocalServiceRegistry.createService(SERVICE_ID, {
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

            var baseUrl = credential.getURL() || 'https://api.anthropic.com';
            svc.setURL(baseUrl + '/v1/messages/batches/' + params.batchId + '/results');
            svc.setRequestMethod('GET');

            svc.addHeader('x-api-key', apiKey);
            svc.addHeader('anthropic-version', params.apiVersion);

            return null;
        },

        parseResponse: function (svc, client) {
            if (client.statusCode !== 200) {
                var errorBody = null;
                try {
                    errorBody = JSON.parse(client.text);
                } catch (e) {
                    errorBody = { message: client.text };
                }
                throw errorHelper.mapProviderError('anthropic', client.statusCode, errorBody);
            }

            // Return raw JSONL text
            return client.text;
        },

        mockCall: function (svc, params) {
            var successLine = JSON.stringify({
                custom_id: 'r1',
                result: {
                    type: 'succeeded',
                    message: {
                        id: 'msg_mock',
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'text', text: 'Mock response' }],
                        stop_reason: 'end_turn',
                        usage: { input_tokens: 10, output_tokens: 5 }
                    }
                }
            });
            var errorLine = JSON.stringify({
                custom_id: 'r2',
                result: {
                    type: 'errored',
                    error: { type: 'server_error', message: 'Internal error' }
                }
            });
            return {
                statusCode: 200,
                statusMessage: 'OK',
                text: successLine + '\n' + errorLine
            };
        },

        filterLogMessage: function (msg) {
            return errorHelper.sanitizeForLogging(msg);
        }
    });

    var result = service.call({ batchId: batchId, apiVersion: anthropicVersion });

    if (!result.ok) {
        var errorMessage = 'Anthropic batch results download failed';
        if (result.errorMessage) {
            errorMessage += ': ' + result.errorMessage;
        }
        logger.error(errorHelper.sanitizeForLogging(errorMessage));

        if (result.error && result.error.isLLMError) {
            throw result.error;
        }

        throw errorHelper.createLLMError(
            errorMessage,
            errorHelper.ERROR_TYPES.ProviderError,
            500,
            null
        );
    }

    // Parse JSONL results
    var parsedLines = parseJSONL(result.object);
    var results = [];

    for (var i = 0; i < parsedLines.length; i++) {
        var line = parsedLines[i];

        if (line.parseError) {
            results.push({
                customId: 'unknown',
                success: false,
                error: errorHelper.createLLMError(
                    'Failed to parse result line: ' + line.error,
                    errorHelper.ERROR_TYPES.ProviderError,
                    500,
                    null
                )
            });
        } else if (line.result && line.result.type === 'succeeded') {
            var normalizedResponse = normalizationHelper.normalizeAnthropicResponse(line.result.message, model);
            normalizedResponse.rawResponse = line.result.message;
            results.push({
                customId: line.custom_id,
                success: true,
                response: normalizedResponse
            });
        } else if (line.result && line.result.type === 'errored') {
            results.push({
                customId: line.custom_id,
                success: false,
                error: errorHelper.createLLMError(
                    'Anthropic batch item error: ' + (line.result.error && line.result.error.message || 'Unknown error'),
                    errorHelper.ERROR_TYPES.ProviderError,
                    500,
                    line.result.error
                )
            });
        } else if (line.result && line.result.type === 'expired') {
            results.push({
                customId: line.custom_id,
                success: false,
                error: errorHelper.createLLMError(
                    'Anthropic batch item expired',
                    errorHelper.ERROR_TYPES.BatchExpiredError,
                    500,
                    null
                )
            });
        } else if (line.result && line.result.type === 'canceled') {
            results.push({
                customId: line.custom_id,
                success: false,
                error: errorHelper.createLLMError(
                    'Anthropic batch item was canceled',
                    errorHelper.ERROR_TYPES.ProviderError,
                    500,
                    null
                )
            });
        }
    }

    return results;
}

/**
 * Cancels an Anthropic batch.
 *
 * @param {string} batchId - The batch identifier
 * @returns {Object} Cancellation result with batchId and status
 * @throws {Error} ProviderError on failure
 */
function cancelBatch(batchId) {
    var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');
    var configHelper = require('*/cartridge/scripts/helpers/llmConfigHelper');

    var anthropicVersion = configHelper.getAnthropicApiVersion();

    var service = LocalServiceRegistry.createService(SERVICE_ID, {
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

            var baseUrl = credential.getURL() || 'https://api.anthropic.com';
            svc.setURL(baseUrl + '/v1/messages/batches/' + params.batchId + '/cancel');
            svc.setRequestMethod('POST');

            svc.addHeader('x-api-key', apiKey);
            svc.addHeader('anthropic-version', params.apiVersion);

            return null;
        },

        parseResponse: function (svc, client) {
            if (client.statusCode !== 200) {
                var errorBody = null;
                try {
                    errorBody = JSON.parse(client.text);
                } catch (e) {
                    errorBody = { message: client.text };
                }
                throw errorHelper.mapProviderError('anthropic', client.statusCode, errorBody);
            }

            return JSON.parse(client.text);
        },

        mockCall: function (svc, params) {
            return {
                statusCode: 200,
                statusMessage: 'OK',
                text: JSON.stringify({
                    id: params.batchId,
                    type: 'message_batch',
                    processing_status: 'canceling'
                })
            };
        },

        filterLogMessage: function (msg) {
            return errorHelper.sanitizeForLogging(msg);
        }
    });

    var result = service.call({ batchId: batchId, apiVersion: anthropicVersion });

    if (!result.ok) {
        var errorMessage = 'Anthropic batch cancellation failed';
        if (result.errorMessage) {
            errorMessage += ': ' + result.errorMessage;
        }
        logger.error(errorHelper.sanitizeForLogging(errorMessage));

        if (result.error && result.error.isLLMError) {
            throw result.error;
        }

        throw errorHelper.createLLMError(
            errorMessage,
            errorHelper.ERROR_TYPES.ProviderError,
            500,
            null
        );
    }

    return {
        batchId: batchId,
        status: 'cancelling'
    };
}

module.exports = {
    submitBatch: submitBatch,
    getBatchStatus: getBatchStatus,
    getBatchResults: getBatchResults,
    cancelBatch: cancelBatch,
    SERVICE_ID: SERVICE_ID
};
